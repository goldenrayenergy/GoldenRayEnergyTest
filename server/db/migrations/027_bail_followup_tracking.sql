-- ────────────────────────────────────────────────────────────────────────────
-- Migration 027 — Bail-out follow-up tracking
--
-- Pattern B Step-3 captures every wizard visitor as a status='partial'
-- enquiry before the analysis or final form runs. Visitors who don't return
-- to complete the wizard within 24h get an automated follow-up email
-- ("you were checking out solar — here's what we found from your bills")
-- delivered by the standalone server/scripts/send-bail-followups.js job.
--
-- This column is the idempotency guard: the job's UPDATE includes a
-- WHERE bail_followup_sent_at IS NULL filter so re-runs (or simultaneous
-- runs from multiple workers) cannot double-send.
--
-- Partial-index keeps the daily query fast even when website_enquiries
-- grows: only rows that are eligible candidates are indexed.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS bail_followup_sent_at TIMESTAMPTZ;

-- Eligible candidates only — keeps the index small.
CREATE INDEX IF NOT EXISTS idx_website_enquiries_bail_candidates
  ON website_enquiries(created_at)
  WHERE status = 'partial' AND bail_followup_sent_at IS NULL;
