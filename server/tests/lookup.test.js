const express = require('express');
const request = require('supertest');

// All mocked before requiring the router, so lookup.js gets these mocks
// when it does its own require() calls internally.
jest.mock('../src/db/pool', () => ({ query: jest.fn(), end: jest.fn() }));
jest.mock('../src/services/apis', () => ({
  getGeo: jest.fn(),
  getShodan: jest.fn(),
  getWhois: jest.fn(),
  getDns: jest.fn(),
}));
jest.mock('../src/services/abuse', () => ({ getAbuse: jest.fn() }));
jest.mock('dns', () => ({ promises: { resolve4: jest.fn(), reverse: jest.fn() } }));

const pool = require('../src/db/pool');
const { getGeo, getShodan, getWhois, getDns } = require('../src/services/apis');
const { getAbuse } = require('../src/services/abuse');
const dns = require('dns').promises;
const lookupRouter = require('../src/routes/lookup');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/lookup', lookupRouter);
  return app;
}

// Routes pool.query calls to canned responses based on the SQL text,
// rather than relying on call order - more robust and easier to read
// per-test than a brittle sequence of mockImplementationOnce calls.
function mockPoolResponses({ cacheRows = [], insertedRow = null, activityRows = [], statsTotal = 0 } = {}) {
  pool.query.mockImplementation((sql) => {
    if (sql.includes('FROM lookups WHERE query')) return Promise.resolve({ rows: cacheRows });
    if (sql.includes('INSERT INTO lookups')) return Promise.resolve({ rows: insertedRow ? [insertedRow] : [] });
    if (sql.includes('INSERT INTO search_history')) return Promise.resolve({ rows: [] });
    if (sql.includes("DATE_TRUNC('day'")) return Promise.resolve({ rows: activityRows });
    if (sql.includes('COUNT(*)::int AS total')) return Promise.resolve({ rows: [{ total: statsTotal }] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/lookup - validation', () => {
  test('rejects a request with no query', async () => {
    mockPoolResponses();
    const app = buildApp();
    const res = await request(app).post('/api/lookup').send({});
    expect(res.status).toBe(400);
  });

  test('rejects private/reserved IPs (SSRF guard)', async () => {
    mockPoolResponses();
    const app = buildApp();
    const res = await request(app).post('/api/lookup').send({ query: '192.168.1.1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private, loopback/i);
    // Confirms it's rejected before any external call is attempted.
    expect(getGeo).not.toHaveBeenCalled();
  });

  test('ignores a client-supplied "type" field entirely', async () => {
    // Even if the client sends type:'domain' for something that's actually
    // an IP, the server must classify it itself - this is the whole point
    // of not trusting client-declared type.
    mockPoolResponses({ cacheRows: [{ id: 1, query: '8.8.8.8', query_type: 'ip', created_at: new Date() }] });
    const app = buildApp();
    const res = await request(app).post('/api/lookup').send({ query: '8.8.8.8', type: 'domain' });
    expect(res.status).toBe(200);
    expect(res.body.query_type).toBe('ip');
  });
});

describe('POST /api/lookup - caching', () => {
  test('returns a cached row without calling any external service', async () => {
    mockPoolResponses({
      cacheRows: [{ id: 1, query: '8.8.8.8', query_type: 'ip', geo_data: { isp: 'Google' }, created_at: new Date() }],
    });
    const app = buildApp();
    const res = await request(app).post('/api/lookup').send({ query: '8.8.8.8' });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.geo_data.isp).toBe('Google');
    expect(getGeo).not.toHaveBeenCalled();
    expect(getShodan).not.toHaveBeenCalled();
  });

  test('fetches from all sources on a cache miss and marks cached:false', async () => {
    mockPoolResponses({
      cacheRows: [],
      insertedRow: { id: 2, query: '8.8.8.8', query_type: 'ip', geo_data: { isp: 'Google' }, created_at: new Date() },
    });
    getGeo.mockResolvedValue({ isp: 'Google', city: 'Mountain View' });
    getShodan.mockResolvedValue({ ports: [53] });
    getWhois.mockResolvedValue({ name: 'GOOGLE' });
    getAbuse.mockResolvedValue({ abuseConfidenceScore: 0 });
    dns.reverse.mockResolvedValue(['dns.google']);

    const app = buildApp();
    const res = await request(app).post('/api/lookup').send({ query: '8.8.8.8' });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(getGeo).toHaveBeenCalledWith('8.8.8.8');
    expect(getShodan).toHaveBeenCalledWith('8.8.8.8');
    expect(getWhois).toHaveBeenCalledWith('8.8.8.8');
    expect(getAbuse).toHaveBeenCalledWith('8.8.8.8');
  });
});

describe('POST /api/lookup - graceful degradation', () => {
  test('a failed source shows up as a labeled error, without failing the whole request', async () => {
    mockPoolResponses({
      cacheRows: [],
      insertedRow: { id: 3, query: '8.8.8.8', query_type: 'ip', created_at: new Date() },
    });
    getGeo.mockResolvedValue({ isp: 'Google' });
    getShodan.mockResolvedValue({ ports: [] });
    getWhois.mockRejectedValue(new Error('RDAP lookup responded with status 503'));
    getAbuse.mockResolvedValue({ abuseConfidenceScore: 0 });
    dns.reverse.mockResolvedValue([]);

    const app = buildApp();
    const res = await request(app).post('/api/lookup').send({ query: '8.8.8.8' });

    expect(res.status).toBe(200); // whole request still succeeds
    // Verify the INSERT was called with a whois_data value that carries
    // the labeled error, proving unwrap() did its job before persisting.
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO lookups'));
    const whoisArg = insertCall[1][3]; // query, type, geo, whois, dns, shodan, abuse -> index 3 is whois
    expect(whoisArg.error).toMatch(/whois lookup failed/);
  });

  test('domain query skips geo/shodan/abuse when DNS resolution fails, instead of calling them with garbage', async () => {
    mockPoolResponses({
      cacheRows: [],
      insertedRow: { id: 4, query: 'brokenhost.example', query_type: 'domain', created_at: new Date() },
    });
    dns.resolve4.mockRejectedValue(new Error('ENOTFOUND'));
    getWhois.mockResolvedValue({ name: 'BROKENHOST' });
    getDns.mockResolvedValue({ A: [], NS: ['ns1.example.com'] });

    const app = buildApp();
    await request(app).post('/api/lookup').send({ query: 'brokenhost.example' });

    expect(getGeo).not.toHaveBeenCalled();
    expect(getShodan).not.toHaveBeenCalled();
    expect(getAbuse).not.toHaveBeenCalled();
  });

  test('falls back to returning fresh data directly if the cache INSERT fails', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM lookups WHERE query')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO lookups')) return Promise.reject(new Error('connection terminated'));
      return Promise.resolve({ rows: [] });
    });
    getGeo.mockResolvedValue({ isp: 'Google' });
    getShodan.mockResolvedValue({ ports: [] });
    getWhois.mockResolvedValue({ name: 'GOOGLE' });
    getAbuse.mockResolvedValue({ abuseConfidenceScore: 0 });
    dns.reverse.mockResolvedValue([]);

    const app = buildApp();
    const res = await request(app).post('/api/lookup').send({ query: '8.8.8.8' });

    expect(res.status).toBe(200); // not a 500, despite the DB failure
    expect(res.body.geo_data.isp).toBe('Google');
  });
});

describe('GET /api/lookup/activity', () => {
  test('returns daily rows from the database', async () => {
    mockPoolResponses({ activityRows: [{ day: '2026-08-20', count: 3 }] });
    const app = buildApp();
    const res = await request(app).get('/api/lookup/activity');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ day: '2026-08-20', count: 3 }]);
  });

  test('returns a clean 500 if the query fails', async () => {
    pool.query.mockRejectedValue(new Error('connection terminated'));
    const app = buildApp();
    const res = await request(app).get('/api/lookup/activity');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Could not load activity data/);
  });
});

describe('GET /api/lookup/stats', () => {
  test('returns the all-time total', async () => {
    mockPoolResponses({ statsTotal: 42 });
    const app = buildApp();
    const res = await request(app).get('/api/lookup/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totalLookups: 42 });
  });

  test('returns a clean 500 if the query fails', async () => {
    pool.query.mockRejectedValue(new Error('connection terminated'));
    const app = buildApp();
    const res = await request(app).get('/api/lookup/stats');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Could not load stats/);
  });
});

describe('POST /api/lookup - unexpected errors', () => {
  test('a failure in the cache-check query itself (not wrapped in its own try/catch) still returns clean JSON', async () => {
    // Unlike the INSERT (which has its own fallback) or the 5 external
    // services (protected by Promise.allSettled), the initial cache-check
    // SELECT has no inner safety net - a failure there is the one realistic
    // path that reaches the route's generic outer catch block.
    pool.query.mockRejectedValue(new Error('connection terminated unexpectedly'));
    const app = buildApp();
    const res = await request(app).post('/api/lookup').send({ query: '8.8.8.8' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Server encountered an error processing the lookup.');
  });
});