// ────────────────────────────────────────────────────────────────────────────
// DB catalogue loader smoke test — live Supabase.
//
// Loads the catalogue via dbLoader, runs the engine with it, asserts:
//   • All buckets populated
//   • Field aliasing actually fills ac_kw / is_plus_variant / battery_capable
//     for the 33 Fronius inverters
//   • Engine runs end-to-end with the DB catalogue (Krishna spec uses real DB SKUs)
//
// Run: node server/scripts/test-db-catalogue-loader.js
// ────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { loadCatalogueFromDb } from '../services/pm/proposalEngine/catalogue/dbLoader.js';
import { runEngine } from '../services/pm/proposalEngine/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, hint = '') {
  const mark = cond ? '✓' : '✗';
  console.log(`  ${mark} ${label}${cond ? '' : '  — ' + hint}`);
  if (cond) pass++; else { fail++; failures.push({ label, hint }); }
}
function section(t) { console.log(); console.log('━'.repeat(80)); console.log('  ' + t); console.log('━'.repeat(80)); }

console.log('━'.repeat(80));
console.log('  DB catalogue loader smoke test — live Supabase');
console.log('━'.repeat(80));

// ── Load the catalogue ────────────────────────────────────────────────────
section('Step 1 — Load catalogue from Supabase');
const cat = await loadCatalogueFromDb(supabase);
const s = cat.__stats;
console.log(`  Products loaded: ${s.products_loaded} (skipped ${s.products_skipped})`);
console.log(`    panels         ${s.panels}`);
console.log(`    inverters      ${s.inverters}`);
console.log(`    batteries      ${s.batteries}`);
console.log(`    bms_controllers ${s.bms_controllers}`);
console.log(`    smart_meters   ${s.smart_meters}`);
console.log(`    ev_chargers    ${s.ev_chargers}`);
console.log(`    bos_items      ${s.bos_items}`);
console.log(`  Labour: ${s.labour_db_or_js} (${s.install_labour_tiers} install tiers)`);
console.log(`  Compliance: ${s.compliance_db_or_js}`);

// ── Bucket counts ────────────────────────────────────────────────────────
section('Step 2 — Bucket counts vs expected');
check('Panels loaded (4 expected)', s.panels === 4);
check('Inverters loaded (>= 39 expected)', s.inverters >= 39, `got ${s.inverters}`);
check('Batteries loaded (>= 1 expected)', s.batteries >= 1, `got ${s.batteries}`);
check('BMS controllers loaded (>= 1 expected)', s.bms_controllers >= 1, `got ${s.bms_controllers}`);
check('Smart meters loaded (>= 1 expected)', s.smart_meters >= 1, `got ${s.smart_meters}`);
check('BoS items loaded (>= 30 expected)', s.bos_items >= 30, `got ${s.bos_items}`);

// ── Field aliasing ────────────────────────────────────────────────────────
section('Step 3 — Field aliasing for Fronius inverters');

// Real semantics confirmed against live DB:
//   hybrid_status='ready'   → Plus (battery-capable out of the box)
//   hybrid_status='upgrade' → Base (requires license)
const PLUS_SKUS = ['FRN-INV-100-G24P-1P', 'FRN-INV-80-G24P-1P', 'FRN-INV-50-G24P-1P'];
let aliased = 0;
for (const sku of PLUS_SKUS) {
  const inv = cat.INVERTERS[sku];
  if (!inv) { console.log(`    ${sku}: not in catalogue`); continue; }
  const acOk = inv.ac_kw != null;
  const plusOk = inv.is_plus_variant === true;
  const battOk = inv.battery_capable === true;
  console.log(`    ${sku}: ac_kw=${inv.ac_kw} · is_plus_variant=${inv.is_plus_variant} · battery_capable=${inv.battery_capable}`);
  if (acOk && plusOk && battOk) aliased++;
}
check(`All 3 known Plus (hybrid_status='ready') SKUs aliased correctly`, aliased === 3, `got ${aliased}/3`);

// Check a base SKU
const BASE_SKU = 'FRN-INV-100-G24-1P';
const base = cat.INVERTERS[BASE_SKU];
if (base) {
  console.log(`    ${BASE_SKU}: ac_kw=${base.ac_kw} · is_plus_variant=${base.is_plus_variant} · battery_capable=${base.battery_capable} · upgrade_license_sku=${base.upgrade_license_sku}`);
  check(`Base SKU is_plus_variant = false`, base.is_plus_variant === false);
  check(`Base SKU battery_capable = false`, base.battery_capable === false);
  check(`Base SKU has upgrade_license_sku`, base.upgrade_license_sku != null);
}

// ── Engineering validator (config + engineering only; no BoM/cost) ───────
section('Step 4 — Engineering validator with DB catalogue (uses aliased fields)');

// validateEngineering reads PANELS/INVERTERS/BATTERIES from catalogue but
// NOT the hardcoded BoS SKUs. So this proves the aliasing actually drives
// the AS/NZS 5033 Voc cold check, MPPT current check, phase consistency, etc.

import { validateEngineering } from '../services/pm/proposalEngine/engineeringValidator.js';
const PANEL_SKU = 'PHN-PNL-595-DRC';
const INVERTER_SKU = 'FRN-INV-100-G24P-1P';
const METER_SKU = 'FRN-MTR-63-S1P';

const spec = {
  customer: {
    full_name: 'DB Loader Test',
    email: 'test@example.com',
    phone: '+64 21 000 0000',
    address: { street: '1 Test St', suburb: 'Auckland', city: 'Auckland', region: 'auckland_vector' },
    property_ownership: 'own',
  },
  bills: { manual_entry: { annual_kwh: 12000, annual_spend: 3500 }},
  system: {
    panel: { sku: PANEL_SKU, count: 20 },
    inverter: { sku: INVERTER_SKU },
    smart_meter: { sku: METER_SKU, phase: 1 },
    string_topology: 'series',
    string_design: { panels_per_string: 5, string_count: 4 },
    cable_run_metres_estimate: 24,
    phase: 1,
  },
  pricing: { customer_price_inc_gst: 40000, stage: 'stage_1_estimate', final_mode: true,
             discount: { applied_nzd: 0, owner_approved: false, reason: null }},
};

const eng = validateEngineering(spec, { catalogue: cat });
console.log(`    Engineering: ${eng.passes.length} passes, ${eng.soft_warnings.length} soft, ${eng.hard_fails.length} hard, ${eng.unverified.length} unverified`);
check('Engineering validator ran without throwing', !!eng);
check('Engineering passes present', eng.passes.length > 0);
check('No hard fails (clean 11.9kW spec on Plus inverter)', eng.hard_fails.length === 0);
check('Voc cold check passed (uoc_max_v aliasing works)',
      eng.passes.some(p => /Voc cold/.test(p.rule)));
check('AS/NZS 4777.2 inverter cert pass', eng.passes.some(p => /AS\/NZS 4777\.2/.test(p.rule)));

// ── Step 5 — Full engine run with DB catalogue + role-based BoM (P3c) ─────
section('Step 5 — Full engine run end-to-end with DB catalogue');

const fullSpec = {
  customer: {
    full_name: 'DB E2E Test',
    email: 'test@example.com',
    phone: '+64 21 000 0000',
    address: { street: '1 Test St', suburb: 'Auckland', city: 'Auckland', region: 'auckland_vector' },
    property_ownership: 'own',
  },
  bills: { manual_entry: { annual_kwh: 12000, annual_spend: 3500,
                           variable_rate_per_kwh_incl_gst: 0.23, daily_fixed_charge_incl_gst: 2.5, buyback_rate: 0.09 }},
  system: {
    panel: { sku: PANEL_SKU, count: 20 },
    inverter: { sku: INVERTER_SKU },
    smart_meter: { sku: METER_SKU, phase: 1 },
    string_topology: 'series',
    string_design: { panels_per_string: 5, string_count: 4 },
    cable_run_metres_estimate: 24,
    phase: 1,
    diverter_included: false,
  },
  pricing: { customer_price_inc_gst: 40000, stage: 'stage_1_estimate', final_mode: true,
             discount: { applied_nzd: 0, owner_approved: false, reason: null }},
  preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' }},
};

const warnings = [];
const e2e = await runEngine(fullSpec, { catalogue: cat, warnings });
check('Engine returned ok=true with DB catalogue + role-based BoM', e2e.ok,
      `config_errors=${JSON.stringify(e2e.config_errors)}, bom_error=${e2e.bom_error}, cost_error=${e2e.cost_error}`);
if (e2e.ok) {
  console.log(`    can_ship=${e2e.can_ship} · margin=${e2e.cost.totals.project_margin_pct.toFixed(1)}% · cost=$${Math.round(e2e.cost.totals.total_cost_ex_gst).toLocaleString()}`);
  console.log(`    BoM lines: ${e2e.bom.length} (${e2e.bom.filter(b => b.group === 'hardware').length} hw + ${e2e.bom.filter(b => b.group === 'bos').length} bos)`);
  check('BoM has hardware lines', e2e.bom.filter(b => b.group === 'hardware').length > 0);
  check('BoM has BoS lines', e2e.bom.filter(b => b.group === 'bos').length > 0);
  check('Engine reports DB catalogue version', /^db-/.test(e2e.versions.catalogue_version));
}
if (warnings.length > 0) {
  console.log(`    BoS role pickers reported ${warnings.length} warnings:`);
  for (const w of warnings.slice(0, 8)) console.log(`      • [${w.code}] ${w.message}`);
}

// ── Summary ───────────────────────────────────────────────────────────────
section('Summary');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.log(`    ✗ ${f.label}  ${f.hint}`);
  process.exit(1);
}
console.log('  ✅ DB catalogue loader works end-to-end with field aliasing.');
