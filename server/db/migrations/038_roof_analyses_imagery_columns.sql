-- ────────────────────────────────────────────────────────────────────────────
-- Migration 038 — Add roof imagery columns to roof_analyses
--
-- Phase 2 of the Google Solar API integration adds the aerial RGB image of
-- the roof to the customer proposal PDF. The image is fetched via Google
-- Solar API's dataLayers endpoint (separate from buildingInsights),
-- converted GeoTIFF → PNG server-side (sharp), stored in a private Supabase
-- Storage bucket, then embedded in the PDF as a base64 data URI.
--
-- Four new columns capture the imagery lifecycle:
--
--   roof_image_storage_bucket  Bucket name (usually 'roof-images'). Stored
--                              rather than hardcoded so future migrations
--                              can rename the bucket without touching this
--                              table's data.
--   roof_image_storage_path    Object path within the bucket
--                              (e.g. '{enquiry_id}/rgb.png').
--   roof_image_fetched_at      Timestamp of successful fetch + upload.
--                              NULL while pending or after failure.
--   roof_image_error_message   Reason for imagery failure (e.g.
--                              'dataLayers-404: no-imagery-tier',
--                              'sharp-convert-error: ...', etc.).
--                              Kept separate from error_message (which is
--                              buildingInsights-scoped) so imagery failure
--                              doesn't overwrite the primary analysis
--                              error.
--
-- Non-destructive: uses IF NOT EXISTS on every column. Re-runnable.
-- No RLS changes needed — existing service_role SELECT policy from
-- Migration 037 covers all columns on the row.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE roof_analyses
  ADD COLUMN IF NOT EXISTS roof_image_storage_bucket  VARCHAR(60),
  ADD COLUMN IF NOT EXISTS roof_image_storage_path    TEXT,
  ADD COLUMN IF NOT EXISTS roof_image_fetched_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS roof_image_error_message   TEXT;

COMMENT ON COLUMN roof_analyses.roof_image_storage_bucket IS
  'Supabase Storage bucket name for the roof image (currently ''roof-images''). Stored per-row so future bucket renames don''t require a data migration.';
COMMENT ON COLUMN roof_analyses.roof_image_storage_path IS
  'Object path within the bucket, typically ''{enquiry_id}/rgb.png''. NULL when imagery not yet fetched or fetch failed.';
COMMENT ON COLUMN roof_analyses.roof_image_fetched_at IS
  'Timestamp of successful GeoTIFF fetch + PNG conversion + Supabase Storage upload. NULL while pending or after failure.';
COMMENT ON COLUMN roof_analyses.roof_image_error_message IS
  'Reason for imagery failure. Kept separate from error_message (which is buildingInsights-scoped) so imagery failure does not overwrite the primary analysis error.';

COMMIT;
