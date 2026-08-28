const request = require('supertest');

// app.js pulls in the lookup router, which pulls in the DB pool and
// services - mocked here too so these tests never touch a real DB or
// network, even though none of these specific tests exercise those routes.
jest.mock('../src/db/pool', () => ({ query: jest.fn(), end: jest.fn() }));
jest.mock('../src/services/apis', () => ({ getGeo: jest.fn(), getShodan: jest.fn(), getWhois: jest.fn(), getDns: jest.fn() }));
jest.mock('../src/services/abuse', () => ({ getAbuse: jest.fn() }));

const createApp = require('../src/app');

describe('health check', () => {
  test('GET /health returns ok', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('404 handling', () => {
  test('unmatched routes return JSON, not HTML', async () => {
    const app = createApp();
    const res = await request(app).get('/nonexistent-route');
    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body.error).toMatch(/Cannot GET/);
  });
});

describe('malformed request bodies', () => {
  test('invalid JSON returns a clean 400, not a crash', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/lookup')
      .set('Content-Type', 'application/json')
      .send('{not valid json');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Malformed JSON/);
  });
});

describe('CORS', () => {
  test('allows a configured origin', async () => {
    process.env.CLIENT_URL = 'http://localhost:5173';
    const app = createApp();
    const res = await request(app)
      .options('/api/lookup')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  test('rejects an unconfigured origin', async () => {
    process.env.CLIENT_URL = 'http://localhost:5173';
    const app = createApp();
    const res = await request(app)
      .options('/api/lookup')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(403);
  });

  test('supports multiple comma-separated origins', async () => {
    process.env.CLIENT_URL = 'http://localhost:5173,https://myapp.vercel.app';
    const app = createApp();
    const res = await request(app)
      .options('/api/lookup')
      .set('Origin', 'https://myapp.vercel.app')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe('https://myapp.vercel.app');
  });

  test('a missing CLIENT_URL fails closed (blocks everything), not open', async () => {
    delete process.env.CLIENT_URL;
    const app = createApp();
    const res = await request(app)
      .options('/api/lookup')
      .set('Origin', 'http://anything.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(403);
  });
});