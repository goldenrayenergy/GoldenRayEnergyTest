// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm/proposal-engine/* (engine-side recommendations)
//
// Endpoints:
//   POST /recommend-string-layout
//     Body: { panel_sku, inverter_sku, panel_count, region }
//     Returns the envelope-aware string layout the engine recommends for the
//     given panel + inverter + count + region. Reads the catalogue from live
//     Supabase to get current spec values (mppt_v_min etc.). See
//     services/pm/proposalEngine/stringDesigner.js for the algorithm.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { loadCatalogueFromDb } from '../../services/pm/proposalEngine/catalogue/dbLoader.js';
import { recommendLayout } from '../../services/pm/proposalEngine/stringDesigner.js';
import { selectInverter } from '../../services/pm/proposalEngine/inverterSelector.js';
import { selectPanel } from '../../services/pm/proposalEngine/panelSelector.js';
import { selectBattery } from '../../services/pm/proposalEngine/batterySelector.js';
import { composeSystem } from '../../services/pm/proposalEngine/systemComposer.js';
import { REGIONS, BMS_RULES, COMPATIBILITY, TIER_STRIP_SETTINGS } from '../../services/pm/proposalEngine/data/engineeringRules.js';

const router = Router();
router.use(authenticate);

// ────────────────────────────────────────────────────────────────────────────
// GET /tier-settings — Option 4c tier-strip configuration
//
// Returns the default size mode + tiered-size multipliers + labels for the
// client autoSizeThreeTiers to use. Read-only for now; admin UI will edit
// when promoted to company_settings.tier_strip_settings jsonb column.
// ────────────────────────────────────────────────────────────────────────────
router.get('/tier-settings', (req, res) => {
  res.json(TIER_STRIP_SETTINGS);
});

router.post('/recommend-string-layout', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { panel_sku, inverter_sku, panel_count, region } = req.body || {};

    if (!panel_sku || !inverter_sku || !panel_count) {
      return res.status(400).json({
        error: 'panel_sku, inverter_sku, and panel_count are required',
      });
    }

    const catalogue = await loadCatalogueFromDb(supabaseAdmin);
    const panel    = catalogue.PANELS[panel_sku];
    const inverter = catalogue.INVERTERS[inverter_sku];

    if (!panel) {
      return res.status(404).json({ error: `Unknown panel SKU: ${panel_sku}` });
    }
    if (!inverter) {
      return res.status(404).json({ error: `Unknown inverter SKU: ${inverter_sku}` });
    }

    // Region is optional — default Auckland if missing (matches engineering
    // validator default for Stage 1 estimates before address confirmed).
    const regionData = REGIONS[region] || REGIONS.auckland_vector;

    const layout = recommendLayout({
      panel,
      inverter,
      panelCount: Number(panel_count),
      region: regionData,
    });

    res.json({
      layout,
      inputs_resolved: {
        panel: { sku: panel_sku, watts: panel.watts, voc_stc: panel.voc_stc, vmp_stc: panel.vmp_stc },
        inverter: { sku: inverter_sku, ac_kw: inverter.ac_kw, mppt_count: inverter.mppt_count,
                    uoc_max_v: inverter.uoc_max_v, mppt_v_min: inverter.mppt_v_min },
        region: { key: region || 'auckland_vector', t_min_celsius: regionData.t_min_celsius },
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /recommend-inverter — Option 4a §2.8 decision tree
//
// Body: { panel_sku, panel_count, phase, has_battery?, has_ev?, dc_ac_target? }
// (panel_sku + panel_count produce target_dc_kwp; alternatively pass
//  target_dc_kwp directly to skip the lookup.)
// ────────────────────────────────────────────────────────────────────────────
router.post('/recommend-inverter', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const {
      panel_sku, panel_count, target_dc_kwp,
      phase, has_battery = false, has_ev = false,
      dc_ac_target,
    } = req.body || {};

    if (!phase || (phase !== 1 && phase !== 3)) {
      return res.status(400).json({ error: 'phase must be 1 or 3' });
    }

    const catalogue = await loadCatalogueFromDb(supabaseAdmin);

    // Compute target_dc_kwp from panel × count if not passed directly.
    let dcKwp = Number(target_dc_kwp) || 0;
    if (!dcKwp) {
      if (!panel_sku || !panel_count) {
        return res.status(400).json({
          error: 'Either target_dc_kwp OR (panel_sku + panel_count) required',
        });
      }
      const panel = catalogue.PANELS[panel_sku];
      if (!panel) return res.status(404).json({ error: `Unknown panel SKU: ${panel_sku}` });
      dcKwp = (Number(panel.watts) * Number(panel_count)) / 1000;
    }

    const result = selectInverter({
      targetDcKwp: dcKwp,
      phase: Number(phase),
      hasBattery: !!has_battery,
      hasEv: !!has_ev,
      catalogue,
      dcAcTarget: dc_ac_target ? Number(dc_ac_target) : undefined,
    });

    res.json({
      ...result,
      inputs_resolved: {
        target_dc_kwp: +dcKwp.toFixed(2),
        phase: Number(phase),
        has_battery: !!has_battery,
        has_ev: !!has_ev,
        dc_ac_target: result.dc_ac_target,
        catalogue_inverters_count: Object.keys(catalogue.INVERTERS).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /recommend-panel — Option 4b panel selector
//
// Body: { target_kwp? }
// Returns the highest-wattage panel in the live catalogue with full specs.
// target_kwp is optional — if provided, response includes panels_needed.
// ────────────────────────────────────────────────────────────────────────────
router.post('/recommend-panel', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { target_kwp } = req.body || {};
    const catalogue = await loadCatalogueFromDb(supabaseAdmin);

    const result = selectPanel({
      catalogue,
      targetKwp: target_kwp ? Number(target_kwp) : null,
    });

    res.json({
      ...result,
      inputs_resolved: {
        target_kwp: target_kwp ? +Number(target_kwp).toFixed(2) : null,
        catalogue_panels_count: Object.keys(catalogue.PANELS).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /recommend-battery — Option 4b §3.1 decision tree
//
// Body: { inverter_sku, target_usable_kwh }
// Returns the battery SKU + module count for the target backup capacity.
// Inverter must be Plus / battery-capable.
// ────────────────────────────────────────────────────────────────────────────
router.post('/recommend-battery', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { inverter_sku, target_usable_kwh } = req.body || {};
    if (!inverter_sku) return res.status(400).json({ error: 'inverter_sku required' });
    if (!target_usable_kwh) return res.status(400).json({ error: 'target_usable_kwh required' });

    const catalogue = await loadCatalogueFromDb(supabaseAdmin);
    const inverter = catalogue.INVERTERS[inverter_sku];
    if (!inverter) return res.status(404).json({ error: `Unknown inverter SKU: ${inverter_sku}` });
    inverter.sku = inverter_sku;  // for downstream lookups

    const result = selectBattery({
      targetUsableKwh: Number(target_usable_kwh),
      inverter,
      catalogue,
      COMPATIBILITY,
      BMS_RULES,
    });

    res.json({
      ...result,
      inputs_resolved: {
        inverter_sku,
        target_usable_kwh: +Number(target_usable_kwh).toFixed(2),
        catalogue_batteries_count: Object.keys(catalogue.BATTERIES).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /compose-system — Option 4c — full-system orchestration in one call
//
// Body: {
//   target_dc_kwp:             10.5,        // required
//   phase:                     1 | 3,       // required
//   target_battery_usable_kwh: 11 | null,   // null = no battery in this tier
//   has_ev:                    false,
//   region:                    "auckland_vector",
// }
//
// Returns a complete tier-ready system:
//   { panel, inverter, battery, string_design, wattpilot_included,
//     reasons, warnings, inputs_resolved }
//
// Failure mode: a missing sub-selector returns null for that field +
// a warning. Tier still renders so the rep sees the gap.
// ────────────────────────────────────────────────────────────────────────────
router.post('/compose-system', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const {
      target_dc_kwp, phase,
      target_battery_usable_kwh, has_ev = false, region,
    } = req.body || {};

    if (!target_dc_kwp || target_dc_kwp <= 0) {
      return res.status(400).json({ error: 'target_dc_kwp required (> 0)' });
    }
    if (!phase || (Number(phase) !== 1 && Number(phase) !== 3)) {
      return res.status(400).json({ error: 'phase must be 1 or 3' });
    }

    const catalogue = await loadCatalogueFromDb(supabaseAdmin);
    const regionData = REGIONS[region] || REGIONS.auckland_vector;

    const out = composeSystem({
      targetDcKwp: Number(target_dc_kwp),
      phase: Number(phase),
      targetBatteryUsableKwh: target_battery_usable_kwh != null
        ? Number(target_battery_usable_kwh) : null,
      hasEv: !!has_ev,
      region: regionData,
      catalogue,
      COMPATIBILITY,
      BMS_RULES,
    });

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
