-- Phase 1 — Bill Analysis foundation
--
-- Stores customer-uploaded power bill PDFs (parsed via OCR) and the
-- forward-looking scenario analysis computed from them. The analysis is
-- the differentiation — it shows the customer things their retailer
-- structurally cannot or will not (multi-scenario projections, retailer
-- switch advice, do-nothing 25-year cost).
--
-- Two related tables:
--
--   bill_analyses  — one row per analysis run (a customer uploads
--                    1-12 bills and we compute one analysis snapshot)
--   bill_uploads   — one row per individual bill PDF, linked to its
--                    parent analysis. Stores the raw OCR text plus the
--                    normalised numeric fields we extracted.
--
-- Privacy:
--   - Bill PDFs contain personal data (address, customer number, dollar
--     amounts). For anonymous users (no email submitted), bill_analyses
--     auto-deletes 90 days after creation via a scheduled job (caller
--     responsibility — schema just records expires_at).
--   - For users who convert to a real lead (contact_id set), we keep
--     the analysis indefinitely as part of their CRM record.
--
-- Conversion flow:
--   - Anonymous run     → contact_id = NULL, expires_at = NOW() + 90d
--   - Quote requested   → contact_id set, expires_at NULLed (kept forever)
--

CREATE TABLE IF NOT EXISTS bill_analyses (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Customer linkage (NULL for anonymous analyses)
  contact_id              UUID REFERENCES contacts(id) ON DELETE SET NULL,
  email                   VARCHAR(255),               -- captured before PDF download even if no contact yet

  -- Aggregate inputs (re-derivable from bill_uploads but cached for speed)
  bills_uploaded          INTEGER NOT NULL DEFAULT 0,
  period_start            DATE,                       -- earliest bill period start
  period_end              DATE,                       -- latest bill period end
  months_covered          INTEGER,                    -- usually 12; could be less

  -- Aggregate consumption + cost
  annual_kwh              NUMERIC(10,2),
  annual_spend_nzd        NUMERIC(12,2),
  effective_rate_nzd      NUMERIC(8,4),               -- annual_spend / annual_kwh
  fixed_charge_total_nzd  NUMERIC(12,2),
  variable_charge_total_nzd NUMERIC(12,2),

  -- Detected retailer + plan (best-effort from OCR)
  retailer                VARCHAR(80),
  plan_name               TEXT,

  -- Location used for solar irradiance / scenario calculation
  region                  VARCHAR(60),                -- 'auckland' | 'wellington' | 'canterbury' | 'otago' | ...
  postcode                VARCHAR(10),

  -- Detected behavioural patterns (rules-based; manual templates)
  -- Stored as JSONB array of { code, label, severity, recommendation } objects
  patterns                JSONB DEFAULT '[]'::jsonb,

  -- Computed scenario projections (the hero output)
  -- Array of { id, label, year_1_cost, year_10_cost, year_25_cost,
  --            upfront_cost, net_25yr, payback_years, recommended_package_slug }
  scenarios               JSONB DEFAULT '[]'::jsonb,

  -- Recommended outputs derived from analysis
  recommended_system_kw   NUMERIC(6,2),
  recommended_battery_kwh NUMERIC(6,2),
  recommended_orientation TEXT,
  recommended_package_slug VARCHAR(120),              -- maps to packages.slug

  -- Retailer switch recommendation (always honest — even when it doesn't help us)
  switch_recommended      BOOLEAN DEFAULT false,
  switch_to_retailer      VARCHAR(80),
  switch_to_plan          TEXT,
  switch_annual_saving    NUMERIC(10,2),

  -- Lifecycle
  status                  VARCHAR(20) NOT NULL DEFAULT 'completed'
                            CHECK (status IN ('uploading','analyzing','completed','failed')),
  expires_at              TIMESTAMPTZ,                -- NULL = keep forever (linked contact); set = TTL for anon

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_analyses_contact   ON bill_analyses(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bill_analyses_email     ON bill_analyses(email)      WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bill_analyses_expires   ON bill_analyses(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bill_analyses_created   ON bill_analyses(created_at DESC);


-- ── bill_uploads — one per parsed bill ────────────────────────────────────
CREATE TABLE IF NOT EXISTS bill_uploads (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_id             UUID NOT NULL REFERENCES bill_analyses(id) ON DELETE CASCADE,

  -- Source artefact (we don't store the PDF itself — just hash + filename)
  file_name               VARCHAR(255),
  file_size_bytes         INTEGER,
  file_hash               VARCHAR(64),               -- sha256 — dedupe duplicate uploads

  -- OCR raw output (kept short — first 4000 chars for debugging only)
  ocr_text_excerpt        TEXT,
  ocr_confidence          NUMERIC(4,3),              -- 0.000 - 1.000

  -- Normalised parse results
  retailer                VARCHAR(80),
  plan_name               TEXT,
  period_start            DATE,
  period_end              DATE,
  days_in_period          INTEGER,

  kwh_total               NUMERIC(10,2),
  kwh_peak                NUMERIC(10,2),             -- TOU plans only
  kwh_off_peak            NUMERIC(10,2),
  kwh_exported            NUMERIC(10,2),             -- if customer already has solar

  fixed_charge_nzd        NUMERIC(10,2),             -- daily charge × days
  variable_charge_nzd     NUMERIC(10,2),
  export_credit_nzd       NUMERIC(10,2),
  gst_nzd                 NUMERIC(10,2),
  total_nzd               NUMERIC(10,2),

  parse_errors            JSONB DEFAULT '[]'::jsonb, -- field-level warnings, not row-level

  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_uploads_analysis ON bill_uploads(analysis_id);
CREATE INDEX IF NOT EXISTS idx_bill_uploads_period   ON bill_uploads(period_start);

-- updated_at trigger on bill_analyses
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bill_analyses_updated_at') THEN
    CREATE TRIGGER trg_bill_analyses_updated_at
      BEFORE UPDATE ON bill_analyses
      FOR EACH ROW
      EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;
