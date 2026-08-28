const { classifyQuery, isIp, isDomain, isPrivateOrReservedIp, normalizeInput } = require('../src/utils/validate');

describe('classifyQuery', () => {
  test('classifies valid IPv4 addresses', () => {
    expect(classifyQuery('8.8.8.8')).toEqual({ value: '8.8.8.8', type: 'ip' });
  });

  test('classifies valid IPv6 addresses', () => {
    expect(classifyQuery('2001:4860:4860::8888')).toEqual({ value: '2001:4860:4860::8888', type: 'ip' });
  });

  test('does not mangle IPv6 addresses ending in digits (regression)', () => {
    // These specific addresses previously got truncated by the port-strip
    // logic treating their trailing ":<digits>" group as a port suffix.
    expect(classifyQuery('2001:db8::1').value).toBe('2001:db8::1');
    expect(() => classifyQuery('fe80::1')).toThrow(/private, loopback/i); // link-local, correctly blocked
    expect(() => classifyQuery('::1')).toThrow(/private, loopback/i); // loopback, correctly blocked (not "invalid format")
  });

  test('handles bracketed IPv6 with a port', () => {
    expect(classifyQuery('[2001:4860:4860::8888]:443')).toEqual({
      value: '2001:4860:4860::8888',
      type: 'ip',
    });
  });

  test('classifies valid domains', () => {
    expect(classifyQuery('example.com')).toEqual({ value: 'example.com', type: 'domain' });
  });

  test('strips protocol, path, and port from input', () => {
    expect(classifyQuery('HTTPS://Example.COM:8080/some/path')).toEqual({
      value: 'example.com',
      type: 'domain',
    });
  });

  test('rejects garbage input', () => {
    expect(() => classifyQuery('not a real query!!')).toThrow(/valid public IP/);
  });

  test('rejects empty input', () => {
    expect(() => classifyQuery('')).toThrow();
  });

  test('rejects input under 3 characters', () => {
    expect(() => classifyQuery('a.')).toThrow();
  });

  test('rejects non-string input without crashing', () => {
    expect(() => classifyQuery(null)).toThrow();
    expect(() => classifyQuery(undefined)).toThrow();
    expect(() => classifyQuery(12345)).toThrow();
  });

  // SSRF guard - the most important behavior in this file. A public OSINT
  // tool that proxies requests to third-party APIs must never let a
  // caller point it at internal infrastructure.
  test('blocks private IPv4 ranges (10.x, 172.16-31.x, 192.168.x)', () => {
    expect(() => classifyQuery('10.0.0.1')).toThrow(/private, loopback/i);
    expect(() => classifyQuery('172.16.0.1')).toThrow(/private, loopback/i);
    expect(() => classifyQuery('172.31.255.255')).toThrow(/private, loopback/i);
    expect(() => classifyQuery('192.168.1.1')).toThrow(/private, loopback/i);
  });

  test('does NOT block 172.x addresses outside the 16-31 private range', () => {
    // 172.15.x and 172.32.x are public - only 172.16.0.0/12 is private.
    expect(() => classifyQuery('172.15.0.1')).not.toThrow();
    expect(() => classifyQuery('172.32.0.1')).not.toThrow();
  });

  test('blocks loopback addresses', () => {
    expect(() => classifyQuery('127.0.0.1')).toThrow();
    expect(() => classifyQuery('::1')).toThrow();
  });

  test('blocks link-local / cloud metadata range', () => {
    expect(() => classifyQuery('169.254.169.254')).toThrow();
  });

  test('allows a normal public IP through', () => {
    expect(() => classifyQuery('1.1.1.1')).not.toThrow();
  });
});

describe('isIp', () => {
  test('rejects an out-of-range IPv4 octet', () => {
    expect(isIp('999.999.999.999')).toBe(false);
  });

  test('rejects an IPv4 address with too few octets', () => {
    expect(isIp('8.8.8')).toBe(false);
  });

  test('accepts a basic IPv6 address', () => {
    expect(isIp('2001:4860:4860::8888')).toBe(true);
  });
});

describe('isDomain', () => {
  test('rejects a domain with a leading-hyphen label', () => {
    expect(isDomain('-example.com')).toBe(false);
  });

  test('rejects a bare TLD with no dot', () => {
    expect(isDomain('localhost')).toBe(false);
  });

  test('accepts a normal domain', () => {
    expect(isDomain('sub.example.co.uk')).toBe(true);
  });
});

describe('isPrivateOrReservedIp', () => {
  test('flags 0.0.0.0 as reserved', () => {
    expect(isPrivateOrReservedIp('0.0.0.1')).toBe(true);
  });

  test('flags multicast/reserved range (224+)', () => {
    expect(isPrivateOrReservedIp('224.0.0.1')).toBe(true);
  });

  test('does not flag a normal public IP', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
  });
});

describe('normalizeInput', () => {
  test('lowercases and trims', () => {
    expect(normalizeInput('  Example.COM  ')).toBe('example.com');
  });

  test('strips http/https protocol', () => {
    expect(normalizeInput('http://example.com')).toBe('example.com');
  });

  test('strips trailing path', () => {
    expect(normalizeInput('example.com/foo/bar')).toBe('example.com');
  });

  test('strips trailing port', () => {
    expect(normalizeInput('example.com:8080')).toBe('example.com');
    expect(normalizeInput('1.2.3.4:8080')).toBe('1.2.3.4');
  });

  test('does NOT strip what looks like a port from a bare IPv6 address', () => {
    expect(normalizeInput('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeInput('fe80::1')).toBe('fe80::1');
  });

  test('extracts address from bracketed IPv6 with a port', () => {
    expect(normalizeInput('[::1]:8080')).toBe('::1');
    expect(normalizeInput('[2001:db8::1]')).toBe('2001:db8::1');
  });
});