-- ────────────────────────────────────────────────────────────────────────────
-- MVP1_003 — Rate cards (labour + compliance) move to DB + archive flow
--
-- IMPORTANT PIVOT (vs initial draft):
--   The original draft added hardware_catalog + bos_catalog tables here.
--   THOSE ARE DROPPED — they duplicated the existing products table that's
--   already used by the shop / line items / admin xlsx import. The engine
--   reads from `products` directly via a field-aliasing DB loader.
--
-- This migration adds ONLY:
--   • labour_rate_card           (Section B — not in products)
--   • compliance_rate_card       (Section C — not in products)
--   • catalogue_csv_imports      (audit log for labour/compliance CSV imports)
--   • 'archived' status on quotes + archive metadata columns
--
-- The labour + compliance tables are EMPTY after this migration. Seed (P2)
-- populates them at 30% margin per the locked rule.
-- ────────────────────────────────────────────────────────────────────────────

-- ── hardware_catalog (REMOVED — engine reads from products) ────────────────
-- See product_catalog_aliasing notes in catalogue/dbLoader.js for the field
-- mapping (rated_kw → ac_kw, hybrid_status → is_plus_variant, etc.).
-- (No SQL emitted for this section.)


-- ── bos_catalog (REMOVED — engine reads from products) ─────────────────────
-- BoS items already live in products under categories like 'Balance of System',
-- 'Racking & Mounting', 'MC4', 'Roof Seal', etc.
-- (No SQL emitted for this section.)


-- ── DUMMY (compile guard so the original CREATE TABLE block below was
--          intentionally left intact at the start of the file but
--          now lives only via this comment)
-- The CREATE TABLE statements for hardware_catalog and bos_catalog that
-- followed in the original draft are removed; the next active SQL is the
-- labour_rate_card table.

-- ── (legacy block kept disabled) ───────────────────────────────────────────
-- Every panel / inverter / battery / BMS / smart meter / EV charger SKU.
-- Type-specific specs (voc_stc, idc_max_a_per_mppt, module_kwh, etc.) live in
-- (hardware_catalog + bos_catalog tables removed per pivot — see header.)


-- ── labour_rate_card ───────────────────────────────────────────────────────
-- Crew labour, supervisor, travel, logistics, battery premium, parallel
-- topology premium. Each row has optional filter rules (kW range, has_battery)
-- so the engine picks the right install-labour tier automatically.
CREATE TABLE IF NOT EXISTS labour_rate_card (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku                 VARCHAR(40) UNIQUE NOT NULL,

  category            VARCHAR(20) NOT NULL
                        CHECK (category IN ('install','battery_install','supervisor',
                                            'travel','logistics','premium','other')),

  name                TEXT NOT NULL,
  cost_nzd            NUMERIC(10,2) NOT NULL,
  margin_pct          NUMERIC(5,2)  NOT NULL DEFAULT 30,

  -- Filter rules (engine applies these when picking which rows apply):
  --   applies_to_kw_min / applies_to_kw_max  (install tier sizing)
  --   applies_when JSONB  (e.g., {"has_battery": true}, {"topology": "parallel"})
  applies_to_kw_min   NUMERIC(5,2),
  applies_to_kw_max   NUMERIC(5,2),
  applies_when        JSONB,

  -- Default qty (engine uses this unless rep overrides on the Costs tab).
  default_qty         NUMERIC(8,2) NOT NULL DEFAULT 1,

  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  last_csv_import_id  UUID
);

CREATE INDEX IF NOT EXISTS labour_rate_card_active_idx
  ON labour_rate_card (active, category) WHERE active = TRUE;

COMMENT ON TABLE labour_rate_card IS
  'Labour line items (Section B). Editable per-quote by reps for qty + cost; margin admin-only with reason.';


-- ── compliance_rate_card ───────────────────────────────────────────────────
-- Design, inspection, commissioning, grid application, CoC, ESC.
-- Simpler than labour: no kW filtering, just a flat list every quote applies.
CREATE TABLE IF NOT EXISTS compliance_rate_card (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku                 VARCHAR(40) UNIQUE NOT NULL,

  category            VARCHAR(20) NOT NULL
                        CHECK (category IN ('design','inspection','commissioning',
                                            'grid_app','certificate','survey','other')),

  name                TEXT NOT NULL,
  cost_nzd            NUMERIC(10,2) NOT NULL,
  margin_pct          NUMERIC(5,2)  NOT NULL DEFAULT 30,

  default_qty         NUMERIC(8,2) NOT NULL DEFAULT 1,

  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  last_csv_import_id  UUID
);

CREATE INDEX IF NOT EXISTS compliance_rate_card_active_idx
  ON compliance_rate_card (active, category) WHERE active = TRUE;

COMMENT ON TABLE compliance_rate_card IS
  'Compliance line items (Section C). Editable per-quote for qty + cost; margin admin-only with reason.';


-- ── catalogue_csv_imports ──────────────────────────────────────────────────
-- Audit trail for bulk CSV updates. Captures who, when, what changed,
-- which rows errored. Prev-state snapshot stored in Supabase Storage so a
-- bad import can be rolled back.
CREATE TABLE IF NOT EXISTS catalogue_csv_imports (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  target_table                VARCHAR(40) NOT NULL
                                CHECK (target_table IN ('hardware_catalog','bos_catalog',
                                                        'labour_rate_card','compliance_rate_card')),

  imported_by                 UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  imported_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  rows_inserted               INT NOT NULL DEFAULT 0,
  rows_updated                INT NOT NULL DEFAULT 0,
  rows_unchanged              INT NOT NULL DEFAULT 0,
  rows_errored                INT NOT NULL DEFAULT 0,

  -- Structured errors: [ { row_number, sku, message, severity }, ... ]
  errors                      JSONB,

  -- Metadata about the source file.
  csv_filename                TEXT,
  csv_size_bytes              INT,
  csv_sha256                  VARCHAR(64),

  -- Why did we re-price? (Required by admin UI before apply.)
  reason                      TEXT,

  -- Backup of the affected table BEFORE the import (CSV blob in Storage).
  -- Enables one-click rollback.
  prev_snapshot_storage_path  TEXT
);

CREATE INDEX IF NOT EXISTS catalogue_csv_imports_target_idx
  ON catalogue_csv_imports (target_table, imported_at DESC);
CREATE INDEX IF NOT EXISTS catalogue_csv_imports_imported_by_idx
  ON catalogue_csv_imports (imported_by, imported_at DESC);

COMMENT ON TABLE catalogue_csv_imports IS
  'Audit + rollback log for catalogue CSV bulk imports. Indefinite retention.';


-- ── quotes.status — add 'archived' to enum ────────────────────────────────
-- Admin soft-archive: quote hides from default list but version history + audit
-- trail + PDFs preserved. Recoverable via "Show archived" filter.
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;

ALTER TABLE quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IN (
    'draft',
    'pending_owner_review',
    'ready_to_generate',
    'generated',
    'sent_to_customer',
    'signed',
    'counter_signed',
    'deposit_received',
    'handed_off',
    'expired',
    'withdrawn',
    'closed_lost',
    'archived'              -- new (MVP1_003)
  ));

-- Track who archived + when, for the audit timeline.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS archived_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason     TEXT;


-- ── PostgREST reload so Supabase Data API sees new tables/columns ─────────
-- (Run via the migration script after COMMIT.)


-- ── Rollback (do not run unless you mean it) ──────────────────────────────
-- DROP TABLE IF EXISTS catalogue_csv_imports;
-- DROP TABLE IF EXISTS compliance_rate_card;
-- DROP TABLE IF EXISTS labour_rate_card;
-- DROP TABLE IF EXISTS bos_catalog;
-- DROP TABLE IF EXISTS hardware_catalog;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS archive_reason;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS archived_by;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS archived_at;
-- ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
-- ALTER TABLE quotes ADD CONSTRAINT quotes_status_check CHECK (status IN (
--   'draft','pending_owner_review','ready_to_generate','generated','sent_to_customer',
--   'signed','counter_signed','deposit_received','handed_off','expired','withdrawn','closed_lost'
-- ));
