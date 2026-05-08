// Forward-looking scenario analysis from a customer's parsed bills.
//
// This is the IP of the bill-analysis feature: we model what the customer
// would pay over 25 years across multiple decisions, including the
// "do nothing" baseline that retailers structurally cannot show.
//
// Inputs:
//   - bills: array of normalised bill records (from billOcrService)
//   - region: 'auckland' | 'wellington' | etc. (defaults to 'auckland')
//
// Outputs:
//   - aggregate consumption + cost picture
//   - 4-5 scenario projections (do-nothing, switch retailer, solar,
//     solar+battery)
//   - retailer-switch advice (which retailer to switch TO and saving)
//   - behavioural patterns + recommended package
//
// All pure functions — no DB, no I/O. Easy to unit-test, easy to reason
// about. The route layer wraps this with persistence + OCR.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RATES = JSON.parse(readFileSync(path.join(__dirname, '../data/nz-retailer-rates.json'), 'utf8'));

const C = RATES._constants;
const PROJECTION_YEARS = 25;

// ── Aggregation ──────────────────────────────────────────────────────────

export function aggregateBills(bills) {
  if (!bills || bills.length === 0) {
    return { months_covered: 0, annual_kwh: 0, annual_spend_nzd: 0, effective_rate_nzd: 0 };
  }

  // Sort by period_start so we know the date range
  const sorted = [...bills].sort((a, b) => new Date(a.period_start) - new Date(b.period_start));

  const totalKwh   = sum(sorted, b => b.kwh_total);
  const totalSpend = sum(sorted, b => b.total_nzd);
  const totalDays  = sum(sorted, b => b.days_in_period);
  const totalFixed = sum(sorted, b => b.fixed_charge_nzd);
  const totalVar   = sum(sorted, b => b.variable_charge_nzd);

  const monthsCovered = Math.max(1, Math.round(totalDays / 30));
  // If we have <12 months, scale up to annual. Otherwise use as-is.
  const scale = monthsCovered < 12 ? 12 / monthsCovered : 1;

  const annualKwh   = round2(totalKwh   * scale);
  const annualSpend = round2(totalSpend * scale);

  return {
    months_covered: monthsCovered,
    period_start:   sorted[0].period_start,
    period_end:     sorted[sorted.length - 1].period_end,
    annual_kwh:     annualKwh,
    annual_spend_nzd: annualSpend,
    effective_rate_nzd: round4(annualSpend / annualKwh),
    fixed_charge_total_nzd: round2(totalFixed * scale),
    variable_charge_total_nzd: round2(totalVar * scale),
    retailer:  mostCommon(sorted.map(b => b.retailer).filter(Boolean)),
    plan_name: mostCommon(sorted.map(b => b.plan_name).filter(Boolean)),
  };
}

// ── Solar fit recommendation ──────────────────────────────────────────────
//
// Given annual kWh and the region's irradiance, recommend a system size
// with ~20% headroom for future EV / hot water diversion.

export function recommendSystem(annualKwh, region = 'auckland') {
  const irradiance = (RATES.regions[region] || RATES.regions.auckland).irradiance_kwh_per_kw_per_year;

  // Sizing: cover roughly 90-100% of consumption (don't oversize for residential —
  // export-buyback rates are too low to justify it). Cap at 10 kW for
  // residential; anything larger is commercial-grade and gets a custom quote.
  const MAX_RESIDENTIAL_KW = 10;
  const baseKw = Math.min(annualKwh * 0.95 / irradiance, MAX_RESIDENTIAL_KW);
  // Snap to nearest standard residential size (3 / 5 / 6.6 / 10)
  const standardSizes = [3, 5, 6.6, 10];
  const recommendedKw = standardSizes.find(s => s >= baseKw) || MAX_RESIDENTIAL_KW;

  // Battery sizing: enough to absorb the typical evening peak.
  // Without hourly data we estimate evening load as ~35% of daily total.
  // Real-world residential batteries cap at 13.5 kWh (Tesla Powerwall 3) —
  // anything more is two stacked units and rarely worth the spend.
  const dailyKwh = annualKwh / 365;
  const eveningKwh = dailyKwh * 0.35;
  const MAX_BATTERY_KWH = 13.5;
  const batteryKwh = Math.min(MAX_BATTERY_KWH, Math.max(5, Math.round(eveningKwh * 0.9 * 2) / 2));

  // Pick a recommended package slug from the catalogue. The recommendation
  // is for the SOLAR + BATTERY scenario by default — the scenario builder
  // will pick a non-battery package when needed for the solar-only scenario.
  let recommendedPackageSlug = 'standard-5kw';
  if (recommendedKw >= 9)        recommendedPackageSlug = 'whole-home-10kw-battery';
  else if (recommendedKw >= 6)   recommendedPackageSlug = 'premium-6kw-battery';
  else if (recommendedKw >= 4)   recommendedPackageSlug = 'standard-5kw';
  else                            recommendedPackageSlug = 'starter-3kw';

  return {
    recommended_system_kw: recommendedKw,
    recommended_battery_kwh: batteryKwh,
    recommended_orientation: 'north (slight east of north for morning load)',
    recommended_package_slug: recommendedPackageSlug,
    annual_generation_kwh: Math.round(recommendedKw * irradiance),
    region,
  };
}

// ── Scenario projections ─────────────────────────────────────────────────
//
// 25-year cost projection for 4-5 scenarios. All include electricity
// inflation; solar scenarios include panel degradation.

export function buildScenarios({ aggregate, recommendation }) {
  const scenarios = [];

  // Scenario 1 — do nothing. Baseline. Simply pay current bills with inflation.
  scenarios.push(projectDoNothing(aggregate));

  // Scenario 2 — switch retailer. Use today's best alternative for this profile.
  const switchAdvice = bestSwitchOption(aggregate, recommendation.region);
  if (switchAdvice && switchAdvice.annualSaving > 50) {
    scenarios.push(projectRetailerSwitch(aggregate, switchAdvice));
  }

  // Scenario 3 — solar only.
  scenarios.push(projectSolar(aggregate, recommendation, { withBattery: false }));

  // Scenario 4 — solar + battery.
  scenarios.push(projectSolar(aggregate, recommendation, { withBattery: true }));

  return { scenarios, switch_advice: switchAdvice };
}

// ── Behavioural patterns ─────────────────────────────────────────────────

export function detectPatterns(bills, aggregate) {
  const patterns = [];
  if (!bills || bills.length < 3) return patterns;

  // Compute month-by-month kWh for pattern detection
  const sorted = [...bills].sort((a, b) => new Date(a.period_start) - new Date(b.period_start));
  const kwhPerMonth = sorted.map(b => ({
    month: new Date(b.period_start).getMonth() + 1,  // 1-12
    days: b.days_in_period || 30,
    kwh: b.kwh_total || 0,
  }));
  const dailyAverages = kwhPerMonth.map(m => m.kwh / m.days);
  const avgDaily = dailyAverages.reduce((a, b) => a + b, 0) / dailyAverages.length;
  const maxDaily = Math.max(...dailyAverages);
  const minDaily = Math.min(...dailyAverages);

  // Pattern 1 — winter spike (heat pump / electric heating)
  // NZ winter = Jun-Aug. If those months' average daily use is >140% of annual avg.
  const winterMonths = kwhPerMonth.filter(m => m.month >= 6 && m.month <= 8);
  if (winterMonths.length >= 2) {
    const winterAvg = winterMonths.reduce((s, m) => s + m.kwh / m.days, 0) / winterMonths.length;
    if (winterAvg / avgDaily > 1.4) {
      patterns.push({
        code: 'winter_spike',
        label: 'Heavy winter heating load',
        severity: 'info',
        details: `Your winter usage runs ~${Math.round((winterAvg / avgDaily - 1) * 100)}% above your annual average. Likely heat-pump or electric heating dominant.`,
        recommendation: 'A 10 kWh battery shifts ~70% of your evening winter load from grid to free solar+stored. Solar generation is lower in winter, but a hybrid system still cuts winter bills 50-65%.',
      });
    }
  }

  // Pattern 2 — summer dip (holiday absence)
  // If Jan-Feb daily averages are <60% of annual avg, holiday hypothesis
  const summerMonths = kwhPerMonth.filter(m => m.month === 1 || m.month === 2);
  if (summerMonths.length >= 1) {
    const summerAvg = summerMonths.reduce((s, m) => s + m.kwh / m.days, 0) / summerMonths.length;
    if (summerAvg / avgDaily < 0.6) {
      patterns.push({
        code: 'holiday_dip',
        label: 'Christmas/January absence',
        severity: 'positive',
        details: `Your usage drops ~${Math.round((1 - summerAvg / avgDaily) * 100)}% in Jan-Feb — looks like you're away over the holidays.`,
        recommendation: 'During those months your solar export earns the most credits. Pick a retailer with a high buyback rate (Meridian or Electric Kiwi at 12c/kWh) once you go solar.',
      });
    }
  }

  // Pattern 3 — high baseline (pool, server room, multiple appliances always-on)
  // If even the lowest monthly daily-average is >40% of the annual avg, baseline is high
  if (minDaily / avgDaily > 0.7 && minDaily > 18) {
    patterns.push({
      code: 'high_baseline',
      label: 'High always-on load',
      severity: 'info',
      details: `Even your lowest month averages ${Math.round(minDaily)} kWh/day — usually points to pool/spa/server or many always-on appliances.`,
      recommendation: 'A bigger system (8 kW+) and battery sized to evening base load have the fastest payback for high-baseline homes.',
    });
  }

  // Pattern 4 — sudden step-change (new appliance / EV / heat pump install)
  // Look for >25% jump month-over-month that persists
  for (let i = 1; i < dailyAverages.length - 1; i++) {
    const prev = dailyAverages[i - 1];
    const curr = dailyAverages[i];
    const next = dailyAverages[i + 1];
    if (curr > prev * 1.25 && next > prev * 1.20) {
      patterns.push({
        code: 'step_change',
        label: 'Sudden usage increase',
        severity: 'info',
        details: `Around month ${kwhPerMonth[i].month} your daily usage jumped ~${Math.round((curr / prev - 1) * 100)}% and stayed elevated.`,
        recommendation: 'New heat pump, EV, or hot tub? Your future system size needs ~1-2 kW headroom beyond current consumption.',
      });
      break; // only flag the first major step-change
    }
  }

  // Pattern 5 — high effective rate (>30c/kWh) — switch advisor will catch this too
  if (aggregate.effective_rate_nzd > 0.31) {
    patterns.push({
      code: 'high_rate',
      label: 'High effective $/kWh',
      severity: 'warning',
      details: `Your effective rate is ${(aggregate.effective_rate_nzd * 100).toFixed(1)}c/kWh — above the NZ average of 28c.`,
      recommendation: 'Switching retailer alone could save you $400+/year before solar. See the switch advice section.',
    });
  }

  return patterns;
}

// ── Internals ────────────────────────────────────────────────────────────

function projectDoNothing(aggregate) {
  let costRunning = 0;
  let yearlyCosts = [];
  for (let y = 0; y < PROJECTION_YEARS; y++) {
    const inflated = aggregate.annual_spend_nzd * Math.pow(1 + C.annual_retail_inflation_pct, y);
    costRunning += inflated;
    yearlyCosts.push(round2(costRunning));
  }
  return {
    id: 'do-nothing',
    label: 'Do nothing — keep paying current rates',
    upfront_cost: 0,
    year_1_cost:  yearlyCosts[0],
    year_10_cost: yearlyCosts[9],
    year_25_cost: yearlyCosts[24],
    annual_cost_year_1: round2(aggregate.annual_spend_nzd),
    payback_years: null,                      // never
    net_25yr: -round2(yearlyCosts[24]),       // it's all loss
    recommended_package_slug: null,
  };
}

function projectRetailerSwitch(aggregate, advice) {
  const switchAnnualSpend = aggregate.annual_spend_nzd - advice.annualSaving;
  let costRunning = 0;
  let yearlyCosts = [];
  for (let y = 0; y < PROJECTION_YEARS; y++) {
    const inflated = switchAnnualSpend * Math.pow(1 + C.annual_retail_inflation_pct, y);
    costRunning += inflated;
    yearlyCosts.push(round2(costRunning));
  }
  return {
    id: 'switch-retailer',
    label: `Switch to ${advice.retailerName} — ${advice.planName}`,
    upfront_cost: 0,
    year_1_cost:  yearlyCosts[0],
    year_10_cost: yearlyCosts[9],
    year_25_cost: yearlyCosts[24],
    annual_cost_year_1: round2(switchAnnualSpend),
    payback_years: 0,                       // free
    net_25yr: -round2(yearlyCosts[24]),
    annual_saving_vs_baseline: round2(advice.annualSaving),
    recommended_package_slug: null,
  };
}

function projectSolar(aggregate, rec, { withBattery }) {
  // Right-size the system for THIS scenario.
  //   - Solar-only: don't oversize. Target ~daytime consumption (~50% of annual)
  //     so most generation is self-consumed at full retail rate, not exported
  //     at low buyback. This matches industry practice and gives realistic 7-9
  //     yr paybacks rather than 12+ yrs from over-exporting at 9c.
  //   - Solar + battery: full coverage (95-100% of consumption) since the
  //     battery captures the surplus you'd otherwise export cheap.
  let scenarioSystemKw;
  if (withBattery) {
    scenarioSystemKw = rec.recommended_system_kw;
  } else {
    // Smaller, optimised for self-consumption
    const irradiance = (RATES.regions[rec.region] || RATES.regions.auckland).irradiance_kwh_per_kw_per_year;
    const targetKw = Math.min(rec.recommended_system_kw, aggregate.annual_kwh * 0.55 / irradiance);
    const standardSizes = [3, 5, 6.6];
    scenarioSystemKw = standardSizes.find(s => s >= targetKw) || 6.6;
  }
  const irradiance = (RATES.regions[rec.region] || RATES.regions.auckland).irradiance_kwh_per_kw_per_year;
  const generation = Math.round(scenarioSystemKw * irradiance);

  const selfConsumption = withBattery
    ? C.default_self_consumption_pct_with_battery
    : C.default_self_consumption_pct_solar_only;

  // Pick the right package for THIS scenario (don't reuse the battery package
  // for a solar-only projection — that's why payback looked terrible)
  const slugForScenario = pickPackageSlug(scenarioSystemKw, withBattery);

  // Pure variable rate (excludes fixed charges) — what the customer actually
  // saves per kWh of solar self-consumption. Derived from bills:
  //   pure variable = annual variable spend ÷ annual kWh
  // Falls back to 27c if for some reason we don't have a breakdown.
  const variableRate = (aggregate.variable_charge_total_nzd && aggregate.annual_kwh)
    ? aggregate.variable_charge_total_nzd / aggregate.annual_kwh
    : 0.27;
  // Buyback after solar — sensible default of 9c (typical mid-pack NZ retailer)
  const buybackRate = 0.09;

  // Self-consumed kWh saves at full retail rate
  // Exported kWh earns buyback rate
  const selfConsumedKwh = Math.min(generation * selfConsumption, aggregate.annual_kwh);
  const exportedKwh    = Math.max(0, generation - selfConsumedKwh);
  const remainingGridKwh = Math.max(0, aggregate.annual_kwh - selfConsumedKwh);

  // Daily fixed charges still apply (solar can't avoid them)
  const fixedAnnual = aggregate.fixed_charge_total_nzd || aggregate.annual_spend_nzd * 0.16;
  const remainingGridCost = remainingGridKwh * variableRate;
  const exportCredit = exportedKwh * buybackRate;

  const yr1NetCost = fixedAnnual + remainingGridCost - exportCredit;
  const yr1NetSaving = aggregate.annual_spend_nzd - yr1NetCost;

  // Upfront cost — pulled from the package picked for THIS scenario
  const upfrontCost = packageUpfront(slugForScenario, scenarioSystemKw, withBattery);

  // 25-year projection (panel degradation reduces generation 0.5%/year)
  let costRunning = 0;
  let savingRunning = 0;
  for (let y = 0; y < PROJECTION_YEARS; y++) {
    const degradation = Math.pow(1 - C.panel_degradation_pct_per_year, y);
    const yearGen = generation * degradation;
    const yearSelfCons = Math.min(yearGen * selfConsumption, aggregate.annual_kwh);
    const yearExport = Math.max(0, yearGen - yearSelfCons);
    const yearRemainingGrid = Math.max(0, aggregate.annual_kwh - yearSelfCons);
    const inflationFactor = Math.pow(1 + C.annual_retail_inflation_pct, y);

    const yearCost = (fixedAnnual * inflationFactor)
                   + (yearRemainingGrid * variableRate * inflationFactor)
                   - (yearExport * buybackRate * inflationFactor);

    costRunning += yearCost;
    savingRunning += (aggregate.annual_spend_nzd * inflationFactor) - yearCost;
  }

  // Payback — find first year where cumulative savings >= upfrontCost
  let paybackYears = null;
  let cumSaving = 0;
  for (let y = 0; y < PROJECTION_YEARS; y++) {
    const inflationFactor = Math.pow(1 + C.annual_retail_inflation_pct, y);
    const degradation = Math.pow(1 - C.panel_degradation_pct_per_year, y);
    const yearGen = generation * degradation;
    const yearSelfCons = Math.min(yearGen * selfConsumption, aggregate.annual_kwh);
    const yearExport = Math.max(0, yearGen - yearSelfCons);
    const yearRemainingGrid = Math.max(0, aggregate.annual_kwh - yearSelfCons);
    const yearCost = (fixedAnnual * inflationFactor)
                   + (yearRemainingGrid * variableRate * inflationFactor)
                   - (yearExport * buybackRate * inflationFactor);
    const yearSaving = (aggregate.annual_spend_nzd * inflationFactor) - yearCost;
    cumSaving += yearSaving;
    if (cumSaving >= upfrontCost && paybackYears === null) {
      // Linear interpolate within the year
      const prevCum = cumSaving - yearSaving;
      const fraction = (upfrontCost - prevCum) / yearSaving;
      paybackYears = round1(y + fraction);
    }
  }

  return {
    id: withBattery ? 'solar-plus-battery' : 'solar-only',
    label: withBattery
      ? `Solar ${scenarioSystemKw} kW + ${rec.recommended_battery_kwh} kWh battery`
      : `Solar ${scenarioSystemKw} kW`,
    scenario_system_kw: scenarioSystemKw,
    scenario_battery_kwh: withBattery ? rec.recommended_battery_kwh : 0,
    upfront_cost: upfrontCost,
    year_1_cost:  round2(yr1NetCost),
    year_10_cost: round2(costRunning * 10 / PROJECTION_YEARS),  // rough rolling
    year_25_cost: round2(costRunning),
    annual_cost_year_1: round2(yr1NetCost),
    annual_saving_year_1: round2(yr1NetSaving),
    payback_years: paybackYears,
    net_25yr: round2(savingRunning - upfrontCost),
    recommended_package_slug: slugForScenario,
  };
}

// Pick the right package slug for a given system size + battery flag.
// Solar-only must NOT pick a battery package (that's the whole point of the bug fix).
function pickPackageSlug(systemKw, withBattery) {
  if (withBattery) {
    if (systemKw >= 9)  return 'whole-home-10kw-battery';
    if (systemKw >= 5)  return 'premium-6kw-battery';
    return 'premium-6kw-battery';                   // smallest battery package we sell
  }
  // Solar-only — pick from the non-battery packages
  if (systemKw >= 9)    return 'premium-6kw-allblack';   // closest non-battery; we'd actually need a 10kW solar-only package eventually
  if (systemKw >= 6)    return 'premium-6kw-allblack';
  if (systemKw >= 4)    return 'standard-5kw';
  return 'starter-3kw';
}

function bestSwitchOption(aggregate, region = 'auckland') {
  if (!aggregate.annual_kwh) return null;
  const days = 365;
  const candidates = [];
  for (const r of RATES.retailers) {
    // Skip the customer's current retailer (case-insensitive match on retailer name)
    if (aggregate.retailer && r.name.toLowerCase().includes(aggregate.retailer.toLowerCase().split(' ')[0])) continue;
    const planKey = r.default_plan;
    const plan = r.plans[planKey];
    if (!plan) continue;
    // Try region-specific rates first, fall back to the retailer's default region pricing
    const regionRate = plan.regions[region] || plan.regions.default;
    if (!regionRate) continue;

    let annualCost;
    if (plan.type === 'flat' || plan.type === 'tou_freezone') {
      annualCost = (regionRate.fixed_per_day_nzd || 0) * days
                 + aggregate.annual_kwh * (regionRate.variable_per_kwh_nzd || 0);
    } else if (plan.type === 'tou') {
      // Without hourly data, approximate: 35% peak, 50% off-peak, 15% night
      const peak    = aggregate.annual_kwh * 0.35 * (regionRate.peak_per_kwh_nzd     || 0);
      const offPeak = aggregate.annual_kwh * 0.50 * (regionRate.off_peak_per_kwh_nzd || 0);
      const night   = aggregate.annual_kwh * 0.15 * (regionRate.night_per_kwh_nzd    || 0);
      annualCost = (regionRate.fixed_per_day_nzd || 0) * days + peak + offPeak + night;
    } else {
      continue;
    }

    candidates.push({
      retailerId:   r.id,
      retailerName: r.name,
      planKey,
      planName:     plan.label,
      annualCost:   round2(annualCost),
      annualSaving: round2(aggregate.annual_spend_nzd - annualCost),
    });
  }

  candidates.sort((a, b) => a.annualCost - b.annualCost);
  const best = candidates[0];
  // Only recommend a switch if it saves >= $50/year (within margin of error)
  if (best && best.annualSaving > 50) return best;
  return null;
}

function packageUpfront(slug, systemKw = 5, withBattery = false) {
  // Pin from the seed-packages.js values. If the catalogue has been edited,
  // those updated prices will be picked up later by joining to the packages table.
  const map = {
    'starter-3kw':              8990,
    'standard-5kw':             13990,
    'premium-6kw-allblack':     16490,
    'premium-6kw-battery':      26990,
    'whole-home-10kw-battery':  39990,
  };
  if (slug && map[slug]) {
    // Special case: a 10kW solar-only system isn't in our catalogue —
    // estimate from per-kW cost rather than reusing the 6.6kW package price.
    if (slug === 'premium-6kw-allblack' && systemKw >= 9) {
      return Math.round(systemKw * 2200);  // ~$2,200/kW for a 10kW residential solar-only install
    }
    return map[slug];
  }
  // Fallback estimation by system size + battery
  const solarOnly = Math.round(systemKw * 2500);  // $2,500/kW residential solar-only baseline
  if (!withBattery) return solarOnly;
  // Battery adds roughly $1,200/kWh
  return solarOnly + Math.round(13.5 * 1200);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sum(arr, fn) { return arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0); }
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }
function mostCommon(arr) {
  if (!arr.length) return null;
  const counts = {};
  for (const x of arr) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Public top-level entry point ─────────────────────────────────────────

export function analyzeBills({ bills, region = 'auckland' }) {
  const aggregate = aggregateBills(bills);
  const recommendation = recommendSystem(aggregate.annual_kwh, region);
  const { scenarios, switch_advice } = buildScenarios({ aggregate, recommendation });
  const patterns = detectPatterns(bills, aggregate);

  return {
    aggregate,
    recommendation,
    scenarios,
    switch_advice,
    patterns,
    region,
  };
}
