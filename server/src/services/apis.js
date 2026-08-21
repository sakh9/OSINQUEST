const dns = require('dns').promises;

// IP Geolocation (ip-api.com - Free, no key)
const getGeo = async (ip) => {
  const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,lat,lon,isp,org,as`);
  return res.json();
};

// Shodan InternetDB (Free, no key, returns open ports & vulns)
const getShodan = async (ip) => {
  const res = await fetch(`https://internetdb.shodan.io/${ip}`);
  if (!res.ok) return { ports: [], vulns: [], hostnames: [] };
  return res.json();
};

// RDAP for WHOIS data (Modern JSON standard, no key)
const getWhois = async (domain) => {
  const res = await fetch(`https://rdap.org/domain/${domain}`);
  if (!res.ok) throw new Error('RDAP lookup failed');
  return res.json();
};

// Native DNS resolution
const getDns = async (domain) => {
  try {
    const [a, mx, txt] = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolveMx(domain),
      dns.resolveTxt(domain)
    ]);
    return {
      A: a.status === 'fulfilled' ? a.value : [],
      MX: mx.status === 'fulfilled' ? mx.value : [],
      TXT: txt.status === 'fulfilled' ? txt.value.flat() : []
    };
  } catch (err) {
    return {};
  }
};

module.exports = { getGeo, getShodan, getWhois, getDns };