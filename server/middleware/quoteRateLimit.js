// server/middleware/quoteRateLimit.js
//
// Path B follow-up (2026-08-27) — daily quote-attempt limit for the
// public /api/roof/analyse endpoint. Prevents:
//   • Tire-kicker / competitor scraping (unlimited addresses per IP)
//   • Runaway Google Solar + LiDAR API cost from bots
//   • Overload of Cesium tile budget
//
// Policy (from the product decision doc, 2026-08-27):
//   • 3 UNIQUE addresses per IP per NZ calendar day (Q1 = B, Q2 = 3)
//   • Same address analysed twice in one day = still 1 (customer
//     refining their own quote doesn't burn attempts)
//   • Reset at midnight Pacific/Auckland (Q3 = A)
//   • Admin cookie `gr-admin-bypass=1` skips the check entirely so the
//     owner can test / demo with no limit
//   • Sub-limit signals return HTTP 429 with `book_survey_url` so the
//     client can render the "book a site survey" CTA (Q4)
//
// Storage: in-memory Map<ip, { date, addresses: Set }>. Server restart
// resets counters — acceptable for a soft anti-abuse limit; a scaled
// deploy behind multiple instances would need Redis/Supabase backing.
// Nightly cleanup timer drops stale entries so memory doesn't grow.
//
// Cookie parsing is done inline (no cookie-parser dep) so this file
// stays self-contained.

const MAX_ADDRESSES_PER_DAY = 3;
const ADMIN_COOKIE_NAME = 'gr-admin-bypass';
const ADMIN_COOKIE_VALUE = '1';

// Per-IP tracking: Map<ip, { date: 'YYYY-MM-DD', addresses: Set<string> }>
const quoteTracker = new Map();

// Nightly cleanup — drop entries whose date is not today. Runs every
// hour so we're never holding more than a couple of days of records.
setInterval(() => {
  const today = todayNZDate();
  for (const [ip, entry] of quoteTracker) {
    if (entry.date !== today) quoteTracker.delete(ip);
  }
}, 60 * 60 * 1000).unref?.();

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
  // Midnight NZT of tomorrow — compute via string round-trip so DST is honoured
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  // The above is midnight UTC of tomorrow — we want midnight NZT. NZ is
  // UTC+12 (NZST) or UTC+13 (NZDT). Subtract 12h as a conservative
  // approximation — the client only shows this as "come back tomorrow"
  // so exact-to-the-minute isn't important.
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
function addressKey(body) {
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

export function quoteRateLimit(req, res, next) {
  // Admin bypass — owner sets this cookie once via the enable-unlimited
  // route below, then their sessions are exempt.
  const cookies = parseCookies(req.headers?.cookie);
  if (cookies[ADMIN_COOKIE_NAME] === ADMIN_COOKIE_VALUE) return next();

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const key = addressKey(req.body || {});
  const today = todayNZDate();

  let entry = quoteTracker.get(ip);
  if (!entry || entry.date !== today) {
    entry = { date: today, addresses: new Set() };
    quoteTracker.set(ip, entry);
  }

  // Repeat address today → free (customer refining same quote).
  if (entry.addresses.has(key)) return next();

  // New address — enforce the limit BEFORE recording.
  if (entry.addresses.size >= MAX_ADDRESSES_PER_DAY) {
    const resetAt = nextMidnightNZ();
    return res.status(429).json({
      error: `You've explored ${MAX_ADDRESSES_PER_DAY} different addresses today. Ready to talk to a real person about your best option?`,
      quotes_used_today: entry.addresses.size,
      max_per_day:       MAX_ADDRESSES_PER_DAY,
      reset_at_iso:      resetAt.toISOString(),
      book_survey_url:   '/book-survey',
    });
  }

  entry.addresses.add(key);
  next();
}

/** Owner-only endpoint handler — sets the admin bypass cookie. */
export function setAdminBypassCookie(req, res) {
  // Simple shared secret so random visitors can't set the cookie.
  // Owner bookmarks /api/admin/enable-unlimited?token=<value> and
  // visits once per browser. Cookie is set for 90 days.
  const providedToken = req.query?.token || '';
  const expectedToken = process.env.ADMIN_BYPASS_TOKEN || '';
  if (!expectedToken) {
    return res.status(503).json({ error: 'ADMIN_BYPASS_TOKEN not set on server.' });
  }
  if (providedToken !== expectedToken) {
    return res.status(403).json({ error: 'Invalid token.' });
  }
  // 90-day cookie, HttpOnly=false so client JS can also read/clear it if needed.
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

/** Test helper — reset the tracker (used by unit tests). */
export function _resetQuoteTracker() {
  quoteTracker.clear();
}

// Export config so tests + admin views can introspect.
export const QUOTE_RATE_LIMIT_CONFIG = {
  MAX_ADDRESSES_PER_DAY,
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_VALUE,
};
