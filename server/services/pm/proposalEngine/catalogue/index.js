// ────────────────────────────────────────────────────────────────────────────
// Catalogue — dependency injection layer.
//
// Engine modules previously imported PANELS / INVERTERS / BATTERIES / etc.
// directly from data/catalogue.js (static JS constants). MVP1_003 moves the
// canonical catalogue to DB tables (hardware_catalog, bos_catalog,
// labour_rate_card, compliance_rate_card) so the admin can refresh prices via
// CSV without a deploy.
//
// Routes fetch from DB and pass the catalogue object into runEngine via
// `options.catalogue`. Engine modules call `getCatalogue(options)` which
// returns either the provided catalogue or the JS-module fallback.
//
// Catalogue shape (matches the legacy JS modules so engine code is unchanged):
//   {
//     PANELS:           { sku → { watts, voc_stc, cost_nzd, margin_pct, ... } },
//     INVERTERS:        { sku → { ac_kw, uoc_max_v, ... } },
//     BATTERIES:        { sku → { series, module_kwh, ... } },
//     BMS_CONTROLLERS:  { sku → { ... } },
//     SMART_METERS:     { sku → { phase, ... } },
//     BOS_ITEMS:        { sku → { category, ... } },
//     EV_CHARGERS:      { sku → { ... } },
//
//     INSTALLATION_LABOUR: { small, medium, large },
//     BATTERY_INSTALL_PREMIUM,
//     SUPERVISOR, TRAVEL, LOGISTICS,
//     SITE_SURVEY_FEE,
//     PARALLEL_PREMIUM,
//
//     SYSTEM_DESIGN, INSPECTION_COMPLIANCE, COMMISSIONING,
//     GRID_APPLICATION, COC, ESC,
//
//     CATALOGUE_VERSION, LABOUR_RATE_CARD_VERSION,
//   }
// ────────────────────────────────────────────────────────────────────────────

import * as CATALOGUE_DEFAULTS from '../data/catalogue.js';
import * as LABOUR_DEFAULTS from '../data/labourRateCard.js';

// Build the fallback catalogue from the legacy JS modules. This is the seed
// source — same data the DB starts with after the MVP1_003 seed script runs.
function buildDefaultCatalogue() {
  return {
    PANELS:           CATALOGUE_DEFAULTS.PANELS,
    INVERTERS:        CATALOGUE_DEFAULTS.INVERTERS,
    BATTERIES:        CATALOGUE_DEFAULTS.BATTERIES,
    BMS_CONTROLLERS:  CATALOGUE_DEFAULTS.BMS_CONTROLLERS,
    SMART_METERS:     CATALOGUE_DEFAULTS.SMART_METERS,
    BOS_ITEMS:        CATALOGUE_DEFAULTS.BOS_ITEMS,
    EV_CHARGERS:      CATALOGUE_DEFAULTS.EV_CHARGERS,
    CATALOGUE_VERSION: CATALOGUE_DEFAULTS.CATALOGUE_VERSION,

    INSTALLATION_LABOUR:     LABOUR_DEFAULTS.INSTALLATION_LABOUR,
    BATTERY_INSTALL_PREMIUM: LABOUR_DEFAULTS.BATTERY_INSTALL_PREMIUM,
    SUPERVISOR:              LABOUR_DEFAULTS.SUPERVISOR,
    TRAVEL:                  LABOUR_DEFAULTS.TRAVEL,
    LOGISTICS:               LABOUR_DEFAULTS.LOGISTICS,
    SITE_SURVEY_FEE:         LABOUR_DEFAULTS.SITE_SURVEY_FEE,
    PARALLEL_PREMIUM: {
      sku: 'LAB-INSTALL-PARALLEL',
      name: 'Parallel-string topology install premium (combiner wiring + string termination)',
      cost_nzd: 400, margin_pct: 0,
    },

    SYSTEM_DESIGN:          LABOUR_DEFAULTS.SYSTEM_DESIGN,
    INSPECTION_COMPLIANCE:  LABOUR_DEFAULTS.INSPECTION_COMPLIANCE,
    COMMISSIONING:          LABOUR_DEFAULTS.COMMISSIONING,
    GRID_APPLICATION:       LABOUR_DEFAULTS.GRID_APPLICATION,
    COC:                    LABOUR_DEFAULTS.COC,
    ESC: null,   // not in legacy JS modules — added at DB seed time (MVP1_003)

    LABOUR_RATE_CARD_VERSION: LABOUR_DEFAULTS.LABOUR_RATE_CARD_VERSION,
  };
}

let _cachedDefault = null;
export function getDefaultCatalogue() {
  if (!_cachedDefault) _cachedDefault = buildDefaultCatalogue();
  return _cachedDefault;
}

// Helper used by every engine module — pull catalogue from options or fall back.
export function getCatalogue(options = {}) {
  return options.catalogue || getDefaultCatalogue();
}

// Lookup any SKU across all hardware + BoS maps.
export function lookupSku(catalogue, sku) {
  const c = catalogue;
  return c.PANELS?.[sku] || c.INVERTERS?.[sku] || c.BATTERIES?.[sku]
      || c.BMS_CONTROLLERS?.[sku] || c.SMART_METERS?.[sku]
      || c.BOS_ITEMS?.[sku] || c.EV_CHARGERS?.[sku] || null;
}

// Build a priced line item from a SKU. Replaces lineFromSku() in catalogue.js.
export function lineFromSku(catalogue, sku, qty) {
  const item = lookupSku(catalogue, sku);
  if (!item) throw new Error(`Unknown SKU: ${sku}`);
  if (qty == null || qty <= 0) throw new Error(`Invalid qty ${qty} for SKU ${sku}`);
  const line_cost = +(item.cost_nzd * qty).toFixed(2);
  const sell_ex_gst = +(line_cost * (1 + item.margin_pct / 100)).toFixed(2);
  return {
    sku, name: item.name, qty,
    unit_cost: item.cost_nzd, line_cost,
    margin_pct: item.margin_pct,
    sell_ex_gst,
    margin_dollar: +(sell_ex_gst - line_cost).toFixed(2),
  };
}

// Select the install labour tier that applies to a given system kW.
// Uses applies_to_kw_min / applies_to_kw_max when available (DB rows), else
// falls back to the legacy small/medium/large keys on INSTALLATION_LABOUR.
export function selectInstallLabour(catalogue, systemKw) {
  const ilab = catalogue.INSTALLATION_LABOUR;
  if (!ilab) return null;
  // Legacy shape: { small, medium, large }
  if (ilab.small && ilab.medium && ilab.large) {
    if (systemKw < 8)  return ilab.small;
    if (systemKw <= 12) return ilab.medium;
    return ilab.large;
  }
  // DB shape: array of rows with applies_to_kw_min / applies_to_kw_max
  if (Array.isArray(ilab)) {
    return ilab.find(r =>
      (r.applies_to_kw_min == null || systemKw >= r.applies_to_kw_min) &&
      (r.applies_to_kw_max == null || systemKw <  r.applies_to_kw_max)
    ) || null;
  }
  return null;
}

// Loader stub — to be filled in by P8 (admin CSV import phase) or a
// separate db-backed module. For now any route can populate options.catalogue
// from a DB query and pass through.
export async function loadCatalogueFromDb(/* supabaseClient */) {
  // Placeholder — implemented at P8 once admin CSV flow is in place.
  throw new Error('loadCatalogueFromDb not yet implemented — pass options.catalogue from route.');
}
