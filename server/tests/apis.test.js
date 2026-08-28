// Mocked at module scope (not inside a describe block) so Jest's hoisting
// guarantees apis.js gets this mock when IT calls require('dns') internally -
// jest.mock() only reliably intercepts requires that happen after it's
// registered, and apis.js is required immediately below.
jest.mock('dns', () => ({
  promises: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
    resolveMx: jest.fn(),
    resolveTxt: jest.fn(),
    resolveNs: jest.fn(),
    resolveCname: jest.fn(),
  },
}));

const { getGeo, getShodan, getWhois, getDns } = require('../src/services/apis');

// Every test mocks global.fetch directly - no real network calls, no
// dependency on third-party API uptime.
beforeEach(() => {
  global.fetch = jest.fn();
});

describe('getGeo', () => {
  test('returns data from the primary provider on success', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', isp: 'Google', as: 'AS15169 Google LLC', city: 'Mountain View', country: 'US', lat: 37.4, lon: -122.0 }),
    });

    const result = await getGeo('8.8.8.8');
    expect(result).toEqual({ isp: 'Google', org: 'AS15169 Google LLC', city: 'Mountain View', country: 'US', lat: 37.4, lon: -122.0 });
    expect(global.fetch).toHaveBeenCalledTimes(1); // fallback should NOT be called
  });

  test('falls back to the secondary provider when the primary throws', async () => {
    global.fetch
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, connection: { isp: 'Cloudflare', org: 'CF' }, city: 'Sydney', country: 'Australia', latitude: -33.8, longitude: 151.2 }),
      });

    const result = await getGeo('1.1.1.1');
    expect(result.isp).toBe('Cloudflare');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('falls back when the primary returns HTTP 200 but status:"fail" (e.g. rate limited)', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'fail', message: 'quota exceeded' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, connection: { isp: 'Backup ISP' }, city: 'X', country: 'Y', latitude: 1, longitude: 1 }),
      });

    const result = await getGeo('2.2.2.2');
    expect(result.isp).toBe('Backup ISP');
  });

  test('throws when both providers fail', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    await expect(getGeo('3.3.3.3')).rejects.toThrow(/all providers unavailable/);
  });
});

describe('getShodan', () => {
  test('returns parsed JSON on success', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ports: [22, 80], vulns: [], hostnames: [] }),
    });
    const result = await getShodan('8.8.8.8');
    expect(result.ports).toEqual([22, 80]);
  });

  test('treats 404 as "no data", not an error', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await getShodan('8.8.8.8');
    expect(result).toEqual({ ip: '8.8.8.8', ports: [], vulns: [], hostnames: [], note: 'No data on file for this host' });
  });

  test('throws on a real server error (5xx)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(getShodan('8.8.8.8')).rejects.toThrow(/status 503/);
  });
});

describe('getWhois', () => {
  test('queries the /ip/ endpoint for an IP', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ name: 'GOOGLE', handle: 'NET-8-8-8-0-1', country: 'US', startAddress: '8.8.8.0', endAddress: '8.8.8.255', status: ['active'] }),
    });
    await getWhois('8.8.8.8');
    expect(global.fetch).toHaveBeenCalledWith('https://rdap.org/ip/8.8.8.8', expect.any(Object));
  });

  test('queries the /domain/ endpoint for a domain', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ldhName: 'EXAMPLE.COM', handle: 'ABC123', status: ['active'], nameservers: [] }),
    });
    await getWhois('example.com');
    expect(global.fetch).toHaveBeenCalledWith('https://rdap.org/domain/example.com', expect.any(Object));
  });

  test('normalizes domain (ldhName) and IP (name) RDAP shapes to the same output shape', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ldhName: 'EXAMPLE.COM', handle: 'ABC', status: ['active'], nameservers: [{ ldhName: 'ns1.example.com' }] }),
    });
    const result = await getWhois('example.com');
    expect(result.name).toBe('EXAMPLE.COM');
    expect(result.nameservers).toEqual(['ns1.example.com']);
  });

  test('returns a soft "not found" result on 404, not an error', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await getWhois('8.8.8.8');
    expect(result.status).toContain('No RDAP record found');
  });

  test('throws on a real server error', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(getWhois('8.8.8.8')).rejects.toThrow(/status 500/);
  });
});

describe('getDns', () => {
  test('returns combined records when at least one type resolves', async () => {
    const dns = require('dns').promises;
    dns.resolve4.mockResolvedValue(['93.184.216.34']);
    dns.resolve6.mockRejectedValue(new Error('no AAAA'));
    dns.resolveMx.mockResolvedValue([{ priority: 10, exchange: 'mail.example.com' }]);
    dns.resolveTxt.mockResolvedValue([['v=spf1 -all']]);
    dns.resolveNs.mockResolvedValue(['ns1.example.com']);
    dns.resolveCname.mockRejectedValue(new Error('no CNAME'));

    const result = await getDns('example.com');
    expect(result.A).toEqual(['93.184.216.34']);
    expect(result.AAAA).toEqual([]);
    expect(result.MX).toEqual(['10 mail.example.com']);
    expect(result.NS).toEqual(['ns1.example.com']);
  });

  test('throws when literally nothing resolves (likely nonexistent domain)', async () => {
    const dns = require('dns').promises;
    dns.resolve4.mockRejectedValue(new Error('ENOTFOUND'));
    dns.resolve6.mockRejectedValue(new Error('ENOTFOUND'));
    dns.resolveMx.mockRejectedValue(new Error('ENOTFOUND'));
    dns.resolveTxt.mockRejectedValue(new Error('ENOTFOUND'));
    dns.resolveNs.mockRejectedValue(new Error('ENOTFOUND'));
    dns.resolveCname.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(getDns('nonexistent-domain-xyz.invalid')).rejects.toThrow(/No DNS records found/);
  });
});