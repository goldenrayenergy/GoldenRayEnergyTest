// ────────────────────────────────────────────────────────────────────────────
// Shared input validators — used by route handlers BEFORE hitting the DB.
//
// The DB has matching CHECK constraints (migration 020) as a final safety
// net. These functions give friendly error messages instead of raw Postgres
// constraint-violation errors.
//
// All validators return { ok: true } or { ok: false, error: 'message' }.
// All allow NULL/empty unless explicitly required — call .required first.
// ────────────────────────────────────────────────────────────────────────────

// Simple practical email regex — accepts "user@host.tld" patterns; doesn't
// validate every RFC 5322 edge case (that would reject valid emails too).
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// NZ phone tolerant pattern — digits + + - ( ) and spaces, 7-20 chars.
// Accepts: +64 21 839 356 · 021-839356 · 0800123456 · etc.
const PHONE_REGEX = /^[0-9+\-\s\(\)]{7,20}$/;

// NZ postcode — exactly 4 digits.
const NZ_POSTCODE_REGEX = /^[0-9]{4}$/;

// ── Atomic validators ────────────────────────────────────────────────────

export function isEmail(v) {
  if (v == null || v === '') return true;          // empty is fine, .required catches it
  return EMAIL_REGEX.test(String(v).trim());
}

export function isPhone(v) {
  if (v == null || v === '') return true;
  return PHONE_REGEX.test(String(v).trim());
}

export function isNZPostcode(v) {
  if (v == null || v === '') return true;
  return NZ_POSTCODE_REGEX.test(String(v).trim());
}

export function isNonNeg(v) {
  if (v == null || v === '') return true;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}

export function inRange(v, min, max) {
  if (v == null || v === '') return true;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
}

// ── Form-level validator — used by /quote/submit ─────────────────────────
//
// Returns an array of human-readable error strings. Empty array → all good.
export function validateQuoteForm(form) {
  const errs = [];

  // At least one contact channel required
  if (!form.firstName && !form.lastName && !form.email && !form.phone) {
    errs.push('Please provide at least a name, email, or phone number.');
  }

  // Email format
  if (form.email && !isEmail(form.email)) {
    errs.push('Email looks invalid — please double-check.');
  }

  // Phone format
  if (form.phone && !isPhone(form.phone)) {
    errs.push('Phone number looks invalid — digits and +/-/spaces only.');
  }
  if (form.referrerPhone && !isPhone(form.referrerPhone)) {
    errs.push('Referrer phone looks invalid.');
  }

  // Postcode (only checked if present)
  if (form.addressPostcode && !isNZPostcode(form.addressPostcode)) {
    errs.push('Postcode must be exactly 4 digits.');
  }

  // Money fields — non-negative
  if (form.monthlyBill != null && !isNonNeg(form.monthlyBill)) {
    errs.push('Monthly bill must be 0 or greater.');
  }

  // Sliders / numerics with hard bounds
  if (form.monthlyBill != null && !inRange(form.monthlyBill, 0, 100000)) {
    errs.push('Monthly bill is out of range — please check.');
  }
  if (form.dailyKwh != null && !inRange(form.dailyKwh, 0, 1000)) {
    errs.push('Daily kWh need is out of range.');
  }
  if (form.contractLength != null && !inRange(form.contractLength, 1, 50)) {
    errs.push('Contract length must be 1-50 years.');
  }

  // Friend referral requirement (existing rule)
  if (form.leadSource === 'friend_referral' && (!form.referrerName || !form.referrerPhone)) {
    errs.push('Please tell us who referred you (name + phone).');
  }

  return errs;
}

// ── Validator for /bill-analysis/estimate ────────────────────────────────
export function validateEstimateForm(body) {
  const errs = [];

  if (!body.monthly_spend || !isNonNeg(body.monthly_spend)) {
    errs.push('Please enter your monthly power spend (NZD).');
  } else if (!inRange(body.monthly_spend, 30, 100000)) {
    errs.push('Monthly spend must be between $30 and $100,000.');
  }

  if (body.postcode && !isNZPostcode(body.postcode)) {
    errs.push('Postcode must be exactly 4 digits.');
  }

  return errs;
}
