-- Phase 3 — Solar Packages
--
-- A "package" is a curated bundle of products (e.g. "Standard 5kW = 12×
-- Phono panels + 1× Fronius Primo 5.0 GEN24") with marketing copy, hero
-- image, and a "from price" — used for:
--   * Public /solar-packages browse and detail pages
--   * "Get Quote" CTA that prefills the website form with the package's
--     installation type / battery option / system size hints
--
-- Pricing model:
--   from_price = sum(item.product.cost × qty × (1 + margin/100) × 1.15)
--   Stored as a calculated column for fast display, but the canonical
--   source remains the products table — re-running the importer ripples
--   into package prices on next read because we recompute on display.
--   from_price_override lets marketing pin a "from $11,500" headline.

CREATE TABLE IF NOT EXISTS packages (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug                     VARCHAR(120) UNIQUE NOT NULL,    -- URL friendly
  name                     VARCHAR(200) NOT NULL,
  tier                     VARCHAR(40),                     -- 'starter' | 'standard' | 'premium' | 'premium-battery' | 'whole-home' | 'off-grid' | 'commercial'
  badge                    VARCHAR(80),                     -- 'Most Popular', 'Best Value', etc.
  description              TEXT,                            -- short marketing line for cards
  long_description         TEXT,                            -- multi-paragraph for detail page

  hero_image_url           TEXT,

  -- Display headlines (manually entered or computed from item specs)
  system_kw                NUMERIC(6,2),
  battery_kwh              NUMERIC(6,2),
  estimated_annual_savings NUMERIC(12,2),
  estimated_payback_years  NUMERIC(4,1),

  -- Pricing
  -- If NULL, "From $X" is computed from package_items + product cost+margin.
  -- If set, marketing has pinned a specific headline price.
  from_price_override      NUMERIC(14,2),

  -- For prefilling the website Get-Free-Quote form when "Get Quote" is clicked
  prefill                  JSONB DEFAULT '{}'::jsonb,

  -- Lifecycle
  is_active                BOOLEAN DEFAULT true,
  sort_order               INTEGER DEFAULT 0,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_packages_is_active  ON packages(is_active);
CREATE INDEX IF NOT EXISTS idx_packages_sort_order ON packages(sort_order);
CREATE INDEX IF NOT EXISTS idx_packages_tier       ON packages(tier);

-- ── package_items — products that make up a package ─────────────────────
-- Note ON DELETE RESTRICT for product_id: hard-deleting a product with
-- packages referencing it must fail loudly. Soft-delete (is_active=false)
-- on the product is fine and doesn't trigger this — packages can still
-- show the inactive product in their bill of materials, just flag it.
CREATE TABLE IF NOT EXISTS package_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id      UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty             INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  position        INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_package_items_package ON package_items(package_id);
CREATE INDEX IF NOT EXISTS idx_package_items_product ON package_items(product_id);
-- A given product appears at most once per package. Caller can change qty
-- to add more, no need for two rows of the same product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_package_items_unique ON package_items(package_id, product_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_packages_updated_at') THEN
    CREATE TRIGGER trg_packages_updated_at
      BEFORE UPDATE ON packages
      FOR EACH ROW
      EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;
