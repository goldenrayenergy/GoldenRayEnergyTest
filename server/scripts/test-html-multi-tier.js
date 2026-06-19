// ────────────────────────────────────────────────────────────────────────────
// P4.5b — Multi-tier HTML smoke test.
//
// Walks a 3-tier Krishna-style spec through:
//   1. runEngine → per-tier results
//   2. runThreeScenarios per tier
//   3. buildCustomerProposalHTML with multi-tier inputs
//
// Asserts the new comparison page renders + recommended ribbon shows + every
// non-comparison page still pulls from the recommended (headline) tier.
//
// Writes the rendered HTML to mockups/ for visual inspection.
// ────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runEngine } from '../services/pm/proposalEngine/index.js';
import { runThreeScenarios } from '../services/pm/proposalEngine/financialModel.js';
import { buildCustomerProposalHTML } from '../services/pm/proposalEngine/htmlTemplates/customerProposal.js';
import { buildMultiTierSalesConsole } from '../services/pm/proposalEngine/htmlTemplates/salesConsole.js';
import { buildMultiTierProposalData } from '../services/pm/proposalEngine/htmlTemplates/proposalData.js';
import { ensureTierIds, buildEffectiveSpec } from '../services/pm/proposalEngine/tiers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../mockups/3-quote-sample-krishna');

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, hint = '') {
  const mark = cond ? '✓' : '✗';
  console.log(`  ${mark} ${label}${cond ? '' : '  — ' + hint}`);
  if (cond) pass++; else { fail++; failures.push({ label, hint }); }
}
function section(t) { console.log(); console.log('━'.repeat(80)); console.log('  ' + t); console.log('━'.repeat(80)); }

// ── Krishna 3-tier spec ───────────────────────────────────────────────────
const spec = {
  customer: {
    full_name: 'Mr Naga Sai Krishna Avala',
    email: 'krishna.avala@example.com',
    phone: '+64 21 000 0000',
    address: { street: '6 Woodacre Street', suburb: 'Flat Bush', city: 'Auckland', postcode: '2019', region: 'auckland_vector' },
    icp_number: '1002175017LCB5D',
    property_ownership: 'mortgaged',
  },
  bills: { manual_entry: { annual_kwh: 13044, annual_spend: 3825, retailer: 'Mercury',
                           variable_rate_per_kwh_incl_gst: 0.223, daily_fixed_charge_incl_gst: 2.52, buyback_rate: 0.09 }},
  system: {
    panel: { sku: 'PHN-PNL-595-DRC', count: 24 },
    inverter: { sku: 'FRN-INV-100-G24P-1P' },
    smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: 'parallel',
    string_design: { panels_per_string: 6, string_count: 4 },
    cable_run_metres_estimate: 24,
    phase: 1,
  },
  preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' }},
  tiers: [
    {
      label: 'Solar only',
      system_overrides: { battery: null },
      pricing: { customer_price_inc_gst: 32500, stage: 'stage_1_estimate', final_mode: true,
                 discount: { applied_nzd: 0, owner_approved: false, reason: null }},
      is_recommended: false,
    },
    {
      label: 'Solar + 11 kWh battery',
      system_overrides: { battery: { sku: 'BYD-BAT-276-HVM', module_count: 4 } },
      pricing: { customer_price_inc_gst: 42000, stage: 'stage_1_estimate', final_mode: true,
                 discount: { applied_nzd: 0, owner_approved: false, reason: null }},
      is_recommended: true,           // ← rep flagged this
    },
    {
      label: 'Solar + 14 kWh battery + EV',
      system_overrides: { battery: { sku: 'BYD-BAT-276-HVM', module_count: 5 },
                          wattpilot_included: true },
      pricing: { customer_price_inc_gst: 52000, stage: 'stage_1_estimate', final_mode: true,
                 discount: { applied_nzd: 0, owner_approved: false, reason: null }},
      is_recommended: false,
    },
  ],
};

console.log('━'.repeat(80));
console.log('  P4.5b — multi-tier HTML smoke');
console.log('━'.repeat(80));

// ── 1. Run engine ────────────────────────────────────────────────────────
section('Step 1 — runEngine (3 tiers)');
const engineResult = await runEngine(spec);
check('Engine ok', engineResult.ok);
check('is_multi_tier=true', engineResult.is_multi_tier === true);
check('3 tier results', engineResult.tiers.length === 3);
check('Recommended tier id is tier 2', engineResult.recommended_tier_id === engineResult.tiers[1].tier_id);
console.log(`    Tiers: ${engineResult.tiers.map(t => `${t.label} (${t.can_ship ? '✓' : '✗'})`).join(', ')}`);

// ── 2. Run scenarios per tier ────────────────────────────────────────────
section('Step 2 — runThreeScenarios per tier');
const specWithIds = ensureTierIds(spec);
const tierScenarios = engineResult.tiers.map((tierResult, i) => {
  const effectiveSpec = buildEffectiveSpec(specWithIds, specWithIds.tiers[i]);
  return runThreeScenarios(effectiveSpec, tierResult.cost);
});
check('Scenarios produced for all 3 tiers', tierScenarios.length === 3 && tierScenarios.every(s => s.summary));

// ── 3. Build HTML ────────────────────────────────────────────────────────
section('Step 3 — buildCustomerProposalHTML (multi-tier mode)');
const html = buildCustomerProposalHTML({
  spec: specWithIds,
  engineResult,
  tierScenarios,
  options: {
    quote_ref: 'PR-AVALA-2026-MT1',
    quote_date: '2026-06-10T00:00:00Z',
    valid_days: 14,
  },
});

const outFile = path.join(OUT_DIR, 'proposal-krishna-multitier.html');
writeFileSync(outFile, html, 'utf8');
console.log(`  ✓ Wrote ${(html.length / 1024).toFixed(1)} KB to ${outFile}`);

// ── 4. Structural assertions ─────────────────────────────────────────────
section('Step 4 — Structural assertions');

const pageCount = (html.match(/<section class="page">/g) || []).length;
// Multi-tier base 7 + H1 (3) + H2 + H3 + H4 + H5 = 14. Patterns + tariff hidden.
check(`16 customer pages rendered (got ${pageCount})`, pageCount === 16);

check('Three packages heading present', html.includes('Three packages — pick what fits'));
check('"Solar only" tier label rendered', html.includes('Solar only'));
check('"Solar + 11 kWh battery" tier label rendered', html.includes('Solar + 11 kWh battery'));
check('"Solar + 14 kWh battery + EV" tier label rendered', html.includes('Solar + 14 kWh battery + EV'));
// Tier ribbon ("★ RECOMMENDED" alone) — not to be confused with the financial
// outlook's "★ RECOMMENDED PLANNING CASE" which is a different label.
check('Tier ribbon "★ RECOMMENDED</div>" present (page 2)',
      /★ RECOMMENDED<\/div>/.test(html));
check('Tier ribbon appears exactly once across the proposal',
      (html.match(/★ RECOMMENDED<\/div>/g) || []).length === 1);

// Tier prices on the comparison page
check('Tier 1 price $32,500 shown', /\$32,500/.test(html));
check('Tier 2 price $42,000 shown', /\$42,000/.test(html));
check('Tier 3 price $52,000 shown', /\$52,000/.test(html));

// Headline (recommended tier) should drive Cover + Hardware
check('Cover mentions recommended battery_label (BYD HVM 11 kWh)',
      /BYD HVM 11\.04 kWh/.test(html));
// Wattpilot appears on tier 3's comparison-page card. The Hardware page
// (driven by the recommended tier, which has no EV charger) should NOT have
// a Wattpilot product card — count Wattpilot mentions and assert only 1
// (the comparison-page tier 3 row).
check('Wattpilot only appears once — on tier 3 comparison card',
      (html.match(/Wattpilot/g) || []).length === 1);

// 3-scenario page should be present (sourced from recommended tier)
check('Financial Outlook (3-scenario) page present', html.includes('Three scenarios — your savings outlook'));
check('Conservative / Expected / Optimistic labels rendered',
      html.includes('Conservative') && html.includes('Expected') && html.includes('Optimistic'));

// Pricing page should show recommended tier's price
check('Pricing page shows recommended tier price ($42,000)',
      html.includes('Investment summary') && /\$42,000/.test(html));

// No undefined / NaN / [object Object]
check('No undefined values in HTML', !html.includes('undefined'));
check('No NaN values in HTML', !html.includes('NaN'));
check('No [object Object] in HTML', !html.includes('[object Object]'));

// ── 4b. Multi-tier sales console ─────────────────────────────────────────
section('Step 4b — Multi-tier sales console');
const consoleData = buildMultiTierProposalData({
  spec: specWithIds, engineResult, tierScenarios,
  options: { quote_ref: 'PR-AVALA-2026-MT1', quote_date: '2026-06-10T00:00:00Z' },
});
const consoleHtml = buildMultiTierSalesConsole(consoleData, engineResult);
const consoleOut = path.join(OUT_DIR, 'sales-console-krishna-multitier.html');
writeFileSync(consoleOut, consoleHtml, 'utf8');
console.log(`  ✓ Wrote ${(consoleHtml.length / 1024).toFixed(1)} KB to ${consoleOut}`);

check('Sales console banner present', consoleHtml.includes('INTERNAL SALES CONSOLE'));
check('Tier P&L comparison table present', consoleHtml.includes('Tier P&amp;L comparison'));
check('All 3 tier labels in P&L table', /Solar only/.test(consoleHtml) && /Solar \+ 11 kWh/.test(consoleHtml) && /Solar \+ 14 kWh/.test(consoleHtml));
check('Recommended tier marked with ★', /★ Solar \+ 11 kWh/.test(consoleHtml));
check('Krishna-format columns present',
      consoleHtml.includes('Major HW') &&
      consoleHtml.includes('BoS') &&
      consoleHtml.includes('Lab+Cmpl') &&
      consoleHtml.includes('Discount') &&
      consoleHtml.includes('HW Margin %') &&
      consoleHtml.includes('Floor'));
check('Engineering check per tier table present', consoleHtml.includes('Engineering check per tier'));
check('Hard-fail detail section present', consoleHtml.includes('Hard-fail detail'));
check('Sales console: no undefined', !consoleHtml.includes('undefined'));
check('Sales console: no [object Object]', !consoleHtml.includes('[object Object]'));

// ── 5. Backward compat — single-tier still works via the same entry ──────
section('Step 5 — Single-tier (legacy) input still works');
{
  const singleSpec = { ...spec };
  delete singleSpec.tiers;
  singleSpec.pricing = { customer_price_inc_gst: 42000, stage: 'stage_1_estimate', final_mode: true,
                         discount: { applied_nzd: 0, owner_approved: false, reason: null }};
  singleSpec.system = { ...singleSpec.system, battery: { sku: 'BYD-BAT-276-HVM', module_count: 4 }};
  const eng = await runEngine(singleSpec);
  const sc = runThreeScenarios(singleSpec, eng.cost);
  const legacyHtml = buildCustomerProposalHTML({
    spec: singleSpec, costResult: eng.cost, scenarios: sc,
    engineering: eng.engineering, bom: eng.bom,
    options: { quote_ref: 'PR-AVALA-2026-LEGACY' },
  });
  const legacyPageCount = (legacyHtml.match(/<section class="page">/g) || []).length;
  // Legacy single-tier base 6 + H1 (3) + H2 + H3 + H4 + H5 + H7 (quotation + signature) = 15.
  check('Legacy single-tier renders 15 pages (6 base + 7 H1-H5 derived + 2 H7)', legacyPageCount === 15);
  check('Legacy single-tier has NO tier comparison page',
        !legacyHtml.includes('Three packages — pick what fits'));
}

// ── Summary ──────────────────────────────────────────────────────────────
section('Summary');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.log(`    ✗ ${f.label}  ${f.hint}`);
  process.exit(1);
}
console.log('  ✅ Multi-tier HTML works correctly.');
console.log(`  Open ${outFile} to inspect the rendered 6-page proposal.`);
