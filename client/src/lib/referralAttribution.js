// referralAttribution — Phase 3 Session 2 (2026-08-22)
//
// Three-tier attribution capture so the referral survives every plausible
// customer journey:
//
//   URL   — /get-quote?ref=SARAH-XY7K   (source of truth; overwrites older
//                                        stores when present)
//   sessionStorage — same-tab persistence across F5 + wizard steps
//   cookie — cross-tab / cross-day persistence for customers who click a
//            link today and come back tomorrow in a new tab
//
// Read priority (later wins on capture; earlier wins on read):
//   captureFromUrl  → writes to both sessionStorage AND cookie
//   getReferralCode → returns first available: sessionStorage → cookie
//
// The cookie is 30 days — matches industry-standard referral attribution
// windows. sessionStorage lives for the tab's lifetime, no expiry.
//
// Server truth: attribution runs at submit-time via POST
// /api/quote/submit-with-design with `design.referralCodeUsed`. The
// server-side fraud check (referralService.attributeReferral) validates
// the code — client-side capture just moves the string around.

const SESSION_KEY  = 'gr_ref';
const COOKIE_NAME  = 'gr_ref';
const COOKIE_DAYS  = 30;

// Referral codes are {SLUG}-{4-char safe alphabet}. Length 6-11. Anything
// outside this pattern gets rejected on capture — prevents URL noise
// (e.g. ?ref=undefined from broken share buttons) from poisoning the
// stored attribution.
const CODE_REGEX = /^[A-Z]{3,6}-[A-Z2-9]{4}$/;

function isValidCode(s) {
  return typeof s === 'string' && CODE_REGEX.test(s);
}

// ─── Capture ─────────────────────────────────────────────────────────────

/**
 * Read `?ref=CODE` from the current URL and persist to sessionStorage +
 * cookie. Called on landing at /get-quote. Idempotent — if the URL has
 * no ref, or the ref is malformed, the existing stored value is kept.
 *
 * Returns the captured code (or the existing one) so the caller can
 * immediately show a "Referred by X" banner without a second read.
 */
export function captureReferralFromUrl() {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('ref');
    if (raw && isValidCode(raw.toUpperCase())) {
      const code = raw.toUpperCase();
      writeSession(code);
      writeCookie(code);
      return code;
    }
  } catch { /* URL parse noise — ignore */ }
  return getReferralCode();
}

// ─── Read ─────────────────────────────────────────────────────────────

/**
 * Return the currently-attributed referral code, or null. Prefers
 * sessionStorage (same-tab, most recent) over cookie (cross-tab, older).
 * Both are re-validated against CODE_REGEX so corrupted storage never
 * lets a bad code reach the submit payload.
 */
export function getReferralCode() {
  if (typeof window === 'undefined') return null;
  try {
    const s = window.sessionStorage?.getItem(SESSION_KEY);
    if (s && isValidCode(s)) return s;
  } catch { /* private mode etc */ }
  const c = readCookie(COOKIE_NAME);
  if (c && isValidCode(c)) return c;
  return null;
}

// ─── Clear ────────────────────────────────────────────────────────────

/**
 * Wipe both storage layers. Called from confirmStartFresh (wizard-header
 * "Start a fresh quote") so a customer explicitly starting over doesn't
 * carry the previous referral into a new quote — that would silently
 * credit someone who didn't actually refer this new lead.
 */
export function clearReferralCode() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage?.removeItem(SESSION_KEY); } catch { /* noop */ }
  writeCookie('', -1);   // negative days → immediate expiry
}

// ─── Internal helpers ─────────────────────────────────────────────────

function writeSession(code) {
  try { window.sessionStorage?.setItem(SESSION_KEY, code); } catch { /* noop */ }
}

function writeCookie(value, days = COOKIE_DAYS) {
  try {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    // SameSite=Lax so the cookie survives cross-site link clicks (the
    // common case: friend clicks Sarah's link in her SMS/email/tweet).
    // Path=/ so the cookie is available on all routes not just /get-quote.
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch { /* SSR / cookie-blocked — capture just becomes sessionStorage-only */ }
}

function readCookie(name) {
  if (typeof document === 'undefined') return null;
  try {
    const parts = document.cookie.split(';');
    for (const part of parts) {
      const [k, ...rest] = part.trim().split('=');
      if (k === name) return decodeURIComponent(rest.join('='));
    }
  } catch { /* noop */ }
  return null;
}
