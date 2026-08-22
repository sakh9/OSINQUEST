const fetch = require('node-fetch');

/**
 * AbuseIPDB reputation check - free tier gives 1000 checks/day with a key
 * from https://www.abuseipdb.com/register. Returns a structured "skipped"
 * result rather than throwing if no key is configured, so the rest of the
 * lookup still works without it.
 */
async function getAbuse(ip) {
  const apiKey = process.env.ABUSEIPDB_KEY;
  if (!apiKey) {
    return { skipped: true, reason: 'ABUSEIPDB_KEY not configured' };
  }

  const res = await fetch(
    `https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=90`,
    { headers: { Key: apiKey, Accept: 'application/json' } }
  );

  if (!res.ok) {
    throw new Error(`AbuseIPDB responded with status ${res.status}`);
  }

  const { data } = await res.json();
  return {
    abuseConfidenceScore: data.abuseConfidenceScore,
    totalReports: data.totalReports,
    lastReportedAt: data.lastReportedAt,
    isTor: data.isTor,
    usageType: data.usageType,
  };
}

module.exports = { getAbuse };