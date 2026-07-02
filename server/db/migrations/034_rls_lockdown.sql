-- Migration 030 — RLS lockdown: revoke wide grants from anon/authenticated
--
-- CONTEXT
--   Audit on 2026-06-26 found that every table in the public schema had
--   ALL DML grants (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
--   TRIGGER) to BOTH the anon and authenticated roles. Combined with the
--   publicly-visible Vercel anon key, this meant every table was reachable
--   via the Supabase REST (PostgREST) API by any visitor on the public
--   internet. Critical-PII tables (users, contacts, finance_applications,
--   proposals, customer_profiles, website_enquiries) were among the exposed
--   set.
--
-- APP IMPACT (verified before writing this migration)
--   - Backend (Render Express) uses the service_role key everywhere via
--     supabaseAdmin from server/config/supabase.js. service_role bypasses
--     both grants and RLS, so backend functionality is unaffected.
--   - The server has a createUserClient(accessToken) factory that would
--     create an anon-key+JWT client, but it is defined and never invoked
--     anywhere in the codebase. Dead code path; unaffected.
--   - Frontend (Vercel Vite) imports the Supabase JS client only in
--     client/src/services/supabase.js, used only by hooks/useRealtime.js,
--     which is never called anywhere. Dead code path; unaffected.
--   - All operational scripts under server/scripts/ use SUPABASE_SERVICE
--     ROLE_KEY. The single anon-key script (scripts/verify-supabase.mjs)
--     is a one-off connectivity test and is expected to fail after this
--     migration — that is harmless.
--   - Supabase Studio uses your logged-in admin user (not anon), so the
--     dashboard is unaffected.
--
-- WHAT THIS DOES
--   1. REVOKE all privileges on every existing public.table, public.sequence,
--      and public.function from anon + authenticated.
--   2. ALTER DEFAULT PRIVILEGES so future objects in public do not auto-grant
--      to anon or authenticated.
--   3. ENABLE RLS on every public table where it is currently off, as
--      defence-in-depth: if a future migration accidentally re-grants, RLS
--      still denies by default until explicit policies are added.
--
-- WHAT THIS DOES NOT DO
--   - Add new RLS policies. Policies come in a follow-up migration if (and
--     only if) any table genuinely needs anon/authenticated access — e.g.
--     a future public catalogue read, contact-form insert, or customer
--     portal feature.
--   - Touch auth.* or storage.* schemas. Supabase manages those internally.
--
-- VERIFICATION (run after applying)
--   Re-run Query 1 from the audit session. Expected for every row:
--     rls              = 'ON'
--     anon_auth_grants = 'none'
--     status           = 'NEUTRAL: RLS on, no policies (deny-all except
--                         service_role)'  OR  'OK: RLS on with policies'
--
-- ROLLBACK (do not use unless absolutely required)
--     GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
--     GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
--     GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
--   This would re-open the public-internet hole. Only run if a critical
--   production path is broken AND the root cause must be diagnosed first.

BEGIN;

-- 1. Revoke all existing grants on public schema objects
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 2. Stop future objects from auto-granting to anon/authenticated
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 3. Enable RLS on every public table where it is currently off
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

COMMIT;
