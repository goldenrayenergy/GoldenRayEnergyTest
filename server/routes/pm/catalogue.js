// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm/catalogue/options
//
// Returns the SKU dropdown options the QuoteForm needs for its panel /
// inverter / battery / smart-meter selectors. Sourced from the live
// products table via the engine's DB catalogue loader (which applies the
// field aliasing — rated_kw → ac_kw, hybrid_status='ready' → is_plus_variant,
// etc.).
//
// Single request returns all categories so the form caches once per session.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { loadCatalogueFromDb } from '../../services/pm/proposalEngine/catalogue/dbLoader.js';

const router = Router();
router.use(authenticate);

// Format helpers — generate friendly labels for the UI.
const fmtPanelLabel = (sku, p) => {
  const w = p.watts ? `${p.watts}W` : '';
  return `${p.brand || ''} ${w} ${p.name || sku}`.replace(/\s+/g, ' ').trim();
};

const fmtInverterLabel = (sku, i) => {
  const kw = i.ac_kw ? `${i.ac_kw}kW` : '';
  const ph = i.phase ? `${i.phase}-phase` : '';
  const plus = i.is_plus_variant ? '(battery-ready)' : (i.battery_capable ? '(hybrid)' : '');
  const bits = [i.brand, i.name, kw, ph, plus].filter(Boolean);
  return bits.join(' · ').replace(/ +/g, ' ');
};

const fmtBatteryLabel = (sku, b) => {
  const kwh = b.module_kwh ? `${b.module_kwh} kWh/module` : '';
  const bits = [b.brand, b.series, b.name || '', kwh].filter(Boolean);
  return bits.join(' · ').replace(/ +/g, ' ');
};

const fmtBmsLabel = (sku, m) => {
  const bits = [m.brand, m.name || '', m.for_battery_series && `for ${m.for_battery_series}`]
    .filter(Boolean);
  return bits.join(' · ');
};

const fmtSmartMeterLabel = (sku, m) => {
  const amps = m.amps ? `${m.amps}A` : '';
  const ph = m.phase ? `${m.phase}-phase` : '';
  return [m.brand, m.name || '', amps, ph].filter(Boolean).join(' · ');
};

const fmtEvLabel = (sku, e) => {
  const kw = e.ac_kw ? `${e.ac_kw}kW` : '';
  const ph = e.phase ? `${e.phase}-phase` : '';
  return [e.brand, e.name || '', kw, ph].filter(Boolean).join(' · ');
};

// Sort: by brand asc, then by rating (watts / kw / kWh) desc
function sortByBrandThenRating(rows, ratingKey) {
  return [...rows].sort((a, b) => {
    const brand = (a.brand || '').localeCompare(b.brand || '');
    if (brand !== 0) return brand;
    return (b[ratingKey] || 0) - (a[ratingKey] || 0);
  });
}

router.get('/options', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const catalogue = await loadCatalogueFromDb(supabaseAdmin);

    const panels = sortByBrandThenRating(
      Object.entries(catalogue.PANELS).map(([sku, p]) => ({
        sku, label: fmtPanelLabel(sku, p),
        brand: p.brand, watts: p.watts,
      })), 'watts');

    const inverters = sortByBrandThenRating(
      Object.entries(catalogue.INVERTERS).map(([sku, i]) => ({
        sku, label: fmtInverterLabel(sku, i),
        brand: i.brand, kw: i.ac_kw, phase: i.phase,
        is_plus_variant: i.is_plus_variant,
        battery_capable: i.battery_capable,
      })), 'kw');

    const batteries = sortByBrandThenRating(
      Object.entries(catalogue.BATTERIES).map(([sku, b]) => ({
        sku, label: fmtBatteryLabel(sku, b),
        brand: b.brand, series: b.series, kwh_per_module: b.module_kwh,
      })), 'kwh_per_module');

    const bms_controllers = Object.entries(catalogue.BMS_CONTROLLERS).map(([sku, m]) => ({
      sku, label: fmtBmsLabel(sku, m),
      brand: m.brand, for_series: m.for_battery_series,
    }));

    const smart_meters = sortByBrandThenRating(
      Object.entries(catalogue.SMART_METERS).map(([sku, m]) => ({
        sku, label: fmtSmartMeterLabel(sku, m),
        brand: m.brand, amps: m.amps, phase: m.phase,
      })), 'amps');

    const ev_chargers = sortByBrandThenRating(
      Object.entries(catalogue.EV_CHARGERS).map(([sku, e]) => ({
        sku, label: fmtEvLabel(sku, e),
        brand: e.brand, kw: e.ac_kw, phase: e.phase,
      })), 'kw');

    res.json({
      panels,
      inverters,
      batteries,
      bms_controllers,
      smart_meters,
      ev_chargers,
      catalogue_version: catalogue.CATALOGUE_VERSION,
      counts: {
        panels: panels.length,
        inverters: inverters.length,
        batteries: batteries.length,
        bms_controllers: bms_controllers.length,
        smart_meters: smart_meters.length,
        ev_chargers: ev_chargers.length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/pm/catalogue/cost-picker
//
// Read-only picker for the Costs tab "+ Add from catalogue" dropdown.
// Returns active labour + compliance rate-card rows so the rep can pick
// a SKU instead of typing one in. Rep-accessible (not admin-gated).
// ────────────────────────────────────────────────────────────────────────────
router.get('/cost-picker', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const [labourRes, complianceRes] = await Promise.all([
      supabaseAdmin.from('labour_rate_card')
        .select('sku, category, name, cost_nzd, margin_pct, default_qty, applies_to_kw_min, applies_to_kw_max')
        .eq('active', true)
        .order('category').order('sku'),
      supabaseAdmin.from('compliance_rate_card')
        .select('sku, category, name, cost_nzd, margin_pct, default_qty')
        .eq('active', true)
        .order('category').order('sku'),
    ]);
    if (labourRes.error)     throw labourRes.error;
    if (complianceRes.error) throw complianceRes.error;
    res.json({
      labour:     labourRes.data || [],
      compliance: complianceRes.data || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
