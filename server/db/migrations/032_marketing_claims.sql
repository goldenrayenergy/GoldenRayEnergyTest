-- ────────────────────────────────────────────────────────────────────────────
-- Migration 032 — products.marketing_claims
--
-- Adds a JSONB column to the products table that holds the customer-facing
-- "why we picked this kit" copy: headline, badges, bullets, side-by-side
-- comparison values, and the manufacturer credibility blurb.
--
-- The customer PDF's new "Premium hardware — why we picked this" page
-- reads from this column so the content scales to any future brand (Victron,
-- Reserva, Enphase, …) without code changes — admin just edits the JSON.
--
-- Shape (per product):
-- {
--   "headline":  "Engineered in Austria. Built for global excellence.",
--   "badges":    ["MADE IN AUSTRIA", "15-YR WARRANTY", ...],
--   "bullets":   [{ "claim": "...", "detail": "..." }, ...],
--   "comparison": { "origin": "Made in Austria", "warranty_yrs": 15, ... },
--   "manufacturer_blurb": "Founded 1945, Austrian family company, ..."
-- }
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS marketing_claims JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN products.marketing_claims IS
  'Customer-facing marketing copy for the "why this kit" PDF page. Keys: headline, badges[], bullets[{claim, detail}], comparison{}, manufacturer_blurb. Empty {} means the page falls back to a generic description.';
