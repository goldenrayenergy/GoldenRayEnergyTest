// Canonical NZ postcode helper — CLIENT MIRROR of server/utils/postcode.js.
// Bug 2 fix (2026-08-24). See server/utils/postcode.js for the full policy.
//
// Kept as a plain client-side copy (not imported from server) because the
// server directory isn't in the Vite module graph. If you change values
// here, change them in server/utils/postcode.js too — the server enforces
// as the last line of defense.

export const NZ_POSTCODE_MIN = 110;
export const NZ_POSTCODE_MAX = 9893;

export function isValidNzPostcode(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (!/^[0-9]{4}$/.test(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) && n >= NZ_POSTCODE_MIN && n <= NZ_POSTCODE_MAX;
}

export function isPartialNzPostcode(v) {
  if (v == null || v === '') return true;
  const s = String(v).trim();
  return /^[0-9]{1,3}$/.test(s);
}

export function normaliseNzPostcode(v) {
  if (v == null) return '';
  return String(v).replace(/\D/g, '').slice(0, 4);
}
