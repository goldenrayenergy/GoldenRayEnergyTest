-- ────────────────────────────────────────────────────────────────────────────
-- Migration 037 — Google Solar API roof analysis + usage tracking
--
-- Two tables:
--
--   1. roof_analyses          — one row per Google Solar API buildingInsights
--                                call. Stores the parsed summary AND the raw
--                                response for future re-parsing / audit.
--                                Parent FKs: website_enquiries (primary),
--                                            contacts + projects_v2 (nullable —
--                                            filled if/when enquiry graduates).
--
--   2. google_solar_usage     — monthly usage counter per endpoint. Enforces
--                                Q6a cost-cap: hard-stop calls once monthly
--                                free quota is exhausted, alert admin at 80%.
--                                One row per (yyyy_mm, endpoint) pair.
--
-- Feature-flagged (env FEATURE_GOOGLE_SOLAR). Tables exist but stay empty
-- until the flag flips on.
--
-- Non-destructive: uses IF NOT EXISTS + DROP POLICY IF EXISTS so re-running
-- is safe. Wrapped in BEGIN/COMMIT — atomic all-or-nothing if any statement
-- fails when pasted into Supabase Studio.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── roof_analyses ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roof_analyses (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Parent links. website_enquiries is required (this is where wizard submit
  -- triggers the analysis). contacts + projects_v2 filled later as the lead
  -- graduates through the pipeline.
  enquiry_id                      UUID NOT NULL REFERENCES website_enquiries(id) ON DELETE CASCADE,
  contact_id                      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  project_id                      UUID REFERENCES projects_v2(id) ON DELETE SET NULL,

  -- Provenance
  source                          VARCHAR(30) NOT NULL DEFAULT 'google_solar_api',
  api_version                     VARCHAR(20),

  -- Lifecycle
  requested_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at                    TIMESTAMPTZ,
  status                          VARCHAR(20) NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','ok','skipped_quota','skipped_flag','failed')),
  error_message                   TEXT,

  -- Input echo — what we sent to Google (address only; API infers rest)
  address_used                    TEXT NOT NULL,
  latitude                        NUMERIC(9,6),
  longitude                       NUMERIC(9,6),

  -- Google-returned imagery/data quality
  imagery_quality                 VARCHAR(10),     -- HIGH / MEDIUM / LOW
  imagery_date                    DATE,

  -- Google-computed summary (parsed from buildingInsights response for fast reads)
  max_array_area_m2               NUMERIC(10,2),
  max_array_panels_count          INTEGER,
  max_sunshine_hours_per_year     NUMERIC(8,2),
  carbon_offset_factor_kg_per_kwh NUMERIC(8,4),

  -- Full segments (each element: area/pitch/azimuth/center) as returned
  roof_segments                   JSONB,

  -- Entire Google response for future re-parsing / audit / debugging
  raw_response                    JSONB,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roof_analyses_enquiry     ON roof_analyses(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_roof_analyses_project     ON roof_analyses(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roof_analyses_contact     ON roof_analyses(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roof_analyses_status      ON roof_analyses(status);
CREATE INDEX IF NOT EXISTS idx_roof_analyses_requested   ON roof_analyses(requested_at DESC);

COMMENT ON TABLE roof_analyses IS
  'Google Solar API roof analysis results, one row per buildingInsights call. Parent enquiry FK required; contact/project FKs filled as lead graduates.';
COMMENT ON COLUMN roof_analyses.status IS
  'pending=in-flight, ok=parsed successfully, skipped_quota=refused pre-call due to monthly cap, skipped_flag=FEATURE_GOOGLE_SOLAR was false, failed=Google returned error';
COMMENT ON COLUMN roof_analyses.raw_response IS
  'Full Google response preserved so we can re-parse later if we start extracting new fields (e.g. financial analysis, panel layout) without re-hitting the API.';


-- ── google_solar_usage ───────────────────────────────────────────────────────
-- Per-month, per-endpoint counter. UNIQUE(yyyy_mm, endpoint) prevents dupes.
-- Increments happen INSIDE analyseRoof.js with UPDATE...RETURNING to avoid
-- race conditions; see analyseRoof.js for the atomic increment pattern.
CREATE TABLE IF NOT EXISTS google_solar_usage (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  yyyy_mm                         VARCHAR(7) NOT NULL,             -- e.g. '2026-07'
  endpoint                        VARCHAR(30) NOT NULL,            -- 'buildingInsights' | 'dataLayers' | 'geoTiff'
  call_count                      INTEGER NOT NULL DEFAULT 0,
  quota_limit                     INTEGER NOT NULL,                -- snapshotted from config at first call of month
  admin_notified_at               TIMESTAMPTZ,                     -- non-null once we've emailed admin about hitting alert threshold
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (yyyy_mm, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_google_solar_usage_month ON google_solar_usage(yyyy_mm);

COMMENT ON TABLE google_solar_usage IS
  'Monthly Google Solar API call counter per endpoint. Enforces free-tier hard cap: analyseRoof.js refuses further calls once call_count >= quota_limit.';
COMMENT ON COLUMN google_solar_usage.quota_limit IS
  'Snapshotted from env.googleSolar.monthlyQuota at first call of the month. Later env changes do NOT retroactively raise the cap for that month.';


-- ── Row Level Security (matches Migration 036 pattern) ───────────────────────
-- Backend uses supabaseAdmin (service_role) which has BYPASSRLS, so backend
-- reads/writes are unaffected. These policies are defence-in-depth in case
-- grants get widened later or a future feature opens PostgREST access. Never
-- add a USING(true) policy here — customer/PII data lives in raw_response.
ALTER TABLE roof_analyses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_solar_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roof_analyses_select_service_role ON roof_analyses;
CREATE POLICY roof_analyses_select_service_role ON roof_analyses
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMENT ON POLICY roof_analyses_select_service_role ON roof_analyses
  IS 'Service role only. raw_response contains full Google API response including customer address. If a customer-portal feature later needs a customer to see THEIR OWN analysis, add a targeted policy (auth.uid() = contact.user_id via join) — never USING(true). See Migration 037.';

DROP POLICY IF EXISTS google_solar_usage_select_service_role ON google_solar_usage;
CREATE POLICY google_solar_usage_select_service_role ON google_solar_usage
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMENT ON POLICY google_solar_usage_select_service_role ON google_solar_usage
  IS 'Service role only. Internal usage/quota tracking table — no user-facing role should ever query it. See Migration 037.';

COMMIT;
