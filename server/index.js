require('dotenv').config();
const createApp = require('./src/app');
const pool = require('./src/db/pool');

// Fail fast at boot if required config is missing
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Check your .env file or hosting provider env vars.');
  process.exit(1);
}

// 1. Initialize the app instance first
const app = createApp();

// 2. Add the Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown handling
function shutdown(signal) {
  console.log(`${signal} received: closing server gracefully...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log('Closed out remaining connections. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('Error closing DB pool:', err.message);
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));