-- ────────────────────────────────────────────────────────────────────────────
-- MVP1_001 — Proposal Generator (temporary tool until full MVP-1 ships)
--
-- Adds a thin proposal-generation layer ON TOP OF the existing PM Tool. Sales
-- reps create + edit + generate customer proposals inside /pm without
-- Rajeshwar's intervention. Engine produces:
--   - customer-facing PDF (21-page Krishna-style layout)
--   - internal sales one-pager (cost / margin / profit)
-- Both stored in Supabase Storage; metadata captured here.
--
-- DESIGN RULES (mirrors the live PM Tool philosophy):
--
--   1. Lives ALONGSIDE projects_v2 — never touches it directly. A quote
--      can exist before a project (sales rep drafts pre-survey) and gets
--      linked to projects_v2.id when the customer signs + deposit lands.
--
--   2. Version history is first-class. Every spec revision creates a new
--      quote_versions row. The previous version is preserved (is_current
--      flips to false). This is how Stage 1 → Stage 2 + revisions audit-
--      trail without trashing previous state.
--
--   3. Pricing snapshot is JSONB on quote_versions. Catalogue costs +
--      margins + GST + applied discount are frozen at generation time.
--      Re-running engine on same spec + same snapshot → byte-identical
--      PDF. This is what kills the Krishna-class drift problem.
--
--   4. Engineering validator output stored as JSONB. Passes / hard_fails /
--      soft_warnings / unverified — all captured. Quote cannot transition
--      to "sent" if any hard_fails present (enforced in API layer).
--
--   5. Discount approvals are admin-only. Sales rep submits a request +
--      reason; admin (single role) approves / modifies / rejects. Decision
--      audit-logged. Project margin floor (10%) enforced in API layer
--      before approval can be applied.
--
--   6. Audit log is append-only. Every action (spec change, generation,
--      email, signature, deposit) becomes a row. No updates, no deletes.
--
--   7. RLS: all authenticated PM users can SELECT quote data (existing PM
--      Tool pattern — permission boundaries enforced in API). Writes go
--      through the service-role backend which enforces business logic.
--
-- Tables:
--   quotes              — one row per customer engagement (lifecycle state)
--   quote_versions      — every spec revision (immutable once generated)
--   quote_audit_log     — append-only action trail
--   discount_approvals  — below-floor discount requests (admin approves)
--   quote_email_log     — every email sent to customer (Resend message_id)
--   quote_run_log       — every PDF generation attempt (duration, validity)
--
-- Rollback: DROP TABLE quote_run_log, quote_email_log, discount_approvals,
-- quote_audit_log, quote_versions, quotes CASCADE.
-- ────────────────────────────────────────────────────────────────────────────


-- ── quotes ──────────────────────────────────────────────────────────────────
-- One row per customer engagement. Status drives the workflow state machine.
-- Multiple version revisions tracked via quote_versions; current_version_id
-- points at the row whose is_current = true.
CREATE TABLE IF NOT EXISTS quotes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Human-friendly reference. Format: PR-{SURNAME}-{YYYY}-{NNN}
  -- Generated server-side from CUSTOMER.name + current year + per-customer
  -- sequence number. Matches Krishna's existing reference (PR-KRISHNA-2026-001).
  quote_ref             VARCHAR(40) UNIQUE NOT NULL,

  -- Project link is OPTIONAL. Sales rep can draft a quote against a contact
  -- before the project_v2 row exists. When the customer signs + deposit
  -- received, the API layer creates / links a projects_v2 row and writes
  -- back here.
  project_id            UUID REFERENCES projects_v2(id) ON DELETE SET NULL,

  -- Customer linkage (required). Sales rep can't draft a quote without a
  -- contact in the system.
  contact_id            UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- Optional bill analysis. Quote can reference parsed bill data for the
  -- financial model. Set NULL on draft-without-bills cases (manual entry).
  bill_analysis_id      UUID REFERENCES bill_analyses(id) ON DELETE SET NULL,

  -- Lifecycle state machine.
  status                VARCHAR(40) NOT NULL DEFAULT 'draft'
                          CHECK (status IN (
                            'draft',
                            'pending_owner_review',     -- discount needs admin approval
                            'ready_to_generate',         -- approval received, ready to PDF
                            'generated',                 -- PDF rendered, not yet sent
                            'sent_to_customer',          -- email + PDF dispatched
                            'signed',                    -- customer signed PDF returned
                            'counter_signed',            -- Goldenray counter-signed
                            'deposit_received',          -- bank transfer confirmed
                            'handed_off',                -- moved into PM Tool install flow
                            'expired',                   -- validity window passed
                            'withdrawn',                 -- sales rep cancelled
                            'closed_lost'                -- customer declined
                          )),

  -- Stage 1 (estimate, subject to site survey) vs Stage 2 (firm).
  stage                 VARCHAR(20) NOT NULL DEFAULT 'stage_1_estimate'
                          CHECK (stage IN ('stage_1_estimate', 'stage_2_firm')),

  -- FINAL_MODE: when true, customer PDF hides any applied discount.
  -- When false (Stage 1 mode), discount shown as "−$X" line item.
  final_mode            BOOLEAN NOT NULL DEFAULT TRUE,

  -- Points at the currently-active version row (one per quote).
  -- Set after first quote_versions row is inserted (chicken-and-egg solved
  -- via deferred FK constraint below).
  current_version_id    UUID,

  -- Cached version number for quick UI display (matches the version row).
  current_version_number INT NOT NULL DEFAULT 1,

  -- Reason captured when status moves to closed_lost. Structured code
  -- (price / scope / timing / competitor / financing / site_issues / ghosted
  -- / other) + free-text notes.
  closed_lost_reason_code  VARCHAR(30),
  closed_lost_reason_notes TEXT,

  -- Validity window. Default 14 days from sent_to_customer.
  valid_until           TIMESTAMPTZ,

  -- Sales rep this quote belongs to. Used for filtering "my quotes" view
  -- and routing notifications.
  assigned_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quotes_contact_id_idx        ON quotes (contact_id);
CREATE INDEX IF NOT EXISTS quotes_project_id_idx        ON quotes (project_id);
CREATE INDEX IF NOT EXISTS quotes_assigned_user_id_idx  ON quotes (assigned_user_id);
CREATE INDEX IF NOT EXISTS quotes_status_idx            ON quotes (status);
CREATE INDEX IF NOT EXISTS quotes_created_at_idx        ON quotes (created_at DESC);

COMMENT ON TABLE quotes IS
  'Customer engagement record. One per customer engagement. Lifecycle states drive UI workflow. Spec versions tracked separately in quote_versions.';


-- ── quote_versions ──────────────────────────────────────────────────────────
-- Every spec revision creates a new row. Older rows preserved with
-- is_current = false. Engine outputs (PDFs + validator + financial model)
-- attached to the version that produced them.
CREATE TABLE IF NOT EXISTS quote_versions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  quote_id              UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

  -- Sequential per-quote: v1, v2, v3...
  version_number        INT NOT NULL,

  -- The customer spec. 6-section JSON (customer / bills / system /
  -- pricing / preferences / site_survey). Schema validated in API layer
  -- against the proposal-engine config-validator before save.
  spec                  JSONB NOT NULL,

  -- Frozen at generation time: every line item's cost + margin + qty + GST
  -- + applied discount. This is what backs the customer's quoted price for
  -- the validity window. Catalogue cost changes don't affect this snapshot.
  -- NULL until quote is generated.
  pricing_snapshot      JSONB,

  -- Engineering validator output: { passes[], hard_fails[], soft_warnings[],
  -- unverified[], standards_referenced[], validator_version }. NULL until
  -- validate run.
  validator_output      JSONB,

  -- Financial model output: { yr1_*, monthly_breakdown[12], yearly_cashflow[30],
  -- payback_inflation_degradation_yrs, lifetime_net_savings, model_version }.
  -- NULL until generate run.
  financial_model_output JSONB,

  -- Supabase Storage paths. NULL until generated.
  customer_pdf_storage_path        TEXT,
  customer_pdf_size_bytes          INT,
  customer_pdf_sha256              VARCHAR(64),

  internal_onepager_pdf_storage_path TEXT,
  internal_onepager_pdf_size_bytes   INT,
  internal_onepager_pdf_sha256       VARCHAR(64),

  -- Version tags captured at generation time for reproducibility.
  engine_version            VARCHAR(20),  -- semver of proposal-engine library
  warranty_terms_version    VARCHAR(20),  -- date snapshot (e.g. '2026-06-01')
  catalogue_version         VARCHAR(20),  -- date snapshot of products catalogue
  standards_version_json    JSONB,        -- { 'AS/NZS 4777.2': '2020', ... }

  -- Generation metadata.
  generated_at              TIMESTAMPTZ,
  generated_by              UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Exactly one row per quote_id has is_current = true (enforced via
  -- partial unique index below).
  is_current                BOOLEAN NOT NULL DEFAULT FALSE,

  -- Set when a newer version is created.
  superseded_at             TIMESTAMPTZ,
  superseded_by_version_id  UUID REFERENCES quote_versions(id) ON DELETE SET NULL,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (quote_id, version_number)
);

CREATE INDEX IF NOT EXISTS quote_versions_quote_id_idx   ON quote_versions (quote_id);
CREATE INDEX IF NOT EXISTS quote_versions_generated_at_idx ON quote_versions (generated_at DESC);

-- Exactly one current version per quote. Partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS quote_versions_current_unique
  ON quote_versions (quote_id) WHERE is_current = TRUE;

COMMENT ON TABLE quote_versions IS
  'Spec revisions for a quote. Append-only after generation: older versions preserved with is_current = false. Pricing snapshot + validator output stored per version for reproducibility.';

-- Resolve chicken-and-egg FK from quotes.current_version_id → quote_versions.id.
-- (Cannot be declared inline on CREATE TABLE because quote_versions didn't
-- exist yet at that point.)
ALTER TABLE quotes
  ADD CONSTRAINT quotes_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES quote_versions(id) ON DELETE SET NULL;


-- ── quote_audit_log ─────────────────────────────────────────────────────────
-- Every action on a quote. Append-only. No updates, no deletes.
-- Customer can request own subset via Privacy Act data export workflow.
CREATE TABLE IF NOT EXISTS quote_audit_log (
  id                BIGSERIAL PRIMARY KEY,

  quote_id          UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

  -- Optional pointer to the version that was affected (e.g. spec.changed
  -- carries the new version_id).
  version_id        UUID REFERENCES quote_versions(id) ON DELETE SET NULL,

  -- Who did this. NULL when the system did it (e.g. expiry sweep).
  actor_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role        VARCHAR(30),   -- snapshot of role at action time

  -- Structured action identifier. Examples:
  --   quote.created · spec.changed · validate.run · discount.requested
  --   discount.approved · discount.rejected · pdf.generated · email.sent
  --   customer.signed · counter_signed · deposit.received · handoff.to_pm
  --   closed_lost.marked · expired.auto · withdrawn
  action            VARCHAR(80) NOT NULL,

  -- Optional state snapshots for diff-after.
  before            JSONB,
  after             JSONB,

  -- Free-form context (IP, user-agent, reason text, etc.)
  metadata          JSONB,

  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quote_audit_log_quote_id_idx
  ON quote_audit_log (quote_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS quote_audit_log_actor_idx
  ON quote_audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS quote_audit_log_action_idx
  ON quote_audit_log (action);

COMMENT ON TABLE quote_audit_log IS
  'Append-only audit trail of every action on a quote. Indefinite retention. Customer can request own subset via Privacy Act data export.';


-- ── discount_approvals ──────────────────────────────────────────────────────
-- Sales rep requests a discount that would push project margin below 10%
-- floor. Admin reviews + approves / modifies / rejects. Reason captured at
-- both ends.
CREATE TABLE IF NOT EXISTS discount_approvals (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  quote_id              UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_id            UUID NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,

  -- Sales rep who raised the request.
  requested_by          UUID NOT NULL REFERENCES users(id),
  requested_amount_nzd  NUMERIC(10,2) NOT NULL,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Mandatory free-text reason. Audited.
  reason                TEXT NOT NULL,

  -- For owner audit: what would project margin be at the requested discount?
  requested_margin_pct  NUMERIC(5,2),

  -- Decision lifecycle.
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending',
                            'approved',          -- admin OK'd as requested
                            'approved_modified', -- admin OK'd at a different $ amount
                            'rejected',
                            'withdrawn'          -- sales rep cancelled before decision
                          )),

  -- Admin who decided (admin role only). NULL if pending.
  decided_by            UUID REFERENCES users(id),
  decided_amount_nzd    NUMERIC(10,2),         -- may differ from requested if modified
  decided_margin_pct    NUMERIC(5,2),
  decision_notes        TEXT,
  decided_at            TIMESTAMPTZ,

  -- Discount expires when quote expires. Null = never expires (rare).
  expires_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS discount_approvals_quote_id_idx
  ON discount_approvals (quote_id);
CREATE INDEX IF NOT EXISTS discount_approvals_pending_idx
  ON discount_approvals (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS discount_approvals_requested_by_idx
  ON discount_approvals (requested_by, requested_at DESC);

COMMENT ON TABLE discount_approvals IS
  'Below-floor (< 10% project margin) discount requests. Sales rep raises, admin role only approves/rejects. Reason and decision both audit-logged.';


-- ── quote_email_log ─────────────────────────────────────────────────────────
-- Every email about a quote that goes to the customer. Stored with Resend
-- message_id for delivery + open tracking.
CREATE TABLE IF NOT EXISTS quote_email_log (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  quote_id              UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_id            UUID REFERENCES quote_versions(id) ON DELETE SET NULL,

  sent_by               UUID REFERENCES users(id) ON DELETE SET NULL,

  sent_to_email         TEXT NOT NULL,
  cc_emails             TEXT[],
  bcc_emails            TEXT[],

  subject               TEXT NOT NULL,
  body_preview          TEXT,                       -- first 500 chars for audit
  attachment_storage_paths TEXT[],                  -- Supabase Storage paths

  -- Resend-specific.
  resend_message_id     VARCHAR(80),

  send_status           VARCHAR(20) NOT NULL DEFAULT 'sent'
                          CHECK (send_status IN (
                            'sent',
                            'delivered',
                            'opened',
                            'bounced',
                            'failed'
                          )),
  send_error            TEXT,

  sent_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at          TIMESTAMPTZ,
  opened_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS quote_email_log_quote_id_idx
  ON quote_email_log (quote_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS quote_email_log_resend_id_idx
  ON quote_email_log (resend_message_id);

COMMENT ON TABLE quote_email_log IS
  'Every email to customer about a quote. Resend message_id stored for delivery + open tracking. Indefinite retention.';


-- ── quote_run_log ───────────────────────────────────────────────────────────
-- Every PDF generation attempt. Captures duration + validation status +
-- output hashes for reproducibility audit.
CREATE TABLE IF NOT EXISTS quote_run_log (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  quote_id              UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_id            UUID NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,

  ran_by                UUID NOT NULL REFERENCES users(id),
  ran_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Performance metric. 60s SLA is soft (warning only — see §9.1.3 rules).
  duration_ms           INT,

  -- SHA256 of the spec JSON at run time. Used to confirm reproducibility:
  -- same hash + same engine version = identical output.
  spec_sha256           VARCHAR(64),
  catalogue_version     VARCHAR(20),
  engine_version        VARCHAR(20),

  -- Validator outcome.
  validation_status     VARCHAR(30) NOT NULL
                          CHECK (validation_status IN (
                            'passed',
                            'passed_with_soft_warnings',
                            'blocked',           -- hard_fails present
                            'failed_error'       -- engine threw exception
                          )),

  -- Output metadata (file paths, sizes, hashes). NULL if validation_status
  -- != 'passed' or 'passed_with_soft_warnings'.
  outputs               JSONB,

  -- Error context if status = failed_error.
  error_message         TEXT,
  error_stack           TEXT
);

CREATE INDEX IF NOT EXISTS quote_run_log_quote_id_idx
  ON quote_run_log (quote_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS quote_run_log_status_idx
  ON quote_run_log (validation_status, ran_at DESC);

COMMENT ON TABLE quote_run_log IS
  'Every PDF generation attempt. spec_sha256 + engine_version enable reproducibility audit. Validation outcome captured for compliance evidence.';


-- ── updated_at trigger for quotes ───────────────────────────────────────────
-- Reuse existing PM Tool pattern: update timestamp whenever row changes.
CREATE OR REPLACE FUNCTION quotes_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotes_updated_at_trigger ON quotes;
CREATE TRIGGER quotes_updated_at_trigger
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION quotes_update_timestamp();


-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Mirror existing PM Tool pattern: all authenticated users can SELECT;
-- writes go through service-role backend (API layer enforces business
-- logic + role checks). RLS prevents direct anon access via Supabase
-- client SDK.
ALTER TABLE quotes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_audit_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_approvals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_email_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_run_log       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotes_select_authenticated ON quotes;
CREATE POLICY quotes_select_authenticated ON quotes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS quote_versions_select_authenticated ON quote_versions;
CREATE POLICY quote_versions_select_authenticated ON quote_versions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS quote_audit_log_select_authenticated ON quote_audit_log;
CREATE POLICY quote_audit_log_select_authenticated ON quote_audit_log
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS discount_approvals_select_authenticated ON discount_approvals;
CREATE POLICY discount_approvals_select_authenticated ON discount_approvals
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS quote_email_log_select_authenticated ON quote_email_log;
CREATE POLICY quote_email_log_select_authenticated ON quote_email_log
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS quote_run_log_select_authenticated ON quote_run_log;
CREATE POLICY quote_run_log_select_authenticated ON quote_run_log
  FOR SELECT TO authenticated USING (true);

-- INSERT / UPDATE / DELETE policies are intentionally absent. All writes
-- must go through the service-role backend so business rules (role checks,
-- margin floor, validator output, audit log writes) are enforced consistently.
