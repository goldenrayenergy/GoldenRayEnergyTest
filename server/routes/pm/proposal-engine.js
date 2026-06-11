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
import { REGIONS } from '../../services/pm/proposalEngine/data/engineeringRules.js';

const router = Router();
router.use(authenticate);

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

export default router;
