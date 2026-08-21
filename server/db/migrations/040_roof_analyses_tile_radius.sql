-- ────────────────────────────────────────────────────────────────────────────
-- Migration 040 — Store the tile radius used per roof-image fetch
--
-- Google Solar's dataLayers endpoint returns a tile centred on the requested
-- lat/lng, covering `radiusMeters` on each side. Historically we hardcoded
-- 50m (100m × 100m tile), which is far larger than a typical NZ house
-- (~10–15m across). Result: the aerial image showed mostly neighbours' roofs,
-- and the client had to crop-via-zoom at 6–8× to focus on the customer's
-- roof, which pixelated the image.
--
-- This column stores the ACTUAL radius used when the tile was fetched, so:
--   • For NEW leads, analyseRoof computes an optimal radius from the
--     building's bounding box (segments) — typically 15–20m — and passes it
--     to Google Solar.
--   • The client uses this stored radius in its lat/lng → pixel transform,
--     so overlays land correctly regardless of tile size.
--   • For OLD rows (NULL value), the client falls back to the 50m default
--     and offers a "refetch tighter tile" flow that upgrades the row in
--     place.
--
-- Additive migration only — no touch to existing rows or other tables.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE roof_analyses
  ADD COLUMN IF NOT EXISTS tile_radius_m NUMERIC(6,2);

COMMENT ON COLUMN roof_analyses.tile_radius_m IS
  'Google Solar dataLayers radiusMeters used when fetching the RGB tile. NULL for pre-Migration-040 rows (client falls back to 50m). Populated on every future fetch via analyseRoof.js.';

COMMIT;
