// ────────────────────────────────────────────────────────────────────────────
// Catalogue DI test — proves that passing options.catalogue overrides the
// default JS-module catalogue, so the engine can be driven by a DB-fetched
// catalogue (as it will be after P8 admin CSV import lands).
//
// Strategy:
//   1. Run the engine on a known spec with the DEFAULT catalogue.
//   2. Build a FIXTURE catalogue where the panel cost is doubled.
//   3. Run the same spec with the fixture catalogue.
//   4. Assert: total cost goes up by exactly (panel_count × panel_cost) — proves
//      the fixture catalogue actually drove the cost.
// ────────────────────────────────────────────────────────────────────────────

import { runEngine } from '../services/pm/proposalEngine/index.js';
import { runFinancialModel, runThreeScenarios } from '../services/pm/proposalEngine/financialModel.js';
import { getDefaultCatalogue } from '../services/pm/proposalEngine/catalogue/index.js';

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, hint = '') {
  const mark = cond ? '✓' : '✗';
  console.log(`  ${mark} ${label}${cond ? '' : '  — ' + hint}`);
  if (cond) pass++; else { fail++; failures.push({ label, hint }); }
}
function section(t) { console.log(); console.log('━'.repeat(80)); console.log('  ' + t); console.log('━'.repeat(80)); }

function spec(price = 50000) {
  return {
    customer: {
      full_name: 'DI Test Customer', email: 'di@test.com', phone: '+64 21 000 0000',
      address: { street: '1 Test St', suburb: 'Testville', city: 'Auckland', region: 'auckland_vector' },
      property_ownership: 'own',
    },
    bills: { manual_entry: { annual_kwh: 10000, annual_spend: 3000,
                             variable_rate_per_kwh_incl_gst: 0.25, daily_fixed_charge_incl_gst: 2, buyback_rate: 0.09 }},
    system: {
      panel: { sku: 'PHN-PNL-595-DRC', count: 20 },
      inverter: { sku: 'FRN-INV-100-G24P-1P' },
      battery: { sku: 'BYD-BAT-276-HVM', module_count: 5 },
      smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
      string_topology: 'parallel',
      string_design: { panels_per_string: 5, string_count: 4 },
      cable_run_metres_estimate: 24,
      phase: 1,
    },
    pricing: { customer_price_inc_gst: price, stage: 'stage_1_estimate', final_mode: true,
               discount: { applied_nzd: 0, owner_approved: false, reason: null }},
    preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' }},
  };
}

console.log('━'.repeat(80));
console.log('  Catalogue DI test — engine uses options.catalogue when provided');
console.log('━'.repeat(80));

const PANEL_SKU = 'PHN-PNL-595-DRC';
const PANEL_COUNT = 20;

// ── 1. Baseline run with default catalogue ────────────────────────────────
section('Step 1 — baseline with default catalogue');
const baseline = runEngine(spec());
check('Baseline engine succeeded', baseline.ok && baseline.can_ship === true);
const baselineHardwareCost = baseline.cost.sections.major_hardware.cost;
const baselineTotalCost = baseline.cost.totals.total_cost_ex_gst;
const baselineCatVersion = baseline.versions.catalogue_version;
console.log(`    Hardware cost: $${baselineHardwareCost.toLocaleString()}`);
console.log(`    Total cost ex GST: $${baselineTotalCost.toLocaleString()}`);
console.log(`    Catalogue version: ${baselineCatVersion}`);

// ── 2. Build a fixture catalogue with the panel cost DOUBLED ──────────────
section('Step 2 — build fixture catalogue (panel cost × 2)');
const defaultCat = getDefaultCatalogue();
const panelOriginal = defaultCat.PANELS[PANEL_SKU];
const panelDoubled = { ...panelOriginal, cost_nzd: panelOriginal.cost_nzd * 2 };
const fixtureCatalogue = {
  ...defaultCat,
  PANELS: { ...defaultCat.PANELS, [PANEL_SKU]: panelDoubled },
  CATALOGUE_VERSION: 'fixture-2x-panels',
};
console.log(`    Original panel cost: $${panelOriginal.cost_nzd}`);
console.log(`    Fixture panel cost:  $${panelDoubled.cost_nzd}`);

// ── 3. Run engine with fixture catalogue ──────────────────────────────────
section('Step 3 — engine run with fixture catalogue');
const fixtured = runEngine(spec(), { catalogue: fixtureCatalogue });
check('Fixture run engine succeeded', fixtured.ok);
const fixturedHardwareCost = fixtured.cost.sections.major_hardware.cost;
const fixturedTotalCost = fixtured.cost.totals.total_cost_ex_gst;
const fixturedCatVersion = fixtured.versions.catalogue_version;
console.log(`    Hardware cost: $${fixturedHardwareCost.toLocaleString()}`);
console.log(`    Total cost ex GST: $${fixturedTotalCost.toLocaleString()}`);
console.log(`    Catalogue version: ${fixturedCatVersion}`);

// ── 4. Assertions ────────────────────────────────────────────────────────
section('Step 4 — assert fixture catalogue actually drove behaviour');

const expectedExtraCost = panelOriginal.cost_nzd * PANEL_COUNT;
check(`Hardware cost increased by $${expectedExtraCost} (20 × $${panelOriginal.cost_nzd})`,
      Math.abs((fixturedHardwareCost - baselineHardwareCost) - expectedExtraCost) < 0.50,
      `actual delta $${fixturedHardwareCost - baselineHardwareCost}, expected $${expectedExtraCost}`);
check(`Total cost increased by same amount`,
      Math.abs((fixturedTotalCost - baselineTotalCost) - expectedExtraCost) < 0.50);
check(`Engine reports fixture catalogue version`,
      fixturedCatVersion === 'fixture-2x-panels');
check(`Default catalogue still works after the fixture run`,
      runEngine(spec()).cost.totals.total_cost_ex_gst === baselineTotalCost);

// ── 5. Threading through to financial model + scenarios ──────────────────
section('Step 5 — fixture catalogue threads to financial model + scenarios');
const finBaseline = runFinancialModel(spec(), baseline.cost);
const finFixtured = runFinancialModel(spec(), fixtured.cost, { catalogue: fixtureCatalogue });
check('Financial model accepts catalogue option',
      finFixtured.yr1.generation_kwh === finBaseline.yr1.generation_kwh,
      'panel watts unchanged → same generation');

const scenariosBaseline = runThreeScenarios(spec(), baseline.cost);
const scenariosFixtured = runThreeScenarios(spec(), fixtured.cost, {}, { catalogue: fixtureCatalogue });
check('runThreeScenarios accepts baseOptions for catalogue',
      scenariosFixtured.summary.length === 3);

// ── Summary ──────────────────────────────────────────────────────────────
section('Summary');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.log(`    ✗ ${f.label}  ${f.hint}`);
  process.exit(1);
}
console.log('  ✅ Catalogue DI works correctly end-to-end.');
