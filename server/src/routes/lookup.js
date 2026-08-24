const express = require('express');
const dns = require('dns').promises;
const router = express.Router();
const { z } = require('zod');
const pool = require('../db/pool');
const { getGeo, getShodan, getWhois, getDns } = require('../services/apis');
const { getAbuse } = require('../services/abuse');
const { classifyQuery } = require('../utils/validate');

const CACHE_TTL_HOURS = Number(process.env.LOOKUP_CACHE_TTL_HOURS) || 24;

// Only the raw query comes from the client now. `type` is no longer
// accepted here - it's derived server-side by classifyQuery() below.
// Trusting a client-declared type is risky: a mismatched type would
// send a domain string into an IP-only service (or vice versa) and
// previously failed silently or behaved unpredictably.
const lookupSchema = z.object({
  query: z.string().trim().min(1).max(255),
});

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  // x-forwarded-for can be a comma-separated chain (client, proxy1, proxy2...)
  // - the original code took the whole header as-is, which breaks logging
  // once you're behind Render/Vercel's proxy layer.
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress;
}

// Normalizes a Promise.allSettled result into a uniform { ...data } | { error }
// shape. Previously a failed source just became `null`, giving the frontend
// (and you, debugging) no idea *why* geo/shodan/whois/dns came back empty.
function unwrap(settled, label) {
  if (settled.status === 'fulfilled') return settled.value;
  return { error: `${label} lookup failed: ${settled.reason?.message || 'unknown error'}` };
}

async function resolveToIp(domain) {
  try {
    const addresses = await dns.resolve4(domain);
    return addresses[0] || null;
  } catch {
    return null;
  }
}

async function reverseDns(ip) {
  try {
    const hostnames = await dns.reverse(ip);
    return { ptr: hostnames };
  } catch (err) {
    return { error: `reverse DNS failed: ${err.message}` };
  }
}

router.post('/', async (req, res) => {
  try {
    // 1. Validate input, then classify + SSRF-check it server-side.
    // classifyQuery() throws (400) on malformed input AND on private/
    // loopback/link-local IPs - without that second check, this endpoint
    // could be used to probe your own infrastructure or cloud metadata
    // endpoints (e.g. 169.254.169.254) via your server as a relay.
    const { query: rawQuery } = lookupSchema.parse(req.body);
    const { value: query, type } = classifyQuery(rawQuery);
    const clientIp = getClientIp(req);

    // 2. Check database cache
    const cacheCheck = await pool.query(
      `SELECT * FROM lookups WHERE query = $1 AND created_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours' ORDER BY created_at DESC LIMIT 1`,
      [query]
    );

    let resultData;
    let lookupId;
    let fromCache = false;

    if (cacheCheck.rows.length > 0) {
      resultData = cacheCheck.rows[0];
      lookupId = resultData.id;
      fromCache = true;
    } else {
      // CACHE MISS: fetch from every applicable source concurrently.
      let geo, shodan, whois, dnsRecords, abuse;

      if (type === 'ip') {
        // Previously an IP query only fetched geo + shodan. WHOIS/RDAP,
        // reverse DNS, and abuse reputation are just as relevant for an
        // IP and are now included too.
        const results = await Promise.allSettled([
          getGeo(query),
          getShodan(query),
          getWhois(query),
          reverseDns(query),
          getAbuse(query),
        ]);
        [geo, shodan, whois, dnsRecords, abuse] = [
          unwrap(results[0], 'geolocation'),
          unwrap(results[1], 'shodan'),
          unwrap(results[2], 'whois'),
          unwrap(results[3], 'dns'),
          unwrap(results[4], 'abuse'),
        ];
      } else {
        // Previously a domain query only fetched whois + dns. Now we also
        // resolve it to an IP so geo, shodan, and abuse data are available
        // for domains too - a domain lookup returned zero of that before.
        const resolvedIp = await resolveToIp(query);
        const skipped = { skipped: true, reason: 'domain did not resolve to an IPv4 address' };

        const results = await Promise.allSettled([
          getWhois(query),
          getDns(query),
          resolvedIp ? getGeo(resolvedIp) : Promise.resolve(skipped),
          resolvedIp ? getShodan(resolvedIp) : Promise.resolve(skipped),
          resolvedIp ? getAbuse(resolvedIp) : Promise.resolve(skipped),
        ]);

        [whois, dnsRecords, geo, shodan, abuse] = [
          unwrap(results[0], 'whois'),
          unwrap(results[1], 'dns'),
          unwrap(results[2], 'geolocation'),
          unwrap(results[3], 'shodan'),
          unwrap(results[4], 'abuse'),
        ];
        if (geo && typeof geo === 'object' && !geo.error) geo.resolvedIp = resolvedIp;
      }

      // 3. Save to cache. If the insert itself fails (e.g. transient DB
      // hiccup, or a race with a concurrent identical request), fall back
      // to returning the freshly-fetched data directly instead of a 500 -
      // the person still gets an answer even though nothing was cached.
      try {
        const insertCache = await pool.query(
          `INSERT INTO lookups (query, query_type, geo_data, whois_data, dns_data, shodan_data, abuse_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [query, type, geo, whois, dnsRecords, shodan, abuse]
        );
        resultData = insertCache.rows[0];
        lookupId = resultData.id;
      } catch (dbErr) {
        console.error('Failed to write lookup cache:', dbErr.message);
        resultData = {
          query,
          query_type: type,
          geo_data: geo,
          whois_data: whois,
          dns_data: dnsRecords,
          shodan_data: shodan,
          abuse_data: abuse,
          created_at: new Date().toISOString(),
        };
        lookupId = null;
      }
    }

    // 4. Log search history - fire and forget, never blocks the response.
    if (lookupId) {
      pool
        .query(`INSERT INTO search_history (lookup_id, user_ip) VALUES ($1, $2)`, [lookupId, clientIp])
        .catch((err) => console.error('Failed to log search history:', err.message));
    }

    return res.json({ cached: fromCache, ...resultData });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request: query is required' });
    }
    // classifyQuery() throws errors with a statusCode (400) for bad
    // format or blocked private/reserved IPs - surface those as-is
    // instead of masking everything as a generic 500.
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Server encountered an error processing the lookup.' });
  }
});

// GET /api/lookup/activity - daily search counts for the last 14 days,
// powering the frontend's activity chart. Mounted on the same router at a
// different path/method than POST '/', so there's no route conflict.
router.get('/activity', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DATE_TRUNC('day', created_at) AS day, COUNT(*)::int AS count
       FROM search_history
       WHERE created_at > NOW() - INTERVAL '14 days'
       GROUP BY day
       ORDER BY day ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch activity stats:', err.message);
    res.status(500).json({ error: 'Could not load activity data.' });
  }
});

module.exports = router;