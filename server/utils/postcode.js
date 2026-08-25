// Canonical NZ postcode helper — shared between server + client.
// Bug 2 fix (2026-08-24): previously three independent validators each
// had different rules (server accepted 0000; client accepted 2-digit
// inputs as "valid"; autocomplete silently returned '' on OSM results
// without country suffix). This helper is the single source of truth.
//
// The client-side mirror lives at client/src/lib/postcode.js and MUST
// stay behaviourally identical to this file — if you change the range
// here, change it there too.
//
// NZ postcode reference (NZ Post):
//   • Format: 4 digits, no letters, no spaces.
//   • Range: 0110 (Auckland CBD) → 9893 (Bluff/Southland).
//   • Values 0000-0109 and 9894-9999 are unallocated.
//   • Post-box vs street-address codes intermix within that range.
//
// We do NOT validate against a specific street/suburb — that requires a
// look-up table with tens of thousands of entries and monthly refreshes.
// Range check + 4-digit format catches the vast majority of typos and
// all zero-padded / partial inputs.

export const NZ_POSTCODE_MIN = 110;
export const NZ_POSTCODE_MAX = 9893;

/**
 * True if `v` is a syntactically valid NZ postcode.
 * Accepts: 4 digits in the range 0110-9893.
 * Rejects: null, empty, not-4-digits, and 0000-0109 / 9894-9999.
 *
 * Non-throwing on unexpected input shapes — bad input just returns false.
 */
export function isValidNzPostcode(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (!/^[0-9]{4}$/.test(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) && n >= NZ_POSTCODE_MIN && n <= NZ_POSTCODE_MAX;
}

/**
 * True if `v` COULD become valid with more typing (partial 1-3 digits).
 * Used by the input's onChange to avoid rejecting keystrokes mid-typing.
 * A blank string is also considered "in progress" (user cleared the field).
 */
export function isPartialNzPostcode(v) {
  if (v == null || v === '') return true;
  const s = String(v).trim();
  return /^[0-9]{1,3}$/.test(s);
}

/**
 * Coerce any input to the canonical form: 4 digits or empty string.
 * Non-digits stripped, capped at 4 digits. Does NOT validate the range —
 * callers that need range check should follow up with isValidNzPostcode.
 */
export function normaliseNzPostcode(v) {
  if (v == null) return '';
  return String(v).replace(/\D/g, '').slice(0, 4);
}
