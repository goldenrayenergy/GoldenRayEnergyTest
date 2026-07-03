-- Migration 036 — Tighten permissive RLS policies to service_role only
--
-- CONTEXT
--   Audit Query 2 on 2026-06-26 found 8 policies using USING (true) on the
--   authenticated role, which means "any logged-in Supabase user can read
--   every row in this table". Since Migration 034 revoked all grants from
--   anon/authenticated, these policies are currently unreachable — but the
--   moment a future feature adds Supabase Auth for customer accounts, these
--   USING(true) policies become live and every customer can read every
--   other customer's quotes, audit logs, email logs, and version history.
--
--   The policies are:
--     - discount_approvals_select_authenticated
--     - quote_audit_log_select_authenticated
--     - quote_email_log_select_authenticated
--     - quote_run_log_select_authenticated
--     - quote_versions_select_authenticated
--     - quotes_select_authenticated
--     (field_limits and field_limits_audit already use auth.role() checks
--     correctly — no change needed.)
--
--   This migration replaces the 6 rubber-stamp policies with policies that
--   only match service_role. The backend already uses service_role for all
--   Storage + DB operations, so functionally nothing changes today. When a
--   customer-portal feature later needs frontend access, that feature adds
--   its own targeted policy (e.g. "customer can read their own quote" via
--   auth.uid() = customer_id) — never USING(true).
--
-- APP IMPACT (verified before writing)
--   - Backend Express uses supabaseAdmin (service_role) everywhere → still
--     bypasses RLS entirely via BYPASSRLS attribute on the role. Unaffected.
--   - Frontend has no direct Supabase queries → unaffected.
--   - No test/QA depends on authenticated-user reads on these tables.
--
-- WHAT THIS DOES
--   1. DROP the 6 USING(true) policies
--   2. CREATE replacement policies that require auth.role() = 'service_role'
--      (defence in depth — makes the intent explicit rather than relying on
--      grants alone)
--   3. Comment the intent so future migrations understand the constraint
--
-- VERIFICATION (run after applying)
--   Re-run Query 2 from the security audit session. Expected: each of the
--   6 tables has a select policy with using_clause exactly equal to
--   (auth.role() = 'service_role'::text), and no USING(true) policies
--   remain in the public schema.
--
-- ROLLBACK
--   Not recommended. If a legitimate feature needs authenticated access to
--   one of these tables, add a targeted policy for that specific case —
--   e.g. "customer can read their own quote" — rather than reverting to
--   the wide-open USING(true).

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- discount_approvals
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS discount_approvals_select_authenticated ON discount_approvals;

CREATE POLICY discount_approvals_select_service_role ON discount_approvals
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMENT ON POLICY discount_approvals_select_service_role ON discount_approvals
  IS 'Service role only. If a future feature needs authenticated user access, add a targeted policy — never USING(true). See Migration 036.';

-- ────────────────────────────────────────────────────────────────────────────
-- quote_audit_log
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS quote_audit_log_select_authenticated ON quote_audit_log;

CREATE POLICY quote_audit_log_select_service_role ON quote_audit_log
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMENT ON POLICY quote_audit_log_select_service_role ON quote_audit_log
  IS 'Service role only. Audit log is admin-visible only through backend routes. See Migration 036.';

-- ────────────────────────────────────────────────────────────────────────────
-- quote_email_log
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS quote_email_log_select_authenticated ON quote_email_log;

CREATE POLICY quote_email_log_select_service_role ON quote_email_log
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMENT ON POLICY quote_email_log_select_service_role ON quote_email_log
  IS 'Service role only. Email log contains customer email addresses. See Migration 036.';

-- ────────────────────────────────────────────────────────────────────────────
-- quote_run_log
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS quote_run_log_select_authenticated ON quote_run_log;

CREATE POLICY quote_run_log_select_service_role ON quote_run_log
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMENT ON POLICY quote_run_log_select_service_role ON quote_run_log
  IS 'Service role only. Contains internal engine diagnostics. See Migration 036.';

-- ────────────────────────────────────────────────────────────────────────────
-- quote_versions
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS quote_versions_select_authenticated ON quote_versions;

CREATE POLICY quote_versions_select_service_role ON quote_versions
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMENT ON POLICY quote_versions_select_service_role ON quote_versions
  IS 'Service role only. Version history contains full quote content across customers. See Migration 036.';

-- ────────────────────────────────────────────────────────────────────────────
-- quotes
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS quotes_select_authenticated ON quotes;

CREATE POLICY quotes_select_service_role ON quotes
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMENT ON POLICY quotes_select_service_role ON quotes
  IS 'Service role only. Customer-facing quote read must go through backend routes that enforce ownership. See Migration 036.';

COMMIT;
