-- Migration 029 — surface per-bill parse observability to the portal
--
-- Today the parser computes parse_warnings (line_items_dont_sum, gst_not_15pct,
-- kwh_low_vs_total, etc.) and field_confidence per bill but they're dropped at
-- persistence time. The sales team can see analysis-level review_required but
-- not which specific bill / which specific field is suspect. This migration
-- makes both visible so the Bills + Analysis tab can show a drill-down row
-- per bill with reconciliation status and red flags.
--
-- Both columns are JSONB so we can extend the per-bill schema without DDL
-- changes later (e.g. adding tariff_consistency_check, kwh_export_negative_check).

ALTER TABLE bill_uploads
  ADD COLUMN IF NOT EXISTS parse_warnings JSONB DEFAULT '[]'::jsonb;

-- Note: field_confidence column already exists from migration 025. We're only
-- adding parse_warnings here. Existing rows default to []; backfill on next
-- analysis re-run (or click "Re-analyze" in admin).

-- PostgREST schema cache reload — required so /rest/v1/bill_uploads exposes
-- the new column without a restart.
NOTIFY pgrst, 'reload schema';
