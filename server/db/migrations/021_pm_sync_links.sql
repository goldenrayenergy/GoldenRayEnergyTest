-- ────────────────────────────────────────────────────────────────────────────
-- Migration 021 — Confirmation gate between legacy `projects` and `projects_v2`
--
-- Policy decision (2026-05): the public website + wizard always land leads in
-- the LEGACY `projects` table. A sales rep does qualification calls inside
-- /portal, then clicks "Confirm & Sync to PM Tool" — only then does a
-- corresponding `projects_v2` row get created. The two tools coexist for that
-- project from then on, evolving independently.
--
-- This migration adds the cross-link columns + an audit pair on the legacy
-- side capturing who confirmed and when. UNIQUE constraints prevent a legacy
-- project being linked to multiple PM projects (or vice versa). NULL is
-- allowed (most legacy projects haven't been confirmed yet).
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS pm_project_id        UUID NULL REFERENCES projects_v2(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_for_pm_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS confirmed_for_pm_by  UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE projects_v2
  ADD COLUMN IF NOT EXISTS legacy_project_id    UUID NULL REFERENCES projects(id) ON DELETE SET NULL;

-- One legacy project → at most one PM project, and vice versa.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_projects_pm_project_id') THEN
    ALTER TABLE projects     ADD CONSTRAINT uq_projects_pm_project_id     UNIQUE (pm_project_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_projects_v2_legacy_project_id') THEN
    ALTER TABLE projects_v2  ADD CONSTRAINT uq_projects_v2_legacy_project_id UNIQUE (legacy_project_id);
  END IF;
END $$;

-- Partial indexes for the common "find by link" queries.
CREATE INDEX IF NOT EXISTS idx_projects_pm_project_id     ON projects(pm_project_id)        WHERE pm_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_v2_legacy_id      ON projects_v2(legacy_project_id) WHERE legacy_project_id IS NOT NULL;

COMMENT ON COLUMN projects.pm_project_id IS
  'Set when a sales rep clicks "Confirm & Sync to PM Tool" on this legacy project. Points at the projects_v2 row; from then on, both tools see the project and evolve independently.';

COMMENT ON COLUMN projects.confirmed_for_pm_at IS
  'Timestamp of the confirmation event. NULL if the project has not been promoted to /pm yet.';

COMMENT ON COLUMN projects.confirmed_for_pm_by IS
  'User who clicked "Confirm & Sync to PM Tool". For audit.';

COMMENT ON COLUMN projects_v2.legacy_project_id IS
  'Back-reference to the legacy projects row this PM project was synced from. NULL for PM projects created natively in /pm (rare).';
