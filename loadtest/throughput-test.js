import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Usage:
//   k6 run -e BASE_URL=https://your-service.up.railway.app throughput-test.js
//
// IMPORTANT: run this against a TEMPORARILY raised rate limit, not
// production defaults. On Railway, set RATE_LIMIT_MAX to something like
// 5000 and RATE_LIMIT_WINDOW_MS to 60000 for the duration of this test,
// then set it back afterward. Against the default 30 req/15min, this
// script will just measure how fast the rate limiter kicks in (see
// ratelimit-test.js for that specific purpose instead).
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5099';

// A mix of IPs and domains, so the test exercises a realistic blend of
// cache hits (repeated queries) and cache misses (first-time queries)
// instead of only ever hitting one already-cached value.
const QUERIES = [
  '8.8.8.8', '1.1.1.1', '9.9.9.9', '4.4.4.4',
  'github.com', 'cloudflare.com', 'example.com', 'wikipedia.org',
];

export const errorRate = new Rate('errors');
export const lookupDuration = new Trend('lookup_duration', true);

export const options = {
  stages: [
    { duration: '10s', target: 10 }, // ramp up
    { duration: '30s', target: 20 }, // sustain
    { duration: '10s', target: 0 },  // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% of requests under 3s
    errors: ['rate<0.05'],             // fewer than 5% failures
  },
};

export default function () {
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const res = http.post(
    `${BASE_URL}/api/lookup`,
    JSON.stringify({ query }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '30s' }
  );

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'response has expected shape': (r) => {
      try {
        return JSON.parse(r.body).query !== undefined;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);
  lookupDuration.add(res.timings.duration);

  sleep(1);
}