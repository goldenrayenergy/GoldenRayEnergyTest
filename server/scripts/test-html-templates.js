// ────────────────────────────────────────────────────────────────────────────
// HTML template smoke test
//
// Runs Krishna's spec through engine → builds customer proposal HTML +
// sales console HTML. Writes both to mockups/3-quote-sample-krishna/
// for visual inspection. Asserts structural integrity (page count, no
// undefined values, key headings present, three scenarios rendered).
//
// Run: node server/scripts/test-html-templates.js
// ────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runEngine } from '../services/pm/proposalEngine/index.js';
import { runThreeScenarios } from '../services/pm/proposalEngine/financialModel.js';
import { buildCustomerProposalHTML, TEMPLATE_VERSION } from '../services/pm/proposalEngine/htmlTemplates/customerProposal.js';
import { buildSalesConsole } from '../services/pm/proposalEngine/htmlTemplates/salesConsole.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../mockups/3-quote-sample-krishna');

let passCount = 0, failCount = 0;
const failures = [];
function expect(label, condition, hint = '') {
  const mark = condition ? '✓' : '✗';
  console.log(`  ${mark} ${label}${condition ? '' : '  — ' + hint}`);
  if (condition) passCount++;
  else { failCount++; failures.push({ label, hint }); }
}
function section(t) { console.log(); console.log('━'.repeat(80)); console.log('  ' + t); console.log('━'.repeat(80)); }

const krishnaSpec = {
  customer: {
    full_name: 'Mr Naga Sai Krishna Avala',
    email: 'krishna@example.com', phone: '+64 21 000 0000',
    address: { street: '6 Woodacre Street', suburb: 'Flat Bush', city: 'Auckland', postcode: '2019', region: 'auckland_vector' },
    icp_number: '1002175017LCB5D',
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
  pricing: { customer_price_inc_gst: 40500, stage: 'stage_2_firm', final_mode: true,
             discount: { applied_nzd: 0, owner_approved: false, reason: null }},
  preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo',
                 financing: { choice: 'cash' }},
  site_survey: { cable_run_metres_measured: 24 },   // stage_2 requires this
};

console.log('━'.repeat(80));
console.log(`  HTML template smoke — template v${TEMPLATE_VERSION}`);
console.log('━'.repeat(80));

const result = await runEngine(krishnaSpec);
if (!result.ok) {
  console.log('Engine refused Krishna spec — cannot proceed:');
  if (result.config_errors) for (const e of result.config_errors) console.log(`  ${e.path}: ${e.message}`);
  process.exit(1);
}
const scenarios = runThreeScenarios(krishnaSpec, result.cost);

// Build customer proposal
const customerHTML = buildCustomerProposalHTML({
  spec: krishnaSpec,
  costResult: result.cost,
  scenarios,
  engineering: result.engineering,
  bom: result.bom,
  options: {
    quote_ref: 'PR-AVALA-2026-001',
    quote_date: '2026-06-09T00:00:00Z',
    valid_days: 14,
  },
});

const customerPath = path.join(OUT_DIR, 'proposal-krishna-engine-v1.html');
writeFileSync(customerPath, customerHTML, 'utf8');
console.log(`✓ Customer proposal written: ${customerPath} (${(customerHTML.length / 1024).toFixed(1)} KB)`);

// Build sales console
const salesHTML = buildSalesConsole(
  // adapter expects `d` from buildProposalData — we recompute via the customer builder which uses same adapter
  // For test we just rebuild d:
  (await import('../services/pm/proposalEngine/htmlTemplates/proposalData.js')).buildProposalData({
    spec: krishnaSpec, costResult: result.cost, scenarios, engineering: result.engineering, bom: result.bom,
    options: { quote_ref: 'PR-AVALA-2026-001', quote_date: '2026-06-09T00:00:00Z' },
  }),
  result.cost,
);
const salesPath = path.join(OUT_DIR, 'sales-console-krishna-v1.html');
writeFileSync(salesPath, salesHTML, 'utf8');
console.log(`✓ Sales console written:   ${salesPath} (${(salesHTML.length / 1024).toFixed(1)} KB)`);

// ── Structural assertions ─────────────────────────────────────────────────
section('Customer proposal HTML — structural checks');

const pageCount = (customerHTML.match(/<section class="page">/g) || []).length;
// Base 6 + Components + H1 (3) + H2 + H3 + H4 + H5 (four_scenarios) = 13.
// Patterns + tariff need bill_analysis (hidden in this test).
expect(`13 customer pages rendered (got ${pageCount})`, pageCount === 13);

expect('Customer name interpolated', customerHTML.includes('Mr Naga Sai Krishna Avala'));
expect('Quote ref shown', customerHTML.includes('PR-AVALA-2026-001'));
expect('Address shown', customerHTML.includes('Woodacre Street'));
expect('Three-scenario heading present', customerHTML.includes('Your financial outlook'));
expect('Conservative scenario rendered', customerHTML.includes('Conservative'));
expect('Expected scenario rendered', customerHTML.includes('Expected'));
expect('Optimistic scenario rendered', customerHTML.includes('Optimistic'));
expect('Recommended ribbon on Expected', customerHTML.includes('★ RECOMMENDED PLANNING CASE'));

expect('System kW (14.28) shown', customerHTML.includes('14.28'));
expect('Battery label rendered (13.8 kWh)', /BYD HVM 13\.8 kWh/.test(customerHTML));
expect('Annual generation rendered', /17,1\d\d/.test(customerHTML));     // 17,100s
expect('Customer price $40,500 shown', customerHTML.includes('40,500'));
expect('Investment summary heading present', customerHTML.includes('Investment summary'));
expect('Warranty terms present', customerHTML.includes('15yr product'));

expect('No undefined values in HTML', !customerHTML.includes('undefined'));
expect('No NaN values in HTML', !customerHTML.includes('NaN'));
expect('No [object Object] in HTML', !customerHTML.includes('[object Object]'));

section('Sales console HTML — structural checks');
expect('Sales console banner present', salesHTML.includes('INTERNAL SALES CONSOLE'));
expect('Margin floor banner present', /MARGIN BELOW FLOOR|Margin healthy|amber zone/.test(salesHTML));
expect('Hardware BoM table present', salesHTML.includes('Major hardware'));
expect('Three-scenario sensitivity table present', salesHTML.includes('Three-scenario sensitivity'));
expect('Engineering passes shown', salesHTML.includes('✓ Passes'));
expect('Hard fails section shown', salesHTML.includes('Hard fails'));
expect('Krishna full name in sales console', salesHTML.includes('Mr Naga Sai Krishna Avala'));
expect('No undefined in sales console', !salesHTML.includes('undefined'));
expect('No [object Object] in sales console', !salesHTML.includes('[object Object]'));

section('Summary');
console.log(`  RESULT: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  for (const f of failures) console.log(`    ✗ ${f.label} — ${f.hint}`);
  process.exit(1);
}
console.log('  ✅ HTML templates render correctly.');
console.log(`  Customer HTML: open ${customerPath}`);
console.log(`  Sales console: open ${salesPath}`);
