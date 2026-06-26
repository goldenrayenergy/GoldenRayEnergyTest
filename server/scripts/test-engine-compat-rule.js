// ────────────────────────────────────────────────────────────────────────────
// Focused test — the new inverter↔battery pairing rule in engineeringValidator,
// driven by inverter.compatible_batteries (attached by dbLoader from
// inverter_battery_compat). Verifies all three branches:
//   A) valid pairing            → a "manufacturer matrix" PASS
//   B) invalid (Primo × 12.6)   → a "manufacturer matrix" HARD FAIL
//   C) no matrix on inverter    → rule SKIPPED (legacy fallback, no new fail)
// ────────────────────────────────────────────────────────────────────────────
import { validateEngineering } from '../services/pm/proposalEngine/engineeringValidator.js';
import { getDefaultCatalogue } from '../services/pm/proposalEngine/catalogue/index.js';

let pass = 0, fail = 0;
const check = (label, cond, hint = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  — ' + hint}`);
  cond ? pass++ : fail++;
};
const hasRule = (list, rx) => list.some(r => rx.test(r.rule) || rx.test(r.message || ''));

// Primo Reserva support per the deck: only 6.3 & 9.5 (NOT 12.6 / 15.8)
const PRIMO_COMPAT = [
  { battery_system_sku: 'FR-RES-6.3', family: 'Reserva', capacity_kwh: 6.31, is_compatible: true, charge_kw: 4.5, discharge_kw: 4.5, full_backup: true },
  { battery_system_sku: 'FR-RES-9.5', family: 'Reserva', capacity_kwh: 9.47, is_compatible: true, charge_kw: 6.75, discharge_kw: 6.75, full_backup: true },
];

function makeCatalogue(compatList) {
  const cat = structuredClone(getDefaultCatalogue());
  cat.INVERTERS['FRN-INV-100-G24P-1P'].compatible_batteries = compatList;
  return cat;
}

function spec(moduleCount) {
  return {
    customer: { full_name: 'T', email: 't@t.com', phone: '+64 21 0',
      address: { street: '1 St', suburb: 'S', city: 'Auckland', region: 'auckland_vector' }, property_ownership: 'own' },
    bills: { manual_entry: { annual_kwh: 10000, annual_spend: 3000, variable_rate_per_kwh_incl_gst: 0.25, daily_fixed_charge_incl_gst: 2, buyback_rate: 0.09 } },
    system: {
      panel: { sku: 'PHN-PNL-475-QSR', count: 8 },
      inverter: { sku: 'FRN-INV-100-G24P-1P' },
      battery: { sku: 'FRN-BAT-315-RSV', module_count: moduleCount },  // Reserva 3.15 kWh/module
      smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
      string_topology: 'series', string_design: { panels_per_string: 8, string_count: 1 },
      cable_run_metres_estimate: 24, phase: 1,
    },
    pricing: { customer_price_inc_gst: 30000, stage: 'stage_1_estimate', final_mode: true,
      discount: { applied_nzd: 0, owner_approved: false, reason: null } },
    preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' } },
  };
}

const RX = /pairing.*matrix|manufacturer matrix/i;
console.log('━'.repeat(70));
console.log('  Inverter↔battery pairing rule — focused test');
console.log('━'.repeat(70));

// A) valid: 2-module Reserva = 6.30 kWh → matches FR-RES-6.3 (6.31)
const A = validateEngineering(spec(2), { catalogue: makeCatalogue(PRIMO_COMPAT) });
check('A. Primo + Reserva 6.3 (2 mod) → manufacturer-matrix PASS', hasRule(A.passes, RX) && !hasRule(A.hard_fails, RX),
  `passes:${hasRule(A.passes, RX)} hard:${hasRule(A.hard_fails, RX)}`);

// B) invalid: 4-module Reserva = 12.60 kWh → NOT in Primo's list → hard fail
const B = validateEngineering(spec(4), { catalogue: makeCatalogue(PRIMO_COMPAT) });
check('B. Primo + Reserva 12.6 (4 mod) → manufacturer-matrix HARD FAIL',
  hasRule(B.hard_fails, /not an approved pairing/i),
  `hard_fails: ${JSON.stringify(B.hard_fails.map(f => f.rule))}`);

// C) no matrix on inverter → rule skipped (no manufacturer-matrix verdict at all)
const C = validateEngineering(spec(4), { catalogue: makeCatalogue(null) });
check('C. No compatible_batteries → rule skipped (legacy fallback)',
  !hasRule(C.passes, RX) && !hasRule(C.hard_fails, RX),
  `passes:${hasRule(C.passes, RX)} hard:${hasRule(C.hard_fails, RX)}`);

console.log('━'.repeat(70));
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('━'.repeat(70));
process.exit(fail ? 1 : 0);
