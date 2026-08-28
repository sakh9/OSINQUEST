require('dotenv').config();
const createApp = require('./src/app');
const pool = require('./src/db/pool');

// Fail fast at boot if required config is missing, rather than crashing
// deep inside the first request that happens to touch the database.
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Check your .env file or hosting provider env vars.');
  process.exit(1);
}

const app = createApp();
const PORT = process.env.PORT || 5000;

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