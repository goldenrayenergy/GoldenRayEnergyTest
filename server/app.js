import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import leadRoutes from './routes/leads.js';
import dealRoutes from './routes/deals.js';
import companyRoutes from './routes/companies.js';
import campaignRoutes from './routes/campaigns.js';
import taskRoutes from './routes/tasks.js';
import activityRoutes from './routes/activities.js';
import reportRoutes from './routes/reports.js';
import proposalRoutes from './routes/proposals.js';
import configRoutes from './routes/config.js';
import quoteRoutes from './routes/quote.js';
import otpRoutes from './routes/otp.js';
import financeRoutes from './routes/finance.js';
import enquiryRoutes from './routes/enquiries.js';
import projectRoutes from './routes/projects.js';
import overrideRoutes from './routes/overrides.js';

dotenv.config({ path: '../.env' });

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ──
app.use(helmet());
// CORS — allow the configured client URL, localhost in dev, and any vercel.app
// preview deployment so we don't have to redeploy every time we get a new URL.
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server, curl, etc.
    if (origin === process.env.CLIENT_URL) return cb(null, true);
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// ── Root Endpoint ──
app.get('/', (req, res) => {
  res.json({
    name: '☀️ GoldenRay Energy — Solar CRM API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      leads: '/api/leads',
      deals: '/api/deals',
      companies: '/api/companies',
      campaigns: '/api/campaigns',
      tasks: '/api/tasks',
      activities: '/api/activities',
      reports: '/api/reports',
      proposals: '/api/proposals',
      config: '/api/config'
    },
    timestamp: new Date().toISOString()
  });
});

// ── API Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/config', configRoutes);
app.use('/api/quote', quoteRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/overrides', overrideRoutes);

// ── Health Check ──
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Error Handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: { message: err.message || 'Internal server error', ...(process.env.NODE_ENV === 'development' && { stack: err.stack }) }
  });
});

// Only start a long-lived listener when running directly via `node app.js`
// or `nodemon`. On Vercel the app is wrapped by serverless-http and the
// platform invokes it once per request — calling listen() there would hang
// the function and waste billing time.
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, () => console.log(`⚡ GoldenRay API running on port ${PORT}`));
}

export default app;
