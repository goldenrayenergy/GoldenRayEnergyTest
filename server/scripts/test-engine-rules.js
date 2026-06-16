// Engine rule tests (Phase B).
//
// Covers the BMS-required hard rule + the tightened findBmsForBattery.
// Runs against an in-memory catalogue derived from the JS fallback (so it's
// hermetic and doesn't depend on Supabase being reachable).
//
// Cases:
//   1. HVM spec normal                → BoM has GEN-BAC-ACC-HVM, engine.can_ship=true
//   2. HVM spec, BMS removed          → engine.can_ship=false, hard_fail mentions BMS
//   3. Reserva spec normal            → BoM has FRN-BAC-ACC-RSV, engine.can_ship=true
//   4. Solar-only spec                → no BMS line, no BMS warning, engine.can_ship=true
//   5. New series (e.g. LVL) WITH a BMS row → BoM has the LVL BMS — guard isn't series-restricted
//
// Run: node server/scripts/test-engine-rules.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { getDefaultCatalogue } from '../services/pm/proposalEngine/catalogue/index.js';
import { runEngine } from '../services/pm/proposalEngine/index.js';
import { findBmsForBattery } from '../services/pm/proposalEngine/catalogue/bosRoles.js';

// Deep-clone the catalogue for each test so mutations don't leak.
// getDefaultCatalogue() returns a cached singleton.
function freshCatalogue() {
  return structuredClone(getDefaultCatalogue());
}

let pass = 0, fail = 0;
const fails = [];
function expect(label, cond, hint = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; fails.push({ label, hint }); console.log(`  ✗ ${label}  — ${hint}`); }
}
function section(t) { console.log(); console.log('━'.repeat(80)); console.log('  ' + t); console.log('━'.repeat(80)); }

// ── Build a spec template ────────────────────────────────────────────────
function specBuilder({ batterySku = null, modules = 0 }) {
  return {
    customer: {
      full_name: 'Test Customer',
      email: 'test@example.com', phone: '+64 21 000 0000',
      address: { street: '1 Test St', suburb: 'Suburb', city: 'Auckland', postcode: '1010', region: 'auckland_vector' },
      icp_number: '00000000000XXX', property_ownership: 'mortgaged',
    },
    bills: { manual_entry: { annual_kwh: 10000, annual_spend: 2500, retailer: 'Mercury',
                              variable_rate_per_kwh_incl_gst: 0.22, daily_fixed_charge_incl_gst: 2.5, buyback_rate: 0.09 }},
    system: {
      panel: { sku: 'PHN-PNL-595-DRC', count: 12 },
      inverter: { sku: 'FRN-INV-100-G24P-1P' },
      ...(batterySku ? { battery: { sku: batterySku, module_count: modules } } : {}),
      smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
      string_topology: 'series',
      string_design: { panels_per_string: 6, string_count: 2 },
      cable_run_metres_estimate: 24,
      phase: 1,
    },
    pricing: { customer_price_inc_gst: 50000, stage: 'stage_1_estimate', final_mode: true,
               discount: { applied_nzd: 0, owner_approved: false, reason: null }},
    preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo',
                   financing: { choice: 'cash' }},
  };
}

// ── Case 1: HVM normal ──────────────────────────────────────────────────
section('Case 1: HVM spec normal → BoM has GEN-BAC-ACC-HVM, engine ships');
{
  const cat = freshCatalogue();
  const spec = specBuilder({ batterySku: 'BYD-BAT-276-HVM', modules: 5 });
  const r = await runEngine(spec, { catalogue: cat });
  expect('engine.ok', r.ok);
  expect('can_ship=true', r.can_ship === true, `block_reasons: ${JSON.stringify(r.block_reasons)}`);
  const bmsLine = r.bom?.find(b => /BAC-ACC|BMS/i.test(b.sku) || /BMS/i.test(b.reason || ''));
  expect('BoM has a BMS line', !!bmsLine, JSON.stringify(bmsLine));
  expect('BMS sku = GEN-BAC-ACC-HVM', bmsLine?.sku === 'GEN-BAC-ACC-HVM', `got ${bmsLine?.sku}`);
  expect('BMS qty = 1 (HVM × 5 mods → 1 tower)', bmsLine?.qty === 1, `got ${bmsLine?.qty}`);
}

// ── Case 2: HVM but BMS removed from catalogue → hard_fail ──────────────
section('Case 2: HVM spec with BMS removed → engine refuses to ship');
{
  const cat = freshCatalogue();
  delete cat.BMS_CONTROLLERS['GEN-BAC-ACC-HVM'];
  const spec = specBuilder({ batterySku: 'BYD-BAT-276-HVM', modules: 5 });
  const r = await runEngine(spec, { catalogue: cat });
  expect('engine.ok still true (config valid)', r.ok);
  expect('can_ship=false', r.can_ship === false);
  const bmsFail = r.engineering?.hard_fails?.find(f => /BMS/i.test(f.rule) || /BMS/i.test(f.message));
  expect('hard_fails includes BMS rule', !!bmsFail, JSON.stringify(r.engineering?.hard_fails));
  expect('hard_fail mentions AS/NZS 5139', bmsFail?.rule?.includes('5139'),
    `got rule: ${bmsFail?.rule}`);
}

// ── Case 3: Reserva normal ──────────────────────────────────────────────
section('Case 3: Reserva spec normal → BoM has FRN-BAC-ACC-RSV');
{
  const cat = freshCatalogue();
  const spec = specBuilder({ batterySku: 'FRN-BAT-315-RSV', modules: 3 });
  const r = await runEngine(spec, { catalogue: cat });
  expect('can_ship=true', r.can_ship === true, JSON.stringify(r.block_reasons));
  const bmsLine = r.bom?.find(b => b.sku === 'FRN-BAC-ACC-RSV');
  expect('BoM has Reserva BMS line', !!bmsLine);
  expect('BMS qty = 1 (3 modules → 1 BMS)', bmsLine?.qty === 1, `got ${bmsLine?.qty}`);
}

// ── Case 3b: Reserva 5 modules → 2 BMS ────────────────────────────────
section('Case 3b: Reserva 5 modules → BoM has 2× FRN-BAC-ACC-RSV');
{
  const cat = freshCatalogue();
  const spec = specBuilder({ batterySku: 'FRN-BAT-315-RSV', modules: 5 });
  const r = await runEngine(spec, { catalogue: cat });
  expect('can_ship=true', r.can_ship === true);
  const bmsLine = r.bom?.find(b => b.sku === 'FRN-BAC-ACC-RSV');
  expect('BMS qty = 2 (5 modules → 2 BMS per bms_per_tower_by_modules)',
    bmsLine?.qty === 2, `got ${bmsLine?.qty}`);
}

// ── Case 4: Solar-only ──────────────────────────────────────────────────
section('Case 4: Solar-only spec → no BMS line, no BMS warning');
{
  const cat = freshCatalogue();
  const spec = specBuilder({ batterySku: null });
  const r = await runEngine(spec, { catalogue: cat });
  expect('can_ship=true', r.can_ship === true);
  const bmsLine = r.bom?.find(b => /BAC-ACC.*HVM|BAC-ACC.*HVS|BAC-ACC.*RSV/.test(b.sku));
  expect('no BMS line in BoM', !bmsLine);
  const bmsFail = r.engineering?.hard_fails?.find(f => /BMS/i.test(f.rule));
  expect('no BMS hard_fail', !bmsFail);
}

// ── Case 5: findBmsForBattery exact-match guard ─────────────────────────
section('Case 5: findBmsForBattery only matches exact for_battery_series');
{
  const cat = freshCatalogue();
  expect('HVM → GEN-BAC-ACC-HVM',
    findBmsForBattery(cat, 'HVM')?.sku === 'GEN-BAC-ACC-HVM');
  expect('HVS → GEN-BAC-ACC-HVS',
    findBmsForBattery(cat, 'HVS')?.sku === 'GEN-BAC-ACC-HVS');
  expect('Reserva → FRN-BAC-ACC-RSV',
    findBmsForBattery(cat, 'Reserva')?.sku === 'FRN-BAC-ACC-RSV');
  expect('Unknown series LVL → null (no brand-fallback to BYD BMS)',
    findBmsForBattery(cat, 'LVL') === null);
  expect('Unknown series Xyz → null',
    findBmsForBattery(cat, 'Xyz') === null);
  expect('null series → null', findBmsForBattery(cat, null) === null);
}

// ── Case 6: Adding a hypothetical LVL BMS row makes it match ────────────
section('Case 6: Future-proof — adding an LVL BMS row makes it discoverable');
{
  const cat = freshCatalogue();
  cat.BMS_CONTROLLERS['BYD-BAC-ACC-LVL'] = {
    sku: 'BYD-BAC-ACC-LVL', name: 'BYD LVL BMS', brand: 'BYD',
    for_battery_series: 'LVL', cost_nzd: 1500, margin_pct: 30,
  };
  const found = findBmsForBattery(cat, 'LVL');
  expect('LVL → BYD-BAC-ACC-LVL (data-driven, not series-restricted)',
    found?.sku === 'BYD-BAC-ACC-LVL');
}

// ── Summary ─────────────────────────────────────────────────────────────
section('Summary');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of fails) console.log(`    ✗ ${f.label} — ${f.hint}`);
  process.exit(1);
}
console.log('  ✅ Engine rule tests pass.');
