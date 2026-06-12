// ────────────────────────────────────────────────────────────────────────────
// P4.5 — Multi-tier engine test
//
// Covers:
//   1. Single-tier (no spec.tiers) → existing behaviour unchanged
//   2. 3-tier spec → each tier runs through engine independently
//   3. Per-tier system_overrides merge correctly over base spec.system
//   4. is_recommended flag flows through to result
//   5. Tier IDs auto-generated when missing
//   6. tier-shape validation (max 3, no duplicate labels, exactly 1 recommended)
//   7. per-tier margin floor — one tier below floor blocks ONLY that tier
//   8. headline tier picker — recommended wins, otherwise middle/last
//   9. Three financial scenarios computed per tier
// ────────────────────────────────────────────────────────────────────────────

import { runEngine } from '../services/pm/proposalEngine/index.js';
import { runThreeScenarios } from '../services/pm/proposalEngine/financialModel.js';
import { buildEffectiveSpec, validateTiers, pickHeadlineTierId, ensureTierIds }
  from '../services/pm/proposalEngine/tiers.js';

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, hint = '') {
  const mark = cond ? '✓' : '✗';
  console.log(`  ${mark} ${label}${cond ? '' : '  — ' + hint}`);
  if (cond) pass++; else { fail++; failures.push({ label, hint }); }
}
function section(t) { console.log(); console.log('━'.repeat(80)); console.log('  ' + t); console.log('━'.repeat(80)); }
const fmt$ = n => '$' + Math.round(n).toLocaleString();

// ── Base spec helpers ─────────────────────────────────────────────────────
function baseSharedSpec() {
  return {
    customer: {
      full_name: 'Multi-Tier Test',
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
      smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
      string_topology: 'series',
      string_design: { panels_per_string: 5, string_count: 4 },
      cable_run_metres_estimate: 24,
      phase: 1,
    },
    preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' }},
  };
}

function threeTierSpec({ price1 = 32000, price2 = 42000, price3 = 52000,
                          recommended = 1 } = {}) {
  const s = baseSharedSpec();
  s.tiers = [
    {
      label: 'Solar only',
      system_overrides: { battery: null },
      pricing: { customer_price_inc_gst: price1, stage: 'stage_1_estimate', final_mode: true,
                 discount: { applied_nzd: 0, owner_approved: false, reason: null }},
      is_recommended: recommended === 0,
    },
    {
      label: 'Solar + 11 kWh battery',
      system_overrides: { battery: { sku: 'BYD-BAT-276-HVM', module_count: 4 } },
      pricing: { customer_price_inc_gst: price2, stage: 'stage_1_estimate', final_mode: true,
                 discount: { applied_nzd: 0, owner_approved: false, reason: null }},
      is_recommended: recommended === 1,
    },
    {
      label: 'Solar + 14 kWh battery + EV',
      system_overrides: { battery: { sku: 'BYD-BAT-276-HVM', module_count: 5 },
                          wattpilot_included: true },
      pricing: { customer_price_inc_gst: price3, stage: 'stage_1_estimate', final_mode: true,
                 discount: { applied_nzd: 0, owner_approved: false, reason: null }},
      is_recommended: recommended === 2,
    },
  ];
  return s;
}

console.log('━'.repeat(80));
console.log('  P4.5 multi-tier engine — test suite');
console.log('━'.repeat(80));

// ── 1. Spec normalization helpers ────────────────────────────────────────
section('Step 1 — buildEffectiveSpec merges system_overrides');
{
  const spec = threeTierSpec();
  const tier = spec.tiers[1];
  const effective = buildEffectiveSpec(spec, tier);
  check('Effective spec inherits shared customer', effective.customer.email === 'test@example.com');
  check('Effective spec inherits shared bills', effective.bills.manual_entry.annual_kwh === 12000);
  check('Effective spec.system.panel comes from base', effective.system.panel.sku === 'PHN-PNL-595-DRC');
  check('Effective spec.system.battery comes from tier override',
        effective.system.battery?.sku === 'BYD-BAT-276-HVM' &&
        effective.system.battery?.module_count === 4);
  check('Effective spec.pricing comes from tier', effective.pricing.customer_price_inc_gst === 42000);
  check('Effective spec has no tiers (recursion guard)', effective.tiers === undefined);
}

section('Step 2 — battery: null explicitly removes battery');
{
  const spec = threeTierSpec();
  const tier1 = spec.tiers[0];   // solar only
  const effective = buildEffectiveSpec(spec, tier1);
  check('Solar-only tier has battery=null', effective.system.battery === null);
}

section('Step 3 — ensureTierIds adds UUIDs');
{
  const spec = threeTierSpec();
  const withIds = ensureTierIds(spec);
  check('Tier 0 got a UUID', !!withIds.tiers[0].tier_id);
  check('Tier 1 got a UUID', !!withIds.tiers[1].tier_id);
  check('Tier 2 got a UUID', !!withIds.tiers[2].tier_id);
  check('IDs are unique', new Set(withIds.tiers.map(t => t.tier_id)).size === 3);
}

// ── 4. validateTiers — shape checks ───────────────────────────────────────
section('Step 4 — validateTiers shape checks');
{
  const tooMany = baseSharedSpec();
  tooMany.tiers = [1, 2, 3, 4].map((i) => ({
    label: 'Tier ' + i, pricing: { customer_price_inc_gst: 40000 },
  }));
  const errs = validateTiers(tooMany);
  check('Rejects > 3 tiers', errs.some(e => /max 3 tiers/.test(e.message)));

  const dup = baseSharedSpec();
  dup.tiers = [
    { label: 'Same', pricing: { customer_price_inc_gst: 40000 }},
    { label: 'Same', pricing: { customer_price_inc_gst: 50000 }},
  ];
  const errs2 = validateTiers(dup);
  check('Rejects duplicate labels', errs2.some(e => /duplicate tier label/.test(e.message)));

  const twoRecommended = threeTierSpec({ recommended: 1 });
  twoRecommended.tiers[0].is_recommended = true;
  const errs3 = validateTiers(twoRecommended);
  check('Rejects 2 recommended tiers',
        errs3.some(e => /exactly one tier may be marked is_recommended/.test(e.message)));

  const missingPrice = baseSharedSpec();
  missingPrice.tiers = [{ label: 'No price', pricing: {} }];
  const errs4 = validateTiers(missingPrice);
  check('Rejects tier without customer_price_inc_gst',
        errs4.some(e => /customer_price_inc_gst/.test(e.message)));
}

// ── 5. pickHeadlineTierId ────────────────────────────────────────────────
section('Step 5 — pickHeadlineTierId logic');
{
  const spec = ensureTierIds(threeTierSpec({ recommended: 0 }));
  check('Recommended tier wins (idx 0)',
        pickHeadlineTierId(spec) === spec.tiers[0].tier_id);

  const noRec = ensureTierIds(threeTierSpec({ recommended: 99 }));
  noRec.tiers.forEach(t => t.is_recommended = false);
  check('No recommended → middle tier (idx 1) for 3-tier',
        pickHeadlineTierId(noRec) === noRec.tiers[1].tier_id);
}

// ── 6. Full engine run on a 3-tier spec ──────────────────────────────────
section('Step 6 — Full engine: 3-tier spec produces per-tier results');
const result3 = await runEngine(threeTierSpec());
check('Result has is_multi_tier=true', result3.is_multi_tier === true);
check('Result has 3 tier results', result3.tiers?.length === 3);
check('Each tier has its own can_ship', result3.tiers.every(t => t.can_ship !== undefined));
check('Each tier has its own cost', result3.tiers.every(t => t.cost?.totals));
check('Each tier has its own engineering', result3.tiers.every(t => t.engineering?.passes));
check('Each tier has its own bom', result3.tiers.every(t => Array.isArray(t.bom)));
check('Tier labels propagate', result3.tiers.map(t => t.label).join(',') === 'Solar only,Solar + 11 kWh battery,Solar + 14 kWh battery + EV');
check('is_recommended flag propagates', result3.tiers[1].is_recommended === true);
check('is_headline mirrors recommended', result3.tiers[1].is_headline === true);

// Print per-tier P&L for sanity
console.log();
console.log('  Per-tier P&L:');
for (const t of result3.tiers) {
  const rec = t.is_recommended ? ' ★' : '  ';
  console.log(`    ${rec} ${t.label.padEnd(28)} can_ship=${t.can_ship} · cost ${fmt$(t.cost.totals.total_cost_ex_gst)} · margin ${t.cost.totals.project_margin_pct.toFixed(1)}%`);
}

// ── 7. Per-tier margin floor — one below blocks only that tier ───────────
section('Step 7 — Per-tier margin floor isolates blockers');
{
  // Tier 1 priced too low → below floor
  const spec = threeTierSpec({ price1: 12000, price2: 42000, price3: 52000 });
  const r = await runEngine(spec);
  check('Tier 1 (cheap) below floor', r.tiers[0].can_ship === false);
  check('Tier 2 (recommended) still ships', r.tiers[1].can_ship === true);
  check('Tier 3 (premium) still ships', r.tiers[2].can_ship === true);
  check('can_ship_all = false when any tier blocks', r.can_ship_all === false);
  check('block_reasons mention the offending tier label',
        r.block_reasons.some(reason => /Solar only/.test(reason)));
}

// ── 8. Three-scenario financials per tier ────────────────────────────────
section('Step 8 — Three-scenario financials applied per tier');
{
  const spec = threeTierSpec();
  const r = await runEngine(spec);
  // Run scenarios on each tier independently using its effective spec
  for (const tier of r.tiers) {
    const effSpec = buildEffectiveSpec(ensureTierIds(spec),
      spec.tiers.find(t => t.label === tier.label));
    const scenarios = runThreeScenarios(effSpec, tier.cost);
    check(`Tier "${tier.label}" — 3-scenario summary present`,
          Array.isArray(scenarios.summary) && scenarios.summary.length === 3);
    check(`Tier "${tier.label}" — Conservative < Expected < Optimistic on lifetime_net_savings`,
          scenarios.summary[0].lifetime_net_savings < scenarios.summary[1].lifetime_net_savings &&
          scenarios.summary[1].lifetime_net_savings < scenarios.summary[2].lifetime_net_savings);
  }
}

// ── 9. Backward-compat: single-tier spec ─────────────────────────────────
section('Step 9 — Single-tier (no spec.tiers) backward compatibility');
{
  const spec = baseSharedSpec();
  spec.pricing = { customer_price_inc_gst: 40000, stage: 'stage_1_estimate', final_mode: true,
                   discount: { applied_nzd: 0, owner_approved: false, reason: null }};
  const r = await runEngine(spec);
  check('Single-tier result has NO is_multi_tier flag', !r.is_multi_tier);
  check('Single-tier result has top-level can_ship', r.can_ship !== undefined);
  check('Single-tier result has top-level cost', !!r.cost);
  check('Single-tier result has top-level bom', Array.isArray(r.bom));
}

// ── Summary ──────────────────────────────────────────────────────────────
section('Summary');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.log(`    ✗ ${f.label}  ${f.hint}`);
  process.exit(1);
}
console.log('  ✅ Multi-tier engine works correctly.');
