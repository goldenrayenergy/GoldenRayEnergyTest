import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import {
  otpLimiter, loginLimiter, submitLimiter, interactiveLimiter, defaultLimiter,
} from './middleware/rateLimiters.js';
// Path B follow-up (2026-08-27) — daily quote limit (3 unique addresses
// per IP per NZ calendar day) applied to /api/roof/analyse. See
// middleware/quoteRateLimit.js for policy details + admin bypass.
import { quoteRateLimit, setAdminBypassCookie } from './middleware/quoteRateLimit.js';

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
// Public quote-flow endpoints (bill parse, roof analysis, tier compose, etc.).
// Previously mounted under /api/poc/* and gated by ENABLE_POC — that gate was
// removed 2026-08-21 when Phase E confirmed these are load-bearing for the
// production merged /get-quote flow, not experimental POC endpoints. Each now
// lives at its natural home. See server/routes/legacy-submit.js for the one
// endpoint still tied to the dev-only /poc/quote page's payload shape.
import billsRoutes    from './routes/bills.js';
import placesRoutes   from './routes/places.js';
import roofRoutes, { aerialRouter } from './routes/roof.js';
import designRoutes   from './routes/design.js';
import threedRoutes   from './routes/threed.js';
import legacySubmitRoutes from './routes/legacy-submit.js';
import pmRoutes from './routes/pm/index.js';
import publicProjectRoutes from './routes/public-projects.js';
import qrRoutes from './routes/qr.js';
import referralRoutes from './routes/referrals.js';

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

// CORS whitelist — explicit allowlist of origins that can call the API with
// credentials. Previously matched any *.vercel.app subdomain via regex, which
// meant ANY Vercel deployment on ANY account could hit our API — a real risk
// once someone starts hosting malicious preview builds under vercel.app.
//
// The allowlist covers:
//   - Configured CLIENT_URL (Render env var → production domain)
//   - Localhost for dev (:5173 = Vite, :3000 = fallback)
//   - Specific Vercel preview subdomains we control (goldenrayenergy account)
//   - The production domain(s) we own
//
// Add new preview URLs to CORS_ALLOWED_ORIGINS env var (comma-separated) if
// you spin up a new preview branch. Avoids ever touching this file for
// routine preview work.
const STATIC_ALLOWED = [
  'https://golden-ray-energy-test.vercel.app',
  'https://www.goldenrayenergy.nz',
  'https://goldenrayenergy.nz',
];

const envAllowed = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set([
  ...STATIC_ALLOWED,
  ...envAllowed,
  ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : []),
]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server, curl, health checks
    // Localhost dev (any port) — only in non-production
    if (process.env.NODE_ENV !== 'production' &&
        /^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    // Log the rejection so we notice legitimate origins we forgot to whitelist,
    // rather than the customer just seeing a broken app.
    console.warn(`[CORS] blocked origin: ${origin}`);
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
// Referrals (Phase 3, 2026-08-22). Public /status + /generate use share_token
// auth; /admin/* sub-routes require portal session (enforced inside the router
// via `router.use(authenticate)` at the top of the admin block).
app.use('/api/referrals', referralRoutes);
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

// Public quote-flow endpoints (Phase E rename, 2026-08-21). These used to
// live under /api/poc/* behind an ENABLE_POC gate, back when they were an
// experimental spike. They now power the production /get-quote flow, so the
// gate is gone and they always mount at their natural URLs.
app.use('/api/bills',                billsRoutes);       // POST /extract (bill parse)
app.use('/api/places',               placesRoutes);      // GET /autocomplete, /details, /reverse-geocode
// Owner-only route to set the admin-bypass cookie. Bookmark
//   /api/admin/enable-unlimited?token=<ADMIN_BYPASS_TOKEN>
// in your browser, visit once, done — this browser gets unlimited quotes.
app.get('/api/admin/enable-unlimited', setAdminBypassCookie);
// Path B (2026-08-27) — daily quote rate limit applied to the analyse
// endpoint ONLY. Sits BEFORE the route so it can reject before we hit
// Google Solar / LiDAR (which are cost-bearing). Compose (/design)
// and PVGIS-only calls stay unlimited — customer refining their own
// quote is free.
app.use('/api/roof/analyse',         quoteRateLimit);
app.use('/api/roof',                 roofRoutes);        // POST /analyse; GET /linz-buildings, /osm-buildings
app.use('/api/aerial',               aerialRouter);      // GET /google, /streetview, /tile
app.use('/api/design',               designRoutes);      // POST /compose
app.use('/api/threed',               threedRoutes);      // GET /tileset-config
app.use('/api/quote/legacy-submit',  legacySubmitRoutes); // POST — only used by dev-only /poc/quote page

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

  // ── Referral expiry sweep (Phase 3, 2026-08-22) ────────────────────────
  // Marks referrals as 'expired' once their credit_expires_at (6 months
  // after unlock) has passed. Runs every 6 hours — sub-daily cadence so
  // an expiry never lags more than a quarter-day, but not so frequent that
  // it thrashes the DB. Kept in-process (setInterval) rather than an
  // external cron (Render Cron Jobs) so the whole feature ships in one
  // codebase. If we ever need proper cron-style guarantees (survive
  // process restarts, don't skip beats), migrate to Render Cron.
  //
  // First invocation is deferred 60s so server boot isn't slowed by an
  // immediate DB call while other init is still finishing.
  import('./services/referralService.js')
    .then(({ expireStaleReferrals }) => import('./config/supabase.js')
      .then(({ supabaseAdmin }) => {
        if (!supabaseAdmin) {
          console.log('[referral-expiry] supabaseAdmin unavailable — sweep disabled');
          return;
        }
        const sweep = async () => {
          try {
            const result = await expireStaleReferrals(supabaseAdmin);
            if (result.error) {
              console.error('[referral-expiry] sweep error:', result.error?.message || result.error);
            } else if (result.expired > 0) {
              console.log(`[referral-expiry] marked ${result.expired} referral(s) expired`);
            }
          } catch (e) {
            console.error('[referral-expiry] sweep threw:', e?.message || e);
          }
        };
        setTimeout(sweep, 60_000);                 // first run 60s after boot
        setInterval(sweep, 6 * 60 * 60 * 1000);    // then every 6 hours
        console.log('⏰ Referral expiry sweep scheduled (every 6h, first run in 60s)');
      })
    )
    .catch((e) => console.error('[referral-expiry] setup failed:', e?.message || e));
}

export default app;
