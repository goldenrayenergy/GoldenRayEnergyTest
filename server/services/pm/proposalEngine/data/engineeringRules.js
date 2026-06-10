// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Engineering rules data
//
// Per-vendor BMS rules · compatibility matrix · regional yield + losses +
// cold-temp · warranty terms. Updated when manufacturers / standards
// change.
// ────────────────────────────────────────────────────────────────────────────

// ── BMS-per-tower rules ─────────────────────────────────────────────────────
// Engine looks up by battery series + module count → returns required BMS+BCU
// count + tower count + parallel rules.
export const BMS_RULES = {
  HVM: {
    bms_sku: 'GEN-BAC-ACC-HVM',
    modules_per_tower_min: 3,
    modules_per_tower_max: 8,
    bms_per_tower: 1,
    max_parallel_towers: 3,
    // Sizing capacity steps (BYD HVM marketed sizes)
    valid_module_counts: [3, 4, 5, 6, 7, 8],
  },
  HVS: {
    bms_sku: 'GEN-BAC-ACC-HVS',
    modules_per_tower_min: 2,
    modules_per_tower_max: 5,
    bms_per_tower: 1,
    max_parallel_towers: 3,
    valid_module_counts: [2, 3, 4, 5],
  },
  Reserva: {
    bms_sku: 'FRN-BAC-ACC-RSV',
    modules_per_tower_min: 2,
    modules_per_tower_max: 5,
    // Reserva 6.3 (2 mod) / 9.5 (3 mod) = 1 BMS controller
    // Reserva 12.6 (4 mod) / 15.8 (5 mod) = 2 BMS controllers
    bms_per_tower_by_modules: { 2: 1, 3: 1, 4: 2, 5: 2 },
    max_parallel_towers: 4,
    valid_module_counts: [2, 3, 4, 5],
  },
};

export function requiredBmsCount(batterySeries, moduleCount) {
  const rule = BMS_RULES[batterySeries];
  if (!rule) return null;
  if (rule.bms_per_tower_by_modules) {
    return rule.bms_per_tower_by_modules[moduleCount] || null;
  }
  return rule.bms_per_tower;
}

// ── Compatibility matrix ────────────────────────────────────────────────────
// Inverter SKU → compatible battery series + phase requirement.
export const COMPATIBILITY = {
  'FRN-INV-100-G24-1P': {
    phase: 1,
    battery_capable: false,
    compatible_battery_series: [],
  },
  'FRN-INV-100-G24P-1P': {
    phase: 1,
    battery_capable: true,
    compatible_battery_series: ['HVS', 'HVM', 'Reserva'],
  },
};

// ── Regional yield + losses + cold-temp ─────────────────────────────────────
export const REGIONS = {
  auckland_vector: {
    label: 'Auckland (Vector)',
    yield_kwh_per_kwp_per_year: 1250,
    base_losses_pct: 14,
    t_min_celsius: -10,
    network_operator: 'Vector',
    wind_zone: 'W3',
  },
  counties_franklin: {
    label: 'Counties / Franklin',
    yield_kwh_per_kwp_per_year: 1260,
    base_losses_pct: 14,
    t_min_celsius: -8,
    network_operator: 'Counties Energy',
    wind_zone: 'W3',
  },
  northland: {
    label: 'Northland',
    yield_kwh_per_kwp_per_year: 1290,
    base_losses_pct: 14,
    t_min_celsius: -2,
    network_operator: 'Northpower',
    wind_zone: 'W4',
  },
  waikato: {
    label: 'Waikato',
    yield_kwh_per_kwp_per_year: 1230,
    base_losses_pct: 14,
    t_min_celsius: -10,
    network_operator: 'WEL Networks',
    wind_zone: 'W2',
  },
  bop_tauranga: {
    label: 'Bay of Plenty / Tauranga',
    yield_kwh_per_kwp_per_year: 1280,
    base_losses_pct: 14,
    t_min_celsius: -5,
    network_operator: 'Powerco',
    wind_zone: 'W4',
  },
  taranaki: {
    label: 'Taranaki / Wairarapa',
    yield_kwh_per_kwp_per_year: 1200,
    base_losses_pct: 15,
    t_min_celsius: -5,
    network_operator: 'Powerco',
    wind_zone: 'W3-4',
  },
  wellington: {
    label: 'Wellington',
    yield_kwh_per_kwp_per_year: 1150,
    base_losses_pct: 16,
    t_min_celsius: -5,
    network_operator: 'Wellington Electricity',
    wind_zone: 'W5',
  },
  canterbury: {
    label: 'Canterbury',
    yield_kwh_per_kwp_per_year: 1220,
    base_losses_pct: 13,
    t_min_celsius: -15,
    network_operator: 'Orion',
    wind_zone: 'W3',
  },
  otago_queenstown: {
    label: 'Otago / Queenstown',
    yield_kwh_per_kwp_per_year: 1300,
    base_losses_pct: 12,
    t_min_celsius: -15,
    network_operator: 'Aurora Energy',
    wind_zone: 'W3',
  },
};

// ── Warranty terms (per current vendor policies) ────────────────────────────
export const WARRANTY_TERMS_VERSION = '2026-06-01';

export const WARRANTY_TERMS = {
  panels: {
    'PHN-PNL-595-DRC': {
      product_warranty_years: 15,
      linear_performance_years: 30,
      linear_performance_endpoint_pct: 87.4,
      yr1_degradation_pct: 1.0,
      annual_degradation_pct: 0.4,
    },
    'PHN-PNL-475-QSR': {
      product_warranty_years: 30,
      linear_performance_years: 30,
      linear_performance_endpoint_pct: 88.5,
      yr1_degradation_pct: 1.0,
      annual_degradation_pct: 0.35,
    },
  },
  inverters: {
    'FRN-INV-100-G24P-1P': {
      product_warranty_years: 10,
      extension_years_free_via_solarweb: 5, // from 2026-06-01 policy
      total_with_extension: 15,
    },
    'FRN-INV-100-G24-1P': {
      product_warranty_years: 10,
      extension_years_free_via_solarweb: 5,
      total_with_extension: 15,
    },
  },
  batteries: {
    HVM: { product_warranty_years: 10, performance_soh_pct_at_year_10: 60 },
    HVS: { product_warranty_years: 10, performance_soh_pct_at_year_10: 60 },
    Reserva: { product_warranty_years: 10, performance_soh_pct_at_year_10: 70 },
  },
  smart_meter_years: 5,
  wattpilot_years: 3,
  racking_bos_years: 2,
  goldenray_workmanship_years: 10,
};

// ── Financial defaults ──────────────────────────────────────────────────────
export const FINANCIAL_DEFAULTS = {
  gst_rate: 0.15,
  energy_inflation_pct_per_year: 7.0,    // NZ MBIE 10-yr retail trend
  npv_discount_rate_pct: 5.0,            // internal use only
  projection_horizon_years: 30,
  minimum_project_margin_pct: 10.0,      // hard floor before discount approval needed
  default_buyback_rate_nzd_per_kwh: 0.09, // Mercury current
  // Buyback decline curve (year → rate). Linearly interpolated between knots.
  buyback_decline_curve: {
    1: 0.09,
    5: 0.07,
    10: 0.05,
    20: 0.03,
    30: 0.02,
  },
  // Self-consumption fraction by usable battery kWh
  self_consumption_by_battery_kwh: [
    { up_to: 0, fraction: 0.30 },           // no battery
    { up_to: 0.001, fraction: 0.55 },       // 0 + diverter (special-case in code)
    { up_to: 6.0, fraction: 0.65 },
    { up_to: 9.5, fraction: 0.78 },
    { up_to: 12.6, fraction: 0.85 },
    { up_to: 13.8, fraction: 0.85 },
    { up_to: 15.8, fraction: 0.88 },
    { up_to: Infinity, fraction: 0.90 },
  ],
  // Clipping loss for parallel-string topology when MPP current exceeds IDC_max
  parallel_topology_clipping_loss_pct: 4.0,
  // Standard install losses
  default_total_losses_pct: 14.0,
};

export function selfConsumptionFraction(batteryKwhUsable, hasDiverter) {
  if (batteryKwhUsable === 0 && hasDiverter) return 0.55;
  for (const tier of FINANCIAL_DEFAULTS.self_consumption_by_battery_kwh) {
    if (batteryKwhUsable <= tier.up_to) return tier.fraction;
  }
  return 0.90;
}

export function buybackRateAtYear(year) {
  const knots = Object.entries(FINANCIAL_DEFAULTS.buyback_decline_curve)
    .map(([y, r]) => ({ year: +y, rate: r }))
    .sort((a, b) => a.year - b.year);
  if (year <= knots[0].year) return knots[0].rate;
  if (year >= knots[knots.length - 1].year) return knots[knots.length - 1].rate;
  for (let i = 0; i < knots.length - 1; i++) {
    if (year >= knots[i].year && year <= knots[i + 1].year) {
      const t = (year - knots[i].year) / (knots[i + 1].year - knots[i].year);
      return knots[i].rate + t * (knots[i + 1].rate - knots[i].rate);
    }
  }
  return knots[knots.length - 1].rate;
}
