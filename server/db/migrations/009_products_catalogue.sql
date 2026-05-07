-- Phase 1 — Product catalogue foundation
--
-- Single source of truth for every solar product Goldenray Energy NZ sells:
-- panels, inverters, batteries, cables, racking, accessories, EV chargers.
-- This table feeds (eventually):
--   1. The trade-shop public pages where electricians buy direct.
--   2. The CRM Deal/Quote line-item picker for sales.
--   3. The CRM Proposal line-item picker for the design team.
--   4. The /solar-packages public pages (packages = bundles of products).
--
-- Pricing model:
--   - cost_nzd is the wholesale/dealer price — the only price stored.
--   - sell_excl_gst and sell_incl_gst are CALCULATED on display from
--     cost × (1 + margin/100) × 1.15. Never stored — edit margin once,
--     every quote/page updates.
--
-- Re-importable: SKU is the natural key. Re-running the importer with a
-- revised price list will UPDATE existing rows by SKU and INSERT new ones.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS products (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Natural key. Nullable because File 2 contributes long-tail items
  -- without supplier SKUs that admins assign manually later.
  sku                 VARCHAR(50) UNIQUE,

  -- Hierarchy
  category            VARCHAR(80),     -- "PV Modules", "Inverters - Grid Tied", ...
  subcategory         VARCHAR(80),     -- "Mono Panels", "Single Phase Hybrid", ...
  brand               VARCHAR(80),     -- "Fronius", "REC", "Phono Solar", ...

  -- Display
  name                VARCHAR(255) NOT NULL,
  description         TEXT,

  -- Pricing (cost only — sell prices computed on display)
  cost_nzd            NUMERIC(12,2),
  default_margin_pct  NUMERIC(5,2) DEFAULT 30.00,
  unit                VARCHAR(20)  DEFAULT 'EA',

  -- Inventory
  stock_status        VARCHAR(20)  DEFAULT 'unknown'
                        CHECK (stock_status IN ('in_stock','backorder','discontinued','unknown')),
  qty_available       INTEGER      DEFAULT 0,
  moq                 INTEGER      DEFAULT 1,
  availability_notes  TEXT,                       -- freeform, kept for reference
  available_from      DATE,                       -- parsed from notes ("Due 15 Jun 2026")

  -- Public-shop nav (may differ from internal `category` — e.g. Smart Meter
  -- is internally "Inverters - Grid Tied" but on the website is "Accessories").
  website_category    VARCHAR(80),

  -- Media + spec sheet
  image_url           TEXT,
  datasheet_url       TEXT,

  -- Flexible specs — wattage, efficiency, dimensions etc. Type-specific.
  specs               JSONB DEFAULT '{}'::jsonb,

  -- Data quality
  needs_review        TEXT,            -- semicolon-separated reasons from importer
  source              VARCHAR(20)      DEFAULT 'manual'
                        CHECK (source IN ('manual','file1','file2','import')),

  -- Lifecycle (soft-delete preserves history for old quotes/orders)
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_category         ON products(category)            WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_brand            ON products(brand)               WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_website_category ON products(website_category)    WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_is_active        ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_sku              ON products(sku)                 WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_search           ON products USING GIN (to_tsvector('english',
  COALESCE(name,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(brand,'')
));

-- Auto-bump updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
