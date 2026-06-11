// ────────────────────────────────────────────────────────────────────────────
// Smoke test for Option 1 — Vmp lower-envelope check (§2.10 MVP-1 rules).
//
// Runs the engineering validator against four hand-crafted specs covering:
//   1. Pass    — 6-panel string on GEN24 10.0 Plus (Vmp_hot well above floor)
//   2. Warn    — 5-panel string (above floor but inside 10% buffer band)
//   3. Fail    — 4-panel string (the bug the user reported: borderline/fail)
//   4. Hard-fail — 3-panel string (clearly below floor)
//
// Run with: node server/scripts/test-vmp-envelope-check.js
// Uses the JS-fallback catalogue so it works without a Supabase connection.
// ────────────────────────────────────────────────────────────────────────────

import { validateEngineering } from '../services/pm/proposalEngine/engineeringValidator.js';

const baseSpec = {
  customer: { address: { region: 'auckland_vector' } },
  pricing:  { stage: 'stage_1_estimate' },
  system: {
    panel:    { sku: 'PHN-PNL-595-DRC', count: 16 },
    inverter: { sku: 'FRN-INV-100-G24P-1P' },
    string_topology: 'series',
    smart_meter: { phase: 1 },
  },
};

const cases = [
  { name: 'PASS — 6-panel string × 2 (12 panels, longer string)',
    panel_count: 12, panels_per_string: 6, string_count: 2 },
  { name: 'WARN — 5-panel string × 3 (15 panels, borderline buffer)',
    panel_count: 15, panels_per_string: 5, string_count: 3 },
  { name: 'BUG — 4-panel string × 4 (16 panels, the user-reported case)',
    panel_count: 16, panels_per_string: 4, string_count: 4 },
  { name: 'HARD-FAIL — 3-panel string × 4 (12 panels, below MPPT floor)',
    panel_count: 12, panels_per_string: 3, string_count: 4 },
];

let failures = 0;

for (const tc of cases) {
  const spec = {
    ...baseSpec,
    system: {
      ...baseSpec.system,
      panel: { ...baseSpec.system.panel, count: tc.panel_count },
      string_design: {
        panels_per_string: tc.panels_per_string,
        string_count: tc.string_count,
      },
    },
  };

  const result = validateEngineering(spec);

  const vmpPass    = result.passes.find(p => p.rule.includes('Vmp lower envelope'));
  const vmpBorder  = result.soft_warnings.find(w => w.rule.includes('Vmp borderline'));
  const vmpHard    = result.hard_fails.find(f => f.rule.includes('Vmp lower envelope'));

  console.log(`\n──── ${tc.name} ────`);
  console.log(`  panel_count=${tc.panel_count}, per_string=${tc.panels_per_string}`);
  if (vmpPass)   console.log(`  ✅ PASS  : ${vmpPass.message}`);
  if (vmpBorder) console.log(`  ⚠️  WARN  : ${vmpBorder.message}`);
  if (vmpHard)   console.log(`  ❌ FAIL  : ${vmpHard.message}`);
  if (!vmpPass && !vmpBorder && !vmpHard) {
    console.log(`  ⛔ NO Vmp check ran — check that mppt_v_min is set on inverter`);
    failures++;
  }
}

console.log(`\n──── Summary ────`);
console.log(`  ${cases.length - failures}/${cases.length} cases produced a Vmp verdict.`);
process.exit(failures === 0 ? 0 : 1);
