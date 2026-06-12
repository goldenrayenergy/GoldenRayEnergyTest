// ────────────────────────────────────────────────────────────────────────────
// P4 — spec.cost_overrides test
//
// Proves the cost overlay logic in costEngine:
//   1. Override an existing labour SKU (e.g., SUPERVISOR qty 1 → qty 2)
//   2. Remove a labour line (set qty: 0)
//   3. Add a custom labour line (is_custom: true)
//   4. Override compliance margin (admin would normally do this, audit later)
//   5. Add a custom hardware add-on via cost_overrides.custom
//   6. Add a custom BoS add-on via cost_overrides.custom
//   7. Unmatched override SKU produces a warning, doesn't crash
//
// Uses the JS-fallback catalogue so we can predict expected $ values exactly.
// ────────────────────────────────────────────────────────────────────────────

import { runEngine } from '../services/pm/proposalEngine/index.js';

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, hint = '') {
  const mark = cond ? '✓' : '✗';
  console.log(`  ${mark} ${label}${cond ? '' : '  — ' + hint}`);
  if (cond) pass++; else { fail++; failures.push({ label, hint }); }
}
function section(t) { console.log(); console.log('━'.repeat(80)); console.log('  ' + t); console.log('━'.repeat(80)); }
const fmt = n => '$' + Math.round(n).toLocaleString();

// Base spec
function base() {
  return {
    customer: {
      full_name: 'Override Test',
      email: 'test@example.com',
      phone: '+64 21 000 0000',
      address: { street: '1 Test St', suburb: 'Auckland', city: 'Auckland', region: 'auckland_vector' },
      property_ownership: 'own',
    },
    bills: { manual_entry: { annual_kwh: 12000, annual_spend: 3500,
                             variable_rate_per_kwh_incl_gst: 0.23, daily_fixed_charge_incl_gst: 2.5, buyback_rate: 0.09 }},
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
    pricing: { customer_price_inc_gst: 45000, stage: 'stage_1_estimate', final_mode: true,
               discount: { applied_nzd: 0, owner_approved: false, reason: null }},
    preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' }},
  };
}

console.log('━'.repeat(80));
console.log('  P4 cost_overrides — test suite');
console.log('━'.repeat(80));

// ── Step 1: baseline (no overrides) ────────────────────────────────────────
section('Step 1 — Baseline (no overrides)');
const baseline = await runEngine(base());
if (!baseline.ok) {
  console.log('  config_errors:', baseline.config_errors);
  console.log('  bom_error:', baseline.bom_error);
  console.log('  cost_error:', baseline.cost_error);
}
check('Baseline engine ok', baseline.ok);
if (!baseline.ok) process.exit(1);
const baseLabourCost = baseline.cost.sections.labour.cost;
const baseLabourSell = baseline.cost.sections.labour.sell_ex_gst;
const baseComplianceCost = baseline.cost.sections.compliance.cost;
const baseLineCount = baseline.cost.lines.length;
console.log(`    Labour:     cost ${fmt(baseLabourCost)} · sell ${fmt(baseLabourSell)}`);
console.log(`    Compliance: cost ${fmt(baseComplianceCost)}`);
console.log(`    Total lines: ${baseLineCount}`);
console.log(`    Total cost ex GST: ${fmt(baseline.cost.totals.total_cost_ex_gst)}`);

// ── Step 2: Override existing labour line (Supervisor qty 1 → 2) ──────────
section('Step 2 — Override existing labour line: SUPERVISOR qty 2');
{
  const spec = base();
  spec.cost_overrides = {
    labour: [
      { sku: 'LAB-SUPERVISOR', qty: 2, override_reason: 'Steep roof — needs 2 days supervision' },
    ],
  };
  const r = await runEngine(spec);
  check('Engine ran ok with override', r.ok);
  const sup = r.cost.lines.find(l => l.sku === 'LAB-SUPERVISOR');
  check('Supervisor line found', !!sup);
  check('Supervisor qty = 2', sup?.qty === 2);
  check('Supervisor line_cost = 2 × $650 = $1,300', sup?.line_cost === 1300);
  check('Supervisor flagged as overridden', sup?.overridden === true);
  check('Override reason captured', sup?.override_reason === 'Steep roof — needs 2 days supervision');
  // Total labour cost up by $650
  check(`Labour cost increased by $650 to ${fmt(baseLabourCost + 650)}`,
        Math.abs(r.cost.sections.labour.cost - (baseLabourCost + 650)) < 0.50,
        `got ${fmt(r.cost.sections.labour.cost)}`);
}

// ── Step 3: Remove a line (qty: 0) ────────────────────────────────────────
section('Step 3 — Remove labour line: LAB-TRAVEL qty 0');
{
  const spec = base();
  spec.cost_overrides = { labour: [{ sku: 'LAB-TRAVEL', qty: 0 }] };
  const r = await runEngine(spec);
  check('Engine ok with line removal', r.ok);
  const travel = r.cost.lines.find(l => l.sku === 'LAB-TRAVEL');
  check('Travel line removed', !travel);
  check(`Labour cost decreased by $350 (travel removed)`,
        Math.abs(r.cost.sections.labour.cost - (baseLabourCost - 350)) < 0.50);
}

// ── Step 4: Add custom labour line (is_custom: true) ──────────────────────
section('Step 4 — Add custom labour line (is_custom: true)');
{
  const spec = base();
  spec.cost_overrides = {
    labour: [
      { sku: 'LAB-RURAL-SURCHARGE', is_custom: true,
        name: 'Rural access surcharge',
        qty: 1, cost_nzd: 500, margin_pct: 30,
        override_reason: 'Job is 80km out — extra day' },
    ],
  };
  const r = await runEngine(spec);
  check('Engine ok with custom labour', r.ok);
  const custom = r.cost.lines.find(l => l.sku === 'LAB-RURAL-SURCHARGE');
  check('Custom labour line added', !!custom);
  check('Custom line marked is_custom', custom?.is_custom === true);
  check('Custom line cost = $500', custom?.line_cost === 500);
  check('Custom line sell ex GST = $650 (30% margin)', custom?.sell_ex_gst === 650);
  check('Custom line group = labour', custom?.group === 'labour');
}

// ── Step 5: Custom add-on hardware via cost_overrides.custom ──────────────
section('Step 5 — Custom hardware via cost_overrides.custom');
{
  const spec = base();
  spec.cost_overrides = {
    custom: [
      { category: 'hardware', name: 'Premium racking upgrade', qty: 1,
        cost_nzd: 1200, margin_pct: 30 },
    ],
  };
  const r = await runEngine(spec);
  check('Engine ok with custom hardware', r.ok);
  const customHw = r.cost.lines.find(l => l.is_custom && l.group === 'hardware');
  check('Custom hardware line added', !!customHw);
  check('Custom hardware line_cost = $1,200', customHw?.line_cost === 1200);
  check('Custom hardware rolls into major_hardware section',
        r.cost.sections.major_hardware.cost === baseline.cost.sections.major_hardware.cost + 1200);
}

// ── Step 6: Custom BoS add-on ─────────────────────────────────────────────
section('Step 6 — Custom BoS add-on');
{
  const spec = base();
  spec.cost_overrides = {
    custom: [
      { category: 'bos', name: 'Switchboard mod', qty: 1, cost_nzd: 380, margin_pct: 30 },
    ],
  };
  const r = await runEngine(spec);
  check('Engine ok with custom BoS', r.ok);
  check('Custom BoS rolls into bos section',
        r.cost.sections.bos.cost === baseline.cost.sections.bos.cost + 380);
}

// ── Step 7: Unmatched override SKU produces warning (no crash) ────────────
section('Step 7 — Unmatched override SKU → warning');
{
  const spec = base();
  spec.cost_overrides = { labour: [{ sku: 'LAB-DOES-NOT-EXIST', qty: 1 }] };
  const warnings = [];
  const r = await runEngine(spec, { override_warnings: warnings });
  check('Engine ok despite unmatched override', r.ok);
  check('Warning emitted', warnings.length === 1);
  check('Warning code = override_sku_not_in_defaults',
        warnings[0]?.code === 'override_sku_not_in_defaults');
}

// ── Step 8: Override margin (the admin-only path; engine accepts it) ──────
section('Step 8 — Override compliance margin (admin would gate this in API layer)');
{
  const spec = base();
  spec.cost_overrides = {
    compliance: [
      { sku: 'CMP-COC', margin_pct: 50, override_reason: 'Custom CoC requirement' },
    ],
  };
  const r = await runEngine(spec);
  const coc = r.cost.lines.find(l => l.sku === 'CMP-COC');
  check('CoC margin = 50%', coc?.margin_pct === 50);
  check('CoC line_cost unchanged (only margin shifted)', coc?.line_cost === 150);
  check('CoC sell_ex_gst = $225 (cost $150 × 1.50)', coc?.sell_ex_gst === 225);
}

// ── Step 9: Multiple overrides at once ───────────────────────────────────
section('Step 9 — Multiple overrides simultaneously');
{
  const spec = base();
  spec.cost_overrides = {
    labour: [
      { sku: 'LAB-SUPERVISOR', qty: 2 },
      { sku: 'LAB-CUSTOM-WEEKEND', is_custom: true, name: 'Weekend premium',
        qty: 1, cost_nzd: 400, margin_pct: 30 },
    ],
    compliance: [{ sku: 'CMP-ESC', qty: 0 }],   // ESC isn't in JS catalogue, no-op
    custom: [
      { category: 'bos', name: 'Battery shelf', qty: 1, cost_nzd: 220, margin_pct: 30 },
    ],
  };
  const r = await runEngine(spec);
  check('Engine ok with combined overrides', r.ok);
  // Verify each
  check('Supervisor qty 2',
        r.cost.lines.find(l => l.sku === 'LAB-SUPERVISOR')?.qty === 2);
  check('Custom weekend premium line added',
        r.cost.lines.find(l => l.sku === 'LAB-CUSTOM-WEEKEND')?.line_cost === 400);
  check('Custom BoS battery shelf added',
        r.cost.lines.some(l => l.group === 'bos' && l.is_custom && l.line_cost === 220));
}

// ── Summary ──────────────────────────────────────────────────────────────
section('Summary');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.log(`    ✗ ${f.label}  ${f.hint}`);
  process.exit(1);
}
console.log('  ✅ Cost overrides work correctly.');
