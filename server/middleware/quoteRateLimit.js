// server/middleware/quoteRateLimit.js
//
// Path B follow-up (2026-08-27) — daily quote-attempt limit for the
// public /api/roof/analyse endpoint. Prevents:
//   • Tire-kicker / competitor scraping (unlimited addresses per IP)
//   • Runaway Google Solar + LiDAR API cost from bots
//   • Overload of Cesium tile budget
//
// Rewrite (2026-08-31): backing storage moved from in-memory Map to
// Supabase table `quote_rate_limits`. The in-memory design was silently
// wiped on every Render restart (deploy) and every idle-cold-start (~15
// min gap between requests). Team ran 30+ addresses in a session; the
// limit was effectively unenforceable. See migration 045 for the table.
//
// Policy (unchanged from 2026-08-27):
//   • 3 UNIQUE addresses per IP per NZ calendar day
//   • Same address analysed twice in one day = still 1 (customer
//     refining their own quote doesn't burn attempts)
//   • Reset at midnight Pacific/Auckland
//   • Admin cookie `gr-admin-bypass=1` skips the check entirely so the
//     owner can test / demo with no limit
//   • Sub-limit signals return HTTP 429 with `book_survey_url` so the
//     client can render the "book a site survey" CTA
//
// Storage: Supabase `quote_rate_limits` (ip, nz_date, address_key) with
// composite PK for natural dedupe. Middleware queries + upserts against
// this. Nightly cleanup job (setInterval below) deletes rows older than
// 2 days. Fail-open: if Supabase is unreachable, we log + allow the
// request. Alternative (fail-closed) would let a DB outage take down
// the quote flow, which is worse than a brief rate-limit gap.
//
// Cookie parsing is done inline (no cookie-parser dep) so this file
// stays self-contained.

import { supabaseAdmin } from '../config/supabase.js';

const MAX_ADDRESSES_PER_DAY = 3;
const ADMIN_COOKIE_NAME = 'gr-admin-bypass';
const ADMIN_COOKIE_VALUE = '1';
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;   // every 6 hours

// Nightly cleanup — drop rows older than 2 days. Runs every 6h so the
// table stays small even under heavy traffic + across deploys.
// setInterval keeps this alive for the process lifetime; .unref() so it
// doesn't hold the process open at shutdown.
if (typeof setInterval === 'function') {
  const cleanupTimer = setInterval(async () => {
    try {
      if (!supabaseAdmin) return;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 2);
      const cutoffDate = cutoff.toISOString().split('T')[0];
      await supabaseAdmin.from('quote_rate_limits').delete().lt('nz_date', cutoffDate);
    } catch (e) {
      console.warn('[quoteRateLimit] cleanup failed (non-fatal):', e?.message || e);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

/** Current calendar date in Pacific/Auckland as YYYY-MM-DD. */
export function todayNZDate() {
  const now = new Date();
  const nzParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const year  = nzParts.find(p => p.type === 'year')?.value;
  const month = nzParts.find(p => p.type === 'month')?.value;
  const day   = nzParts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

/** Next midnight Pacific/Auckland as a Date (approximate, DST-aware). */
function nextMidnightNZ() {
  const today = todayNZDate();
  const [y, m, d] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  return new Date(tomorrow.getTime() - 12 * 60 * 60 * 1000);
}

/** Parse a `Cookie` header into a plain object. */
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/** Cheap best-effort address key for de-dupe. Prefer place_id (stable across
 *  sessions) over lat/lng (customer may nudge the pin). Falls back to
 *  raw coords when place_id isn't present (LiDAR-only path). */
export function addressKey(body) {
  const pid = body?.place_id;
  if (pid && typeof pid === 'string') return `pid:${pid}`;
  const lat = body?.lat_override ?? body?.latitude;
  const lng = body?.lng_override ?? body?.longitude;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    // Round to ~10m so tiny nudges don't count as new addresses
    return `coord:${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  }
  return 'unknown';
}

/**
 * Factory — builds a middleware bound to a specific supabase client.
 * Enables dependency-injection so tests can pass mock clients without
 * fighting ESM module immutability.
 *
 * Production callers use the default `quoteRateLimit` export below,
 * which is this factory bound to the real `supabaseAdmin`.
 */
export function createQuoteRateLimit(supabase) {
  return async function quoteRateLimitMiddleware(req, res, next) {
    // Admin bypass — owner sets this cookie once via the enable-unlimited
    // route below, then their sessions are exempt.
    const cookies = parseCookies(req.headers?.cookie);
    if (cookies[ADMIN_COOKIE_NAME] === ADMIN_COOKIE_VALUE) return next();

    // Fail-open when Supabase isn't configured. Better to accept the request
    // than to take down the quote flow on DB outage. Logged so we notice.
    if (!supabase) {
      console.warn('[quoteRateLimit] supabase client not available — allowing request unchecked');
      return next();
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = addressKey(req.body || {});
    const today = todayNZDate();

    try {
      // Read the customer's addresses today. Exact count via row-scan
      // (data is at most 3-30 rows per (ip, date) — cheap).
      const { data: existing, error: readErr } = await supabase
        .from('quote_rate_limits')
        .select('address_key')
        .eq('ip', ip)
        .eq('nz_date', today);

      if (readErr) {
        console.warn('[quoteRateLimit] read failed, failing open:', readErr.message);
        return next();
      }

      const usedKeys = new Set((existing || []).map(r => r.address_key));

      // Repeat address today → free (customer refining same quote)
      if (usedKeys.has(key)) return next();

      // New address — enforce limit BEFORE recording
      if (usedKeys.size >= MAX_ADDRESSES_PER_DAY) {
        const resetAt = nextMidnightNZ();
        return res.status(429).json({
          error: `You've explored ${MAX_ADDRESSES_PER_DAY} different addresses today. Ready to talk to a real person about your best option?`,
          quotes_used_today: usedKeys.size,
          max_per_day:       MAX_ADDRESSES_PER_DAY,
          reset_at_iso:      resetAt.toISOString(),
          book_survey_url:   '/book-survey',
        });
      }

      // Record the new address. Composite PK (ip, nz_date, address_key)
      // makes this a no-op if the row already exists — safe against races.
      const { error: insertErr } = await supabase
        .from('quote_rate_limits')
        .upsert({ ip, nz_date: today, address_key: key },
                { onConflict: 'ip,nz_date,address_key', ignoreDuplicates: true });
      if (insertErr) {
        // Duplicate key race is fine (ignoreDuplicates). Other errors we log
        // but still allow — the write failure doesn't warrant blocking the
        // customer.
        console.warn('[quoteRateLimit] upsert failed (allowing anyway):', insertErr.message);
      }

      next();
    } catch (e) {
      console.warn('[quoteRateLimit] unexpected error, failing open:', e?.message || e);
      next();
    }
  };
}

/** Production middleware — bound to the real supabaseAdmin. */
export const quoteRateLimit = createQuoteRateLimit(supabaseAdmin);

/** Owner-only endpoint handler — sets the admin bypass cookie. */
export function setAdminBypassCookie(req, res) {
  const providedToken = req.query?.token || '';
  const expectedToken = process.env.ADMIN_BYPASS_TOKEN || '';
  if (!expectedToken) {
    return res.status(503).json({ error: 'ADMIN_BYPASS_TOKEN not set on server.' });
  }
  if (providedToken !== expectedToken) {
    return res.status(403).json({ error: 'Invalid token.' });
  }
  const maxAgeSeconds = 90 * 24 * 60 * 60;
  res.setHeader('Set-Cookie',
    `${ADMIN_COOKIE_NAME}=${ADMIN_COOKIE_VALUE}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`);
  return res.json({
    ok: true,
    message: `Admin bypass cookie set. Your quote-limit is now unlimited for 90 days on this browser.`,
    cookie_name:  ADMIN_COOKIE_NAME,
    expires_days: 90,
  });
}

/** Test helper — clear the table (used by unit + integration tests). */
export async function _resetQuoteTracker() {
  if (!supabaseAdmin) return;
  // Delete-all requires a WHERE clause; use a always-true condition.
  await supabaseAdmin.from('quote_rate_limits').delete().gt('created_at', '1970-01-01');
}

// Export config so tests + admin views can introspect.
export const QUOTE_RATE_LIMIT_CONFIG = {
  MAX_ADDRESSES_PER_DAY,
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_VALUE,
};
