const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const IPV6_REGEX =
  /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,7}:$|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^::([0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$|^::$/;

const DOMAIN_REGEX =
  /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

function isIp(value) {
  return IPV4_REGEX.test(value) || IPV6_REGEX.test(value);
}

function isDomain(value) {
  return DOMAIN_REGEX.test(value);
}

/**
 * Blocks private, loopback, link-local, and other non-public ranges.
 * Important for an OSINT tool that proxies requests to third-party APIs -
 * without this, someone could point your server at 127.0.0.1 or
 * 169.254.169.254 (cloud metadata endpoints) and use it as an SSRF probe.
 */
function isPrivateOrReservedIp(ip) {
  if (IPV4_REGEX.test(ip)) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true; // "this" network
    if (a >= 224) return true; // multicast/reserved
    return false;
  }

  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  return false;
}

/**
 * Normalizes raw user input: strips protocol/path, lowercases, trims.
 */
function normalizeInput(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, ''); // strip a trailing :port if someone pastes host:port
}

/**
 * Authoritative server-side classification. Deliberately ignores any
 * `type` the client may send - the server must never trust the client
 * to correctly declare what kind of input it's sending, since that
 * value drives which external services get called.
 */
function classifyQuery(rawQuery) {
  if (typeof rawQuery !== 'string' || rawQuery.trim().length < 3) {
    const err = new Error('Query must be a non-empty IP address or domain name');
    err.statusCode = 400;
    throw err;
  }

  const value = normalizeInput(rawQuery);

  if (isIp(value)) {
    if (isPrivateOrReservedIp(value)) {
      const err = new Error('Private, loopback, and reserved IP ranges cannot be looked up');
      err.statusCode = 400;
      throw err;
    }
    return { value, type: 'ip' };
  }

  if (isDomain(value)) {
    return { value, type: 'domain' };
  }

  const err = new Error('Input must be a valid public IP address or domain name');
  err.statusCode = 400;
  throw err;
}

module.exports = { classifyQuery, isIp, isDomain, isPrivateOrReservedIp, normalizeInput };