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

// IP Geolocation
const getGeo = async (ip) => {
  // Primary Attempt: ip-api.com
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout before failover

    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,lat,lon,isp,org,as`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        return {
          isp: data.isp,
          org: data.org || data.as,
          city: data.city,
          country: data.country,
          lat: data.lat,
          lon: data.lon
        };
      }
    }
  } catch (err) {
    console.warn(`[Geo API] Primary ip-api.com failed for ${ip}, trying fallback...`);
  }

  // Fallback Attempt: ipwho.is (Free, no key required, HTTPS support)
  try {
    const fallbackRes = await fetch(`https://ipwho.is/${ip}`);
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
    console.error(`[Geo API] Fallback geo lookup also failed for ${ip}`);
  }

  return { error: 'Geolocation lookup timed out across all providers.' };
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

  const res = await fetchWithTimeout(url, { redirect: 'follow' });

  if (res.status === 404) {
    return { status: ['No RDAP record found'], handle: query };
  }
  if (!res.ok) {
    throw new Error(`RDAP lookup responded with status ${res.status}`);
  }

  const data = await res.json();

  // Domain RDAP responses use `ldhName`; IP/network RDAP responses use
  // `name` + `startAddress`/`endAddress`/`country` instead. Normalizing
  // both shapes here means the frontend never has to branch on query type.
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