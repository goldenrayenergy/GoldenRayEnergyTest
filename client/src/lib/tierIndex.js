// Canonical 0-indexed tier positions for the residential quote flow.
//
// Every read AND every write of a per-tier state slot (battery kWh, EV km,
// panel count) MUST use these constants. Mixing 0-indexed (0/1/2) with
// human tier numbers (1/2/3 or 2/3) is exactly what produced Bug 1
// (2026-08-26): the Solar+Battery+EV slider wrote customByTier[2] using
// viewingTierIdx=2 but reads used getCustomBatteryKwh(3), landing on a
// missing key and silently updating the wrong card. Importing from one
// source stops the class of bug from recurring when a 4th tier or a new
// per-tier field gets added.
//
// The residential flow ships THREE tiers in a fixed rendering order:
//   idx 0 — Solar only
//   idx 1 — Solar + battery                 (recommended by default)
//   idx 2 — Solar + battery + EV-ready
//
// If a 4th tier is ever added (commercial, PPA, …), append it here + to
// TIER_INDICES and use the new named constant everywhere it's referenced.
// Never hard-code raw indices in tier-state code.

export const TIER_SOLAR_ONLY        = 0;
export const TIER_SOLAR_BATTERY     = 1;
export const TIER_SOLAR_BATTERY_EV  = 2;

export const TIER_INDICES = Object.freeze([
  TIER_SOLAR_ONLY,
  TIER_SOLAR_BATTERY,
  TIER_SOLAR_BATTERY_EV,
]);

export const TIER_LABELS = Object.freeze({
  [TIER_SOLAR_ONLY]:       'Solar only',
  [TIER_SOLAR_BATTERY]:    'Solar + battery',
  [TIER_SOLAR_BATTERY_EV]: 'Solar + battery + EV',
});
