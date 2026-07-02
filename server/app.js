import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import {
  otpLimiter, loginLimiter, submitLimiter, interactiveLimiter, defaultLimiter,
} from './middleware/rateLimiters.js';

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
import addressRoutes from './routes/address.js';
import productRoutes from './routes/products.js';
import lineItemRoutes from './routes/lineItems.js';
import packageRoutes from './routes/packages.js';
import shopRoutes from './routes/shop.js';
import tradeRequestRoutes from './routes/tradeRequests.js';
import billAnalysisRoutes from './routes/billAnalysis.js';
import pmRoutes from './routes/pm/index.js';
import publicProjectRoutes from './routes/public-projects.js';
import qrRoutes from './routes/qr.js';

dotenv.config({ path: '../.env' });

const app = express();
const PORT = process.env.PORT || 5000;

// Render runs us behind a load balancer that sets X-Forwarded-For. Trust
// the first hop so req.ip is the real client IP — without this, all rate
// limiters would key on the same proxy IP and a single bot could exhaust
// the limit for everyone behind it.
app.set('trust proxy', 1);

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

// ── Tiered rate limiting ──
// Per-route limiters mounted BEFORE the route handlers so a 429 short-circuits
// the request without touching application code. Order matters — most-specific
// paths first, default last.
app.use('/api/auth/login',      loginLimiter);          // 5 / 5min  — brute-force gate
app.use('/api/otp',             otpLimiter);            // 5 / 5min  — SMS cost gate
app.use('/api/quote/submit',    submitLimiter);         // covers /submit AND /submit-partial
app.use('/api/quote/calculate', interactiveLimiter);    // 60 / min  — fired per UI step
app.use('/api/address',         interactiveLimiter);    // 60 / min  — autocomplete keystrokes
app.use(defaultLimiter);                                // 200 / 15min catch-all

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
      products: '/api/products',
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
app.use('/api/address', addressRoutes);
app.use('/api/products', productRoutes);
app.use('/api/projects/:projectId/line-items', lineItemRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/trade-requests', tradeRequestRoutes);
app.use('/api/bill-analysis', billAnalysisRoutes);
app.use('/api/pm', pmRoutes);  // PM tool (Phase A) — parallel project model, no overlap with /api/projects
app.use('/api/public', publicProjectRoutes);  // Customer-facing project viewer (B-1) — no auth, gated by unguessable share_token
app.use('/qr', qrRoutes);                     // QR-code redirect endpoint (Phase D) — no auth, logs scan + 302 to destination with UTM params

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
