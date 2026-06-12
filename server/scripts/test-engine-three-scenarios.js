// ────────────────────────────────────────────────────────────────────────────
// Three-scenario financial test — Conservative / Expected / Optimistic
//
// Validates the credibility-preserving projection layer. Asserts:
//   1. All three scenarios produce valid output (no crashes)
//   2. Conservative < Expected < Optimistic on 30-yr net savings (monotonicity)
//   3. Conservative ≥ Expected on payback years (i.e. longer payback)
//   4. Reconciliation invariants pass in every scenario
//   5. Year-1 savings nearly identical across scenarios (no compounding yet)
//   6. headline === expected (canonical pointer for downstream rendering)
//
// Also prints a 3-column table so the user can eyeball the spread.
//
// Run: node server/scripts/test-engine-three-scenarios.js
// ────────────────────────────────────────────────────────────────────────────

import { runEngine } from '../services/pm/proposalEngine/index.js';
import { runThreeScenarios, FINANCIAL_SCENARIOS } from '../services/pm/proposalEngine/financialModel.js';

let passCount = 0, failCount = 0;
const failures = [];

function ok(label, actual, expected, tol = 0.01) {
  const pass = Math.abs(actual - expected) <= tol;
  const mark = pass ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(60)} actual ${String(actual).padStart(12)}  expected ${String(expected).padStart(12)}`);
  if (pass) passCount++;
  else { failCount++; failures.push({ label, actual, expected }); }
}

function okExact(label, condition, hint = '') {
  const mark = condition ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(60)} ${condition ? '' : hint}`);
  if (condition) passCount++;
  else { failCount++; failures.push({ label }); }
}

function section(title) {
  console.log();
  console.log('━'.repeat(80));
  console.log(`  ${title}`);
  console.log('━'.repeat(80));
}

const fmt$ = n => '$' + Math.round(n).toLocaleString('en-NZ');

// ── Krishna spec ───────────────────────────────────────────────────────────
const krishnaSpec = {
  customer: {
    full_name: 'Mr Krishna', email: 'krishna@example.com', phone: '+64 21 000 0000',
    address: { street: '6 Woodacre St', suburb: 'Flat Bush', city: 'Auckland', region: 'auckland_vector' },
    property_ownership: 'mortgaged',
  },
  bills: { manual_entry: { annual_kwh: 13044, annual_spend: 3825, retailer: 'Mercury',
                           variable_rate_per_kwh_incl_gst: 0.223, daily_fixed_charge_incl_gst: 2.52, buyback_rate: 0.09 }},
  system: {
    panel: { sku: 'PHN-PNL-595-DRC', count: 24 },
    inverter: { sku: 'FRN-INV-100-G24P-1P' },
    battery: { sku: 'BYD-BAT-276-HVM', module_count: 5 },
    smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: 'parallel',
    string_design: { panels_per_string: 6, string_count: 4 },
    cable_run_metres_estimate: 24,
    phase: 1,
  },
  pricing: { customer_price_inc_gst: 40500, stage: 'stage_1_estimate', final_mode: true,
             discount: { applied_nzd: 0, owner_approved: false, reason: null }},
  preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo',
                 financing: { choice: 'cash' }},
};

const result = await runEngine(krishnaSpec);
const scenarios = runThreeScenarios(krishnaSpec, result.cost);

section('Three-scenario projection for Krishna');

// Print summary table
console.log();
console.log('  Scenario      Yr1 save  Payback   30-yr net      ROI %   IRR %    NPV @5%');
console.log('  ' + '─'.repeat(78));
for (const s of scenarios.summary) {
  console.log(
    `  ${s.label.padEnd(13)} ${fmt$(s.yr1_savings).padStart(8)}  ${(s.payback_yrs + ' yrs').padStart(7)}  ${fmt$(s.lifetime_net_savings).padStart(11)}  ${String(s.total_roi_pct).padStart(6)}%  ${String(s.irr_pct).padStart(5)}%   ${fmt$(s.npv_5pct).padStart(8)}`
  );
}
console.log();
console.log('  Key assumptions:');
for (const s of scenarios.summary) {
  console.log(`    ${s.label.padEnd(13)} inflation ${s.energy_inflation_pct}% · degradation ${s.panel_degradation_pct}%/yr`);
}

// ── Assertions ─────────────────────────────────────────────────────────────
section('Assertions');

const c = scenarios.conservative;
const e = scenarios.expected;
const o = scenarios.optimistic;

// 1. All three returned valid output
okExact('Conservative scenario produced output', !!c.yr1);
okExact('Expected scenario produced output', !!e.yr1);
okExact('Optimistic scenario produced output', !!o.yr1);

// 2. Monotonicity on 30-yr net savings
okExact(`Conservative 30-yr (${fmt$(c.lifetime_net_savings)}) < Expected (${fmt$(e.lifetime_net_savings)})`,
        c.lifetime_net_savings < e.lifetime_net_savings,
        `expected Cons < Exp; got ${c.lifetime_net_savings} vs ${e.lifetime_net_savings}`);
okExact(`Expected 30-yr (${fmt$(e.lifetime_net_savings)}) < Optimistic (${fmt$(o.lifetime_net_savings)})`,
        e.lifetime_net_savings < o.lifetime_net_savings);

// 3. Payback monotonicity (Conservative pays back later)
okExact(`Conservative payback (${c.payback_inflation_degradation_yrs} yrs) ≥ Expected (${e.payback_inflation_degradation_yrs} yrs)`,
        c.payback_inflation_degradation_yrs >= e.payback_inflation_degradation_yrs);
okExact(`Expected payback (${e.payback_inflation_degradation_yrs} yrs) ≥ Optimistic (${o.payback_inflation_degradation_yrs} yrs)`,
        e.payback_inflation_degradation_yrs >= o.payback_inflation_degradation_yrs);

// 4. Reconciliation passes in all 3
okExact('Conservative reconciliation pass', c.reconciliation.all_pass);
okExact('Expected reconciliation pass', e.reconciliation.all_pass);
okExact('Optimistic reconciliation pass', o.reconciliation.all_pass);

// 5. Year-1 savings nearly identical (slight self-consumption-multiplier delta only)
const yr1Spread = Math.max(c.yr1.savings, e.yr1.savings, o.yr1.savings) -
                  Math.min(c.yr1.savings, e.yr1.savings, o.yr1.savings);
okExact(`Year-1 spread across scenarios (${fmt$(yr1Spread)}) ≤ $200 (no compounding yet)`,
        yr1Spread <= 200,
        `yr1 cons ${c.yr1.savings}, exp ${e.yr1.savings}, opt ${o.yr1.savings}`);

// 6. Headline pointer
okExact('scenarios.headline === scenarios.expected',
        scenarios.headline === scenarios.expected);

// 7. Assumptions surfaced correctly
const approx = (a, b) => Math.abs(a - b) < 0.001;
okExact('Conservative assumptions show 3% inflation',
        approx(c.assumptions.energy_inflation_pct_per_year, 3.0));
okExact('Expected assumptions show 5% inflation',
        approx(e.assumptions.energy_inflation_pct_per_year, 5.0));
okExact('Optimistic assumptions show 7% inflation',
        approx(o.assumptions.energy_inflation_pct_per_year, 7.0));

// 8. Scenario labels propagate
okExact('Conservative.scenario label', c.assumptions.scenario === 'Conservative');
okExact('Expected.scenario label', e.assumptions.scenario === 'Expected');
okExact('Optimistic.scenario label', o.assumptions.scenario === 'Optimistic');

// 9. Summary table has 3 rows
okExact('Summary table has exactly 3 entries', scenarios.summary.length === 3);

// 10. Spread is meaningful (Optimistic > Conservative by at least $50k for Krishna)
const spread = o.lifetime_net_savings - c.lifetime_net_savings;
okExact(`Cons-to-Opt spread ${fmt$(spread)} is wide enough to be useful (>= $50k)`,
        spread >= 50_000);

// ── Summary ────────────────────────────────────────────────────────────────
console.log();
console.log('━'.repeat(80));
console.log(`  RESULT: ${passCount} passed, ${failCount} failed`);
console.log('━'.repeat(80));
if (failCount > 0) {
  console.log('  Failures:');
  for (const f of failures) console.log(`    ✗ ${f.label}`);
  process.exit(1);
} else {
  console.log('  ✅ Three-scenario projection works correctly.');
}
