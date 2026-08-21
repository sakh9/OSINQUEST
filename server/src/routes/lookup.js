const express = require('express');
const router = express.Router();
const { z } = require('zod');
const pool = require('../db/pool');
const { getGeo, getShodan, getWhois, getDns } = require('../services/apis');

// Validation schema
const lookupSchema = z.object({
  query: z.string().trim().min(1),
  type: z.enum(['ip', 'domain'])
});

router.post('/', async (req, res) => {
  try {
    // 1. Validate Input
    const { query, type } = lookupSchema.parse(req.body);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // 2. Check Database Cache (Is data < 24 hours old?)
    const cacheCheck = await pool.query(
      `SELECT * FROM lookups WHERE query = $1 AND created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 1`,
      [query]
    );

    let resultData;
    let lookupId;

    if (cacheCheck.rows.length > 0) {
      // CACHE HIT
      resultData = cacheCheck.rows[0];
      lookupId = resultData.id;
    } else {
      // CACHE MISS: Fetch from APIs concurrently
      let geo = null, shodan = null, whois = null, dnsRecords = null;

      if (type === 'ip') {
        const results = await Promise.allSettled([getGeo(query), getShodan(query)]);
        geo = results[0].status === 'fulfilled' ? results[0].value : null;
        shodan = results[1].status === 'fulfilled' ? results[1].value : null;
      } else {
        const results = await Promise.allSettled([getWhois(query), getDns(query)]);
        whois = results[0].status === 'fulfilled' ? results[0].value : null;
        dnsRecords = results[1].status === 'fulfilled' ? results[1].value : null;
      }

      // Save to lookups cache table
      const insertCache = await pool.query(
        `INSERT INTO lookups (query, query_type, geo_data, whois_data, dns_data, shodan_data) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [query, type, geo, whois, dnsRecords, shodan]
      );
      resultData = insertCache.rows[0];
      lookupId = resultData.id;
    }

    // 3. Log the search in history asynchronously (don't block the response)
    pool.query(`INSERT INTO search_history (lookup_id, user_ip) VALUES ($1, $2)`, [lookupId, clientIp]).catch(console.error);

    return res.json(resultData);

  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid IP or Domain format' });
    console.error(err);
    res.status(500).json({ error: 'Server encountered an error processing the lookup.' });
  }
});

module.exports = router;