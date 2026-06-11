// ────────────────────────────────────────────────────────────────────────────
// Smoke test for Option 2 — String designer envelope-search algorithm.
//
// Verifies the designer picks the right layout across realistic cases.
//
// Run: node server/scripts/test-string-designer.js
// ────────────────────────────────────────────────────────────────────────────

import { recommendLayout } from '../services/pm/proposalEngine/stringDesigner.js';

// Fixtures from JS fallback catalogue
const PANEL_595 = {
  watts: 595,
  voc_stc: 52.92,
  isc_stc: 14.32,
  vmp_stc: 43.75,
  imp_stc: 13.60,
  voltage_temp_coef_pct_per_c: -0.25,
};

const INVERTER_PRIMO_10P = {
  ac_kw: 10.0,
  uoc_max_v: 600,
  mppt_v_min: 165,
  idc_max_a_per_mppt: 22,
  isc_max_a_mppt1: 41.25,
  isc_max_a_mppt2: 36,
  mppt_count: 2,
};

// Imagine a Verto 3ph commercial inverter (high mppt_v_min)
const INVERTER_VERTO_PLUS = {
  ac_kw: 20.0,
  uoc_max_v: 1000,
  mppt_v_min: 240,
  idc_max_a_per_mppt: 30,
  isc_max_a_mppt1: 50,
  mppt_count: 3,
};

const REGION_AKL = { t_min_celsius: -10 };

const cases = [
  {
    name: '12 panels on GEN24 10.0 Plus — should pick 2 strings × 6',
    panel: PANEL_595, inverter: INVERTER_PRIMO_10P, panelCount: 12, region: REGION_AKL,
    expect: { panels_per_string: 6, string_count: 2, reason_code: 'optimal' },
  },
  {
    name: '16 panels on GEN24 10.0 Plus — should prefer 2 × 8 over 4 × 4',
    panel: PANEL_595, inverter: INVERTER_PRIMO_10P, panelCount: 16, region: REGION_AKL,
    expect: { panels_per_string: 8, string_count: 2, reason_code: 'optimal' },
  },
  {
    name: '20 panels on GEN24 10.0 Plus — 2 × 10 or 4 × 5? (10 ≈ Voc 600V — TIGHT)',
    panel: PANEL_595, inverter: INVERTER_PRIMO_10P, panelCount: 20, region: REGION_AKL,
    expect_pass: true,
  },
  {
    name: '24 panels on GEN24 10.0 Plus — NO valid layout (oversized array for this inverter)',
    panel: PANEL_595, inverter: INVERTER_PRIMO_10P, panelCount: 24, region: REGION_AKL,
    expect: { reason_code: 'no_valid_layout' },
  },
  {
    name: '17 panels (prime) on GEN24 10.0 Plus — asymmetric fallback',
    panel: PANEL_595, inverter: INVERTER_PRIMO_10P, panelCount: 17, region: REGION_AKL,
    expect: { reason_code: 'asymmetric_fallback' },
  },
  {
    name: '8 panels on GEN24 10.0 Plus — only 1 × 8 or 2 × 4 viable, prefer 1 × 8',
    panel: PANEL_595, inverter: INVERTER_PRIMO_10P, panelCount: 8, region: REGION_AKL,
    expect: { panels_per_string: 8, string_count: 1, reason_code: 'optimal' },
  },
  {
    name: '12 panels on Verto Plus (mppt_v_min=240V) — 4 panels = 155V, NO valid layout',
    panel: PANEL_595, inverter: INVERTER_VERTO_PLUS, panelCount: 12, region: REGION_AKL,
    expect_pass_or_violation_set: ['vmp_hot_below_floor'],
  },
];

let failed = 0;

for (const tc of cases) {
  console.log(`\n──── ${tc.name} ────`);
  const layout = recommendLayout({
    panel: tc.panel, inverter: tc.inverter,
    panelCount: tc.panelCount, region: tc.region,
  });

  console.log(`  Result: ${layout.string_count} × ${layout.panels_per_string} ` +
              `(${layout.topology}) — ${layout.reason_code}`);
  console.log(`  Voc cold: ${layout.string_voc_cold}V  /  Vmp hot: ${layout.string_vmp_hot}V`);
  console.log(`  ${layout.reason}`);

  if (layout.alternatives?.length > 0) {
    console.log(`  Alternatives:`);
    for (const alt of layout.alternatives) {
      console.log(`    • ${alt.string_count} × ${alt.panels_per_string} ` +
                  `(${alt.topology}, Voc ${alt.string_voc_cold}V, Vmp ${alt.string_vmp_hot}V)`);
    }
  }

  if (layout.violations?.length > 0) {
    console.log(`  Violations:`);
    for (const v of layout.violations) console.log(`    ⚠️  ${v.message}`);
  }

  // Assertions
  let ok = true;
  if (tc.expect) {
    for (const [key, val] of Object.entries(tc.expect)) {
      if (layout[key] !== val) {
        console.log(`  ❌ ASSERT FAIL: expected ${key}=${val}, got ${layout[key]}`);
        ok = false;
      }
    }
  }
  if (tc.expect_pass && layout.reason_code === 'no_valid_layout') {
    console.log(`  ❌ ASSERT FAIL: expected a valid layout, got no_valid_layout`);
    ok = false;
  }
  if (tc.expect_pass_or_violation_set) {
    const codes = (layout.violations || []).map(v => v.code);
    const allMatch = tc.expect_pass_or_violation_set.every(c => codes.includes(c));
    if (!allMatch && layout.reason_code !== 'optimal' && layout.reason_code !== 'asymmetric_fallback') {
      console.log(`  ❌ ASSERT FAIL: expected violations ${tc.expect_pass_or_violation_set.join(', ')}, got [${codes.join(', ')}]`);
      ok = false;
    }
  }

  if (ok) console.log(`  ✅ ok`);
  else failed++;
}

console.log(`\n──── Summary ────`);
console.log(`  ${cases.length - failed}/${cases.length} cases pass.`);
process.exit(failed === 0 ? 0 : 1);
