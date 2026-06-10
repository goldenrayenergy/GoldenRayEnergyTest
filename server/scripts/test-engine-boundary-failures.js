// ────────────────────────────────────────────────────────────────────────────
// Boundary / failure test — proposal engine
//
// Confirms the engine REFUSES to ship bad inputs. For each case below, the
// engine must either fail config validation, return engineering hard_fails,
// or report margin_floor_status === 'below_floor'.
//
// These tests are the ones that matter most for safety: they prove the
// validator/floor actually fires when the input is wrong, not just when the
// input happens to be the Krishna PDF.
//
// Run: node server/scripts/test-engine-boundary-failures.js
// ────────────────────────────────────────────────────────────────────────────

import { runEngine } from '../services/pm/proposalEngine/index.js';

let passCount = 0, failCount = 0;
const failures = [];

function expectRejection(name, spec, expected) {
  const r = runEngine(spec);

  // Collect what actually happened
  const configErrPaths = (r.config_errors || []).map(e => e.path);
  const hardFailRules = (r.engineering?.hard_fails || []).map(f => f.rule);
  const floorStatus = r.cost?.margin_floor_status;

  let pass = false;
  let detail = '';

  if (expected.type === 'config_error') {
    pass = configErrPaths.some(p => p.includes(expected.contains));
    detail = pass
      ? `config error at ${configErrPaths.find(p => p.includes(expected.contains))}`
      : `expected config error containing "${expected.contains}", got: [${configErrPaths.join(', ')}] / hard_fails: [${hardFailRules.join(', ')}]`;
  } else if (expected.type === 'hard_fail') {
    pass = hardFailRules.some(rule => rule.includes(expected.contains));
    detail = pass
      ? `hard fail: ${hardFailRules.find(rule => rule.includes(expected.contains))}`
      : `expected hard_fail containing "${expected.contains}", got hard_fails: [${hardFailRules.join(', ')}], config_errors: [${configErrPaths.join(', ')}]`;
  } else if (expected.type === 'below_floor') {
    pass = floorStatus === 'below_floor';
    detail = pass
      ? `floor status = below_floor (margin ${r.cost?.totals?.project_margin_pct}%)`
      : `expected below_floor, got ${floorStatus} (margin ${r.cost?.totals?.project_margin_pct}%)`;
  } else if (expected.type === 'cant_ship') {
    pass = r.can_ship === false;
    detail = pass
      ? `can_ship = false, blocks: ${r.block_reasons?.length || 0}`
      : `expected can_ship = false, got ${r.can_ship}`;
  }

  const mark = pass ? '✓' : '✗';
  console.log(`  ${mark} ${name.padEnd(60)} ${detail}`);
  if (pass) passCount++;
  else { failCount++; failures.push({ name, detail }); }
}

// ── Base good spec (so we only mutate one field per test) ──────────────────
function baseSpec() {
  return {
    customer: {
      full_name: 'Test Customer',
      email: 'test@example.com',
      phone: '+64 21 000 0000',
      address: { street: '1 Test St', suburb: 'Testville', city: 'Auckland', region: 'auckland_vector' },
      property_ownership: 'own',
    },
    bills: { manual_entry: { annual_kwh: 12000, annual_spend: 3500, variable_rate_per_kwh_incl_gst: 0.23, daily_fixed_charge_incl_gst: 2.5, buyback_rate: 0.09 }},
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
    pricing: { customer_price_inc_gst: 40000, stage: 'stage_1_estimate', final_mode: true,
               discount: { applied_nzd: 0, owner_approved: false, reason: null }},
    preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo',
                   financing: { choice: 'cash' }},
  };
}

console.log('━'.repeat(80));
console.log('  Boundary / failure tests — engine must REFUSE these specs');
console.log('━'.repeat(80));
console.log();

// ── 1. Krishna's ORIGINAL design (13 panels in series) — Voc violation ────
{
  const spec = baseSpec();
  spec.system.panel.count = 26;
  spec.system.string_design = { panels_per_string: 13, string_count: 2 };
  // Voc cold per panel = 52.92 × 1.0875 = 57.55V × 13 = 748V > 600V Uoc max
  expectRejection('1. 13-in-series Voc violation (748V > 600V)',
    spec, { type: 'hard_fail', contains: 'Voc max' });
}

// ── 2. Battery with base (non-Plus) inverter ────────────────────────────────
{
  const spec = baseSpec();
  spec.system.inverter.sku = 'FRN-INV-100-G24-1P';  // base, not Plus
  expectRejection('2. Battery on base GEN24 (not Plus)',
    spec, { type: 'config_error', contains: 'battery' });
}

// ── 3. Invalid BYD HVM module count (9 > max 8) ─────────────────────────────
{
  const spec = baseSpec();
  spec.system.battery.module_count = 9;
  spec.system.string_topology = 'series';
  spec.system.string_design = { panels_per_string: 10, string_count: 2 };
  expectRejection('3. 9× HVM modules (max 8 per tower)',
    spec, { type: 'hard_fail', contains: 'module count' });
}

// ── 4. BYD HVM with 2 modules (min 3) ───────────────────────────────────────
{
  const spec = baseSpec();
  spec.system.battery.module_count = 2;
  expectRejection('4. 2× HVM modules (min 3 per tower)',
    spec, { type: 'hard_fail', contains: 'module count' });
}

// ── 5. String of 3 panels (Fronius minimum 4) ───────────────────────────────
{
  const spec = baseSpec();
  spec.system.panel.count = 24;
  spec.system.string_design = { panels_per_string: 3, string_count: 8 };
  expectRejection('5. 3-panel strings (Fronius minimum 4)',
    spec, { type: 'hard_fail', contains: 'string minimum' });
}

// ── 6. Phase mismatch (3ph meter on 1ph inverter) ───────────────────────────
{
  const spec = baseSpec();
  spec.system.smart_meter = { sku: 'FRN-MTR-63-S3P', phase: 3 };
  expectRejection('6. 3-phase meter on 1-phase inverter',
    spec, { type: 'hard_fail', contains: 'phase mismatch' });
}

// ── 7. Customer price below 10% margin floor ────────────────────────────────
{
  const spec = baseSpec();
  spec.pricing.customer_price_inc_gst = 25000;  // engine cost ~$33k, well below
  expectRejection('7. Customer price $25k on $33k-cost system (below floor)',
    spec, { type: 'below_floor' });
}

// ── 8. Discount applied without owner approval flag ─────────────────────────
{
  const spec = baseSpec();
  spec.pricing.discount = { applied_nzd: 2000, owner_approved: false, reason: 'Customer asked' };
  expectRejection('8. Discount > 0 without owner_approved',
    spec, { type: 'config_error', contains: 'owner_approved' });
}

// ── 9. Discount > 0 without reason field ────────────────────────────────────
{
  const spec = baseSpec();
  spec.pricing.discount = { applied_nzd: 2000, owner_approved: true, reason: null,
                            approved_by: 'owner', approved_at: '2026-06-09' };
  expectRejection('9. Discount > 0 without reason',
    spec, { type: 'config_error', contains: 'reason' });
}

// ── 10. Panel count ≠ panels_per_string × string_count ──────────────────────
{
  const spec = baseSpec();
  spec.system.panel.count = 24;
  spec.system.string_design = { panels_per_string: 5, string_count: 4 };  // 20 ≠ 24
  expectRejection('10. Panel count mismatch with string design',
    spec, { type: 'config_error', contains: 'string_design' });
}

// ── 11. Unknown region key ──────────────────────────────────────────────────
{
  const spec = baseSpec();
  spec.customer.address.region = 'mars_colony';
  expectRejection('11. Unknown region "mars_colony"',
    spec, { type: 'config_error', contains: 'region' });
}

// ── 12. Missing customer email ──────────────────────────────────────────────
{
  const spec = baseSpec();
  delete spec.customer.email;
  expectRejection('12. Missing customer.email',
    spec, { type: 'config_error', contains: 'email' });
}

// ── 13. Invalid email format ────────────────────────────────────────────────
{
  const spec = baseSpec();
  spec.customer.email = 'not-an-email';
  expectRejection('13. Invalid email format',
    spec, { type: 'config_error', contains: 'email' });
}

// ── 14. Unknown panel SKU ───────────────────────────────────────────────────
{
  const spec = baseSpec();
  spec.system.panel.sku = 'BOG-PNL-9999-FAKE';
  expectRejection('14. Unknown panel SKU',
    spec, { type: 'config_error', contains: 'panel.sku' });
}

// ── 15. Annual kWh out of range (low) ───────────────────────────────────────
{
  const spec = baseSpec();
  spec.bills.manual_entry.annual_kwh = 500;
  expectRejection('15. Annual kWh 500 (below 1000 floor)',
    spec, { type: 'config_error', contains: 'annual_kwh' });
}

// ── 16. Annual kWh out of range (high) ──────────────────────────────────────
{
  const spec = baseSpec();
  spec.bills.manual_entry.annual_kwh = 80000;
  expectRejection('16. Annual kWh 80000 (above 60000 ceiling)',
    spec, { type: 'config_error', contains: 'annual_kwh' });
}

// ── 17. Customer price 0 ────────────────────────────────────────────────────
{
  const spec = baseSpec();
  spec.pricing.customer_price_inc_gst = 0;
  expectRejection('17. Customer price 0',
    spec, { type: 'config_error', contains: 'customer_price_inc_gst' });
}

// ── 18. can_ship is false when ANY hard_fail exists ─────────────────────────
{
  const spec = baseSpec();
  spec.system.panel.count = 26;
  spec.system.string_design = { panels_per_string: 13, string_count: 2 };
  expectRejection('18. can_ship = false when Voc hard-fails',
    spec, { type: 'cant_ship' });
}

// ── 19. can_ship is false when margin below floor ───────────────────────────
{
  const spec = baseSpec();
  spec.pricing.customer_price_inc_gst = 20000;
  expectRejection('19. can_ship = false when below margin floor',
    spec, { type: 'cant_ship' });
}

// ── 20. Bills section missing both array AND manual_entry ───────────────────
{
  const spec = baseSpec();
  spec.bills = {};
  expectRejection('20. Bills missing both array and manual_entry',
    spec, { type: 'config_error', contains: 'bills' });
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log();
console.log('━'.repeat(80));
console.log(`  RESULT: ${passCount} passed, ${failCount} failed`);
console.log('━'.repeat(80));
if (failCount > 0) {
  console.log('  Failures:');
  for (const f of failures) console.log(`    ✗ ${f.name}\n      → ${f.detail}`);
  process.exit(1);
} else {
  console.log('  ✅ Engine refuses every bad input as expected.');
}
