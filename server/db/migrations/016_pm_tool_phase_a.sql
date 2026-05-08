-- ────────────────────────────────────────────────────────────────────────────
-- PM Tool — Phase A schema
--
-- A parallel project-management model that lives ALONGSIDE the existing
-- `projects` table without touching it. The existing portal keeps using
-- `projects` (stage enum, stage_progress JSONB). The new /pm tool reads/
-- writes here exclusively. If the experiment fails we drop these tables —
-- the existing app is unaffected.
--
-- Three structural shifts vs the old model:
--
--   1. Project-first navigation. No customer parent. Every install is its
--      own row in projects_v2. A repeat customer = same contact_id, new
--      projects_v2 row.
--
--   2. Five parallel swim-lanes (sales/engineering/compliance/operations/
--      finance) replace the linear `stage` enum. Each lane has its own
--      status; project health is a rollup. Stored as JSONB so the
--      checklist content can evolve without migrations.
--
--   3. Assets live ON the project, not in a separate table. After
--      `commissioned_at` is set, the same row carries serial numbers,
--      warranty windows, performance cache, and VPP-readiness fields.
--      Pre-commission those columns are NULL.
--
-- VPP-readiness is captured from day one even though the VPP product
-- launches in ~12 months — by then we'll already have a year of clean
-- asset data ready for enrollment queries.
--
-- Tables:
--   projects_v2                 — the central object
--   project_assignments         — RBAC scope (which staff touch which project)
--   project_artifacts           — gate-keeper documents (metadata; files in Storage)
--   project_payments            — deposit / progress / final / refund events
--   project_hardware            — installed components with serial numbers
--   project_maintenance_events  — post-commission service history
--   project_ppa_contracts       — long-term billing contracts (VPP-ready)
--   project_notifications       — emails/SMS sent to the customer (audit)
-- ────────────────────────────────────────────────────────────────────────────


-- ── projects_v2 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects_v2 (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Human-friendly identifier shown on cards/links. Format: PMv2-YYYY-NNNN
  code                  VARCHAR(40) UNIQUE,

  -- Customer linkage (read-only — never modifies contacts table)
  contact_id            UUID REFERENCES contacts(id) ON DELETE SET NULL,
  bill_analysis_id      UUID REFERENCES bill_analyses(id) ON DELETE SET NULL,

  -- Address (denormalised so projects survive contact edits)
  address               TEXT,
  suburb                VARCHAR(80),
  city                  VARCHAR(80),
  region                VARCHAR(60),
  postcode              VARCHAR(10),
  gps_lat               NUMERIC(9,6),
  gps_lng               NUMERIC(9,6),

  -- Project type drives which checklist items appear in each lane
  project_type          VARCHAR(30) NOT NULL DEFAULT 'residential_rooftop'
                          CHECK (project_type IN (
                            'residential_rooftop',
                            'commercial',
                            'ground_mount',
                            'battery_addon',
                            'system_upgrade'
                          )),

  -- Headline system specs (set during Engineering lane)
  system_size_kw        NUMERIC(6,2),
  battery_kwh           NUMERIC(6,2),
  panel_count           INTEGER,
  system_type           VARCHAR(30) DEFAULT 'on-grid'  -- on-grid | off-grid | hybrid
                          CHECK (system_type IN ('on-grid','off-grid','hybrid')),
  estimated_value_nzd   NUMERIC(12,2),

  -- Five-lane status block. Keys: sales | engineering | compliance | operations | finance.
  -- Each value: { status: 'not_started'|'in_progress'|'blocked'|'done',
  --               started_at, completed_at, blocked_reason, owner_id, items: { item_key: bool|... } }
  -- Defaulted to all-not_started — population happens via API on create.
  lane_status           JSONB NOT NULL DEFAULT '{
    "sales":       {"status":"not_started","items":{}},
    "engineering": {"status":"not_started","items":{}},
    "compliance":  {"status":"not_started","items":{}},
    "operations":  {"status":"not_started","items":{}},
    "finance":     {"status":"not_started","items":{}}
  }'::jsonb,

  -- Health rollup, computed by the API on every write
  -- 'green'  = all lanes on track
  -- 'amber'  = one lane behind SLA but not blocked
  -- 'red'    = SLA breach
  -- 'blocked'= a lane has status='blocked'
  health                VARCHAR(10) DEFAULT 'green'
                          CHECK (health IN ('green','amber','red','blocked')),

  -- Lifecycle status of the project itself (separate from lane statuses)
  status                VARCHAR(20) NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','on_hold','cancelled','completed')),
  cancel_reason         TEXT,

  -- The big gate: when this is set, the project transitions from
  -- "install motion" to "operating asset". All five lanes must be done.
  commissioned_at       TIMESTAMPTZ,

  -- Ownership (lead person on this deal). Per-lane owners live in lane_status.
  primary_owner_id      UUID,  -- FK to staff/users — soft FK to avoid coupling

  -- ── Asset / post-commission fields (NULL until commissioned_at is set) ──

  -- Hardware identity (one inverter / one battery / one panel model is the
  -- common case — multi-component installs use project_hardware too)
  inverter_make         VARCHAR(60),
  inverter_model        VARCHAR(120),
  inverter_serial       VARCHAR(80),
  battery_make          VARCHAR(60),
  battery_model         VARCHAR(120),
  battery_serial        VARCHAR(80),
  panel_make            VARCHAR(60),
  panel_model           VARCHAR(120),

  -- Warranty windows (set at commissioning from manufacturer + workmanship terms)
  panel_warranty_until         DATE,
  inverter_warranty_until      DATE,
  battery_warranty_until       DATE,
  workmanship_warranty_until   DATE,

  -- Performance cache (refreshed by monitoring poll job; not authoritative —
  -- always treat the monitoring API as the source of truth)
  monitoring_provider          VARCHAR(40),  -- fronius | sungrow | tesla | solaredge | enphase
  monitoring_external_id       VARCHAR(120), -- their site/system ID
  lifetime_kwh                 NUMERIC(12,2),
  last_30d_kwh                 NUMERIC(10,2),
  last_health_check_at         TIMESTAMPTZ,

  -- ── VPP-readiness (captured day 1, used in ~12 months) ────────────────
  vpp_capable_hardware  BOOLEAN DEFAULT false,  -- derived from inverter/battery model lookup
  vpp_consented         BOOLEAN DEFAULT false,  -- customer has agreed to be approached
  vpp_enrolled          BOOLEAN DEFAULT false,  -- actively in fleet
  vpp_enrolled_at       TIMESTAMPTZ,
  vpp_aggregator        VARCHAR(60),            -- 'goldenray' | partner name
  vpp_paused_until      TIMESTAMPTZ,            -- customer can pause (e.g., away)

  -- Public share token for the customer-facing magic-link viewer
  share_token           UUID DEFAULT uuid_generate_v4() UNIQUE,

  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  created_by            UUID  -- soft FK to staff/users
);

-- Auto-generate a code on insert if not supplied. Format: PMv2-YYYY-####
CREATE OR REPLACE FUNCTION pm_v2_generate_code() RETURNS TRIGGER AS $$
DECLARE
  yr   TEXT := to_char(NOW(), 'YYYY');
  seq  INT;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '^PMv2-\d{4}-', ''), '')::INT), 0) + 1
      INTO seq
      FROM projects_v2
      WHERE code LIKE 'PMv2-' || yr || '-%';
    NEW.code := 'PMv2-' || yr || '-' || LPAD(seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pm_v2_code') THEN
    CREATE TRIGGER trg_pm_v2_code
      BEFORE INSERT ON projects_v2
      FOR EACH ROW
      EXECUTE FUNCTION pm_v2_generate_code();
  END IF;
END $$;

-- updated_at trigger reuses existing update_modified_column() function from base schema
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_projects_v2_updated_at') THEN
    CREATE TRIGGER trg_projects_v2_updated_at
      BEFORE UPDATE ON projects_v2
      FOR EACH ROW
      EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pv2_contact         ON projects_v2(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pv2_status          ON projects_v2(status);
CREATE INDEX IF NOT EXISTS idx_pv2_health          ON projects_v2(health);
CREATE INDEX IF NOT EXISTS idx_pv2_type            ON projects_v2(project_type);
CREATE INDEX IF NOT EXISTS idx_pv2_owner           ON projects_v2(primary_owner_id) WHERE primary_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pv2_commissioned    ON projects_v2(commissioned_at) WHERE commissioned_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pv2_vpp_eligible    ON projects_v2(vpp_capable_hardware, vpp_consented, vpp_enrolled);
CREATE INDEX IF NOT EXISTS idx_pv2_share_token     ON projects_v2(share_token);
CREATE INDEX IF NOT EXISTS idx_pv2_created         ON projects_v2(created_at DESC);


-- ── project_assignments ─────────────────────────────────────────────────────
-- Per-project staff scope. A user can access a project if:
--   (a) they have role=admin/owner globally, OR
--   (b) they have an active row here, OR
--   (c) they are the customer (contact_id matches their user record)
CREATE TABLE IF NOT EXISTS project_assignments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id        UUID NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL,  -- soft FK to staff/users
  role_in_project   VARCHAR(30) NOT NULL
                      CHECK (role_in_project IN (
                        'project_lead',
                        'sales',
                        'engineer',
                        'electrician',
                        'installer',
                        'accounts',
                        'subcontractor'
                      )),
  assigned_at       TIMESTAMPTZ DEFAULT NOW(),
  removed_at        TIMESTAMPTZ,  -- soft delete — keep audit trail
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_pv2_assign_project ON project_assignments(project_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pv2_assign_user    ON project_assignments(user_id)    WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pv2_assign_active
  ON project_assignments(project_id, user_id, role_in_project)
  WHERE removed_at IS NULL;


-- ── project_artifacts ───────────────────────────────────────────────────────
-- Files that gate lane progression. Metadata only — the actual PDF/photo
-- lives in Supabase Storage at:
--   goldenray-projects-v2/{project_id}/{swim_lane}/{filename}
CREATE TABLE IF NOT EXISTS project_artifacts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id        UUID NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  swim_lane         VARCHAR(20) NOT NULL
                      CHECK (swim_lane IN ('sales','engineering','compliance','operations','finance')),
  artifact_type     VARCHAR(60) NOT NULL,    -- e.g. 'site_survey_report', 'sld_pdf', 'coc_pdf', 'commissioning_form'
  file_url          TEXT,                    -- Supabase Storage URL (or external for embedded artifacts)
  file_hash         VARCHAR(64),             -- sha256 — dedupe + tamper-detect
  file_size_bytes   BIGINT,
  mime_type         VARCHAR(80),
  uploaded_by       UUID,                    -- soft FK to staff/users
  uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
  verified_by       UUID,                    -- who signed off (e.g., COC certifier)
  verified_at       TIMESTAMPTZ,
  is_required       BOOLEAN DEFAULT false,   -- gate-keeper flag
  replaces_id       UUID REFERENCES project_artifacts(id) ON DELETE SET NULL,  -- versioning chain
  metadata          JSONB DEFAULT '{}'::jsonb -- artifact-specific structured data
);

CREATE INDEX IF NOT EXISTS idx_pv2_artifacts_project ON project_artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_pv2_artifacts_lane    ON project_artifacts(project_id, swim_lane);
CREATE INDEX IF NOT EXISTS idx_pv2_artifacts_type    ON project_artifacts(project_id, artifact_type);


-- ── project_payments ────────────────────────────────────────────────────────
-- One-off payment events tied to project install (deposit / progress / final).
-- Recurring PPA billing lives in project_ppa_contracts instead.
CREATE TABLE IF NOT EXISTS project_payments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id        UUID NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  event             VARCHAR(20) NOT NULL
                      CHECK (event IN ('deposit','progress','final','refund','adjustment')),
  expected_at       DATE,
  expected_amount_nzd NUMERIC(12,2),
  received_at       TIMESTAMPTZ,
  received_amount_nzd NUMERIC(12,2),
  method            VARCHAR(30),  -- bank_transfer | card | cash | finance_disbursement | other
  invoice_ref       VARCHAR(80),  -- your accounting system's invoice number
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv2_payments_project ON project_payments(project_id);
CREATE INDEX IF NOT EXISTS idx_pv2_payments_event   ON project_payments(project_id, event);


-- ── project_hardware ────────────────────────────────────────────────────────
-- Component-level inventory. Used when a project has multiple inverters or
-- batteries, or for tracking individual panel batches. The headline single
-- inverter/battery/panel-model also lives on projects_v2 for fast rendering.
CREATE TABLE IF NOT EXISTS project_hardware (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id        UUID NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  component_type    VARCHAR(30) NOT NULL
                      CHECK (component_type IN (
                        'panel','inverter','battery','optimiser','meter','ev_charger',
                        'mounting_kit','isolator','monitoring_gateway','other'
                      )),
  manufacturer      VARCHAR(60),
  model             VARCHAR(120),
  serial_number     VARCHAR(120),
  quantity          INTEGER DEFAULT 1,
  installed_at      TIMESTAMPTZ,
  warranty_until    DATE,
  notes             TEXT,
  metadata          JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv2_hw_project ON project_hardware(project_id);
CREATE INDEX IF NOT EXISTS idx_pv2_hw_type    ON project_hardware(project_id, component_type);
CREATE INDEX IF NOT EXISTS idx_pv2_hw_serial  ON project_hardware(serial_number) WHERE serial_number IS NOT NULL;


-- ── project_maintenance_events ──────────────────────────────────────────────
-- Post-commission service history: 6-month checks, faults, firmware updates,
-- panel cleans, warranty claims.
CREATE TABLE IF NOT EXISTS project_maintenance_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id        UUID NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  event_type        VARCHAR(40) NOT NULL,    -- scheduled_check | fault | firmware_update | panel_clean | warranty_claim | other
  triggered_by      VARCHAR(20),             -- alert | customer | scheduled | proactive
  task_id           UUID,                    -- soft FK to existing tasks table
  scheduled_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  outcome           TEXT,
  cost_nzd          NUMERIC(10,2),
  parts_replaced    JSONB DEFAULT '[]'::jsonb,  -- array of { component_type, manufacturer, model, qty }
  notes             TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv2_maint_project ON project_maintenance_events(project_id);
CREATE INDEX IF NOT EXISTS idx_pv2_maint_type    ON project_maintenance_events(project_id, event_type);


-- ── project_ppa_contracts ───────────────────────────────────────────────────
-- One PPA contract per project (1:1, optional). Holds the long-term billing
-- relationship for customers on a Power Purchase Agreement instead of cash/loan.
-- Recurring invoices generated against this row by a scheduled job (later phase).
CREATE TABLE IF NOT EXISTS project_ppa_contracts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id        UUID NOT NULL UNIQUE REFERENCES projects_v2(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  start_date        DATE,
  end_date          DATE,
  rate_nzd_per_kwh  NUMERIC(8,4),
  escalation_pct_pa NUMERIC(5,2),                 -- annual escalator
  buyout_schedule   JSONB DEFAULT '[]'::jsonb,    -- array of { year, buyout_amount_nzd }
  billing_frequency VARCHAR(20) DEFAULT 'monthly',
  status            VARCHAR(20) DEFAULT 'draft'
                      CHECK (status IN ('draft','active','paused','in_default','bought_out','expired','cancelled')),
  signed_at         TIMESTAMPTZ,
  signed_pdf_url    TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pv2_ppa_updated_at') THEN
    CREATE TRIGGER trg_pv2_ppa_updated_at
      BEFORE UPDATE ON project_ppa_contracts
      FOR EACH ROW
      EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pv2_ppa_status ON project_ppa_contracts(status);


-- ── project_notifications ───────────────────────────────────────────────────
-- Audit log of every customer-facing email/SMS sent. Used by the customer
-- portal to show their communication history and to prevent double-sends.
CREATE TABLE IF NOT EXISTS project_notifications (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id        UUID NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  channel           VARCHAR(20) NOT NULL CHECK (channel IN ('email','sms','in_portal')),
  template_key      VARCHAR(80) NOT NULL,    -- e.g., 'milestone_design_ready'
  subject           TEXT,
  body_excerpt      TEXT,
  recipient         TEXT,
  sent_at           TIMESTAMPTZ DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ,
  opened_at         TIMESTAMPTZ,
  clicked_at        TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pv2_notif_project ON project_notifications(project_id);
CREATE INDEX IF NOT EXISTS idx_pv2_notif_template ON project_notifications(project_id, template_key);
