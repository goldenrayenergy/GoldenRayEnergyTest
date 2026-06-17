// ────────────────────────────────────────────────────────────────────────────
// Daily profile simulator — Phase H2
//
// Produces hour-by-hour kW estimates for 4 illustrative days:
//   • Sunny summer (Dec)
//   • Cloudy summer (Jan)
//   • Sunny winter  (Jul)
//   • Cloudy winter (Jul)
//
// Inputs:
//   spec      — quote spec (panel kWp, battery kWh, region, annual_kwh)
//   region    — REGIONS row (yield + latitude proxy via t_min)
//   catalogue — for panel watts (kWp derivation if spec doesn't carry it)
//
// Output: { day_type: { label, hours: [24 × { hour, gen_kw, use_kw,
//                                               batt_kw, grid_kw, soc_kwh }],
//                       summary: { gen_kwh, use_kwh, exported_kwh,
//                                  imported_kwh, batt_cycled_kwh } } }
//
// NOT a precision yield model — this is illustrative. The Year-1 monthly
// numbers (already in the engine) come from a different, higher-fidelity
// path using regional yield + losses. This module exists ONLY to give the
// customer a visceral sense of "what does my day look like".
// ────────────────────────────────────────────────────────────────────────────

import { REGIONS } from './data/engineeringRules.js';

// ── NZ residential consumption shape (sums to 1.0 over 24 hrs) ──────────
// Derived from EECA's typical "all-electric without controlled hot-water"
// load curve. Peaks at 7-9am (waking + showers) and 5-9pm (cooking + heating).
// Trough overnight (heat pump + base loads). Customer's annual_kwh / 365 is
// multiplied by this curve.
const NZ_RES_HOURLY_SHARE = [
  0.025, 0.022, 0.021, 0.020, 0.022, 0.028,  // 0-5  trough
  0.040, 0.065, 0.075, 0.060, 0.045, 0.040,  // 6-11 morning peak then dip
  0.040, 0.035, 0.032, 0.038, 0.052, 0.075,  // 12-17 afternoon dip + early evening rise
  0.090, 0.085, 0.070, 0.050, 0.035, 0.028,  // 18-23 evening peak then wind-down
];
// Sanity: should sum to ~1.0
const HOURLY_SHARE_SUM = NZ_RES_HOURLY_SHARE.reduce((a, b) => a + b, 0);

// ── 4 day archetypes — weekday vs weekend × summer vs winter ─────────────
// Weekday consumption: dip in middle of day (people at work/school) plus
// strong evening peak. Weekend: more daytime use (washing, cooking, kids
// home) so the dip is shallower and evening peak is similar.
const DAY_TYPES = {
  summer_weekday: {
    label: 'Summer Weekday (Dec–Feb)',
    season: 'summer',
    cloud_factor: 0.85,
    peak_hour: 13,
    daylight_hours: 14.5,
    use_seasonal_mult: 0.85,
    use_pattern: 'weekday',
  },
  summer_weekend: {
    label: 'Summer Weekend (Dec–Feb)',
    season: 'summer',
    cloud_factor: 0.85,
    peak_hour: 13,
    daylight_hours: 14.5,
    use_seasonal_mult: 0.95,        // weekends use a bit more
    use_pattern: 'weekend',
  },
  winter_weekday: {
    label: 'Winter Weekday (Jun–Aug)',
    season: 'winter',
    cloud_factor: 0.65,
    peak_hour: 12,
    daylight_hours: 9.5,
    use_seasonal_mult: 1.30,
    use_pattern: 'weekday',
  },
  winter_weekend: {
    label: 'Winter Weekend (Jun–Aug)',
    season: 'winter',
    cloud_factor: 0.65,
    peak_hour: 12,
    daylight_hours: 9.5,
    use_seasonal_mult: 1.45,
    use_pattern: 'weekend',
  },
};

// ── Generation per hour ─────────────────────────────────────────────────
// Cosine bell around peak_hour, zero outside daylight window. Integrated
// daily energy = systemKw × yield_factor × cloud_factor where yield_factor
// approximates the season's per-day kWh per kWp of installed capacity.
function hourlyGeneration(systemKw, dayConfig) {
  const halfDay = dayConfig.daylight_hours / 2;
  const sunrise = dayConfig.peak_hour - halfDay;
  const sunset  = dayConfig.peak_hour + halfDay;

  // Bell amplitude tuned so that integrating ~equals expected daily kWh:
  //   summer clear  ~6.5 kWh/kWp/day
  //   winter clear  ~2.8 kWh/kWp/day
  const baseDailyKwhPerKwp = dayConfig.season === 'summer' ? 6.5 : 2.8;
  const dailyKwh = systemKw * baseDailyKwhPerKwp * dayConfig.cloud_factor;

  const out = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const center = h + 0.5;   // sample mid-hour
    if (center < sunrise || center > sunset) continue;
    // Cosine bell from sunrise(0) → peak(1) → sunset(0)
    const x = (center - sunrise) / dayConfig.daylight_hours;  // 0..1
    const bell = Math.sin(Math.PI * x);                         // peaks at x=0.5
    out[h] = bell;
  }
  // Normalise so the integral equals dailyKwh (each hour is 1 hour of duration)
  const sum = out.reduce((a, b) => a + b, 0);
  if (sum > 0) {
    const scale = dailyKwh / sum;
    for (let h = 0; h < 24; h++) out[h] *= scale;
  }
  return out;
}

// Weekend variant — flatter mid-day, similar evening peak
const NZ_RES_WEEKEND_SHARE = [
  0.025, 0.022, 0.021, 0.020, 0.022, 0.025,
  0.030, 0.045, 0.060, 0.060, 0.055, 0.052,  // morning slower start, less dip
  0.050, 0.048, 0.047, 0.050, 0.060, 0.075,
  0.085, 0.080, 0.070, 0.052, 0.040, 0.030,
];

// ── Consumption per hour ────────────────────────────────────────────────
function hourlyConsumption(annualKwh, dayConfig) {
  const avgDailyKwh = (annualKwh || 0) / 365;
  const seasonalDailyKwh = avgDailyKwh * dayConfig.use_seasonal_mult;
  const shape = dayConfig.use_pattern === 'weekend' ? NZ_RES_WEEKEND_SHARE : NZ_RES_HOURLY_SHARE;
  const sum = shape.reduce((a, b) => a + b, 0);
  return shape.map(share => (share / sum) * seasonalDailyKwh);
}

// ── Battery + grid resolution (greedy) ──────────────────────────────────
// Each hour: solar covers consumption first. Excess charges battery
// (capped at usable kWh, max charge rate ~5 kW). Shortfall drains battery
// (also capped at ~5 kW discharge). Anything that doesn't fit goes to/from
// grid. SoC starts at 50% of usable.
function resolveBatteryAndGrid(genArr, useArr, batteryUsableKwh) {
  const cap = Math.max(0, batteryUsableKwh || 0);
  const chargeRateKw = 5.0;
  const dischargeRateKw = 5.0;
  let soc = cap * 0.5;
  const battArr = new Array(24).fill(0);
  const gridArr = new Array(24).fill(0);
  const socArr = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const gen = genArr[h];
    const use = useArr[h];
    const net = gen - use;   // positive = excess; negative = shortfall
    if (net >= 0) {
      // Excess: charge battery (capped by rate + cap)
      const room = cap - soc;
      const charge = Math.max(0, Math.min(net, chargeRateKw, room));
      soc += charge;
      const excess = net - charge;
      battArr[h] = -charge;             // negative = charging
      gridArr[h] = -excess;             // negative = exporting
    } else {
      // Shortfall: drain battery (capped by rate + soc)
      const need = -net;
      const drain = Math.max(0, Math.min(need, dischargeRateKw, soc));
      soc -= drain;
      const stillNeed = need - drain;
      battArr[h] = drain;               // positive = discharging
      gridArr[h] = stillNeed;           // positive = importing
    }
    socArr[h] = soc;
  }
  return { battArr, gridArr, socArr };
}

// ── Public entry ────────────────────────────────────────────────────────
export function simulateTypicalDays({ spec, catalogue }) {
  const systemKw = spec?.system?.panel?.count
    && catalogue?.PANELS?.[spec.system.panel.sku]?.watts
    ? +(spec.system.panel.count * catalogue.PANELS[spec.system.panel.sku].watts / 1000).toFixed(2)
    : 0;
  if (!systemKw) return null;

  // Adjust generation yield by regional factor. REGIONS.yield_kwh_per_kwp_per_year
  // tells us per-year — bake that into a per-day multiplier vs the base 1250.
  const region = REGIONS[spec?.customer?.address?.region];
  const regionalYieldMult = (region?.yield_kwh_per_kwp_per_year || 1250) / 1250;

  const battery = spec?.system?.battery?.sku
    ? catalogue?.BATTERIES?.[spec.system.battery.sku] : null;
  const batteryUsableKwh = battery
    ? +(spec.system.battery.module_count * battery.module_kwh).toFixed(2) : 0;

  const annualKwh = spec?.bills?.manual_entry?.annual_kwh
    || (spec?.bills?.bills?.reduce
        ? spec.bills.bills.reduce((s, b) => s + (b.kwh || 0), 0) * (365 / Math.max(1,
            spec.bills.bills.reduce((s, b) => s + (b.days || 0), 0)))
        : 0);

  const out = {};
  for (const [key, dayConfig] of Object.entries(DAY_TYPES)) {
    const genArr = hourlyGeneration(systemKw * regionalYieldMult, dayConfig);
    const useArr = hourlyConsumption(annualKwh, dayConfig);
    const { battArr, gridArr, socArr } = resolveBatteryAndGrid(genArr, useArr, batteryUsableKwh);

    const hours = [];
    for (let h = 0; h < 24; h++) {
      hours.push({
        hour: h,
        gen_kw:  +genArr[h].toFixed(3),
        use_kw:  +useArr[h].toFixed(3),
        batt_kw: +battArr[h].toFixed(3),   // + drain (discharge), - charge
        grid_kw: +gridArr[h].toFixed(3),   // + import, - export
        soc_kwh: +socArr[h].toFixed(2),
      });
    }
    const gen_kwh = hours.reduce((s, h) => s + h.gen_kw, 0);
    const use_kwh = hours.reduce((s, h) => s + h.use_kw, 0);
    const exported = hours.reduce((s, h) => s + Math.max(0, -h.grid_kw), 0);
    const imported = hours.reduce((s, h) => s + Math.max(0,  h.grid_kw), 0);
    const charged = hours.reduce((s, h) => s + Math.max(0, -h.batt_kw), 0);
    const discharged = hours.reduce((s, h) => s + Math.max(0, h.batt_kw), 0);
    out[key] = {
      label: dayConfig.label,
      hours,
      summary: {
        gen_kwh: +gen_kwh.toFixed(1),
        use_kwh: +use_kwh.toFixed(1),
        exported_kwh: +exported.toFixed(1),
        imported_kwh: +imported.toFixed(1),
        batt_charged_kwh: +charged.toFixed(1),
        batt_discharged_kwh: +discharged.toFixed(1),
      },
    };
  }
  return out;
}
