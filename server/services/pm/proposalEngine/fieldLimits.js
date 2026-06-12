// ────────────────────────────────────────────────────────────────────────────
// fieldLimits.js — single source of truth for editable spec field ranges.
//
// configValidator.js imports these to enforce hard limits server-side.
// client/src/pm/utils/fieldHints.js mirrors them for inline UI hint text.
// If a limit changes here, ONLY here — both consumers pick it up.
//
// Each entry:
//   • hard_min / hard_max — engine rejects values outside this range
//   • typical_min / typical_max — NZ residential best-practice band
//                                 (informational only — not enforced)
//   • unit — display unit for hints
//
// Typical bands sourced from MBIE residential consumption studies + industry
// installer best-practice. Promote to admin-tunable company_settings when the
// rest of the §2 hardcode-audit items are addressed (see memory rule
// project-products-fill-sheet).
// ────────────────────────────────────────────────────────────────────────────

export const FIELD_LIMITS = {
  // ── System: panel + count ───────────────────────────────────────────────
  'system.panel.count': {
    hard_min: 4, hard_max: 60,
    typical_min: 12, typical_max: 24,
    unit: 'panels',
  },

  // ── System: battery module count ────────────────────────────────────────
  // Validator enforces 1-24; vendor-specific (BMS_RULES) is narrower:
  //   BYD HVM:   3-8 modules
  //   BYD HVS:   2-5 modules
  //   Reserva:   2-5 modules
  'system.battery.module_count': {
    hard_min: 1, hard_max: 24,
    typical_min: 3, typical_max: 8,
    unit: 'modules',
  },

  // ── System: cable run estimate ──────────────────────────────────────────
  'system.cable_run_metres_estimate': {
    hard_min: 5, hard_max: 200,
    typical_min: 15, typical_max: 35,
    unit: 'm',
  },

  // ── System: string design (per group) ───────────────────────────────────
  // Fronius min 4 panels per string (datasheet); upper bound from Voc-cold
  // envelope on highest-Voc inverter in catalogue.
  'system.string_design.groups.panels_per_string': {
    hard_min: 4, hard_max: 30,
    typical_min: 6, typical_max: 12,
    unit: 'panels',
  },
  'system.string_design.groups.string_count': {
    hard_min: 1, hard_max: 8,
    typical_min: 1, typical_max: 4,
    unit: 'strings',
  },

  // ── Bills: manual_entry ─────────────────────────────────────────────────
  // Ranges anchored to NZ residential corpus (~7M kWh/yr average across
  // ~1.6M households per MBIE 2024).
  'bills.annual_kwh': {
    hard_min: 1500, hard_max: 35000,
    typical_min: 7000, typical_max: 15000,
    unit: 'kWh/yr',
  },
  'bills.annual_spend': {
    hard_min: 500, hard_max: 15000,
    typical_min: 2500, typical_max: 5500,
    unit: 'NZD/yr',
  },
  'bills.variable_rate_per_kwh_incl_gst': {
    hard_min: 0.10, hard_max: 0.50,
    typical_min: 0.20, typical_max: 0.35,
    unit: '$/kWh inc GST',
  },
  'bills.daily_fixed_charge_incl_gst': {
    hard_min: 0.50, hard_max: 5.00,
    typical_min: 1.50, typical_max: 3.50,
    unit: '$/day inc GST',
  },
  'bills.buyback_rate': {
    hard_min: 0.00, hard_max: 0.20,
    typical_min: 0.07, typical_max: 0.13,
    unit: '$/kWh',
  },
};

// Convenience getters used by both server validator and client hint
// generators — keeps callers from hardcoding `FIELD_LIMITS[path].hard_min`.
export function getLimits(path) {
  return FIELD_LIMITS[path] || null;
}
export function getHardRange(path) {
  const l = FIELD_LIMITS[path];
  return l ? { min: l.hard_min, max: l.hard_max } : null;
}
export function getTypicalRange(path) {
  const l = FIELD_LIMITS[path];
  return l ? { min: l.typical_min, max: l.typical_max } : null;
}
