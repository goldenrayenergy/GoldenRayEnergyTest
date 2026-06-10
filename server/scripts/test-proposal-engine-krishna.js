// ────────────────────────────────────────────────────────────────────────────
// Smoke test — run the new proposal engine against Krishna's actual spec
// and compare to known-good numbers from the v2 PDF we shipped.
//
// Known-good Krishna numbers (from regenerated proposal-krishna-FINAL-v2.pdf):
//   System          14.28 kW (24 × Phono 595W Draco)
//   Topology        4 strings of 6, parallel (2 strings per MPPT)
//   Inverter        Fronius Primo 10.0 GEN24 Plus
//   Battery         BYD HVM 13.8 kWh (5 modules + 1 BMS+BCU)
//   Customer price  $40,500 inc GST
//   (from earlier costing using $3,641 BoS basis):
//   Hardware cost   $21,474 ex GST
//   BoS cost        $4,041 ex GST  (includes $400 parallel surcharge)
//   Labour cost     $7,550 ex GST  (includes $400 parallel install surcharge)
//   Total cost      $33,065 ex GST  → inc GST $38,025
//   List price      $48,263 inc GST
//   Discount        $7,763 (16.1%)
//   Profit          $2,152 ex GST  → 6.1% project margin
// ────────────────────────────────────────────────────────────────────────────

import { runEngine } from '../services/pm/proposalEngine/index.js';
import { runFinancialModel } from '../services/pm/proposalEngine/financialModel.js';

// ── Krishna spec (constructed by hand from build-krishna-proposal.js) ──────
const krishnaSpec = {
  customer: {
    full_name: 'Mr Naga Sai Krishna Avala',
    email: 'krishna.avala@example.com',
    phone: '+64 21 000 0000',
    address: {
      street: '6 Woodacre Street',
      suburb: 'Flat Bush',
      city: 'Auckland',
      postcode: '2019',
      region: 'auckland_vector',
    },
    icp_number: '1002175017LCB5D',
    property_ownership: 'mortgaged',
  },
  bills: {
    manual_entry: {
      annual_kwh: 13044,
      annual_spend: 3825,
      retailer: 'Mercury',
      variable_rate_per_kwh_incl_gst: 0.223,
      daily_fixed_charge_incl_gst: 2.52,
      buyback_rate: 0.09,
    },
  },
  system: {
    panel: {
      sku: 'PHN-PNL-595-DRC',
      count: 24,
    },
    inverter: {
      sku: 'FRN-INV-100-G24P-1P',  // Plus variant (battery requires it)
    },
    battery: {
      sku: 'BYD-BAT-276-HVM',
      module_count: 5,              // 5 × 2.76 = 13.8 kWh
    },
    smart_meter: {
      sku: 'FRN-MTR-63-S1P',
      phase: 1,
    },
    string_topology: 'parallel',
    string_design: {
      panels_per_string: 6,
      string_count: 4,              // 4 strings × 6 panels = 24
    },
    cable_run_metres_estimate: 24,
    phase: 1,
  },
  pricing: {
    customer_price_inc_gst: 40500,
    stage: 'stage_1_estimate',
    final_mode: true,
    discount: {
      applied_nzd: 0,
      owner_approved: false,
      reason: null,
    },
  },
  preferences: {
    backup_priority: 'whole_home_essentials',
    decision_makers: 'solo',
    future_loads: {
      ev_planned_2yr: true,
    },
    financing: {
      choice: 'cash',
    },
  },
};

// ── Known-good numbers from regenerated v2 PDF ─────────────────────────────
const EXPECTED = {
  hardware_cost_ex_gst: 21474,
  bos_cost_ex_gst: 4041,              // includes $400 parallel surcharge
  labour_cost_ex_gst: 7550,            // includes $400 parallel install premium
  total_cost_ex_gst: 33065,
  customer_total_inc_gst: 40500,
  profit_ex_gst: 2152,
  project_margin_pct: 6.1,
  system_kw: 14.28,
};

// ── Run + compare ──────────────────────────────────────────────────────────
console.log('━'.repeat(80));
console.log('  Krishna smoke test — proposal engine v' +
  (await import('../services/pm/proposalEngine/index.js')).ENGINE_VERSION);
console.log('━'.repeat(80));
console.log();

const result = runEngine(krishnaSpec);

if (!result.ok) {
  console.log('❌ Engine failed:');
  if (result.config_errors) {
    for (const e of result.config_errors) console.log(`  • ${e.path}: ${e.message}`);
  }
  if (result.bom_error) console.log('  BoM error:', result.bom_error);
  if (result.cost_error) console.log('  Cost error:', result.cost_error);
  process.exit(1);
}

console.log('Config valid:    ✓');
console.log('Can ship:        ', result.can_ship ? '✓' : '✗ (block reasons below)');
console.log('Spec hash:       ', result.spec_sha256.slice(0, 16) + '...');
console.log('Duration:        ', result.duration_ms + ' ms');
console.log();
console.log('Versions:');
for (const [k, v] of Object.entries(result.versions)) console.log(`  ${k.padEnd(28)} ${v}`);
console.log();

// Engineering validator output
console.log('Engineering validator:');
console.log(`  Passes:        ${result.engineering.passes.length}`);
for (const p of result.engineering.passes) console.log(`    ✓ ${p.rule}: ${p.message}`);
console.log(`  Soft warnings: ${result.engineering.soft_warnings.length}`);
for (const w of result.engineering.soft_warnings) console.log(`    ⚠ ${w.rule}: ${w.message}`);
console.log(`  Hard fails:    ${result.engineering.hard_fails.length}`);
for (const f of result.engineering.hard_fails) console.log(`    ✗ ${f.rule}: ${f.message}`);
console.log(`  Unverified:    ${result.engineering.unverified.length}`);
for (const u of result.engineering.unverified) console.log(`    ? ${u.rule}: ${u.message}`);
console.log();

// Cost summary
const t = result.cost.totals;
const fmt$ = n => '$' + Math.round(n).toLocaleString('en-NZ');
console.log('Cost build:');
for (const [name, s] of Object.entries(result.cost.sections)) {
  console.log(`  ${name.padEnd(15)}  cost ${fmt$(s.cost).padStart(10)}  sell ${fmt$(s.sell_ex_gst).padStart(10)}  margin ${fmt$(s.margin_dollar).padStart(8)}`);
}
console.log('  ' + '─'.repeat(60));
console.log(`  Total cost ex GST      ${fmt$(t.total_cost_ex_gst).padStart(10)}`);
console.log(`  Total list ex GST      ${fmt$(t.total_list_ex_gst).padStart(10)}`);
console.log(`  Total list inc GST     ${fmt$(t.total_list_inc_gst).padStart(10)}`);
console.log(`  Customer total inc GST ${fmt$(t.customer_total_inc_gst).padStart(10)}`);
console.log(`  Discount applied       ${fmt$(t.discount_applied_inc_gst).padStart(10)} (${t.discount_pct_of_list}% off list)`);
console.log(`  Profit ex GST          ${fmt$(t.profit_ex_gst).padStart(10)}`);
console.log(`  Project margin         ${t.project_margin_pct.toFixed(1)}%`);
console.log(`  Margin floor status    ${result.cost.margin_floor_status}`);
console.log();

// Block reasons if any
if (!result.can_ship) {
  console.log('Block reasons:');
  for (const r of result.block_reasons) console.log(`  ✗ ${r}`);
  console.log();
}

// ── Compare to known-good ─────────────────────────────────────────────────
const cmp = (label, actual, expected, tolerance) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  const sign = actual >= expected ? '+' : '';
  const delta = (actual - expected).toFixed(0);
  const status = ok ? '✓' : '⚠';
  console.log(
    `  ${status} ${label.padEnd(28)} ${fmt$(actual).padStart(10)}  vs expected ${fmt$(expected).padStart(10)}  Δ ${sign}${delta}`
  );
  return ok;
};

console.log('━'.repeat(80));
console.log('  Reconciliation vs known-good Krishna v2 PDF numbers');
console.log('━'.repeat(80));
const allOk = [
  cmp('System kW', t.system_kw, EXPECTED.system_kw, 0.01),
  cmp('Hardware cost ex GST', result.cost.sections.major_hardware.cost, EXPECTED.hardware_cost_ex_gst, 50),
  cmp('BoS cost ex GST', result.cost.sections.bos.cost, EXPECTED.bos_cost_ex_gst, 200),
  cmp('Labour cost ex GST',
      result.cost.sections.labour.cost + result.cost.sections.compliance.cost,
      EXPECTED.labour_cost_ex_gst, 100),
  cmp('Total cost ex GST', t.total_cost_ex_gst, EXPECTED.total_cost_ex_gst, 100),
  cmp('Customer total inc GST', t.customer_total_inc_gst, EXPECTED.customer_total_inc_gst, 1),
  cmp('Profit ex GST', t.profit_ex_gst, EXPECTED.profit_ex_gst, 100),
];
console.log();
console.log(allOk.every(Boolean)
  ? '✅ All cost numbers within tolerance.'
  : '⚠ Cost numbers diverge — see above. (Acceptable per Option A — engine is more rigorous.)');

// ────────────────────────────────────────────────────────────────────────────
// Financial model test
// ────────────────────────────────────────────────────────────────────────────
console.log();
console.log('━'.repeat(80));
console.log('  Financial model — Year-1 economics + 30-yr projection');
console.log('━'.repeat(80));
console.log();

const fin = runFinancialModel(krishnaSpec, result.cost);

console.log('Year-1 economics:');
console.log(`  System kW                    ${fin.yr1.system_kw.toFixed(2)} kW`);
console.log(`  Annual generation            ${fin.yr1.generation_kwh.toLocaleString()} kWh`);
console.log(`  Self-consumed                ${fin.yr1.self_consumed_kwh.toLocaleString()} kWh (${fin.yr1.self_consume_pct}% of gen)`);
console.log(`  Imported                     ${fin.yr1.imported_kwh.toLocaleString()} kWh`);
console.log(`  Exported                     ${fin.yr1.exported_kwh.toLocaleString()} kWh (${fin.yr1.export_pct}% of gen)`);
console.log(`  Coverage % of usage          ${fin.yr1.coverage_pct}%`);
console.log(`  Old bill (annual)            ${fmt$(fin.yr1.old_bill)}`);
console.log(`  New bill                       Variable ${fmt$(fin.yr1.new_variable)} + Fixed ${fmt$(fin.yr1.new_fixed)} − Export ${fmt$(fin.yr1.export_credit)} = ${fmt$(fin.yr1.new_bill)}`);
console.log(`  Year-1 savings               ${fmt$(fin.yr1.savings)}  (${fmt$(fin.yr1.monthly_avg_savings)}/mo avg)`);
console.log();

console.log('Long-term:');
console.log(`  Payback (inflation+degradation, headline)   ${fin.payback_inflation_degradation_yrs} yrs`);
console.log(`  Payback (discounted at 5% TVM, internal)   ${fin.payback_discounted_yrs} yrs`);
console.log(`  30-yr cumulative net savings                ${fmt$(fin.lifetime_net_savings)}`);
console.log(`  30-yr gross savings                         ${fmt$(fin.lifetime_gross_savings)}`);
console.log(`  Total ROI %                                  ${fin.total_roi_pct}%`);
console.log(`  NPV @ 5% discount rate (internal)            ${fmt$(fin.npv_5pct)}`);
console.log(`  IRR / annualised return (internal)           ${fin.irr_pct}%`);
console.log();

console.log('Reconciliation invariants (CI-enforced):');
for (const c of fin.reconciliation.checks) {
  const mark = c.pass ? '✓' : '✗';
  console.log(`  ${mark} ${c.name.padEnd(50)} actual ${c.actual}  expected ${c.expected}  (tol ±${c.tol})`);
}
console.log(fin.reconciliation.all_pass
  ? '✅ All reconciliation invariants pass.'
  : '⚠ Reconciliation FAILED — PDF generation would be blocked.');
console.log();

console.log('Monthly profile (first 6 months):');
console.log('  Month  Gen     Use     Imp     Exp     OldBill  NewBill  Savings');
for (const m of fin.monthly.slice(0, 6)) {
  console.log(`  ${m.month.padEnd(6)} ${String(m.gen_kwh).padStart(6)}  ${String(m.use_kwh).padStart(6)}  ${String(m.imported_kwh).padStart(6)}  ${String(m.exported_kwh).padStart(6)}  ${fmt$(m.old_bill).padStart(7)}  ${fmt$(m.new_bill).padStart(7)}  ${fmt$(m.savings).padStart(7)}`);
}

// Reconciliation vs known Krishna v2 PDF numbers (financial)
console.log();
console.log('━'.repeat(80));
console.log('  Reconciliation vs Krishna v2 PDF — financial');
console.log('━'.repeat(80));
const finOk = [
  cmp('Year-1 generation', fin.yr1.generation_kwh, 17136, 150),
  cmp('Year-1 savings', fin.yr1.savings, 3274, 100),
  cmp('Payback (inflation+deg)', fin.payback_inflation_degradation_yrs * 1000,
      9400, 1000), // ±1 yr tolerance, *1000 hack to use cmp
  cmp('30-yr net savings', fin.lifetime_net_savings, 245942, 5000),
];
console.log();
console.log(finOk.every(Boolean)
  ? '✅ Financial numbers match Krishna v2 PDF.'
  : '⚠ Financial numbers diverge — review deltas above.');
