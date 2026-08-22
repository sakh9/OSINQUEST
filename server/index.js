require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const lookupRoute = require('./src/routes/lookup');
const pool = require('./src/db/pool');

// Fail fast at boot if required config is missing, rather than crashing
// deep inside the first request that happens to touch the database.
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Check your .env file or hosting provider env vars.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

// Render, Vercel, Railway etc. all sit behind a reverse proxy. Without this,
// req.ip and the x-forwarded-for header - used both by lookup.js's client-IP
// logging and by express-rate-limit's default key - resolve to the proxy's
// address instead of the real caller, so rate limiting becomes one shared
// bucket for every visitor. Newer express-rate-limit versions also throw
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR without this set correctly behind a proxy.
app.set('trust proxy', 1);

app.use(helmet());

// Supports a comma-separated list in CLIENT_URL (e.g. your production
// domain plus a Vercel preview URL). Unlike the previous `|| '*'` fallback,
// this never silently opens CORS to every origin if the env var is missing -
// it just allows nothing, which is the safer failure mode.
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header covers curl/Postman/server-to-server calls - allow those.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  })
);

// Lookup queries are short strings - capping the body size is a cheap
// guard against oversized payloads, and is more intentional than relying
// on express's 100kb default.
app.use(express.json({ limit: '10kb' }));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting: protects this server AND the free-tier third-party APIs
// it proxies to. standardHeaders uses the modern RateLimit-* response
// headers instead of the deprecated X-RateLimit-* ones.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use('/api', limiter);

app.use('/api/lookup', lookupRoute);

// Health check for Render/UptimeRobot
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', time: new Date().toISOString() }));

// Unmatched routes previously fell through to Express's default HTML 404
// page - a JSON API should never hand the frontend HTML to parse.
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// Central error handler. Catches CORS rejections, malformed JSON bodies
// (express.json() throws a SyntaxError on bad input), and anything an
// individual route forgot to catch - and always responds with JSON
// instead of Express's default HTML stack trace page.
app.use((err, req, res, next) => {
  if (err.message?.startsWith('Origin ') && err.message?.endsWith('is not allowed by CORS')) {
    return res.status(403).json({ error: 'Not allowed by CORS' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body' });
  }
  console.error('Unhandled error:', err);
  res.status(err.statusCode || 500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Render/Railway send SIGTERM on every redeploy, restart, or scale-down.
// Without handling it, in-flight requests get killed mid-response and
// Postgres connections leak until the pool times them out on its own.
function shutdown(signal) {
  console.log(`${signal} received: closing server gracefully...`);
  server.close(async () => {
    // Wrapped in try/catch rather than just .catch() - if pool.end()
    // ever throws synchronously instead of returning a rejected promise,
    // a bare .catch() chain would never attach and the process would
    // crash with an unhandled exception during shutdown.
    try {
      await pool.end();
      console.log('Closed out remaining connections. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('Error closing DB pool:', err.message);
      process.exit(1);
    }
  });
  // Force-exit if graceful shutdown takes too long, so the platform
  // doesn't have to SIGKILL a hung process.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));