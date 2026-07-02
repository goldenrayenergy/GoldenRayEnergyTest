// server/middleware/rateLimiters.js
//
// Tiered rate-limiting for the public API.
//
// The original app.js had a single global limiter at 500 req / 15 min, which
// is loose enough that bots can comfortably brute-force /api/auth/login,
// SMS-bomb /api/otp/send (costing real money via Twilio), or pound
// /api/quote/submit. This module replaces it with four tiers, each tuned to
// the abuse pattern the endpoint is exposed to.
//
// All limiters key on req.ip. app.js sets `trust proxy` so this is the real
// client IP behind Render's load balancer, not the proxy IP.
//
// Tiers
//   otpLimiter         5 / 5 min   SMS sends — each one costs ~NZ$0.06 via Twilio
//   loginLimiter       5 / 5 min   Login attempts — brute-force gate
//   submitLimiter      5 / 5 min   Form submissions — real customers submit once
//   interactiveLimiter 60 / min    Calculator, address lookup, etc. — fires per UI step
//   defaultLimiter     200 / 15min Catch-all fallback for everything else
//
// The standard-rate-limit headers (RateLimit, RateLimit-Reset, etc.) are
// returned to the client so a well-behaved consumer can back off; legacy
// X-RateLimit-* headers are suppressed.

import rateLimit from 'express-rate-limit';

const base = (overrides) => rateLimit({
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  ...overrides,
});

// ── Tier 1 — very tight (cost-bearing endpoints) ──────────────────────────
export const otpLimiter = base({
  windowMs: 5 * 60 * 1000,
  max:      5,
  message:  { error: 'Too many SMS requests from this IP. Try again in 5 minutes.' },
});

export const loginLimiter = base({
  windowMs: 5 * 60 * 1000,
  max:      5,
  message:  { error: 'Too many login attempts from this IP. Try again in 5 minutes.' },
});

// ── Tier 2 — tight (public form submission) ───────────────────────────────
export const submitLimiter = base({
  windowMs: 5 * 60 * 1000,
  max:      5,
  message:  { error: 'Too many submissions from this IP. Try again in 5 minutes.' },
});

// ── Tier 3 — moderate (interactive endpoints) ─────────────────────────────
// The wizard fires /calculate as the customer adjusts inputs, and /address
// lookups fire per keystroke. Tight enough to block abuse, loose enough to
// not break a customer typing fast.
export const interactiveLimiter = base({
  windowMs: 60 * 1000,
  max:      60,
  message:  { error: 'Too many requests. Slow down and try again in a minute.' },
});

// ── Tier 4 — default catch-all ────────────────────────────────────────────
export const defaultLimiter = base({
  windowMs: 15 * 60 * 1000,
  max:      200,
});
