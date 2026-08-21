-- ────────────────────────────────────────────────────────────────────────────
-- Migration 041 — Record which imagery provider supplied each roof tile
--
-- Before this migration all tiles came from Google Solar's dataLayers
-- endpoint. Now the aerialImagery orchestrator can pick LINZ Basemap
-- (LINZ_BASEMAP_API_KEY + FEATURE_LINZ_IMAGERY) or fall back to Google
-- Solar. Storing the source lets us:
--   • debug why a tile looks a certain way ("Google fallback fired because
--     LINZ was 429'd")
--   • migrate old rows to LINZ selectively without confusion
--   • report on provider mix per month for cost/quality analysis
--
-- Additive migration — no touch to existing rows or other tables.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE roof_analyses
  ADD COLUMN IF NOT EXISTS imagery_source VARCHAR(20);

COMMENT ON COLUMN roof_analyses.imagery_source IS
  'Which provider supplied roof_image_storage_path. Values: ''linz'' (LINZ Basemap), ''google_solar'' (Google Solar dataLayers). NULL for pre-Migration-041 rows — those are all google_solar historically.';

COMMIT;
