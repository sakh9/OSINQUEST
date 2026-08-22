const dns = require('dns').promises;

// IP Geolocation
const getGeo = async (ip) => {
  const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,lat,lon,isp,org,as`);
  return res.json();
};

// Shodan InternetDB
const getShodan = async (ip) => {
  const res = await fetch(`https://internetdb.shodan.io/${ip}`);
  if (!res.ok) return { ports: [], vulns: [], hostnames: [] };
  return res.json();
};

// RDAP WHOIS for Domains (with redirect handling)
const getWhois = async (domain) => {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, { redirect: 'follow' });
    if (!res.ok) return { registrar: 'Unknown', handle: domain };
    const data = await res.json();
    return {
      ldhName: data.ldhName || domain,
      handle: data.handle || 'N/A',
      status: data.status || [],
      events: data.events || []
    };
  } catch (err) {
    return { ldhName: domain, status: ['Lookup failed'] };
  }
};

// DNS Records
const getDns = async (domain) => {
  try {
    const [a, mx, txt, ns] = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolveMx(domain),
      dns.resolveTxt(domain),
      dns.resolveNs(domain)
    ]);
    return {
      A: a.status === 'fulfilled' ? a.value : [],
      MX: mx.status === 'fulfilled' ? mx.value.map(m => `${m.priority} ${m.exchange}`) : [],
      TXT: txt.status === 'fulfilled' ? txt.value.flat() : [],
      NS: ns.status === 'fulfilled' ? ns.value : []
    };
  } catch (err) {
    return { A: [], MX: [], TXT: [], NS: [] };
  }
};

module.exports = { getGeo, getShodan, getWhois, getDns };