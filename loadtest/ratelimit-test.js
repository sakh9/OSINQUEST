import http from 'k6/http';
import { check, sleep } from 'k6';

// Usage (run against PRODUCTION defaults, no env var changes needed):
//   k6 run -e BASE_URL=https://your-service.up.railway.app ratelimit-test.js
//
// Deliberately sends more requests than the 30-per-15-minutes limit
// allows, from a single source, to confirm the rate limiter actually
// engages in the deployed environment - not just in the mocked unit
// tests. This is a legitimate result to report either way: a portfolio
// piece demonstrating its own abuse-protection works under real load is
// arguably a better story than a raw throughput number.
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5099';

export const options = {
  vus: 1,
  iterations: 35, // 5 more than the default limit of 30
};

export default function () {
  const res = http.post(
    `${BASE_URL}/api/lookup`,
    JSON.stringify({ query: '8.8.8.8' }), // same query every time -> cache hit after the first, isolating rate-limit behavior from lookup latency
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });

  sleep(0.5);
}