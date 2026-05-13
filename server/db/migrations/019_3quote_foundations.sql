-- ────────────────────────────────────────────────────────────────────────────
-- PM Tool — 3-Quote Engine Foundations (Phase 1.1)
--
-- Six new tables + extensions to `products` that enable the 3-quote flow:
--   1. suppliers              — relationship metadata per brand (REC / Fronius / BYD / ...)
--                                with tier, contract status, volume commitments, rep contacts.
--   2. product_compatibility  — verified panel↔inverter and inverter↔battery pairings.
--   3. customer_profiles      — canonical, portal-agnostic customer record built by the
--                                normaliser. Single source of truth for the quote engine,
--                                proposal generator, sales-exec view, PM Tool lead view.
--   4. quote_recommendations  — log of every 3-quote-pack generation event.
--                                Scoring breakdown stored alongside generation;
--                                outcome columns filled later as the lead progresses.
--                                This is the feedback loop for tuning recommendations.
--   5. region_defaults        — NZ regions with sun hours + average household consumption.
--                                Drives system sizing for form-only customers.
--   6. cost_defaults          — install labour, council fees, scaffolding, etc.
--                                Fixed costs added on top of parts cost.
--
-- Plus on existing `products` table:
--   - supplier_id            — FK link to suppliers row (was implicit via brand text)
--   - wholesale_cost_nzd     — what Goldenray pays the supplier
--                              (separate from cost_nzd which today mixes wholesale + cost-to-sell)
--   - margin_target_pct      — per-product margin override
--                              (falls back to supplier's default if NULL)
--   - lead_time_days         — supplier lead time, for install scheduling
--
-- All tables are EMPTY at migration time. The Supplier_Setup workbook
-- importer (Phase 1.2) seeds them from owner-filled real data.
--
-- Migration is idempotent: re-running is a no-op (CREATE TABLE IF NOT EXISTS,
-- ALTER TABLE ADD COLUMN IF NOT EXISTS where supported).
-- ────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. SUPPLIERS                                                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS suppliers (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identity
  name                        VARCHAR(160) NOT NULL,             -- 'REC Solar of Norway', 'Fronius Australia'
  short_code                  VARCHAR(12) UNIQUE NOT NULL,       -- 'REC', 'FRO' — used in quote labels
  category_focus              VARCHAR(40),                       -- 'Panels' | 'Inverters' | 'Batteries' | 'Racking' | 'BOS' | 'Mixed'

  -- Tier defines this supplier's role in the 3-quote engine.
  -- t1_strategic  → Quote A bias (premium-tier products, thinner margin, formal commit)
  -- t2_volume     → Quote B bias (mid-market workhorses, fair margin)
  -- t3_opportunistic → Quote C bias (spot buys, fattest margin, no commit)
  tier                        VARCHAR(24) NOT NULL
                              CHECK (tier IN ('t1_strategic', 't2_volume', 't3_opportunistic')),

  -- Contract state
  contract_status             VARCHAR(20) DEFAULT 'active'
                              CHECK (contract_status IN ('active', 'probation', 'paused', 'terminated')),
  contract_start_date         DATE,
  contract_renewal_date       DATE,                              -- when agreement expires (procurement reminder)

  -- Volume commitments (t1 only — t2/t3 leave NULL)
  min_volume_target_yearly    INTEGER,                           -- units/yr committed
  volume_unit                 VARCHAR(20),                       -- 'panels'/'inverters'/'batteries'/'mixed'

  -- Co-funding (% of marketing spend the supplier reimburses)
  marketing_cofund_pct        NUMERIC(5,2) DEFAULT 0.00,

  -- Default margin target — used when product.margin_target_pct is NULL
  default_margin_target_pct   NUMERIC(5,2),

  -- Rep contacts
  rep_name                    VARCHAR(120),
  rep_email                   VARCHAR(160),
  rep_phone                   VARCHAR(40),

  -- Free text
  notes                       TEXT,

  -- Lifecycle
  is_active                   BOOLEAN DEFAULT TRUE,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tier            ON suppliers(tier);
CREATE INDEX IF NOT EXISTS idx_suppliers_contract_status ON suppliers(contract_status);
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active       ON suppliers(is_active);

-- updated_at trigger (reuse existing function from migration 009)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_suppliers_updated_at') THEN
    CREATE TRIGGER trg_suppliers_updated_at
      BEFORE UPDATE ON suppliers
      FOR EACH ROW EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. PRODUCTS — extensions                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Link products to their supplier. Nullable for now since existing products
-- have no supplier row to link to until the workbook importer runs.
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id            UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_cost_nzd     NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS margin_target_pct      NUMERIC(5,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_days         INTEGER;

-- Index for joining by supplier (e.g. "all REC products")
CREATE INDEX IF NOT EXISTS idx_products_supplier_id     ON products(supplier_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. PRODUCT_COMPATIBILITY                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Verified pairings: which panel-inverter and inverter-battery combinations
-- work together. The 3-quote engine queries this BEFORE bundling products.
-- If no row exists for a pairing, the engine refuses to offer it.
--
-- pairing_type values:
--   'panel_inverter'   — DC string voltage compatibility
--   'inverter_battery' — hybrid inverter ↔ specific battery brand
--   'inverter_meter'   — inverter ↔ smart meter compatibility (rare exclusion)

CREATE TABLE IF NOT EXISTS product_compatibility (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pairing_type    VARCHAR(40) NOT NULL
                  CHECK (pairing_type IN ('panel_inverter', 'inverter_battery', 'inverter_meter')),

  -- Convention: product_a is the "host" (inverter), product_b is the "device"
  -- (panel or battery or meter). Engine queries WHERE product_a = $inverter.
  product_a_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_b_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- String voltage range (panel_inverter pairings only)
  string_min      INTEGER,                                       -- min panels in series
  string_max      INTEGER,                                       -- max panels in series
  voltage_range   VARCHAR(40),                                   -- '180-540V' free-form

  -- Verification trail
  verified_by     VARCHAR(120),                                  -- Master Electrician name
  verified_at     DATE,
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compat_pairing_type    ON product_compatibility(pairing_type);
CREATE INDEX IF NOT EXISTS idx_compat_product_a       ON product_compatibility(product_a_id);
CREATE INDEX IF NOT EXISTS idx_compat_product_b       ON product_compatibility(product_b_id);

-- A given pairing should appear at most once per pairing_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_compat_unique_pairing
  ON product_compatibility(pairing_type, product_a_id, product_b_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. CUSTOMER_PROFILES                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- One row per lead. Built by the normaliser service from whichever door the
-- customer entered through (12-bill upload OR Get Quote form). Every
-- downstream service (3-quote engine, proposal generator, sales-exec view,
-- PM Tool lead view) reads from here — never from raw form data or raw bills.
--
-- One lead = one canonical profile. If a lead comes back later and uploads
-- bills, the profile is recomputed in-place (UPDATE), not duplicated.

CREATE TABLE IF NOT EXISTS customer_profiles (
  id                                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Provenance — which door, when normalised, confidence band
  lead_id                             UUID UNIQUE,                                    -- nullable: lead can be in either website_enquiries or projects_v2
  enquiry_id                          UUID REFERENCES website_enquiries(id) ON DELETE SET NULL,
  project_id                          UUID REFERENCES projects_v2(id) ON DELETE SET NULL,
  source_door                         VARCHAR(40) NOT NULL
                                      CHECK (source_door IN ('bill_upload_12', 'bill_upload_partial', 'quote_form', 'manual_entry')),
  confidence_band                     VARCHAR(10) NOT NULL DEFAULT 'medium'
                                      CHECK (confidence_band IN ('high', 'medium', 'low')),

  -- ── Consumption (the foundation) ────────────────────────────────────────
  annual_kwh                          NUMERIC(10,2),                                  -- total yearly consumption
  annual_kwh_source                   VARCHAR(40)
                                      CHECK (annual_kwh_source IN ('measured_from_bills', 'computed_from_spend', 'estimated_from_household_size', NULL)),
  monthly_kwh_profile                 JSONB DEFAULT '[]'::jsonb,                      -- 12-element array [jan_kwh, feb_kwh, ...]
  seasonal_swing_ratio                NUMERIC(4,2),                                   -- high_month / low_month
  seasonality_source                  VARCHAR(20)
                                      CHECK (seasonality_source IN ('measured', 'regional_default', NULL)),

  -- ── Tariff & rate ──────────────────────────────────────────────────────
  current_retailer                    VARCHAR(40),                                    -- 'Mercury'/'Pulse'/'Contact'/'Genesis'/etc
  current_plan                        VARCHAR(80),                                    -- 'Anytime'/'Good Nights'/etc
  effective_rate_per_kwh              NUMERIC(6,4),                                   -- blended cents/kWh
  tou_split_available                 BOOLEAN DEFAULT FALSE,
  peak_pct                            NUMERIC(5,2),                                   -- % of usage at peak
  off_peak_pct                        NUMERIC(5,2),
  annual_spend_nzd                    NUMERIC(10,2),

  -- ── Solar economics inputs ─────────────────────────────────────────────
  self_consumption_pct                NUMERIC(5,2),                                   -- without battery
  self_consumption_with_battery_pct   NUMERIC(5,2),
  self_consumption_confidence         VARCHAR(10)
                                      CHECK (self_consumption_confidence IN ('high', 'medium', 'low', NULL)),
  inferred_load_pattern               VARCHAR(20)
                                      CHECK (inferred_load_pattern IN ('daytime_heavy', 'evening_heavy', 'flat', 'unknown', NULL)),

  -- ── Property ────────────────────────────────────────────────────────────
  address_full                        TEXT,
  street                              VARCHAR(160),
  suburb                              VARCHAR(80),
  city                                VARCHAR(80),
  postcode                            VARCHAR(8),
  region                              VARCHAR(60),                                    -- 'Auckland'/'Wellington'/etc
  sun_hours_daily                     NUMERIC(4,2),
  roof_type                           VARCHAR(40),                                    -- 'tile'/'coloursteel'/'membrane'/'shingles'
  roof_orientation                    VARCHAR(20),
  owns_home                           BOOLEAN,
  floors                              VARCHAR(8),                                     -- '1'/'2'/'3+'

  -- ── Customer signals (drive recommendation) ─────────────────────────────
  household_size                      VARCHAR(10),                                    -- '1-2'/'3-4'/'5+'
  battery_interest                    VARCHAR(20)
                                      CHECK (battery_interest IN ('wants_backup', 'considering', 'not_interested', NULL)),
  ev_intent                           VARCHAR(20)
                                      CHECK (ev_intent IN ('has_ev', 'planning_2yr', 'no_plans', NULL)),
  urgency                             VARCHAR(20),                                    -- 'asap'/'1-3_months'/etc (mirrors enquiry form)
  brand_preference                    VARCHAR(80),                                    -- free text if customer mentioned one
  price_sensitivity                   VARCHAR(10)
                                      CHECK (price_sensitivity IN ('high', 'medium', 'low', NULL)),

  -- ── Bill metrics (only populated for bill-upload doors) ────────────────
  bill_uploads_count                  INTEGER DEFAULT 0,
  highest_month_kwh                   NUMERIC(8,2),
  lowest_month_kwh                    NUMERIC(8,2),
  average_monthly_spend_nzd           NUMERIC(8,2),

  -- ── Metadata ────────────────────────────────────────────────────────────
  normaliser_version                  VARCHAR(20) DEFAULT 'v1',
  normalised_at                       TIMESTAMPTZ DEFAULT NOW(),
  created_at                          TIMESTAMPTZ DEFAULT NOW(),
  updated_at                          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_enquiry_id       ON customer_profiles(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_project_id       ON customer_profiles(project_id);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_source_door      ON customer_profiles(source_door);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_confidence_band  ON customer_profiles(confidence_band);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_region           ON customer_profiles(region);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_postcode         ON customer_profiles(postcode);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customer_profiles_updated_at') THEN
    CREATE TRIGGER trg_customer_profiles_updated_at
      BEFORE UPDATE ON customer_profiles
      FOR EACH ROW EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. QUOTE_RECOMMENDATIONS                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Log of every 3-quote-pack generation. One row per generation event.
-- Two halves: generation-time (filled at creation) and outcome-time
-- (filled later when the lead closes/loses/abandons).
-- This is the feedback loop — query this table to tune scoring weights.

CREATE TABLE IF NOT EXISTS quote_recommendations (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- ── Linking ─────────────────────────────────────────────────────────────
  customer_profile_id             UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  enquiry_id                      UUID REFERENCES website_enquiries(id) ON DELETE SET NULL,
  project_id                      UUID REFERENCES projects_v2(id) ON DELETE SET NULL,

  -- ── Generation side (filled at quote-pack creation) ────────────────────
  generated_at                    TIMESTAMPTZ DEFAULT NOW(),
  profile_snapshot                JSONB,                                              -- frozen copy of normalised profile at gen time

  -- The 3 quotes — stored as JSON snapshots so historic generations stay
  -- intact even if products / suppliers change later.
  -- Shape: { tier:'A'|'B'|'C', system_kw, panel_sku, panel_qty, inverter_sku,
  --          battery_sku?, battery_qty?, bos_skus[], parts_cost, margin_pct,
  --          labour_cost, total_incl_gst }
  quote_a                         JSONB,
  quote_b                         JSONB,
  quote_c                         JSONB,

  -- Scoring (0-100 each)
  quote_a_score                   NUMERIC(5,2),
  quote_b_score                   NUMERIC(5,2),
  quote_c_score                   NUMERIC(5,2),
  -- Breakdown shape: { customer_fit: 82, margin: 15, commitment_priority: 90 }
  quote_a_breakdown               JSONB,
  quote_b_breakdown               JSONB,
  quote_c_breakdown               JSONB,

  recommended_quote               CHAR(1)
                                  CHECK (recommended_quote IN ('A', 'B', 'C', NULL)),
  recommendation_rationale        TEXT,                                               -- human-readable reason for sales exec

  -- Sales exec assignment
  assigned_to_user_id             UUID,                                               -- nullable for now (no users table referenced)

  -- ── Outcome side (filled later as the lead progresses) ─────────────────
  quotes_sent_to_customer         TEXT[],                                             -- e.g., ['B'] or ['A','B']
  override_reason                 TEXT,                                               -- if sales exec didn't send recommended
  outcome_status                  VARCHAR(20)
                                  CHECK (outcome_status IN ('still_open', 'closed_won', 'closed_lost', 'unqualified', NULL)),
  final_quote_chosen              CHAR(1)
                                  CHECK (final_quote_chosen IN ('A', 'B', 'C', NULL)),
  outcome_value_nzd               NUMERIC(12,2),                                      -- sale value if won
  outcome_margin_pct              NUMERIC(5,2),                                       -- actual margin achieved
  outcome_recorded_at             TIMESTAMPTZ,

  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qrec_customer_profile_id ON quote_recommendations(customer_profile_id);
CREATE INDEX IF NOT EXISTS idx_qrec_enquiry_id          ON quote_recommendations(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_qrec_project_id          ON quote_recommendations(project_id);
CREATE INDEX IF NOT EXISTS idx_qrec_outcome_status      ON quote_recommendations(outcome_status);
CREATE INDEX IF NOT EXISTS idx_qrec_recommended_quote   ON quote_recommendations(recommended_quote);
CREATE INDEX IF NOT EXISTS idx_qrec_generated_at        ON quote_recommendations(generated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_quote_recommendations_updated_at') THEN
    CREATE TRIGGER trg_quote_recommendations_updated_at
      BEFORE UPDATE ON quote_recommendations
      FOR EACH ROW EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. REGION_DEFAULTS                                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- NZ regions with sun hours, average household consumption, typical
-- self-consumption %. Used by the normaliser for Door B (form-only)
-- customers who lack measured data. Owner-editable via admin / workbook.

CREATE TABLE IF NOT EXISTS region_defaults (
  id                                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  region_name                                 VARCHAR(60) UNIQUE NOT NULL,            -- 'Auckland', 'Wellington'
  postcode_prefix                             VARCHAR(40),                            -- '0xxx-1xxx' free-form

  sun_hours_daily                             NUMERIC(4,2) NOT NULL,
  avg_household_kwh_yearly                    INTEGER,
  avg_monthly_bill_nzd                        NUMERIC(8,2),
  typical_self_consumption_pct                NUMERIC(5,2),
  with_battery_self_consumption_pct           NUMERIC(5,2),
  irradiance_kwh_m2_yearly                    INTEGER,

  notes                                       TEXT,
  is_active                                   BOOLEAN DEFAULT TRUE,
  created_at                                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_region_defaults_is_active ON region_defaults(is_active);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_region_defaults_updated_at') THEN
    CREATE TRIGGER trg_region_defaults_updated_at
      BEFORE UPDATE ON region_defaults
      FOR EACH ROW EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 7. COST_DEFAULTS                                                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Install labour, permits, scaffolding, CoC fees — the costs added on top of
-- BOM parts to produce the customer-facing "From price". Owner-editable.
--
-- Each row is one cost component. `unit` defines how it scales:
--   'fixed'      — added once per install
--   'per_kw'     — multiplied by system_kw
--   'per_panel'  — multiplied by panel count
--   'per_floor'  — multiplied by floor count (≥2 typically)
--
-- `applies_to` controls when the cost is added:
--   'all'             — every install
--   'residential'     — residential only
--   'commercial'      — commercial only
--   'battery_only'    — only if quote includes a battery
--   'multi_floor_only'— only if floors ≥ 2

CREATE TABLE IF NOT EXISTS cost_defaults (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  cost_type       VARCHAR(80) NOT NULL,                                                -- 'Install labour — base'
  cost_nzd        NUMERIC(10,2) NOT NULL,
  unit            VARCHAR(20) NOT NULL
                  CHECK (unit IN ('fixed', 'per_kw', 'per_panel', 'per_floor')),
  applies_to      VARCHAR(40) DEFAULT 'all'
                  CHECK (applies_to IN ('all', 'residential', 'commercial', 'battery_only', 'multi_floor_only')),

  sort_order      INTEGER DEFAULT 0,
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_defaults_is_active  ON cost_defaults(is_active);
CREATE INDEX IF NOT EXISTS idx_cost_defaults_applies_to ON cost_defaults(applies_to);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cost_defaults_updated_at') THEN
    CREATE TRIGGER trg_cost_defaults_updated_at
      BEFORE UPDATE ON cost_defaults
      FOR EACH ROW EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- Migration 019 complete. All tables empty by design — the workbook importer
-- in Phase 1.2 will seed them from owner-filled real supplier data.
-- ────────────────────────────────────────────────────────────────────────────
