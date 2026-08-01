-- ────────────────────────────────────────────────────────────────────────────
-- Migration 039 — Panel-layout design state per quote
--
-- One row per quote. Holds the Fabric.js canvas state as JSONB plus a version
-- counter for optimistic concurrency. Phase 3a stores view state only
-- (pan/zoom + roof image reference). Phase 3b+ adds roof faces, panels,
-- inverter, battery. Deliberately loose jsonb schema so the tool can evolve
-- without a migration for every new field.
--
-- One-active-design-per-quote via UNIQUE(quote_id). Versioning (design history)
-- will use a separate design_versions table in Phase 3e — that's when engineer
-- sign-off + version diffing become part of the workflow.
--
-- Non-destructive: uses IF NOT EXISTS + DROP POLICY IF EXISTS so re-running
-- is safe. Wrapped in BEGIN/COMMIT — atomic all-or-nothing if any statement
-- fails when pasted into Supabase Studio.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── designs ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS designs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Parent link. UNIQUE constraint enforces one active design per quote;
  -- versioning (Phase 3e) will move to a separate design_versions table.
  quote_id     UUID NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,

  -- The Fabric.js canvas state. In Phase 3a this holds view state only
  -- (pan offset, zoom level, roof image reference). Later phases add roof
  -- faces, panels, inverter/battery selections. Kept as jsonb so the tool's
  -- shape can evolve without a migration for every new field.
  state        JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Monotonic per-quote version counter, bumped on every successful save.
  -- Client sends expected version on save; backend rejects mismatched saves
  -- to prevent lost-update races between concurrent editors (rep + engineer).
  version      INTEGER NOT NULL DEFAULT 0,

  -- Audit
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID,   -- auth.users(id); nullable to survive user deletion
  updated_by   UUID
);

CREATE INDEX IF NOT EXISTS idx_designs_quote   ON designs(quote_id);
CREATE INDEX IF NOT EXISTS idx_designs_updated ON designs(updated_at DESC);

COMMENT ON TABLE designs IS
  'Panel-layout design state per quote. Phase 3a stores view state only; Phase 3b+ adds panels, inverter, battery.';
COMMENT ON COLUMN designs.state IS
  'Fabric.js canvas serialisation + Goldenray design metadata (roof faces, panels, inverter, battery). Loose schema on purpose.';
COMMENT ON COLUMN designs.version IS
  'Monotonic per-quote counter for optimistic concurrency. Client sends expected version on save; backend rejects if mismatched.';


-- ── Row Level Security (matches Migration 037 pattern) ─────────────────────
-- Backend uses supabaseAdmin (service_role) which has BYPASSRLS, so backend
-- reads/writes are unaffected. This policy is defence-in-depth in case grants
-- get widened later. Never add a USING(true) policy here — design state may
-- carry customer address hints via the roof image reference.
ALTER TABLE designs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designs_select_service_role ON designs;
CREATE POLICY designs_select_service_role ON designs
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMENT ON POLICY designs_select_service_role ON designs
  IS 'Service role only. Design state may reference customer roof image / address; do not open to anon/authenticated without a targeted policy. See Migration 039.';

COMMIT;
