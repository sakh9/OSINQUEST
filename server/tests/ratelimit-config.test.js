jest.mock('./../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }), end: jest.fn() }));
jest.mock('../src/services/apis', () => ({ getGeo: jest.fn(), getShodan: jest.fn(), getWhois: jest.fn(), getDns: jest.fn() }));
jest.mock('../src/services/abuse', () => ({ getAbuse: jest.fn() }));
const request = require('supertest');
const createApp = require('../src/app');

test('defaults to max:30 when no env vars are set (unchanged production behavior)', async () => {
  delete process.env.RATE_LIMIT_MAX;
  delete process.env.RATE_LIMIT_WINDOW_MS;
  const app = createApp();
  // /health is intentionally NOT rate-limited (mounted outside /api) - use
  // an actual /api route to inspect the limiter's headers.
  const res = await request(app).get('/api/lookup/stats');
  expect(res.headers['ratelimit-limit']).toBe('30');
});

test('respects RATE_LIMIT_MAX override when set', async () => {
  process.env.RATE_LIMIT_MAX = '5000';
  const app = createApp();
  const res = await request(app).get('/api/lookup/stats');
  expect(res.headers['ratelimit-limit']).toBe('5000');
  delete process.env.RATE_LIMIT_MAX;
});