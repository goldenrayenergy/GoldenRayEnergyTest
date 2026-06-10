-- ────────────────────────────────────────────────────────────────────────────
-- MVP1_002 — Quote lifecycle fields (signing, counter-signing, deposit, dry-run)
--
-- Adds the columns Day-5 routes write to but MVP1_001 didn't include:
--   quote_versions: signed_pdf_*, counter_signed_pdf_*, signed_at, signer_name,
--                   counter_signed_at, counter_signed_by, counter_signer_name
--   quotes:         deposit_amount_nzd, deposit_reference, deposit_received_at
--   quote_email_log: dry_run flag (so dev/preview sends don't clutter delivery stats)
--   quote_run_log:   run_kind (generate / regenerate / validate-only) for filtering
--
-- All ADDs use IF NOT EXISTS so re-runs are safe.
-- Rollback: ALTER TABLE … DROP COLUMN … (see bottom of file).
-- ────────────────────────────────────────────────────────────────────────────

-- ── quote_versions: signature & counter-signature ─────────────────────────
ALTER TABLE quote_versions
  ADD COLUMN IF NOT EXISTS signed_pdf_storage_path        TEXT,
  ADD COLUMN IF NOT EXISTS signed_pdf_size_bytes          INT,
  ADD COLUMN IF NOT EXISTS signed_pdf_sha256              VARCHAR(64),
  ADD COLUMN IF NOT EXISTS signed_at                      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signer_name                    TEXT,
  ADD COLUMN IF NOT EXISTS counter_signed_pdf_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS counter_signed_pdf_size_bytes  INT,
  ADD COLUMN IF NOT EXISTS counter_signed_pdf_sha256      VARCHAR(64),
  ADD COLUMN IF NOT EXISTS counter_signed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS counter_signed_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counter_signer_name            TEXT;

-- ── quotes: deposit tracking ──────────────────────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS deposit_amount_nzd    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_reference     TEXT,
  ADD COLUMN IF NOT EXISTS deposit_received_at   TIMESTAMPTZ;

-- ── quote_email_log: dry-run flag ─────────────────────────────────────────
-- Lets the UI distinguish preview "would-send" attempts from real sends,
-- and excludes dry-runs from delivery-rate analytics.
ALTER TABLE quote_email_log
  ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE;

-- ── quote_run_log: run_kind for filtering ─────────────────────────────────
ALTER TABLE quote_run_log
  ADD COLUMN IF NOT EXISTS run_kind VARCHAR(30) DEFAULT 'generate';

-- ── Indexes for common lookups ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS quote_versions_signed_at_idx
  ON quote_versions (signed_at DESC) WHERE signed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS quotes_deposit_received_at_idx
  ON quotes (deposit_received_at DESC) WHERE deposit_received_at IS NOT NULL;

COMMENT ON COLUMN quote_email_log.dry_run IS
  'TRUE when the email was a preview / dry-run only (no Resend call made). Exclude from delivery-rate analytics.';
COMMENT ON COLUMN quote_run_log.run_kind IS
  'What kind of run: generate (full PDFs) / regenerate / validate-only. Filter for SLA dashboards.';

-- ── Rollback (do not run unless you mean it) ──────────────────────────────
-- ALTER TABLE quote_versions
--   DROP COLUMN IF EXISTS signed_pdf_storage_path,
--   DROP COLUMN IF EXISTS signed_pdf_size_bytes,
--   DROP COLUMN IF EXISTS signed_pdf_sha256,
--   DROP COLUMN IF EXISTS signed_at,
--   DROP COLUMN IF EXISTS signer_name,
--   DROP COLUMN IF EXISTS counter_signed_pdf_storage_path,
--   DROP COLUMN IF EXISTS counter_signed_pdf_size_bytes,
--   DROP COLUMN IF EXISTS counter_signed_pdf_sha256,
--   DROP COLUMN IF EXISTS counter_signed_at,
--   DROP COLUMN IF EXISTS counter_signed_by,
--   DROP COLUMN IF EXISTS counter_signer_name;
-- ALTER TABLE quotes
--   DROP COLUMN IF EXISTS deposit_amount_nzd,
--   DROP COLUMN IF EXISTS deposit_reference,
--   DROP COLUMN IF EXISTS deposit_received_at;
-- ALTER TABLE quote_email_log  DROP COLUMN IF EXISTS dry_run;
-- ALTER TABLE quote_run_log    DROP COLUMN IF EXISTS run_kind;
