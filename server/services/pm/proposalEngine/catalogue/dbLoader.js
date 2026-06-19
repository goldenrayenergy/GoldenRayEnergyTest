// ────────────────────────────────────────────────────────────────────────────
// catalogue/dbLoader.js — Build the engine catalogue from live Supabase.
//
// Reads:
//   • products              (panels, inverters, batteries, BMS, smart meters,
//                            EV chargers, BoS items — already populated)
//   • labour_rate_card      (Section B — populated by MVP1_003 seed)
//   • compliance_rate_card  (Section C — populated by MVP1_003 seed)
//
// Returns the catalogue object the engine modules expect (same shape as
// data/catalogue.js + data/labourRateCard.js).
//
// ── Field aliasing (the important part) ────────────────────────────────────
// Your team has been filling products.specs with the proper engineering data
// but under different field names than the engine expects. The loader bridges
// the two so the existing data is engine-ready without a DB rewrite:
//
//   Engine wants                Your specs has        Loader does
//   ──────────────────────      ──────────────────    ─────────────────────
//   ac_kw                       rated_kw              copy
//   mppt_count                  mppts                 copy (fallback)
//   is_plus_variant             hybrid_status         set TRUE if 'plus'
//   battery_capable             hybrid_ready          set TRUE if true OR
//                              + upgrade_license_sku  if upgrade_license_sku
//
// Category mapping (Supabase category → engine bucket):
//   'PV Modules'                  → PANELS
//   'Inverters - Grid Tied'       → INVERTERS
//   'Inverters - Off Grid'        → INVERTERS (excluded by spec for now)
//   'Inverters - Commercial'      → INVERTERS
//   'Fronius Tauro Eco'           → INVERTERS
//   'Batteries - Lithium'         → BATTERIES
//   'BYD- BMS' + 'Battery Accessories' → BMS_CONTROLLERS
//   'Smart Meters'                → SMART_METERS
//   'EV Chargers Fronius'         → EV_CHARGERS
//   'Balance of System' +
//   'Racking & Mounting' +
//   'Roof Seal' + 'MC4' + 'Tile Feet' +
//   'Enclosure PV' + 'Lable Kit'  → BOS_ITEMS
//
// All loaders return SKU → object maps matching the legacy JS catalogue shape.
// ────────────────────────────────────────────────────────────────────────────

import { getDefaultCatalogue } from './index.js';

// ── Category mapping ──────────────────────────────────────────────────────
const CATEGORY_BUCKETS = {
  PANELS: ['PV Modules'],
  INVERTERS: ['Inverters - Grid Tied', 'Inverters - Off Grid',
              'Inverters - Commercial', 'Fronius Tauro Eco'],
  BATTERIES: ['Batteries - Lithium'],
  BMS_CONTROLLERS: ['BMS', 'BYD- BMS', 'Battery Accessories'],
  SMART_METERS: ['Smart Meters'],
  EV_CHARGERS: ['EV Chargers Fronius'],
  BOS_ITEMS: ['Balance of System', 'Racking & Mounting', 'Roof Seal',
              'MC4', 'Tile Feet', 'Enclosure PV', 'Lable Kit',
              'BYD- Accessories', 'Fronius- Accessories', 'Other Accessories',
              'Accessories', 'Water Heater', 'MCB'],
};

// ── Helper: safe number conversion (null-tolerant) ────────────────────────
const num = (v) => v == null || v === '' ? null : Number(v);
const bool = (v) => v === true || v === 'true' || v === 1;

// ── Hardware → engine shape mappers ───────────────────────────────────────
function mapPanel(row) {
  const s = row.specs || {};
  return {
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    watts: num(s.watts ?? s.wattage_w),
    voc_stc: num(s.voc_stc ?? s.voc_v),
    isc_stc: num(s.isc_stc ?? s.isc_a),
    vmp_stc: num(s.vmp_stc ?? s.vmp_v),
    imp_stc: num(s.imp_stc ?? s.imp_a),
    voltage_temp_coef_pct_per_c: num(s.voltage_temp_coef_pct_per_c ?? s.temp_coeff_voc_pct_c),
    current_temp_coef_pct_per_c: num(s.current_temp_coef_pct_per_c ?? s.temp_coeff_isc_pct_c),
    power_temp_coef_pct_per_c:   num(s.power_temp_coef_pct_per_c   ?? s.temp_coeff_pmax_pct_c),
    cost_nzd: num(row.cost_nzd),
    margin_pct: num(row.default_margin_pct) ?? 30,
    peak_efficiency_pct: num(s.peak_efficiency_pct),
    datasheet_filename: s.datasheet_filename || null,
    image_url:     row.image_url || null,
    datasheet_url: row.datasheet_url || null,
    marketing_claims: row.marketing_claims || null,
  };
}

function mapInverter(row) {
  const s = row.specs || {};
  // Aliasing: prefer engine-named fields, fall back to alternate names.
  const ac_kw          = num(s.ac_kw ?? s.rated_kw ?? s.kw_rating);
  const mppt_count     = num(s.mppt_count ?? s.mppts);
  // Fronius semantics (confirmed against live data):
  //   hybrid_status='ready'   → Plus variant (battery-ready out of box)
  //   hybrid_status='upgrade' → Base variant (needs license SKU to add battery)
  // `is_plus_variant` is true ONLY for the ready (out-of-box) case.
  // `battery_capable` mirrors that — the rep must explicitly add the upgrade
  // license as a separate line item to make a Base inverter battery-capable.
  const is_plus_variant = s.is_plus_variant != null
    ? bool(s.is_plus_variant)
    : (s.hybrid_status === 'ready' || s.hybrid_status === 'plus');
  const battery_capable = s.battery_capable != null
    ? bool(s.battery_capable)
    : is_plus_variant;
  return {
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    phase: num(s.phase) || (typeof s.phase === 'string' ? Number(s.phase) : null),
    ac_kw,
    is_plus_variant,
    battery_capable,
    uoc_max_v:         num(s.uoc_max_v),
    mppt_v_min:        num(s.mppt_v_min ?? s.mpp_v_min ?? s.mppt_voltage_min),
    idc_max_a_per_mppt: num(s.idc_max_a_per_mppt),
    isc_max_a_mppt1:   num(s.isc_max_a_mppt1),
    isc_max_a_mppt2:   num(s.isc_max_a_mppt2 ?? s.isc_max_a_mppt1),
    mppt_count,
    max_pv_kwp_standard: num(s.max_pv_kwp_standard ?? s.max_dc_kw),
    max_pv_kwp_reduced:  num(s.max_pv_kwp_reduced),
    peak_efficiency_pct: num(s.peak_efficiency_pct),
    cost_nzd: num(row.cost_nzd),
    margin_pct: num(row.default_margin_pct) ?? 30,
    // Bonus pass-through (engine doesn't use these yet but they're useful)
    upgrade_license_sku: s.upgrade_license_sku || null,
    compatible_batteries_raw: s.compatible_batteries_raw || null,
    datasheet_filename: s.inverter_datasheet || null,
    image_url:     row.image_url || null,
    datasheet_url: row.datasheet_url || null,
    marketing_claims: row.marketing_claims || null,
  };
}

function mapBattery(row) {
  const s = row.specs || {};
  return {
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    series: s.series || s.family || null,
    module_kwh: num(s.module_kwh ?? s.kwh_capacity),
    chemistry: s.chemistry || 'LFP',
    cost_nzd: num(row.cost_nzd),
    margin_pct: num(row.default_margin_pct) ?? 30,
    datasheet_filename: s.datasheet_filename || null,
    image_url:     row.image_url || null,
    datasheet_url: row.datasheet_url || null,
    marketing_claims: row.marketing_claims || null,
  };
}

function mapBmsController(row) {
  const s = row.specs || {};
  return {
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    for_battery_series: s.for_battery_series || s.series || null,
    cost_nzd: num(row.cost_nzd),
    margin_pct: num(row.default_margin_pct) ?? 30,
    // Phase G — surface image_url + datasheet_url so the customer PDF concat
    // and Components page can find them. Without these, BMS rows showed up
    // in the bucket but loadDatasheetBuffers couldn't see their URL.
    image_url:     row.image_url || null,
    datasheet_url: row.datasheet_url || null,
  };
}

function mapSmartMeter(row) {
  const s = row.specs || {};
  return {
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    phase: num(s.phase) || (typeof s.phase === 'string' ? Number(s.phase) : null),
    amps: num(s.amps),
    cost_nzd: num(row.cost_nzd),
    margin_pct: num(row.default_margin_pct) ?? 30,
    datasheet_filename: s.datasheet_filename || null,
    image_url:     row.image_url || null,
    datasheet_url: row.datasheet_url || null,
  };
}

function mapBosItem(row) {
  // category lower-cased + tagged so the engine knows roughly what it is
  const cat = (row.category || '').toLowerCase();
  const subc = (row.subcategory || '').toLowerCase();
  let category = 'misc';
  if (cat.includes('rack') || cat.includes('tile') || cat.includes('tilt') || subc.includes('tilt') || cat.includes('mount')) category = 'mounting';
  else if (cat.includes('cable') || cat.includes('cabling') || cat.includes('conduit') || subc.includes('cable')) category = 'cabling';
  else if (cat.includes('enclosure')) category = 'enclosure';
  else if (cat.includes('mc4') || cat.includes('isolator') || cat.includes('spd') || cat.includes('breaker') || cat.includes('mcb') || cat.includes('connector')) category = 'electrical';
  else if (cat.includes('seal')) category = 'mounting';
  else if (cat.includes('label')) category = 'compliance';
  else if (cat.includes('accessor')) category = 'accessory';
  return {
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    category,
    cost_nzd: num(row.cost_nzd),
    margin_pct: num(row.default_margin_pct) ?? 30,
  };
}

function mapEvCharger(row) {
  const s = row.specs || {};
  return {
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    ac_kw: num(s.ac_kw ?? s.rated_kw ?? s.kw_rating),
    phase: num(s.phase) || (typeof s.phase === 'string' ? Number(s.phase) : null),
    cost_nzd: num(row.cost_nzd),
    margin_pct: num(row.default_margin_pct) ?? 30,
    // Phase G — needed for the customer-PDF datasheet concat. Without these
    // the Wattpilot datasheet was uploaded but never made it into the merged
    // EV-ready quote PDFs.
    image_url:     row.image_url || null,
    datasheet_url: row.datasheet_url || null,
  };
}

const HARDWARE_MAPPERS = {
  PANELS: mapPanel,
  INVERTERS: mapInverter,
  BATTERIES: mapBattery,
  BMS_CONTROLLERS: mapBmsController,
  SMART_METERS: mapSmartMeter,
  EV_CHARGERS: mapEvCharger,
  BOS_ITEMS: mapBosItem,
};

// ── Labour + compliance mappers ──────────────────────────────────────────
function mapLabourRow(row) {
  return {
    sku: row.sku,
    name: row.name,
    category: row.category,
    cost_nzd: num(row.cost_nzd),
    margin_pct: num(row.margin_pct) ?? 30,
    applies_to_kw_min: num(row.applies_to_kw_min),
    applies_to_kw_max: num(row.applies_to_kw_max),
    applies_when: row.applies_when || null,
    default_qty: num(row.default_qty) ?? 1,
  };
}

function mapComplianceRow(row) {
  return {
    sku: row.sku,
    name: row.name,
    category: row.category,
    cost_nzd: num(row.cost_nzd),
    margin_pct: num(row.margin_pct) ?? 30,
    default_qty: num(row.default_qty) ?? 1,
  };
}

// ── Public loader ────────────────────────────────────────────────────────
// Pass a Supabase admin client. Returns a catalogue object matching the
// engine's expected shape. Missing labour/compliance falls back to JS defaults
// so the engine keeps working even if MVP1_003 isn't applied yet.
export async function loadCatalogueFromDb(supabase) {
  if (!supabase) throw new Error('loadCatalogueFromDb: supabase client required');

  // ── 1. Products → hardware + BoS buckets ────────────────────────────────
  const wantedCategories = Object.values(CATEGORY_BUCKETS).flat();
  const { data: productRows, error: prodErr } = await supabase
    .from('products')
    .select('id, sku, brand, name, category, subcategory, cost_nzd, default_margin_pct, specs, is_active, image_url, datasheet_url, marketing_claims')
    .eq('is_active', true)
    .in('category', wantedCategories);
  if (prodErr) throw new Error(`Products query failed: ${prodErr.message}`);

  const out = {
    PANELS: {}, INVERTERS: {}, BATTERIES: {}, BMS_CONTROLLERS: {},
    SMART_METERS: {}, EV_CHARGERS: {}, BOS_ITEMS: {},
    CATALOGUE_VERSION: 'db-' + new Date().toISOString().slice(0, 10),
  };

  // Reverse lookup: category → engine bucket name
  const categoryToBucket = new Map();
  for (const [bucket, cats] of Object.entries(CATEGORY_BUCKETS)) {
    for (const c of cats) categoryToBucket.set(c, bucket);
  }

  let skipped = 0;
  for (const row of productRows || []) {
    if (!row.sku) { skipped++; continue; }
    const bucket = categoryToBucket.get(row.category);
    if (!bucket) { skipped++; continue; }
    const mapper = HARDWARE_MAPPERS[bucket];
    out[bucket][row.sku] = mapper(row);
  }

  // ── 2. Labour rate card ─────────────────────────────────────────────────
  const { data: labourRows, error: labErr } = await supabase
    .from('labour_rate_card')
    .select('*')
    .eq('active', true);

  // Group labour rows into engine shape
  const installRows = [], premiumRows = [], otherRows = {};
  if (!labErr && labourRows?.length) {
    for (const row of labourRows) {
      const mapped = mapLabourRow(row);
      if (mapped.category === 'install') {
        installRows.push({
          ...mapped,
          // Legacy field name for selectInstallLabour helper compatibility
          sku: mapped.sku, name: mapped.name, cost_nzd: mapped.cost_nzd, margin_pct: mapped.margin_pct,
        });
      } else if (mapped.category === 'battery_install') {
        out.BATTERY_INSTALL_PREMIUM = mapped;
      } else if (mapped.category === 'supervisor') out.SUPERVISOR = mapped;
      else if (mapped.category === 'travel')      out.TRAVEL = mapped;
      else if (mapped.category === 'logistics')   out.LOGISTICS = mapped;
      else if (mapped.category === 'premium')     out.PARALLEL_PREMIUM = mapped;
      else if (mapped.category === 'other')       out.SITE_SURVEY_FEE = mapped;
    }
    // Array form for kW-range matching (catalogue/index.js → selectInstallLabour)
    out.INSTALLATION_LABOUR = installRows;
    out.LABOUR_RATE_CARD_VERSION = 'db-' + new Date().toISOString().slice(0, 10);
  } else {
    // Fallback to JS defaults if labour table missing/empty
    const fallback = getDefaultCatalogue();
    out.INSTALLATION_LABOUR = fallback.INSTALLATION_LABOUR;
    out.BATTERY_INSTALL_PREMIUM = fallback.BATTERY_INSTALL_PREMIUM;
    out.SUPERVISOR = fallback.SUPERVISOR;
    out.TRAVEL = fallback.TRAVEL;
    out.LOGISTICS = fallback.LOGISTICS;
    out.PARALLEL_PREMIUM = fallback.PARALLEL_PREMIUM;
    out.SITE_SURVEY_FEE = fallback.SITE_SURVEY_FEE;
    out.LABOUR_RATE_CARD_VERSION = 'js-fallback-' + fallback.LABOUR_RATE_CARD_VERSION;
  }

  // ── 3. Compliance rate card ─────────────────────────────────────────────
  const { data: compRows, error: cmpErr } = await supabase
    .from('compliance_rate_card')
    .select('*')
    .eq('active', true);

  if (!cmpErr && compRows?.length) {
    for (const row of compRows) {
      const mapped = mapComplianceRow(row);
      if (mapped.category === 'design') out.SYSTEM_DESIGN = mapped;
      else if (mapped.category === 'inspection')     out.INSPECTION_COMPLIANCE = mapped;
      else if (mapped.category === 'commissioning')  out.COMMISSIONING = mapped;
      else if (mapped.category === 'grid_app')       out.GRID_APPLICATION = mapped;
      else if (mapped.category === 'certificate' && /coc/i.test(mapped.sku))  out.COC = mapped;
      else if (mapped.category === 'certificate' && /esc/i.test(mapped.sku))  out.ESC = mapped;
    }
  } else {
    // Fallback for compliance
    const fallback = getDefaultCatalogue();
    out.SYSTEM_DESIGN = fallback.SYSTEM_DESIGN;
    out.INSPECTION_COMPLIANCE = fallback.INSPECTION_COMPLIANCE;
    out.COMMISSIONING = fallback.COMMISSIONING;
    out.GRID_APPLICATION = fallback.GRID_APPLICATION;
    out.COC = fallback.COC;
    // ESC always absent in JS fallback
    out.ESC = null;
  }

  // Stats for the route to log
  out.__stats = {
    products_loaded: (productRows || []).length - skipped,
    products_skipped: skipped,
    panels: Object.keys(out.PANELS).length,
    inverters: Object.keys(out.INVERTERS).length,
    batteries: Object.keys(out.BATTERIES).length,
    bms_controllers: Object.keys(out.BMS_CONTROLLERS).length,
    smart_meters: Object.keys(out.SMART_METERS).length,
    ev_chargers: Object.keys(out.EV_CHARGERS).length,
    bos_items: Object.keys(out.BOS_ITEMS).length,
    install_labour_tiers: installRows.length,
    labour_db_or_js: labourRows?.length ? 'db' : 'js-fallback',
    compliance_db_or_js: compRows?.length ? 'db' : 'js-fallback',
  };

  return out;
}
