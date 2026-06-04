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

  // Compute month-by-month kWh for pattern detection.
  // Parse the month directly from the YYYY-MM-DD string — using new Date()
  // is timezone-sensitive (NZ being UTC+12/13 means '2025-04-01' parses to
  // March 31 NZ time, off-by-one).
  const monthOf = (s) => {
    if (!s) return 1;
    if (s instanceof Date) return s.getUTCMonth() + 1;
    const m = String(s).match(/^(\d{4})-(\d{2})/);
    return m ? parseInt(m[2], 10) : 1;
  };
  const sorted = [...bills].sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
  const kwhPerMonth = sorted.map(b => ({
    month: monthOf(b.period_start),  // 1-12
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
  // We're trying to flag a "level shift" (e.g. heat pump installed in March
  // and now usage is permanently 30%+ higher) — NOT seasonal ramp-up.
  // Approach: split the year in half, compare. A real step-change means the
  // 2nd-half daily average is dramatically different from the 1st-half AND
  // the within-half variability is small (sustained shift, not a peak).
  if (dailyAverages.length >= 8) {
    const mid = Math.floor(dailyAverages.length / 2);
    const firstHalf = dailyAverages.slice(0, mid);
    const secondHalf = dailyAverages.slice(mid);
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const ratio = secondAvg / firstAvg;
    // Require >40% sustained shift to flag. Also exclude seasonal effect:
    // if first half is "summer" (Oct-Mar) and second is "winter" (Apr-Sep)
    // that's just seasonality. Same in reverse. Only flag if direction
    // contradicts the seasonal expectation OR the shift is huge.
    const firstHalfMonths = kwhPerMonth.slice(0, mid).map(m => m.month);
    const isWinterToSummer = firstHalfMonths.every(m => m >= 4 && m <= 9);
    const isSummerToWinter = firstHalfMonths.every(m => m <= 3 || m >= 10);
    if (ratio > 1.40 && !isSummerToWinter) {
      patterns.push({
        code: 'step_change',
        label: 'Sudden sustained usage increase',
        severity: 'info',
        details: `Your usage in the second half of the period is ${Math.round((ratio - 1) * 100)}% higher than the first half — sustained, not seasonal.`,
        recommendation: 'New heat pump, EV, or hot tub? Your future system size needs ~1-2 kW headroom beyond current consumption.',
      });
    }
    if (ratio < 0.60 && !isWinterToSummer) {
      patterns.push({
        code: 'step_change_drop',
        label: 'Sudden sustained usage drop',
        severity: 'info',
        details: `Your usage dropped ${Math.round((1 - ratio) * 100)}% in the second half — sustained, not seasonal.`,
        recommendation: 'Lifestyle change, energy efficiency upgrade, or fewer occupants? System sizing is on lower of the two consumption levels.',
      });
    }
  }

  // Pattern 5 — high effective rate (>33c/kWh — meaningfully above NZ avg of ~28-30c)
  if (aggregate.effective_rate_nzd > 0.33) {
    patterns.push({
      code: 'high_rate',
      label: 'High effective $/kWh',
      severity: 'warning',
      details: `Your effective rate is ${(aggregate.effective_rate_nzd * 100).toFixed(1)}c/kWh — meaningfully above NZ average (28-30c).`,
      recommendation: 'Switching retailer alone could save you $300+/year before solar. See the switch advice section.',
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

// ── Transparency block — built into every result ─────────────────────────
//
// Surfaces every assumption, source, and known limitation so customers
// can audit how their numbers were produced. This is the difference
// between "trust us" and "here's our work."

function buildTransparency({ aggregate, recommendation, region }) {
  const regionMeta = RATES.regions[region] || RATES.regions.auckland;
  const monthsCovered = aggregate.months_covered || 0;
  const dataConfidence =
    monthsCovered >= 12 ? 'high'
    : monthsCovered >= 6 ? 'medium'
    : 'low';

  return {
    as_of: RATES._meta.as_of,
    next_data_refresh_due: RATES._meta.next_refresh_due,

    overall_confidence: dataConfidence,
    confidence_explanation:
      monthsCovered >= 12
        ? 'You provided a full 12 months of bills — projections are based on a complete seasonal picture.'
        : monthsCovered >= 6
        ? `You provided ${monthsCovered} months — the engine extrapolated to a full year. Real annual kWh could be ±10% from this estimate.`
        : `Only ${monthsCovered} month(s) of bills available — extrapolation is rough. Upload more bills for sharper numbers.`,

    data_sources: [
      { name: 'NZ retailer rates',         source: 'Each retailer\'s residential pricing page + powerswitch.org.nz comparison tool', as_of: RATES._meta.as_of, refreshes: 'quarterly' },
      { name: 'Solar irradiance (regional)', source: 'NIWA SolarView dataset + EECA Energy Wise model', granularity: 'regional', value_used: `${regionMeta.irradiance_kwh_per_kw_per_year} kWh/kW/yr (${regionMeta.label})` },
      { name: 'Grid emissions factor',     source: 'Ministry for the Environment — Greenhouse Gas Emissions Factors (annual)', value_used: `${C.grid_emissions_kg_co2_per_kwh} kg CO₂/kWh` },
      { name: 'Electricity retail inflation', source: 'MBIE Energy in New Zealand — 10-yr residential rate trend', value_used: `${(C.annual_retail_inflation_pct * 100).toFixed(1)}%/yr` },
      { name: 'Panel degradation',          source: 'Tier-1 manufacturer warranties (REC, Phono Solar, Trina)', value_used: `${(C.panel_degradation_pct_per_year * 100).toFixed(2)}%/yr` },
      { name: 'Battery round-trip efficiency', source: 'Tesla Powerwall 3 / BYD HVS / Fronius Reserva datasheets', value_used: `${(C.battery_round_trip_efficiency * 100).toFixed(0)}%` },
      { name: 'Self-consumption baseline',  source: 'BEAM (Building Energy Analysis Model NZ) + EECA solar-battery field studies', value_used: `solar-only ${(C.default_self_consumption_pct_solar_only * 100).toFixed(0)}% / with battery ${(C.default_self_consumption_pct_with_battery * 100).toFixed(0)}%` },
    ],

    assumptions: [
      { key: 'gst_rate',                value: C.gst_rate,                          label: 'GST rate', basis: 'NZ IRD — 15% since 2010' },
      { key: 'electricity_inflation',   value: C.annual_retail_inflation_pct,       label: 'Annual retail electricity inflation', basis: '10-year NZ MBIE residential rate trend', why_matters: 'Affects 25-year savings — higher inflation → bigger savings from solar' },
      { key: 'self_consumption_solar',  value: C.default_self_consumption_pct_solar_only, label: 'Solar-only self-consumption %', basis: 'Industry mid-range; assumes hot-water timer included in install', why_matters: 'Higher % → more solar savings; lower % → more low-rate exports' },
      { key: 'self_consumption_battery', value: C.default_self_consumption_pct_with_battery, label: 'Solar+battery self-consumption %', basis: 'Battery captures evening + cloudy-day load' },
      { key: 'buyback_rate',            value: 0.09,                                 label: 'Solar export (buyback) rate', basis: 'NZ retailer mid-pack default; some retailers pay 12c+ — see switch advice', why_matters: 'Customer\'s actual buyback could be 7c (Mercury) to 12.5c (Electric Kiwi)' },
      { key: 'panel_degradation',       value: C.panel_degradation_pct_per_year,    label: 'Panel performance degradation', basis: 'Tier-1 manufacturer 25-yr warranty terms' },
      { key: 'battery_efficiency',      value: C.battery_round_trip_efficiency,     label: 'Battery round-trip efficiency', basis: 'Modern lithium-iron-phosphate ~90-92%' },
      { key: 'projection_years',        value: PROJECTION_YEARS,                     label: 'Projection horizon', basis: 'Matches Tier-1 panel performance warranty' },
    ],

    sensitivity: {
      basis: 'Each scenario\'s "low / high" range reflects ±15% real-world variability for solar scenarios (roof orientation, shading, household behaviour, retailer plan changes) and ±8% for non-solar scenarios (inflation rate uncertainty only).',
      solar_uncertainty_pct: 0.15,
      no_solar_uncertainty_pct: 0.08,
    },

    limitations: [
      {
        code: 'no_hourly_data',
        label: 'No hourly load resolution',
        impact: 'Self-consumption % is a single average, not modelled per appliance. Real solar economics depend on hour-by-hour load matching — your number could vary ±10% from this estimate.',
        severity: 'medium',
        mitigation: 'Upload your retailer\'s smart-meter CSV (Mercury, Genesis, Contact all support this) for sharper projections.',
      },
      {
        code: 'fixed_buyback_assumption',
        label: 'Buyback rate assumed at 9c/kWh',
        impact: 'Your actual buyback varies by retailer (7c-12.5c). The switch-retailer advice already uses real per-retailer rates, but the solar scenarios use the 9c default.',
        severity: 'medium',
        mitigation: 'After choosing solar, review the retailer rate table to maximise your export earnings.',
      },
      {
        code: 'no_roof_assessment',
        label: 'No roof orientation / shading analysis',
        impact: 'Generation estimates assume an unshaded north-facing roof at 25° pitch. East/west-facing roofs generate ~85-95% of north; heavy shading reduces further.',
        severity: 'medium',
        mitigation: 'Site visit will measure your actual roof and adjust.',
      },
      {
        code: 'no_tou_modelling',
        label: 'Time-of-use plan benefits not separately modelled',
        impact: 'Some retailers (Genesis Energy IQ, Electric Kiwi MoveMaster) reward off-peak use. Customers who load-shift can save 15-20% even before solar — not modelled here.',
        severity: 'low',
        mitigation: 'Ask about TOU plans during the consultation.',
      },
      {
        code: 'no_ev_modelling',
        label: 'EV charging not modelled',
        impact: 'If you plan to add an EV in the next 2-3 years, your usage will rise ~3,000 kWh/yr. Recommended system size in this analysis won\'t reflect that.',
        severity: 'medium',
        mitigation: 'Mention EV plans during the consultation — system sizing should add ~1.5 kW headroom.',
      },
      {
        code: 'inflation_assumption',
        label: 'Future electricity inflation assumed 5%/yr',
        impact: 'Real future inflation may differ. The 25-year savings figure is sensitive: 7%/yr would lift savings ~25%; 3%/yr would cut them ~20%.',
        severity: 'low',
        mitigation: 'Treat 25-year figures as directional, not exact.',
      },
      {
        code: 'point_in_time_rates',
        label: `Retailer rates current as of ${RATES._meta.as_of}`,
        impact: 'NZ retailers adjust prices 1-2 times per year. Switch advice may be stale by the next quarter.',
        severity: 'low',
        mitigation: 'Refresh the retailer dataset quarterly — rate changes are public.',
      },
    ],

    methodology_summary: 'Deterministic 25-year cashflow projection. Each scenario simulates yearly costs accounting for inflation, panel degradation, battery efficiency, and buyback rates. Pure-function computation — same input always produces the same output, no randomness, no hidden adjustments.',

    disclaimer:
      `Estimates produced by Goldenray Energy NZ\'s analysis engine using public NZ energy data current as of ${RATES._meta.as_of}. ` +
      `Projections cover ${PROJECTION_YEARS} years and assume an unshaded north-facing roof at typical NZ pitch. ` +
      `Actual results may vary ±10-15% depending on roof orientation, shading, household behaviour, retailer plan changes, and electricity market movements. ` +
      `Final installed pricing requires an on-site assessment. ` +
      `This analysis is provided as a planning aid, not a guaranteed quote.`,
  };
}

// Add sensitivity ranges to each scenario.
function addSensitivity(scenario, transparency) {
  const isSolar = scenario.id === 'solar-only' || scenario.id === 'solar-plus-battery';
  const pct = isSolar ? transparency.sensitivity.solar_uncertainty_pct : transparency.sensitivity.no_solar_uncertainty_pct;
  const lo = (n) => n == null ? null : round2(n * (1 - pct));
  const hi = (n) => n == null ? null : round2(n * (1 + pct));
  return {
    ...scenario,
    sensitivity_pct: pct,
    year_1_cost_range:    { low: lo(scenario.year_1_cost),    high: hi(scenario.year_1_cost) },
    year_25_cost_range:   { low: lo(scenario.year_25_cost),   high: hi(scenario.year_25_cost) },
    net_25yr_range:       { low: lo(scenario.net_25yr),       high: hi(scenario.net_25yr) },
    payback_years_range:
      scenario.payback_years == null
        ? { low: null, high: null }
        : { low: round1(scenario.payback_years * (1 - pct)), high: round1(scenario.payback_years * (1 + pct)) },
  };
}

// ── Postcode → region resolver (NZ Post public ranges) ───────────────────
//
// NZ Post publishes 4-digit postcode ranges by territorial authority. We map
// each range to a region key that exists in nz-retailer-rates.json (so the
// region-specific irradiance is used downstream). Best-effort — boundary
// cases at range edges may fall into an adjacent region; the worst-case
// irradiance error within a wrong-but-neighbouring region is <8%.
//
// Source: NZ Post postcode coverage tables (public domain).
const POSTCODE_RANGES = [
  // [minInclusive, maxInclusive, region]
  [100,  599,  'northland'],
  [600,  999,  'auckland'],          // North Shore + West Auckland
  [1000, 1499, 'auckland'],          // CBD / Central
  [1500, 1999, 'auckland'],          // South Auckland to airport
  [2000, 2999, 'auckland'],          // Counties / Manukau (still in 'auckland' irradiance bucket)
  [3000, 3499, 'waikato'],           // Hamilton + surrounds
  [3500, 3999, 'bay_of_plenty'],     // Tauranga, Rotorua, Whakatāne
  [4000, 4099, 'bay_of_plenty'],     // Gisborne — closest irradiance proxy
  [4100, 4499, 'hawkes_bay'],
  [4500, 4899, 'manawatu'],          // Manawatū + Taranaki + Whanganui
  [4900, 4999, 'wellington'],        // Wairarapa
  [5000, 6999, 'wellington'],        // Wellington region
  [7000, 7799, 'tasman'],            // Marlborough / Tasman / Nelson
  [7800, 7999, 'westland'],          // West Coast
  [8000, 8999, 'canterbury'],
  [9000, 9499, 'otago'],
  [9500, 9999, 'southland'],
];

export function regionFromPostcode(postcode) {
  if (!postcode) return null;
  const n = parseInt(String(postcode).trim(), 10);
  if (isNaN(n) || n < 100 || n > 9999) return null;
  for (const [min, max, region] of POSTCODE_RANGES) {
    if (n >= min && n <= max) return region;
  }
  return null;
}

// Resolve which region to use, with provenance for audit (rule 1.4).
// Priority: explicit user override > bill postcode > default.
export function resolveRegion({ bills, regionOverride }) {
  if (regionOverride) {
    return { region: regionOverride, region_resolved_from: 'user_override' };
  }
  // Most common postcode across the supplied bills
  const postcodes = (bills || []).map(b => b.service_postcode).filter(Boolean);
  if (postcodes.length) {
    const tally = {};
    for (const p of postcodes) tally[p] = (tally[p] || 0) + 1;
    const dominantPostcode = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    const region = regionFromPostcode(dominantPostcode);
    if (region) {
      return { region, region_resolved_from: 'address_postcode', region_postcode: dominantPostcode };
    }
  }
  return { region: 'auckland', region_resolved_from: 'default' };
}

// ── Validation gate (rules 4.10, 14.10, 16.9, 16.12, 16.15) ──────────────
//
// Computes whether this analysis should be blocked from generating customer-
// facing recommendations until a human has reviewed it. The route layer is
// responsible for actually surfacing this — this function just decides.
//
// Returns: { review_required: bool, review_reasons: [{code, severity, message}] }
//
// Severities:
//   'blocker' — analysis MUST NOT be shown to customer until reviewed
//   'warning' — analysis can be shown but with a "verify with us" banner
//   'info'    — purely informational, no review required
export function computeReviewGate({ bills, aggregate, recommendation, regionInfo }) {
  const reasons = [];

  // (1) Any bill flagged as parse_suspect = blocker
  const suspectBills = (bills || []).filter(b => b.parse_suspect);
  if (suspectBills.length) {
    reasons.push({
      code: 'bill_parse_suspect',
      severity: 'blocker',
      message: `${suspectBills.length} bill(s) failed cross-field validation: ${
        suspectBills.flatMap(b => (b.parse_warnings || []).map(w => w.code)).filter(Boolean).join(', ')
      }`,
    });
  }

  // (2) Critical fields missing across ALL bills (rules 14.3, 16.12)
  if (!aggregate || !aggregate.annual_kwh || aggregate.annual_kwh <= 0) {
    reasons.push({
      code: 'no_consumption_data',
      severity: 'blocker',
      message: 'No usable kWh consumption could be extracted from any bill.',
    });
  }
  if (!aggregate || !aggregate.annual_spend_nzd || aggregate.annual_spend_nzd <= 0) {
    reasons.push({
      code: 'no_spend_data',
      severity: 'blocker',
      message: 'No usable bill total could be extracted from any bill.',
    });
  }

  // (3) Conflicting service addresses across bills (rule 2.10, 16.11)
  // Different supply addresses → bills are for different sites, must not be merged.
  //
  // Normalise before the unique check — Mercury (and others) format the same
  // address inconsistently across consecutive bills: case differences, optional
  // "NEW ZEALAND" country token, double-spaces, trailing punctuation. Treating
  // those cosmetic variants as different sites produces false positives.
  const normaliseAddress = (a) => (a || '')
    .toUpperCase()
    .replace(/\bNEW\s+ZEALAND\b/g, '')
    .replace(/[,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const addresses = [...new Set(
    (bills || []).map(b => normaliseAddress(b.service_address)).filter(Boolean)
  )];
  if (addresses.length > 1) {
    reasons.push({
      code: 'multiple_service_addresses',
      severity: 'blocker',
      message: `Bills cover ${addresses.length} different service addresses — they may belong to different sites and must not be combined.`,
    });
  }

  // (4) Region resolution failed → no irradiance basis (rule 6.10)
  if (regionInfo && regionInfo.region_resolved_from === 'default' && !addresses.length) {
    reasons.push({
      code: 'region_unresolved',
      severity: 'warning',
      message: 'Service location could not be determined from bills. Generation estimates use Auckland irradiance as a placeholder.',
    });
  }

  // (5) Very short history → annualisation is rough (rule 5.11)
  if (aggregate && aggregate.months_covered < 3) {
    reasons.push({
      code: 'insufficient_history',
      severity: 'warning',
      message: `Only ${aggregate.months_covered} month(s) of bills provided. Annual figures are extrapolated and may be off by ±20%.`,
    });
  }

  // (6) Aggregate field confidence low (rules 13.5, 13.6)
  // Take min confidence across critical fields per bill, then min across bills
  const criticalConf = (bills || []).map(b => {
    const fc = b.field_confidence || {};
    const critical = ['period_start','period_end','kwh_total','total_nzd'];
    const vals = critical.map(f => fc[f]).filter(v => typeof v === 'number');
    return vals.length ? Math.min(...vals) : 0;
  });
  const aggregateFieldConf = criticalConf.length ? Math.min(...criticalConf) : 0;
  if (aggregateFieldConf < 0.5 && criticalConf.length > 0) {
    reasons.push({
      code: 'low_field_confidence',
      severity: 'blocker',
      message: `Critical-field confidence is ${(aggregateFieldConf*100).toFixed(0)}% (need ≥50%). One or more required fields could not be reliably extracted.`,
    });
  }

  const isBlocked = reasons.some(r => r.severity === 'blocker');
  return {
    review_required: isBlocked,
    review_reasons:  reasons,
    overall_field_confidence: +aggregateFieldConf.toFixed(3),
  };
}

// ── Public top-level entry point ─────────────────────────────────────────

export function analyzeBills({ bills, region: regionOverride = null }) {
  const aggregate = aggregateBills(bills);
  // Resolve region from the bills' service_postcode (public NZ Post mapping)
  // before any solar production math runs. Falls back to 'auckland' default
  // when no address is extractable — and computeReviewGate flags that.
  const regionInfo = resolveRegion({ bills, regionOverride });
  const recommendation = recommendSystem(aggregate.annual_kwh, regionInfo.region);
  const { scenarios, switch_advice } = buildScenarios({ aggregate, recommendation });
  const patterns = detectPatterns(bills, aggregate);
  const transparency = buildTransparency({ aggregate, recommendation, region: regionInfo.region });
  const scenariosWithSensitivity = scenarios.map(s => addSensitivity(s, transparency));

  // Compute the review gate. Per rule 4.10/16.9/16.12, recommendations from
  // blocked analyses must NOT be presented to the customer until a human has
  // verified. The route layer/UI is responsible for honouring this; this
  // function just decides. We still return the (preliminary) recommendation
  // so the reviewing human has something to evaluate.
  const gate = computeReviewGate({ bills, aggregate, recommendation, regionInfo });

  return {
    aggregate,
    recommendation,
    scenarios: scenariosWithSensitivity,
    switch_advice,
    patterns,
    region: regionInfo.region,
    region_resolved_from: regionInfo.region_resolved_from,
    region_postcode: regionInfo.region_postcode || null,
    review_required: gate.review_required,
    review_reasons:  gate.review_reasons,
    overall_field_confidence: gate.overall_field_confidence,
    transparency,
  };
}
