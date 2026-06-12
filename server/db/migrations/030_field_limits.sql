-- ────────────────────────────────────────────────────────────────────────────
-- 030 — field_limits — admin-tunable hard/typical ranges for spec fields
--
-- Promotes server/services/pm/proposalEngine/fieldLimits.js from a static
-- module to a DB-driven, admin-editable config table.
--
-- Engine-side consumers (configValidator.js, fieldHints.js) read through a
-- cache-backed loader; admin UI edits invalidate the cache so next live
-- preview picks up the new range immediately.
--
-- Every edit is captured in field_limits_audit (append-only) with a required
-- reason text — same pattern as labour_rate_card margin-% edits (admin policy:
-- internal-cost / range changes need audit trail).
--
-- Tables added:
--   field_limits         — current value per path (one row per spec field)
--   field_limits_audit   — append-only history of every change
--
-- Seeded from the values that lived in fieldLimits.js as of commit 2410ff3.
-- ────────────────────────────────────────────────────────────────────────────


-- ── field_limits ──────────────────────────────────────────────────────────
-- One row per editable spec field. `path` matches the JSONPath the validator
-- + hint generators use (e.g. 'system.panel.count'). hard_min/max are enforced
-- by the engine; typical_min/max are advisory display only.
CREATE TABLE IF NOT EXISTS field_limits (
  path                  VARCHAR(120) PRIMARY KEY,

  hard_min              NUMERIC(12,4) NOT NULL,
  hard_max              NUMERIC(12,4) NOT NULL,
  typical_min           NUMERIC(12,4) NOT NULL,
  typical_max           NUMERIC(12,4) NOT NULL,
  unit                  VARCHAR(40),

  -- Admin note: why this range? (e.g. "Fronius datasheet min 4 panels/string".)
  notes                 TEXT,

  -- Track who edited last. NULL for seed rows.
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT field_limits_hard_range_valid
    CHECK (hard_min < hard_max),
  CONSTRAINT field_limits_typical_within_hard
    CHECK (typical_min >= hard_min AND typical_max <= hard_max
           AND typical_min <= typical_max)
);

COMMENT ON TABLE field_limits IS
  'Admin-editable hard/typical ranges for spec fields. Server cache-backed; admin UI edits hot-reload.';
COMMENT ON COLUMN field_limits.hard_min IS
  'Engine REJECTS values below this. Audit-logged on change.';
COMMENT ON COLUMN field_limits.hard_max IS
  'Engine REJECTS values above this. Audit-logged on change.';
COMMENT ON COLUMN field_limits.typical_min IS
  'Display only — typical NZ residential band lower bound. Not enforced.';
COMMENT ON COLUMN field_limits.typical_max IS
  'Display only — typical NZ residential band upper bound. Not enforced.';

-- Trigger: bump updated_at on every UPDATE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_field_limits_updated_at') THEN
    CREATE TRIGGER trg_field_limits_updated_at
      BEFORE UPDATE ON field_limits
      FOR EACH ROW
      EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;


-- ── field_limits_audit ────────────────────────────────────────────────────
-- Append-only history. One row per field_limits UPDATE. Reason text required
-- (server enforces ≥10 chars on the endpoint before INSERT). No DELETE.
CREATE TABLE IF NOT EXISTS field_limits_audit (
  id                    BIGSERIAL PRIMARY KEY,

  path                  VARCHAR(120) NOT NULL,

  -- Snapshot BEFORE the change (NULL for the seed row's audit, which is
  -- represented by a single "seeded" entry written by the seed itself).
  prev_hard_min         NUMERIC(12,4),
  prev_hard_max         NUMERIC(12,4),
  prev_typical_min      NUMERIC(12,4),
  prev_typical_max      NUMERIC(12,4),
  prev_unit             VARCHAR(40),
  prev_notes            TEXT,

  -- Snapshot AFTER the change.
  new_hard_min          NUMERIC(12,4) NOT NULL,
  new_hard_max          NUMERIC(12,4) NOT NULL,
  new_typical_min       NUMERIC(12,4) NOT NULL,
  new_typical_max       NUMERIC(12,4) NOT NULL,
  new_unit              VARCHAR(40),
  new_notes             TEXT,

  -- Who + when + why.
  actor_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  reason                TEXT NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT field_limits_audit_reason_min_length
    CHECK (char_length(reason) >= 10)
);

CREATE INDEX IF NOT EXISTS field_limits_audit_path_idx
  ON field_limits_audit (path, occurred_at DESC);
CREATE INDEX IF NOT EXISTS field_limits_audit_actor_idx
  ON field_limits_audit (actor_user_id, occurred_at DESC);

COMMENT ON TABLE field_limits_audit IS
  'Append-only history of every field_limits change. Indefinite retention.';


-- ── Seed (idempotent — only inserts if path not already present) ──────────
-- Values copied verbatim from server/services/pm/proposalEngine/fieldLimits.js
-- as of commit 2410ff3 (Session A field-hints work).
INSERT INTO field_limits (path, hard_min, hard_max, typical_min, typical_max, unit, notes)
VALUES
  ('system.panel.count',
   4, 60, 12, 24, 'panels',
   'Fronius single-MPPT min 4. Upper bound from Voc-cold envelope on the highest-Voc inverter in catalogue.'),

  ('system.battery.module_count',
   1, 24, 3, 8, 'modules',
   'Validator enforces 1-24. Vendor BMS rules narrow this further (BYD HVM 3-8, HVS/Reserva 2-5).'),

  ('system.cable_run_metres_estimate',
   5, 200, 15, 35, 'm',
   'Inverter → switchboard. Refined at Stage 2 site survey.'),

  ('system.string_design.groups.panels_per_string',
   4, 30, 6, 12, 'panels',
   'Fronius min 4 panels per string (datasheet). Upper bound from Voc-cold envelope.'),

  ('system.string_design.groups.string_count',
   1, 8, 1, 4, 'strings',
   'Per group. Sum across groups must equal panel count.'),

  ('bills.annual_kwh',
   1500, 35000, 7000, 15000, 'kWh/yr',
   'NZ residential corpus (~7M kWh/yr average across ~1.6M households per MBIE 2024).'),

  ('bills.annual_spend',
   500, 15000, 2500, 5500, 'NZD/yr',
   'Hard min/max are sanity-check bounds. Typical band from NZ residential corpus.'),

  ('bills.variable_rate_per_kwh_incl_gst',
   0.10, 0.50, 0.20, 0.35, '$/kWh inc GST',
   'NZ retailer range. Below 0.10 unusual; above 0.50 likely commercial.'),

  ('bills.daily_fixed_charge_incl_gst',
   0.50, 5.00, 1.50, 3.50, '$/day inc GST',
   'NZ residential fixed-charge range. Above 5 likely commercial.'),

  ('bills.buyback_rate',
   0.00, 0.20, 0.07, 0.13, '$/kWh',
   'NZ retailer buyback. Mercury ~$0.09; some retailers $0.07-$0.13.')

ON CONFLICT (path) DO NOTHING;


-- ── RLS — admin write, authenticated read ─────────────────────────────────
ALTER TABLE field_limits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_limits_audit ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read (engine + UI need this).
DROP POLICY IF EXISTS field_limits_select_authenticated ON field_limits;
CREATE POLICY field_limits_select_authenticated ON field_limits
  FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

DROP POLICY IF EXISTS field_limits_audit_select_authenticated ON field_limits_audit;
CREATE POLICY field_limits_audit_select_authenticated ON field_limits_audit
  FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Writes go through the server (service_role) — the server enforces admin role
-- + reason + audit insert in a transaction. No direct anon/auth writes.
DROP POLICY IF EXISTS field_limits_write_service_role ON field_limits;
CREATE POLICY field_limits_write_service_role ON field_limits
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS field_limits_audit_write_service_role ON field_limits_audit;
CREATE POLICY field_limits_audit_write_service_role ON field_limits_audit
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ── Rollback (commented for safety) ───────────────────────────────────────
-- DROP TABLE IF EXISTS field_limits_audit;
-- DROP TABLE IF EXISTS field_limits;
