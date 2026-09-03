const dns = require('dns').promises;
const { isIp } = require('../utils/validate');

const DEFAULT_TIMEOUT_MS = 8000;

// Every one of these calls hits a free third-party API with no SLA. Without
// a timeout, one slow/hung response holds the whole lookup request open
// until Render's platform-level timeout kills it (or the browser gives up).
// AbortController lets us fail fast and report *why* instead of just hanging.
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${new URL(url).hostname} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// IP Geolocation - tries ip-api.com first, falls back to ipwho.is if the
// primary is down, rate-limited, or times out. Both calls go through the
// shared fetchWithTimeout() helper so neither one can hang the request
// indefinitely - a bug in an earlier version of this function gave the
// fallback call no timeout at all, meaning a hung ipwho.is response could
// stall the entire /api/lookup request forever, regardless of how fast
// every other data source responded.
const getGeo = async (ip) => {
  try {
    const res = await fetchWithTimeout(
      `http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,lat,lon,isp,org,as`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        return {
          isp: data.isp,
          org: data.org || data.as,
          city: data.city,
          country: data.country,
          lat: data.lat,
          lon: data.lon,
        };
      }
    }
  } catch (err) {
    console.warn(`[Geo API] Primary ip-api.com failed for ${ip}: ${err.message}. Trying fallback...`);
  }

  // Fallback Attempt: ipwho.is (Free, no key required, HTTPS support)
  try {
    const fallbackRes = await fetchWithTimeout(`https://ipwho.is/${ip}`);
    if (fallbackRes.ok) {
      const fbData = await fallbackRes.json();
      if (fbData.success) {
        return {
          isp: fbData.connection?.isp || 'Unknown',
          org: fbData.connection?.org || fbData.connection?.asn,
          city: fbData.city,
          country: fbData.country,
          lat: fbData.latitude,
          lon: fbData.longitude
        };
      }
    }
  } catch (err) {
    console.error(`[Geo API] Fallback geo lookup also failed for ${ip}: ${err.message}`);
  }

  // Throwing here (rather than returning { error: ... } as a normal value)
  // matches every other function in this file: it lets unwrap() in lookup.js
  // apply the same consistent "X lookup failed: ..." labeling to every
  // source, instead of geo being the one field with a differently-shaped
  // failure object the frontend has to special-case.
  throw new Error('all providers unavailable (ip-api.com and ipwho.is)');
};

// Shodan InternetDB
const getShodan = async (ip) => {
  const res = await fetchWithTimeout(`https://internetdb.shodan.io/${ip}`);
  if (res.status === 404) {
    // Not an error - InternetDB just has nothing on file for this host.
    // Worth distinguishing from a real failure (5xx/timeout) below.
    return { ip, ports: [], vulns: [], hostnames: [], note: 'No data on file for this host' };
  }
  if (!res.ok) {
    throw new Error(`Shodan InternetDB responded with status ${res.status}`);
  }
  return res.json();
};

// RDAP WHOIS - now handles both domains and IPs, and no longer swallows
// real failures. Previously this only ever queried /domain/{value}, so
// every IP lookup silently got back {registrar:'Unknown'} instead of
// actual RDAP network/allocation data. Errors are now thrown instead of
// caught-and-faked, so the router's error handling (unwrap in lookup.js)
// can report the real reason to the frontend.
const getWhois = async (query) => {
  const url = isIp(query) ? `https://rdap.org/ip/${query}` : `https://rdap.org/domain/${query}`;

  const customHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OSINQUEST-OSINT-Engine/1.0',
    'Accept': 'application/rdap+json, application/json',
  };

  try {
    const res = await fetchWithTimeout(url, {
      redirect: 'follow',
      headers: customHeaders,
    });

    if (res.status === 404) {
      return { status: ['No RDAP record found'], handle: query };
    }

    if (res.ok) {
      const data = await res.json();
      return {
        name: data.ldhName || data.name || query,
        handle: data.handle || 'N/A',
        startAddress: data.startAddress || null,
        endAddress: data.endAddress || null,
        country: data.country || null,
        status: data.status || [],
        events: (data.events || []).map((e) => ({ action: e.eventAction, date: e.eventDate })),
        nameservers: (data.nameservers || []).map((ns) => ns.ldhName).filter(Boolean),
      };
    }
    
    console.warn(`[RDAP WHOIS] Primary RDAP returned status ${res.status} for ${query}. Attempting fallback...`);
  } catch (err) {
    console.warn(`[RDAP WHOIS] Primary RDAP failed for ${query}: ${err.message}. Trying fallback...`);
  }

  // Fallback Attempt: ipwho.is for IP queries if RDAP.org returned 403/Forbidden
  if (isIp(query)) {
    try {
      const fallbackRes = await fetchWithTimeout(`https://ipwho.is/${query}`);
      if (fallbackRes.ok) {
        const fbData = await fallbackRes.json();
        if (fbData.success) {
          return {
            name: fbData.connection?.org || fbData.connection?.isp || query,
            handle: fbData.connection?.asn ? `AS${fbData.connection.asn}` : 'N/A',
            startAddress: fbData.ip,
            endAddress: fbData.ip,
            country: fbData.country,
            status: ['active (fallback)'],
            events: [],
            nameservers: [],
          };
        }
      }
    } catch (fbErr) {
      console.error(`[RDAP WHOIS] Fallback query failed for ${query}: ${fbErr.message}`);
    }
  }

  throw new Error('RDAP WHOIS lookup failed or access was forbidden (403)');
};

// DNS Records - added AAAA/CNAME for parity with what a real DNS toolkit
// shows, and now throws if literally nothing resolved (likely means the
// domain doesn't exist) rather than returning an all-empty object that's
// indistinguishable from "this domain just has no MX record," which is normal.
const getDns = async (domain) => {
  const [a, aaaa, mx, txt, ns, cname] = await Promise.allSettled([
    dns.resolve4(domain),
    dns.resolve6(domain),
    dns.resolveMx(domain),
    dns.resolveTxt(domain),
    dns.resolveNs(domain),
    dns.resolveCname(domain),
  ]);

  const record = {
    A: a.status === 'fulfilled' ? a.value : [],
    AAAA: aaaa.status === 'fulfilled' ? aaaa.value : [],
    MX: mx.status === 'fulfilled' ? mx.value.map((m) => `${m.priority} ${m.exchange}`) : [],
    TXT: txt.status === 'fulfilled' ? txt.value.flat() : [],
    NS: ns.status === 'fulfilled' ? ns.value : [],
    CNAME: cname.status === 'fulfilled' ? cname.value : [],
  };

  const hasAnyRecord = Object.values(record).some((arr) => arr.length > 0);
  if (!hasAnyRecord) {
    throw new Error('No DNS records found - domain may not exist or is not delegated');
  }

  return record;
};

module.exports = { getGeo, getShodan, getWhois, getDns };