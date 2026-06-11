// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Catalogue (products / SKUs / costs / margins)
//
// Single source of truth for every priced item that can appear in a quote.
// Updated by owner whenever supplier prices change. Old quotes keep their
// pricing snapshot so they're unaffected.
//
// All costs are NZD ex GST. Margins are percentages applied as:
//   sell_ex_gst = cost × (1 + margin / 100)
//
// Convention: SKU = {BRAND}-{TYPE}-{SIZE}-{VARIANT?} per memory.
// ────────────────────────────────────────────────────────────────────────────

export const CATALOGUE_VERSION = '2026-06-09';

// ── Solar panels ────────────────────────────────────────────────────────────
export const PANELS = {
  'PHN-PNL-475-QSR': {
    name: 'Phono Solar 475W Quasar All-Black panel',
    brand: 'Phono Solar',
    watts: 475,
    voc_stc: 40.11,
    isc_stc: 15.01,
    vmp_stc: 33.20,
    imp_stc: 14.31,
    voltage_temp_coef_pct_per_c: -0.20,
    current_temp_coef_pct_per_c: 0.05,
    power_temp_coef_pct_per_c: -0.26,
    cost_nzd: 195.00,
    margin_pct: 50,
    datasheet_filename: 'PhonoSolar-QuasarClear-475W.pdf',
  },
  'PHN-PNL-595-DRC': {
    name: 'Phono Solar 595W Draco Bifacial N-TOPCon',
    brand: 'Phono Solar',
    watts: 595,
    voc_stc: 52.92,
    isc_stc: 14.32,
    vmp_stc: 43.75,
    imp_stc: 13.60,
    voltage_temp_coef_pct_per_c: -0.25,
    current_temp_coef_pct_per_c: 0.04,
    power_temp_coef_pct_per_c: -0.29,
    cost_nzd: 260.00,
    margin_pct: 50,
    datasheet_filename: 'Phono_PanelDataSheet.pdf',
  },
};

// ── Inverters ───────────────────────────────────────────────────────────────
export const INVERTERS = {
  'FRN-INV-100-G24-1P': {
    name: 'Fronius Primo 10.0 GEN24 single-phase hybrid',
    brand: 'Fronius',
    phase: 1,
    ac_kw: 10.0,
    is_plus_variant: false,
    battery_capable: false,
    uoc_max_v: 600,
    mppt_v_min: 165,
    idc_max_a_per_mppt: 22,
    isc_max_a_mppt1: 41.25,
    isc_max_a_mppt2: 36,
    mppt_count: 2,
    max_pv_kwp_standard: 12.5,
    max_pv_kwp_reduced: 15.0,
    peak_efficiency_pct: 97.3,
    cost_nzd: 3777.00,
    margin_pct: 30,
    datasheet_filename: 'Fronius_InverterDataSheet.pdf',
  },
  'FRN-INV-100-G24P-1P': {
    name: 'Fronius Primo 10.0 GEN24 Plus single-phase hybrid',
    brand: 'Fronius',
    phase: 1,
    ac_kw: 10.0,
    is_plus_variant: true,
    battery_capable: true,
    uoc_max_v: 600,
    mppt_v_min: 165,
    idc_max_a_per_mppt: 22,
    isc_max_a_mppt1: 41.25,
    isc_max_a_mppt2: 36,
    mppt_count: 2,
    max_pv_kwp_standard: 12.5,
    max_pv_kwp_reduced: 15.0,
    peak_efficiency_pct: 97.3,
    cost_nzd: 4811.00,
    margin_pct: 30,
    datasheet_filename: 'Fronius_InverterDataSheet.pdf',
  },
};

// ── Battery modules + BMS ───────────────────────────────────────────────────
export const BATTERIES = {
  'BYD-BAT-276-HVM': {
    name: 'BYD HVM 2.76 kWh battery module',
    brand: 'BYD',
    series: 'HVM',
    module_kwh: 2.76,
    chemistry: 'LFP',
    cost_nzd: 1855.00,
    margin_pct: 30,
    datasheet_filename: 'BYD_BatteryDataSheet.pdf',
  },
  'BYD-BAT-256-HVS': {
    name: 'BYD HVS 2.56 kWh battery module',
    brand: 'BYD',
    series: 'HVS',
    module_kwh: 2.56,
    chemistry: 'LFP',
    cost_nzd: 1720.00, // estimated; confirm with BYD NZ
    margin_pct: 30,
    datasheet_filename: 'BYD_BatteryDataSheet.pdf',
  },
  'FRN-BAT-315-RSV': {
    name: 'Fronius Reserva 3.15 kWh battery module',
    brand: 'Fronius',
    series: 'Reserva',
    module_kwh: 3.15,
    chemistry: 'LFP',
    cost_nzd: 2075.85,
    margin_pct: 30,
    datasheet_filename: 'Fronius_BatteryDataSheet.pdf',
  },
};

export const BMS_CONTROLLERS = {
  'GEN-BAC-ACC-HVM': {
    name: 'BYD HVM BMS+BCU (Vers 2)',
    brand: 'BYD',
    for_battery_series: 'HVM',
    cost_nzd: 920.00,
    margin_pct: 30,
  },
  'GEN-BAC-ACC-HVS': {
    name: 'BYD HVS BMS+BCU',
    brand: 'BYD',
    for_battery_series: 'HVS',
    cost_nzd: 920.00, // same as HVM
    margin_pct: 30,
  },
  'FRN-BAC-ACC-RSV': {
    name: 'Fronius Reserva BMS controller',
    brand: 'Fronius',
    for_battery_series: 'Reserva',
    cost_nzd: 1937.25,
    margin_pct: 30,
  },
};

// ── Smart meters ────────────────────────────────────────────────────────────
export const SMART_METERS = {
  'FRN-MTR-63-S1P': {
    name: 'Fronius Smart Meter 63A-1 (single-phase)',
    brand: 'Fronius',
    phase: 1,
    amps: 63,
    cost_nzd: 228.23,
    margin_pct: 30,
    datasheet_filename: 'SmartMeter_DataSheet.pdf',
  },
  'FRN-MTR-63-S3P': {
    name: 'Fronius Smart Meter 63A-3 (three-phase)',
    brand: 'Fronius',
    phase: 3,
    amps: 63,
    cost_nzd: 565.00,
    margin_pct: 30,
    datasheet_filename: 'SmartMeter_DataSheet.pdf',
  },
};

// ── Balance of System (BoS) items ───────────────────────────────────────────
// These are the materials that go around the major hardware. Quantities are
// derived per system spec in bomBuilder.js — not stored here.
export const BOS_ITEMS = {
  'HOP-TIN-KIT-4P': {
    name: 'Hopergy 4-Panel Tin Kit Black (L-feet, splice, clamps, earth lug + plates)',
    category: 'mounting',
    cost_nzd: 101.44,
    margin_pct: 30,
  },
  'SLF-BOS-32-30M': {
    name: 'Solarflex 32mm HD UV Pre-wired Conduit 6×4mm² + Earth (30m)',
    category: 'cabling',
    cost_nzd: 596.40,
    margin_pct: 30,
  },
  'GEN-BOS-MC4': {
    name: 'MC4 Connectors M/F Pair — bag of 50',
    category: 'electrical',
    cost_nzd: 386.10,
    margin_pct: 30,
  },
  'GEN-BOS-40-DC': {
    name: 'DC Isolator 40A 1500V IP66 (rooftop)',
    category: 'electrical',
    cost_nzd: 250.00,
    margin_pct: 30,
  },
  'GEN-BOS-40-S1P-AC': {
    name: 'AC Isolator 40A IP66 single-phase 8–10kW',
    category: 'electrical',
    cost_nzd: 300.00,
    margin_pct: 30,
  },
  'GEN-BOS-SPD-AC': {
    name: 'Type 2 Residential AC SPD',
    category: 'electrical',
    cost_nzd: 450.00,
    margin_pct: 30,
  },
  'GEN-BOS-SPD-DC': {
    name: 'Type 2 DC SPD',
    category: 'electrical',
    cost_nzd: 200.00,
    margin_pct: 30,
  },
  'ECS-BOS-ENC': {
    name: 'ECS 12-Pole PV IP65 Enclosure',
    category: 'electrical',
    cost_nzd: 150.00,
    margin_pct: 30,
  },
  'GEN-RCK-SEAL-EPD-B': {
    name: 'FlashRite Roof Seal EPDM Black',
    category: 'mounting',
    cost_nzd: 8.85,
    margin_pct: 30,
  },
  'GEN-BOS-CABLE-AC': {
    name: 'AC cable (per metre)',
    category: 'cabling',
    cost_nzd: 18.00,
    margin_pct: 30,
  },
  'GEN-BOS-LABEL': {
    name: 'AS/NZS 4777 Label Kit',
    category: 'compliance',
    cost_nzd: 50.00,
    margin_pct: 30,
  },
  'GEN-BOS-EARTH': {
    name: 'Earth rod + bonding cable',
    category: 'electrical',
    cost_nzd: 80.00,
    margin_pct: 30,
  },
  'GEN-BOS-SUNDRY': {
    name: 'Cable ties, glands, sealants, sundries',
    category: 'misc',
    cost_nzd: 80.00,
    margin_pct: 30,
  },
  // Parallel-string topology surcharge bundle (combiner box + DC string fuses)
  'GEN-BOS-COMBINER': {
    name: 'DC string combiner box + 4× DC string fuses (parallel topology)',
    category: 'electrical',
    cost_nzd: 400.00,
    margin_pct: 30,
  },
  // Optional: hot water diverter (auto-added for non-battery quotes per §2.18)
  'CTP-ACC-DIVERTER': {
    name: 'Catch Power Black hot water diverter',
    category: 'accessory',
    cost_nzd: 1200.00, // installer wholesale; confirm
    margin_pct: 25,
  },
};

// ── EV charger (Wattpilot) ──────────────────────────────────────────────────
export const EV_CHARGERS = {
  'FRN-EV-WATTPILOT-11': {
    name: 'Fronius Wattpilot 11kW single-phase EV charger',
    brand: 'Fronius',
    ac_kw: 11,
    phase: 1,
    cost_nzd: 1850.00,
    margin_pct: 30,
  },
};

// ── Helper: look up any SKU across all maps ─────────────────────────────────
const ALL = { ...PANELS, ...INVERTERS, ...BATTERIES, ...BMS_CONTROLLERS,
              ...SMART_METERS, ...BOS_ITEMS, ...EV_CHARGERS };

export function lookupSku(sku) {
  return ALL[sku] || null;
}

export function lineFromSku(sku, qty) {
  const item = ALL[sku];
  if (!item) throw new Error(`Unknown SKU: ${sku}`);
  if (qty == null || qty <= 0) throw new Error(`Invalid qty ${qty} for SKU ${sku}`);
  const line_cost = +(item.cost_nzd * qty).toFixed(2);
  const sell_ex_gst = +(line_cost * (1 + item.margin_pct / 100)).toFixed(2);
  return {
    sku,
    name: item.name,
    qty,
    unit_cost: item.cost_nzd,
    line_cost,
    margin_pct: item.margin_pct,
    sell_ex_gst,
    margin_dollar: +(sell_ex_gst - line_cost).toFixed(2),
  };
}
