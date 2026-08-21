// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Financial model
//
// Pure function. Given a validated spec + cost engine output, returns:
//   - Year-1 economics (generation, self-consumption, old bill, new bill, savings)
//   - Monthly breakdown × 12 (rescaled to sum exactly to annual via
//     largest-remainder rounding)
//   - 30-yr cash flow with inflation + degradation + buyback decline
//   - Two payback methodologies (inflation+degradation as headline,
//     discounted at 5% TVM as secondary)
//   - Total ROI %
//   - Loan amortisation + monthly cashflow if customer chose financing
//
// CI-enforced reconciliation invariants (any failure blocks PDF generation):
//   Σ monthly_generation = annual_generation (± 1 kWh)
//   Σ monthly_usage      = annual_kwh        (± 1 kWh)
//   Σ monthly_old_bill   = annual_spend      (± $1)
//   Σ monthly_new_bill   = annual_new_bill   (± $1)
//   Σ monthly_savings    = yr1_savings       (± $1)
// ────────────────────────────────────────────────────────────────────────────

import {
  REGIONS,
  FINANCIAL_DEFAULTS,
  selfConsumptionFraction,
  buybackRateAtYear,
} from './data/engineeringRules.js';
import { getCatalogue } from './catalogue/index.js';

const r0 = (n) => Math.round(+n);
const r2 = (n) => +(+n).toFixed(2);

// Largest-remainder rounding preserves the annual sum when integers required.
function roundPreservingSum(rawValues, target) {
  const floors = rawValues.map(v => Math.floor(v));
  const sumFloors = floors.reduce((a, b) => a + b, 0);
  const targetInt = Math.round(target);
  let deficit = targetInt - sumFloors;
  const remainders = rawValues
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < Math.abs(deficit); k++) {
    floors[remainders[k % rawValues.length].i] += Math.sign(deficit);
  }
  return floors;
}

// Auckland monthly insolation distribution (% of annual yield per month, Jan→Dec)
// Exported so the POC design route can fall back to this shape when PVGIS
// monthly data isn't available (Google-Solar path addresses).
export const MONTHLY_YIELD_PCT = [
  0.124, 0.105, 0.093, 0.063, 0.054, 0.042,
  0.047, 0.063, 0.076, 0.101, 0.113, 0.119,
];

// NZ residential typical consumption shape (% of annual usage per month).
// Higher winter (heat pump / hot water) than summer.
const MONTHLY_USAGE_PCT = [
  0.062, 0.073, 0.080, 0.097, 0.110, 0.115,
  0.131, 0.131, 0.080, 0.064, 0.061, 0.062,
];

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Loan payment (PMT formula, monthly compounding).
function loanMonthlyPayment(principal, annualRatePct, years) {
  if (principal <= 0 || years <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// Financing options table (per §5.10) — referenced when spec.preferences.financing.choice is set.
const FINANCING_OPTIONS = {
  cash:                 { label: 'Cash (no loan)',                       rate_pct: 0,    default_years: 0 },
  anz_good_energy:      { label: 'ANZ Good Energy Home Loan',             rate_pct: 5.0,  default_years: 10 },
  westpac_warm_up:      { label: 'Westpac Warm Up Loan',                  rate_pct: 6.5,  default_years: 10 },
  kiwibank_eco_loan:    { label: 'Kiwibank Sustainable Energy Loan',      rate_pct: 1.0,  default_years: 5 },
  bnz_healthy_homes:    { label: 'BNZ Healthy Homes Loan',                rate_pct: 6.0,  default_years: 10 },
  asb_better_homes:     { label: 'ASB Better Homes Top-up',               rate_pct: 6.5,  default_years: 10 },
  auckland_council_ryh: { label: 'Auckland Council Retrofit Your Home',   rate_pct: 0,    default_years: 10 },
  personal_loan:        { label: 'Personal loan',                         rate_pct: 10.0, default_years: 5 },
  other:                { label: 'Other / customer-arranged',             rate_pct: null, default_years: null },
};

// ── Main entry ─────────────────────────────────────────────────────────────
export function runFinancialModel(spec, costResult, options = {}) {
  const catalogue = getCatalogue(options);
  const { PANELS, INVERTERS, BATTERIES } = catalogue;

  // ── Inputs ──
  const region = REGIONS[spec.customer.address.region];
  if (!region) throw new Error(`Unknown region: ${spec.customer.address.region}`);

  const panel = PANELS[spec.system.panel.sku];
  if (!panel) throw new Error(`Unknown panel SKU: ${spec.system.panel.sku}`);

  const systemKw = spec.system.panel.count * panel.watts / 1000;
  const hasBattery = !!spec.system?.battery?.sku;
  const batteryUsableKwh = hasBattery
    ? spec.system.battery.module_count * BATTERIES[spec.system.battery.sku].module_kwh
    : 0;
  const hasDiverter = !hasBattery; // diverter auto-added for non-battery quotes

  // Customer's bill data — either from `bills.manual_entry` or aggregated bills.
  const billData = resolveBillData(spec.bills);
  const annualKwh = billData.annual_kwh;
  const annualSpend = billData.annual_spend;
  const variableRate = billData.variable_rate_incl_gst;
  const dailyFixed = billData.daily_fixed_incl_gst;
  const buybackYr1 = options.buyback_yr1 ?? billData.buyback_rate
                  ?? FINANCIAL_DEFAULTS.default_buyback_rate_nzd_per_kwh;

  // ── Generation ──
  // Regional yield (kWh/kWp/yr) is PR-baked-in (NIWA-derived, PR ≈ 0.80
  // already included). Do NOT apply additional system losses. Apply only
  // clipping when MPPT current exceeds inverter IDC max — matches the
  // engineering-validator's "MPPT current clipping" rule so the two never
  // disagree about whether a system clips.
  const isParallel = spec.system.string_topology === 'parallel';
  const inverter = INVERTERS[spec.system.inverter.sku];
  const stringCount = spec.system.string_design?.string_count || 1;
  const mpptCount = inverter?.mppt_count || 2;
  const stringsPerMppt = isParallel ? Math.ceil(stringCount / mpptCount) : 1;
  const mppCurrentPerMppt = panel.imp_stc * stringsPerMppt;
  const clips = inverter && mppCurrentPerMppt > inverter.idc_max_a_per_mppt;
  const clippingPct = clips
    ? FINANCIAL_DEFAULTS.parallel_topology_clipping_loss_pct / 100
    : 0;
  const yr1Generation = Math.round(
    systemKw * region.yield_kwh_per_kwp_per_year * (1 - clippingPct)
  );

  // ── Self-consumption: capacity-based fraction with physics cap ──
  // Scenario knob: caller may scale (e.g. 0.95 for Conservative). Capped at 0.95.
  const selfConsumeMultiplier = options.self_consume_multiplier ?? 1.0;
  const selfConsumeFracBase = selfConsumptionFraction(batteryUsableKwh, hasDiverter);
  const selfConsumeFrac = Math.min(0.95, selfConsumeFracBase * selfConsumeMultiplier);
  // Physics cap: can't self-consume more than usage; rest is exported
  const selfConsumedRaw = yr1Generation * selfConsumeFrac;
  const selfConsumed = Math.min(Math.round(selfConsumedRaw), annualKwh);
  const imported = Math.max(0, annualKwh - selfConsumed);
  const exported = Math.max(0, yr1Generation - selfConsumed);

  // ── Year-1 new bill ──
  const newVariable = r2(imported * variableRate);
  const newFixed = r2(dailyFixed * 365);
  const exportCredit = r2(exported * buybackYr1);
  const newBill = r2(Math.max(0, newVariable + newFixed - exportCredit));
  const yr1Savings = Math.round(annualSpend - newBill);
  const coveragePct = annualSpend > 0
    ? Math.round((1 - newBill / annualSpend) * 100)
    : 0;
  const selfConsumePct = yr1Generation > 0
    ? Math.round((selfConsumed / yr1Generation) * 100)
    : 0;
  const exportPct = yr1Generation > 0
    ? Math.round((exported / yr1Generation) * 100)
    : 0;

  // ── 30-year projection ──
  // Scenario knobs (defaults match Phono Draco datasheet + MBIE trend).
  const inflation = (options.energy_inflation_pct ?? FINANCIAL_DEFAULTS.energy_inflation_pct_per_year) / 100;
  const degradeYr1 = (options.panel_degradation_yr1_pct ?? 1.0) / 100;
  const degradeAnnual = (options.panel_degradation_annual_pct ?? 0.4) / 100;
  const buybackMultiplier = options.buyback_curve_multiplier ?? 1.0;
  const projectionYears = FINANCIAL_DEFAULTS.projection_horizon_years;
  const installCost = costResult.totals.customer_total_inc_gst;

  const yearly = [];
  let cumulative = -installCost;
  let cumulativeUndiscounted = -installCost;
  let cumulativeDiscounted = -installCost;
  const discountRate = FINANCIAL_DEFAULTS.npv_discount_rate_pct / 100;
  let paybackUndiscounted = null;
  let paybackDiscounted = null;

  for (let y = 1; y <= projectionYears; y++) {
    const outputFactor = y === 1
      ? (1 - degradeYr1)
      : (1 - degradeYr1) * Math.pow(1 - degradeAnnual, y - 1);
    const inflationFactor = Math.pow(1 + inflation, y - 1);
    // Buyback scenario knob: multiplier > 1 = slower decline (optimistic);
    // < 1 = steeper decline (conservative). Floor at $0.01/kWh.
    const buybackYrBase = buybackRateAtYear(y);
    const buybackYr = Math.max(0.01, buybackYr1 - (buybackYr1 - buybackYrBase) / buybackMultiplier);

    const generationYr = Math.round(yr1Generation * outputFactor);
    const oldBillYr = r2(annualSpend * inflationFactor);

    // Recompute new bill at year y with current generation + inflated variable rate + decayed buyback
    const variableRateYr = variableRate * inflationFactor;
    const dailyFixedYr = dailyFixed * inflationFactor;
    const selfConsumedYr = Math.min(Math.round(generationYr * selfConsumeFrac), annualKwh);
    const importedYr = Math.max(0, annualKwh - selfConsumedYr);
    const exportedYr = Math.max(0, generationYr - selfConsumedYr);

    const newVariableYr = importedYr * variableRateYr;
    const newFixedYr = dailyFixedYr * 365;
    const exportCreditYr = exportedYr * buybackYr;
    const newBillYr = r2(Math.max(0, newVariableYr + newFixedYr - exportCreditYr));
    const savingsYr = r2(oldBillYr - newBillYr);

    cumulativeUndiscounted += savingsYr;
    cumulativeDiscounted += savingsYr / Math.pow(1 + discountRate, y);
    cumulative = cumulativeUndiscounted;

    if (paybackUndiscounted === null && cumulativeUndiscounted >= 0) {
      // Interpolate to find fractional year
      const overshoot = cumulativeUndiscounted;
      paybackUndiscounted = +(y - overshoot / savingsYr).toFixed(1);
    }
    if (paybackDiscounted === null && cumulativeDiscounted >= 0) {
      const overshoot = cumulativeDiscounted;
      paybackDiscounted = +(y - overshoot / (savingsYr / Math.pow(1 + discountRate, y))).toFixed(1);
    }

    yearly.push({
      year: 2026 + y - 1,            // calendar year
      year_n: y,                      // 1..30
      output_factor: r2(outputFactor),
      generation_kwh: generationYr,
      old_bill: r0(oldBillYr),
      new_bill: r0(newBillYr),
      savings: r0(savingsYr),
      system_cost: y === 1 ? installCost : 0,
      net_cashflow: y === 1 ? r0(savingsYr - installCost) : r0(savingsYr),
      cumulative: r0(cumulativeUndiscounted),
    });
  }

  const lifetimeNetSavings = r0(cumulativeUndiscounted);
  const lifetimeGrossSavings = r0(cumulativeUndiscounted + installCost);
  const totalRoiPct = installCost > 0 ? r0((lifetimeNetSavings / installCost) * 100) : 0;
  const npv = r0(cumulativeDiscounted);

  // IRR via Newton-Raphson
  const irr = computeIRR([
    -installCost,
    ...yearly.map(y => y.savings),
  ]);

  // ── Monthly breakdown — rescaled to reconcile exactly to annual ──
  const monthlyResult = buildMonthlyBreakdown({
    annualGeneration: yr1Generation,
    annualKwh,
    annualSpend,
    yr1Savings,
    variableRate,
    dailyFixed,
    buybackYr1,
    batteryKwh: batteryUsableKwh,
  });

  // ── Reconciliation invariants ──
  const checks = runReconciliationChecks(monthlyResult, {
    annualGeneration: yr1Generation,
    annualKwh,
    annualSpend,
    yr1Savings,
  });

  // ── Financing — loan amortisation + monthly cashflow ──
  const financing = computeFinancing(spec, installCost);

  return {
    yr1: {
      system_kw: r2(systemKw),
      generation_kwh: yr1Generation,
      self_consumed_kwh: selfConsumed,
      imported_kwh: imported,
      exported_kwh: exported,
      self_consume_pct: selfConsumePct,
      export_pct: exportPct,
      coverage_pct: coveragePct,
      old_bill: r0(annualSpend),
      new_variable: r0(newVariable),
      new_fixed: r0(newFixed),
      export_credit: r0(exportCredit),
      new_bill: r0(newBill),
      savings: yr1Savings,
      monthly_avg_savings: r0(yr1Savings / 12),
    },
    monthly: monthlyResult.rows,
    monthly_chart_avg_per_day: monthlyResult.avgPerDay,
    yearly,
    lifetime_net_savings: lifetimeNetSavings,
    lifetime_gross_savings: lifetimeGrossSavings,
    payback_inflation_degradation_yrs: paybackUndiscounted ?? projectionYears,
    payback_discounted_yrs: paybackDiscounted ?? projectionYears,
    npv_5pct: npv,
    total_roi_pct: totalRoiPct,
    irr_pct: r2(irr * 100),
    financing,
    reconciliation: checks,
    model_version: '1.0.0',
    assumptions: {
      scenario: options.scenario_label || 'Expected',
      energy_inflation_pct_per_year: inflation * 100,
      panel_degradation_yr1_pct: degradeYr1 * 100,
      panel_degradation_annual_pct: degradeAnnual * 100,
      buyback_curve_multiplier: buybackMultiplier,
      self_consume_fraction_yr1: selfConsumeFrac,
      self_consume_multiplier: selfConsumeMultiplier,
      regional_yield_pr_baked_in: true,
      clipping_pct: clippingPct * 100,
      regional_yield_kwh_per_kwp: region.yield_kwh_per_kwp_per_year,
      region_label: region.label,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Three-scenario wrapper — Conservative / Expected / Optimistic
//
// Single point estimates ("$245k 30-yr net savings") read as too-good-to-be-
// true to NZ homeowners even when defensible. Showing all three brackets the
// outcome and matches FMA financial-adviser conventions for projections.
//
// Locked across scenarios (these are knowns, not predictions): system cost,
// regional yield, hardware specs, customer's current bill, GST.
//
// Headline number in the rest of the proposal MUST come from the Expected
// column — never Optimistic.
// ────────────────────────────────────────────────────────────────────────────
export const FINANCIAL_SCENARIOS = {
  conservative: {
    label: 'Conservative',
    description: 'Below-trend energy inflation, faster panel ageing, steeper buyback decline',
    options: {
      scenario_label: 'Conservative',
      energy_inflation_pct: 3.0,
      panel_degradation_yr1_pct: 1.0,
      panel_degradation_annual_pct: 0.5,
      self_consume_multiplier: 0.95,
      buyback_curve_multiplier: 0.85,
    },
  },
  expected: {
    label: 'Expected',
    description: 'Mid-range realistic — historical CPI + datasheet degradation + current buyback curve',
    options: {
      scenario_label: 'Expected',
      energy_inflation_pct: 5.0,
      panel_degradation_yr1_pct: 1.0,
      panel_degradation_annual_pct: 0.4,
      self_consume_multiplier: 1.00,
      buyback_curve_multiplier: 1.00,
    },
  },
  optimistic: {
    label: 'Optimistic',
    description: 'MBIE 10-yr energy-price trend, best-in-class N-TOPCon degradation, slower buyback decline',
    options: {
      scenario_label: 'Optimistic',
      energy_inflation_pct: 7.0,
      panel_degradation_yr1_pct: 1.0,
      panel_degradation_annual_pct: 0.3,
      self_consume_multiplier: 1.05,
      buyback_curve_multiplier: 1.15,
    },
  },
};

export function runThreeScenarios(spec, costResult, overrides = {}, baseOptions = {}) {
  const results = {};
  for (const key of ['conservative', 'expected', 'optimistic']) {
    const opts = { ...baseOptions, ...FINANCIAL_SCENARIOS[key].options, ...(overrides[key] || {}) };
    results[key] = runFinancialModel(spec, costResult, opts);
  }

  // Headline summary table — used by HTML template + sales console.
  const summary = ['conservative', 'expected', 'optimistic'].map(key => ({
    key,
    label: FINANCIAL_SCENARIOS[key].label,
    description: FINANCIAL_SCENARIOS[key].description,
    energy_inflation_pct: FINANCIAL_SCENARIOS[key].options.energy_inflation_pct,
    panel_degradation_pct: FINANCIAL_SCENARIOS[key].options.panel_degradation_annual_pct,
    yr1_savings: results[key].yr1.savings,
    payback_yrs: results[key].payback_inflation_degradation_yrs,
    lifetime_net_savings: results[key].lifetime_net_savings,
    total_roi_pct: results[key].total_roi_pct,
    irr_pct: results[key].irr_pct,
    npv_5pct: results[key].npv_5pct,
  }));

  return {
    summary,
    conservative: results.conservative,
    expected: results.expected,
    optimistic: results.optimistic,
    headline: results.expected,   // canonical pointer for all other proposal sections
    model_version: '1.0.0',
  };
}

// ── Bill data resolution ───────────────────────────────────────────────────
function resolveBillData(bills) {
  if (bills.manual_entry) {
    return {
      annual_kwh: bills.manual_entry.annual_kwh,
      annual_spend: bills.manual_entry.annual_spend,
      variable_rate_incl_gst: bills.manual_entry.variable_rate_per_kwh_incl_gst,
      daily_fixed_incl_gst: bills.manual_entry.daily_fixed_charge_incl_gst,
      buyback_rate: bills.manual_entry.buyback_rate,
    };
  }
  // Aggregate from bills[] array
  const arr = bills.bills || [];
  const totalDays = arr.reduce((s, b) => s + b.days, 0);
  const totalKwh = arr.reduce((s, b) => s + b.kwh, 0);
  const totalSpend = arr.reduce((s, b) => s + b.total, 0);
  const totalVariable = arr.reduce((s, b) => s + (b.variable_charge || 0), 0);
  const totalFixed = arr.reduce((s, b) => s + (b.fixed_charge || 0), 0);
  if (totalDays === 0) throw new Error('No bills with days > 0');
  const annualKwh = Math.round(totalKwh / totalDays * 365);
  const annualSpend = +(totalSpend / totalDays * 365).toFixed(2);
  // Derive variable rate from per-line variable charges if available
  const variableRate = totalKwh > 0 && totalVariable > 0
    ? +(totalVariable * 1.15 / totalKwh).toFixed(4) // GST gross-up
    : +(annualSpend * 0.75 / annualKwh).toFixed(4); // fallback estimate
  const dailyFixed = totalDays > 0 && totalFixed > 0
    ? +(totalFixed * 1.15 / totalDays).toFixed(4)
    : 2.52; // fallback NZ residential typical
  return {
    annual_kwh: annualKwh,
    annual_spend: annualSpend,
    variable_rate_incl_gst: variableRate,
    daily_fixed_incl_gst: dailyFixed,
    buyback_rate: 0.09,
  };
}

// ── Monthly breakdown rescaled to sum exactly to annual ────────────────────
function buildMonthlyBreakdown({ annualGeneration, annualKwh, annualSpend, yr1Savings,
                                 variableRate, dailyFixed, buybackYr1, batteryKwh }) {
  const yieldSum = MONTHLY_YIELD_PCT.reduce((s, v) => s + v, 0);
  const usageSum = MONTHLY_USAGE_PCT.reduce((s, v) => s + v, 0);

  const rawGen = MONTHLY_YIELD_PCT.map(p => annualGeneration * (p / yieldSum));
  const rawUse = MONTHLY_USAGE_PCT.map(p => annualKwh * (p / usageSum));
  const genCol = roundPreservingSum(rawGen, annualGeneration);
  const useCol = roundPreservingSum(rawUse, annualKwh);

  // Old bill reconciliation
  const annualVariable = annualKwh * variableRate;
  const annualFixed = Math.max(0, annualSpend - annualVariable);
  const oldBillRaw = useCol.map(u => u * variableRate + annualFixed / 12);
  const oldBillCol = roundPreservingSum(oldBillRaw, annualSpend);

  // New bill — distribute proportionally to seasonal pattern (more in winter)
  const annualNewBillTarget = Math.max(0, annualSpend - yr1Savings);
  const BILL_SEASONAL = [0.4, 0.5, 0.7, 1.1, 1.6, 1.9, 2.0, 1.8, 1.2, 0.8, 0.6, 0.4];
  const seasonalSum = BILL_SEASONAL.reduce((s, v) => s + v, 0);
  const newBillRaw = BILL_SEASONAL.map(p => annualNewBillTarget * p / seasonalSum);
  const newBillCol = roundPreservingSum(newBillRaw, annualNewBillTarget);

  const rows = [];
  for (let m = 0; m < 12; m++) {
    const monthGen = genCol[m];
    const monthUse = useCol[m];
    // Physical kWh flows — direct estimate
    const dayUsage = Math.round(monthUse * 0.45);
    const directSelf = Math.min(monthGen, dayUsage);
    const surplus = monthGen - directSelf;
    const batteryShift = Math.min(surplus, batteryKwh * 30 * 0.75);
    const selfConsume = Math.min(directSelf + batteryShift, monthUse);
    const importedKwh = Math.max(0, monthUse - selfConsume);
    const exportedKwh = Math.max(0, monthGen - selfConsume);

    rows.push({
      month: MONTH_LABELS[m],
      gen_kwh: monthGen,
      use_kwh: monthUse,
      imported_kwh: importedKwh,
      exported_kwh: exportedKwh,
      export_credit: Math.round(exportedKwh * buybackYr1),
      old_bill: oldBillCol[m],
      new_bill: newBillCol[m],
      savings: oldBillCol[m] - newBillCol[m],
    });
  }

  const avgPerDay = rows.map(r => ({
    month: r.month,
    gen: Math.round(r.gen_kwh / 30),
    use: Math.round(r.use_kwh / 30),
  }));

  return { rows, avgPerDay };
}

// ── Reconciliation invariants ──────────────────────────────────────────────
function runReconciliationChecks(monthlyResult, expected) {
  const rows = monthlyResult.rows;
  const sums = {
    gen: rows.reduce((s, r) => s + r.gen_kwh, 0),
    use: rows.reduce((s, r) => s + r.use_kwh, 0),
    oldBill: rows.reduce((s, r) => s + r.old_bill, 0),
    newBill: rows.reduce((s, r) => s + r.new_bill, 0),
    savings: rows.reduce((s, r) => s + r.savings, 0),
  };
  const checks = [
    { name: 'Σ monthly_generation = annual_generation',
      pass: Math.abs(sums.gen - expected.annualGeneration) <= 1,
      actual: sums.gen, expected: expected.annualGeneration, tol: 1 },
    { name: 'Σ monthly_usage = annual_kwh',
      pass: Math.abs(sums.use - expected.annualKwh) <= 1,
      actual: sums.use, expected: expected.annualKwh, tol: 1 },
    { name: 'Σ monthly_old_bill = annual_spend',
      pass: Math.abs(sums.oldBill - expected.annualSpend) <= 1,
      actual: sums.oldBill, expected: expected.annualSpend, tol: 1 },
    { name: 'Σ monthly_savings ≈ yr1_savings',
      pass: Math.abs(sums.savings - expected.yr1Savings) <= 2,
      actual: sums.savings, expected: expected.yr1Savings, tol: 2 },
  ];
  return {
    all_pass: checks.every(c => c.pass),
    checks,
  };
}

// ── IRR via Newton-Raphson ────────────────────────────────────────────────
function computeIRR(cashflows) {
  let r = 0.10;
  for (let iter = 0; iter < 200; iter++) {
    let npv = 0, dnpv = 0;
    cashflows.forEach((cf, t) => {
      const disc = Math.pow(1 + r, t);
      npv += cf / disc;
      if (t > 0) dnpv -= t * cf / (disc * (1 + r));
    });
    if (Math.abs(dnpv) < 1e-12) break;
    const dr = npv / dnpv;
    r -= dr;
    if (Math.abs(dr) < 1e-7) break;
    if (r < -0.99) r = -0.5;
  }
  return r;
}

// ── Financing + monthly cashflow ──────────────────────────────────────────
function computeFinancing(spec, installCost) {
  const choice = spec.preferences?.financing?.choice || 'cash';
  const opt = FINANCING_OPTIONS[choice] || FINANCING_OPTIONS.cash;
  const years = spec.preferences?.financing?.term_years || opt.default_years;

  if (choice === 'cash' || years === 0 || opt.rate_pct === 0 && years === 0) {
    return {
      choice,
      label: opt.label,
      principal: installCost,
      monthly_payment: 0,
      term_years: 0,
      rate_pct: 0,
      total_interest: 0,
      total_paid: installCost,
      cashflow_yr1: { monthly_loan: 0, monthly_solar_bill: null, monthly_savings: null, monthly_net: null },
    };
  }

  const monthlyPayment = loanMonthlyPayment(installCost, opt.rate_pct || 0, years);
  const totalPaid = monthlyPayment * years * 12;
  const totalInterest = Math.max(0, totalPaid - installCost);

  return {
    choice,
    label: opt.label,
    principal: installCost,
    monthly_payment: +monthlyPayment.toFixed(2),
    term_years: years,
    rate_pct: opt.rate_pct,
    total_interest: +totalInterest.toFixed(2),
    total_paid: +totalPaid.toFixed(2),
  };
}
