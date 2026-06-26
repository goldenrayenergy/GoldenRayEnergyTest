// ────────────────────────────────────────────────────────────────────────────
// Root-cause-gap test — every engineering hard_fail / soft_warning rule the
// validator can emit must resolve to a STABLE code (never the 'engineering_other'
// fallback), and that code set must exactly match the engineering codes the
// client catalogue knows about. This is the safety net that keeps the
// validator (server) and the Error Playbook (client) in lockstep.
// No DB needed — codeForRule is pure.
// ────────────────────────────────────────────────────────────────────────────
import { codeForRule } from '../services/pm/proposalEngine/engineeringValidator.js';

let pass = 0, fail = 0;
const check = (l, c, h = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${c ? '' : '  — ' + h}`); c ? pass++ : fail++; };

// Every rule STRING the validator can put in hard_fails or soft_warnings.
// (Copied from engineeringValidator.js — if a rule is reworded there, update here.)
const RULES_EMITTED = [
  'AS/NZS 5033 §3 — Voc max',
  'AS/NZS 5033 §3 — Voc reduced mode',
  'MVP-1 §2.10 — Vmp lower envelope',
  'MVP-1 §2.10 — Vmp borderline',
  'AS/NZS 5033 § / Inverter datasheet — MPPT current clipping',
  'AS/NZS 5033 §3 — ISC max',
  'Fronius DC/AC oversizing',
  'Fronius reduced-mode oversizing — Voc',
  'Fronius reduced-mode oversizing',
  'Battery interface — Plus inverter required',
  'Inverter–battery pairing (manufacturer matrix)',
  'HVM battery module count',   // dynamic: `${series} battery module count`
  'HVS battery module count',
  'Reserva battery module count',
  'Cell chemistry — LFP only',
  'Fronius string minimum',
  'Smart meter phase mismatch',
  'Parallel-string topology',
  'Mixed-vendor warranty disclosure',
];

// The engineering codes the client catalogue (errorCatalogue.js → ENGINEERING)
// declares. Server can't import the client file, so we mirror the key set here;
// this test fails loudly if the two drift.
const CATALOGUE_ENGINEERING_CODES = new Set([
  'voc_cold_exceeded', 'voc_reduced_mode_warn', 'vmp_below_min', 'vmp_borderline',
  'mppt_current_clipping', 'isc_exceeded', 'dc_ac_oversize_max', 'dc_ac_reduced_voc',
  'dc_ac_reduced_mode', 'battery_needs_plus_inverter', 'inverter_battery_not_approved',
  'battery_module_count_invalid', 'battery_not_lfp', 'string_below_minimum',
  'phase_mismatch', 'parallel_topology_disclosure', 'mixed_vendor_disclosure',
]);

console.log('━'.repeat(70));
console.log('  Engineering rule → stable code coverage');
console.log('━'.repeat(70));

// 1. No rule falls through to the generic fallback.
const produced = new Set();
let fellThrough = 0;
for (const rule of RULES_EMITTED) {
  const code = codeForRule(rule);
  produced.add(code);
  if (code === 'engineering_other') { fellThrough++; console.log(`     ✗ "${rule}" → engineering_other`); }
}
check(`every emitted rule maps to a stable code (${RULES_EMITTED.length} rules)`, fellThrough === 0, `${fellThrough} fell through`);

// 2. Every produced code is known to the client catalogue.
const unknown = [...produced].filter(c => !CATALOGUE_ENGINEERING_CODES.has(c));
check('every produced code exists in the client catalogue', unknown.length === 0, `unknown: ${unknown.join(', ')}`);

// 3. No catalogue engineering code is orphaned (declared but never produced).
const orphans = [...CATALOGUE_ENGINEERING_CODES].filter(c => !produced.has(c));
check('no orphaned catalogue codes (all are reachable)', orphans.length === 0, `orphans: ${orphans.join(', ')}`);

console.log('━'.repeat(70));
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('━'.repeat(70));
process.exit(fail ? 1 : 0);
