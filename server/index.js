require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const lookupRoute = require('./src/routes/lookup');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*' })); // Restrict in prod
app.use(express.json());

// Rate Limiting: 30 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 30,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api', limiter);

// Routes
app.use('/api/lookup', lookupRoute);

// Health Check for Render/UptimeRobot
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));