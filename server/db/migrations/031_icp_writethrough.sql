-- ────────────────────────────────────────────────────────────────────────────
-- Migration 031 — ICP writethrough + quote_versions.updated_at
--
-- Bug #6 fix: when a customer uploads bills via the public wizard, the
-- parser extracts an ICP per bill (stored on bill_uploads.icp_number since
-- migration 025), but it never propagates to:
--   • bill_analyses  — the canonical "analysis on file for this contact"
--   • contacts       — the CRM record sales reps work with
--   • quote spec     — the field on the Customer tab in the new-quote form
--
-- Bug #4 fix: generate-bumped versioning needs an updated_at on
-- quote_versions so we can record when an in-place save happened (vs. when
-- the row was first created). Append-only audit history still lives in
-- quote_audit_log.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE bill_analyses
  ADD COLUMN IF NOT EXISTS icp_number VARCHAR(50);

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS icp_number VARCHAR(50);

ALTER TABLE quote_versions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill updated_at = created_at for existing rows (additive, no data loss).
UPDATE quote_versions SET updated_at = created_at WHERE updated_at IS NULL;

-- Indexes for ICP lookups (sales: "give me everyone on ICP 1234…"). Partial
-- so they only cost storage on rows that actually have an ICP.
CREATE INDEX IF NOT EXISTS idx_bill_analyses_icp
  ON bill_analyses(icp_number) WHERE icp_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_icp
  ON contacts(icp_number) WHERE icp_number IS NOT NULL;

COMMENT ON COLUMN bill_analyses.icp_number IS
  'NZ Installation Control Point — most-frequent ICP across the bills in this analysis. Set by the bill upload route at insert time.';
COMMENT ON COLUMN contacts.icp_number IS
  'NZ Installation Control Point — propagated from the customer''s latest bill analysis when the bill upload includes a parseable ICP.';
COMMENT ON COLUMN quote_versions.updated_at IS
  'Last time the version''s spec was changed in place. Bug #4 versioning model uses this to surface "last save" without bumping version_number.';
