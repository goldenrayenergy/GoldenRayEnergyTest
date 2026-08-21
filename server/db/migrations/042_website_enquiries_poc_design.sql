-- ────────────────────────────────────────────────────────────────────────────
-- Migration 042 — website_enquiries columns for /api/quote/submit-with-design
--
-- Part of the /get-quote + /poc/quote integration
-- ([[project-quote-flow-integration-plan]] Phase A, ticket A4, 2026-08-20).
--
-- The merged residential quote flow captures a lot more per lead than the old
-- wizard: full roof analysis, chosen tier + price, system size, battery pick,
-- EV opt-in, exact coords. This migration adds the columns needed to persist
-- that data so sales team can filter/report on it and so the PM Tool project
-- row (Phase 6.6, ticket A7) can pull FKs.
--
-- Design choice: keep summary columns for SQL querying AND a full JSONB blob
-- `poc_design_json` for audit + PDF regeneration. `/api/poc/roof/analyse`
-- currently does NOT persist to any table (returns result inline) so there
-- is no FK target for `analysis_id` — we store the analysis in the blob.
-- If POC roof analysis gets its own persistence table later, we can add
-- an FK in a follow-up migration.
--
-- Additive only — old wizard writes to `website_enquiries` unchanged. All
-- new columns are NULL for rows written by the old /api/quote/submit path.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Which flow produced this lead. Old wizard writes NULL; new merged flow
-- writes 'get_quote_with_design'. Lets us filter reports on new-flow leads
-- without needing to join to another table.
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS submission_source VARCHAR(40);

COMMENT ON COLUMN website_enquiries.submission_source IS
  'Which endpoint produced this lead. NULL for legacy wizard (/api/quote/submit). ''get_quote_with_design'' for the new merged flow (/api/quote/submit-with-design).';

-- Chosen tier — the customer clicked one of the 3 tier cards. String key
-- ('essential' | 'balanced' | 'premium' typically) so we don't need a FK
-- to a tier catalogue that could change over time.
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS chosen_tier_id VARCHAR(40);

COMMENT ON COLUMN website_enquiries.chosen_tier_id IS
  'The tier the customer clicked "Get this quote" on. String key of the tier as computed by threeTierComposer at submit time. NULL for legacy wizard leads.';

-- System size + panel count as recommended by the composer for the chosen
-- tier, after roof-fit-aware capping (Fix C from 2026-08-19).
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS system_kwp NUMERIC(6, 3);

COMMENT ON COLUMN website_enquiries.system_kwp IS
  'System size in kWp for the chosen tier. NULL for legacy wizard (its `system_size_kw` column is from the pre-Solar calcService estimate).';

ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS panel_count INTEGER;

COMMENT ON COLUMN website_enquiries.panel_count IS
  'Number of panels for the chosen tier, capped by roof-fit if applicable.';

-- Battery kWh for the chosen tier (NULL if customer opted out of battery)
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS battery_kwh_chosen NUMERIC(6, 2);

COMMENT ON COLUMN website_enquiries.battery_kwh_chosen IS
  'Usable kWh of battery in the chosen tier. NULL for solar-only. Distinct from the legacy `battery_kwh` column which was the calcService estimate.';

-- Wattpilot EV charger — boolean opt-in
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS ev_charger_included BOOLEAN;

COMMENT ON COLUMN website_enquiries.ev_charger_included IS
  'True if chosen tier includes a Wattpilot EV charger. NULL for legacy wizard leads (never tracked).';

-- Final price for the chosen tier
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS tier_price NUMERIC(10, 2);

COMMENT ON COLUMN website_enquiries.tier_price IS
  'Final price the customer saw on the tier they chose (post-discount if any). Distinct from `total_cost` which is the legacy calcService estimate.';

-- Which imagery source backed the roof analysis (google-solar / lidar / osm)
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS roof_source VARCHAR(20);

COMMENT ON COLUMN website_enquiries.roof_source IS
  'Roof-analysis imagery provider used: ''google_solar'', ''lidar'', or ''osm''. Tells sales team how confident to be in the roof geometry when quoting.';

-- Exact coordinates (customer dragged pin, so more accurate than address alone)
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS coords_lat DOUBLE PRECISION;
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS coords_lng DOUBLE PRECISION;

COMMENT ON COLUMN website_enquiries.coords_lat IS
  'Latitude of pin after customer confirmed on Leaflet map. More accurate than the geocoded address alone.';
COMMENT ON COLUMN website_enquiries.coords_lng IS
  'Longitude — see coords_lat.';

-- Full design payload — the entire threeTierComposer output + roof analysis
-- result. Stored as JSONB so we can regenerate the customer PDF later,
-- diff tier options if we tweak the composer, and audit exactly what the
-- customer saw at submission time.
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS poc_design_json JSONB;

COMMENT ON COLUMN website_enquiries.poc_design_json IS
  'Full JSON blob of the roof-analysis + all 3 tier options + customer sliders (battery kWh, EV km/day) at submit time. Used for PDF regeneration and audit. NULL for legacy wizard leads.';

-- Index on submission_source for the "new flow leads only" report
CREATE INDEX IF NOT EXISTS idx_website_enquiries_submission_source
  ON website_enquiries (submission_source)
  WHERE submission_source IS NOT NULL;

COMMIT;
