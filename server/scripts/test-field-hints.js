// ────────────────────────────────────────────────────────────────────────────
// Smoke test for L1 field hint generators (client + server).
//
// Verifies that:
//   1. Base hints render the allowed + typical range correctly.
//   2. System tab hints append the engine-pick line when bill recommendation
//      values are passed (panelCountHint + batteryModuleCountHint).
//   3. Pricing tab hints derive LIST + 11% cap from a real engine.cost block.
//   4. All hints degrade gracefully when their inputs are missing/undefined.
//
// Run: node server/scripts/test-field-hints.js
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const {
  panelCountHint, batteryModuleCountHint, cableRunHint,
  panelsPerStringHint, stringCountHint, phaseHint,
  annualKwhHint, annualSpendHint, variableRateHint,
  dailyFixedHint, buybackHint,
  customerPriceHint, discountHint,
} = await import('../../client/src/pm/utils/fieldHints.js');

let pass = 0, fail = 0;
function check(label, value, expected) {
  const ok = expected instanceof RegExp ? expected.test(value)
           : typeof expected === 'function' ? expected(value)
           : value === expected;
  if (ok) { pass++; console.log(`  ✓ ${label}: ${value}`); }
  else    { fail++; console.log(`  ✗ ${label}: ${value}\n    expected: ${expected}`); }
}

// ── 1. Base hints — range + typical band ────────────────────────────────────
console.log('\n━━━ 1. Base hints (range + typical band) ━━━');
check('panel count (no bill rec)',     panelCountHint(null, 475, null),
      /Allowed 4-60 panels.*Typical NZ residential 12-24/);
check('battery (no bill rec)',         batteryModuleCountHint(null, 2.76, null, 'HVM'),
      /Allowed 1-24 modules.*BYD HVM: 3-8/);
check('cable run',                     cableRunHint(),                       /Allowed 5-200 m.*Inverter→switchboard/);
check('panels per string',             panelsPerStringHint(),                /Allowed 4-30 panels.*Voc cold.*Vmp hot/);
check('string count',                  stringCountHint(),                    /Allowed 1-8 strings.*sum.*panel count/);
check('phase',                         phaseHint(),                          /1.*single-phase.*3.*three-phase/);
check('annual kwh',                    annualKwhHint(),                      /Allowed 1,?500-35,?000 kWh\/yr/);
check('annual spend',                  annualSpendHint(),                    /Allowed \$500-\$15,?000.*Typical NZ residential \$2,?500-\$5,?500/);
check('variable rate',                 variableRateHint(),                   /Allowed 0\.10-0\.50.*Typical NZ residential 0\.20-0\.35/);
check('daily fixed',                   dailyFixedHint(),                     /Allowed 0\.50-5.*Typical NZ residential 1\.50-3\.50/);
check('buyback',                       buybackHint(),                        /Allowed 0-0\.20.*Mercury current ~\$0\.09/);

// ── 2. System tab engine-pick line ──────────────────────────────────────────
console.log('\n━━━ 2. System tab engine-pick line ━━━');
check('panel count + 10kW system, 475W panels',
      panelCountHint(null, 475, 10.0),
      /Engine: ~20 \(10 kWp ÷ 475W, clean ×4\)/);
check('panel count + 8kW system, 595W panels',
      panelCountHint(null, 595, 8.0),
      /Engine: ~12 \(8 kWp ÷ 595W, clean ×4\)/);
check('battery HVM @ 13.5 kWh',
      batteryModuleCountHint(null, 2.76, 13.5, 'HVM'),
      /Engine: 5 \(13\.5 kWh ÷ 2\.76 kWh\/module\)/);
check('battery HVS @ 11 kWh',
      batteryModuleCountHint(null, 2.56, 11, 'HVS'),
      /Engine: 5 \(11 kWh ÷ 2\.56 kWh\/module\)/);

// ── 3. Pricing tab hints — fallback paths ───────────────────────────────────
console.log('\n━━━ 3. Pricing tab hints — fallback when no engine run yet ━━━');
check('customer price (no snapshot)',  customerPriceHint(null),
      /Customer-facing total.*tracks the engine LIST/);
check('customer price (snapshot, no totals)', customerPriceHint({}),
      /Customer-facing total/);
check('discount (no snapshot)',        discountHint(null),
      /Reason text and owner approval are required/);

// ── 4. Pricing tab hints — real engine.cost block ───────────────────────────
console.log('\n━━━ 4. Pricing tab hints — with real engine.cost from runEngine() ━━━');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const { loadCatalogueFromDb } = await import(
  '../services/pm/proposalEngine/catalogue/dbLoader.js');
const { runEngine } = await import(
  '../services/pm/proposalEngine/index.js');

const catalogue = await loadCatalogueFromDb(supabase);
const minimalSpec = {
  customer: { full_name: 'Smoke Test', email: 't@t.nz', address: {
    street: '1 Test St', suburb: 'Mt Eden', city: 'Auckland', postcode: '1024',
    region: 'auckland_vector',
  }},
  bills: { manual_entry: {
    annual_kwh: 12000, annual_spend: 3500, retailer: 'Mercury',
    variable_rate_per_kwh_incl_gst: 0.23, daily_fixed_charge_incl_gst: 2.5, buyback_rate: 0.09,
  }},
  system: {
    panel: { sku: 'PHN-PNL-475-QSR', count: 20 },
    inverter: { sku: 'FRN-INV-100-G24-1P' },
    battery: null,
    smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: 'series',
    string_design: { topology: 'series', groups: [{ panels_per_string: 10, string_count: 2 }] },
    cable_run_metres_estimate: 24,
    phase: 1,
  },
  pricing: {
    customer_price_inc_gst: 25000,
    stage: 'stage_1_estimate',
    final_mode: false,
    discount: { applied_nzd: 0, owner_approved: false },
  },
  preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' } },
};

const engineOutput = await runEngine(minimalSpec, { catalogue });
const cost = engineOutput.cost;
const list = cost?.totals?.total_list_inc_gst;
console.log(`  Engine ran: list=$${list} margin=${cost?.totals?.project_margin_pct}%`);
check('customer price hint with real LIST',
      customerPriceHint(cost),
      v => v.includes('Engine LIST: $') && v.includes('Auto-priced'));
check('discount hint with real LIST',
      discountHint(cost),
      v => v.includes('Engine LIST: $') && v.includes('Owner approval'));

console.log(`\n━━━ ${pass} pass · ${fail} fail ━━━`);
if (fail > 0) process.exit(1);
