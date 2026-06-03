-- ────────────────────────────────────────────────────────────────────────────
-- Migration 025 — Bill extraction v2 + validation gate
--
-- Adds the columns needed to move the bill-analysis engine from ~35% to ~75%
-- compliance with the accuracy rule-set:
--
--   bill_uploads:
--     service_address       — extracted from each bill (rule 3.6, section 6)
--     icp_number            — NZ Installation Control Point (rule 3.10)
--     network_distributor   — Vector / Counties / etc (rule 12.3)
--     tariff_components     — JSONB per-rate breakdown (rule 12.4)
--     payment_date          — when customer paid (rule 14.2 financial-health signal)
--     due_date              — bill due date (same)
--     raw_extracted_fields  — JSONB catch-all so future engines can mine OCR
--                             output for fields we didn't think to extract
--                             (this is the "no PDF storage but still re-runnable"
--                             insurance policy)
--     ocr_text_full         — promoted from VARCHAR(4000) to full TEXT — same
--                             reason as raw_extracted_fields
--     field_confidence      — JSONB { field_name: 0.0-1.0 } — per-field
--                             confidence (rules 3.15, 13.1)
--     parse_method          — 'text' | 'ocr' | 'failed' (rules 13.6, 15.5)
--
--   bill_analyses:
--     review_required       — boolean gate (rules 4.10, 14.10, 16.9, 16.12, 16.15)
--     review_reasons        — JSONB array of {code, severity, message}
--     region_resolved_from  — 'address_postcode' | 'default' | 'user_override'
--                             — audit how we picked the region (rule 1.4)
--
-- All changes are additive + idempotent. Existing rows keep working.
-- ────────────────────────────────────────────────────────────────────────────

-- ── bill_uploads additions ────────────────────────────────────────────────
ALTER TABLE bill_uploads
  ADD COLUMN IF NOT EXISTS service_address       VARCHAR(300),
  ADD COLUMN IF NOT EXISTS icp_number            VARCHAR(50),
  ADD COLUMN IF NOT EXISTS network_distributor   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS tariff_components     JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_date          DATE,
  ADD COLUMN IF NOT EXISTS due_date              DATE,
  ADD COLUMN IF NOT EXISTS raw_extracted_fields  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_text_full         TEXT,
  ADD COLUMN IF NOT EXISTS field_confidence      JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parse_method          VARCHAR(20);

-- Index for distributor lookups when sales filters by network operator
CREATE INDEX IF NOT EXISTS idx_bill_uploads_distributor
  ON bill_uploads(network_distributor)
  WHERE network_distributor IS NOT NULL;

-- Index for ICP-based lookups (sales can search "give me everyone on ICP 1234...")
CREATE INDEX IF NOT EXISTS idx_bill_uploads_icp
  ON bill_uploads(icp_number)
  WHERE icp_number IS NOT NULL;

-- ── bill_analyses additions ───────────────────────────────────────────────
ALTER TABLE bill_analyses
  ADD COLUMN IF NOT EXISTS review_required      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reasons       JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS region_resolved_from VARCHAR(40);

-- Index so the portal "Review queue" view is fast
CREATE INDEX IF NOT EXISTS idx_bill_analyses_review
  ON bill_analyses(review_required, created_at DESC)
  WHERE review_required = true;
