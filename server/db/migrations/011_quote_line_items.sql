-- Phase 2 — quote line items on Projects
--
-- A project's bill of materials. Each row points at a product (so prices
-- and stock can be looked up live) but ALSO snapshots the name, SKU, cost,
-- and margin at the moment of quoting. Once a customer accepts a proposal,
-- those numbers must not silently change because someone re-imported the
-- supplier price list a week later.
--
-- Why on projects (not deals or contacts):
-- The project is the operational record that owns the design, the
-- proposal PDF, and the install. Sales rep promotes a qualified lead to
-- a project, design team builds the BOM by adding line items here.

CREATE TABLE IF NOT EXISTS quote_line_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Live link to the catalogue (nullable so admins can add ad-hoc items
  -- not in the catalogue without breaking)
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,

  -- Snapshots — what the customer was quoted, frozen at line-item create time
  name            TEXT NOT NULL,
  sku             VARCHAR(50),
  unit_cost_nzd   NUMERIC(12,2),
  margin_pct      NUMERIC(5,2),

  qty             INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  notes           TEXT,
  position        INTEGER NOT NULL DEFAULT 0,    -- display order within the project

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qli_project ON quote_line_items(project_id);
CREATE INDEX IF NOT EXISTS idx_qli_product ON quote_line_items(product_id) WHERE product_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qli_updated_at') THEN
    CREATE TRIGGER trg_qli_updated_at
      BEFORE UPDATE ON quote_line_items
      FOR EACH ROW
      EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;
