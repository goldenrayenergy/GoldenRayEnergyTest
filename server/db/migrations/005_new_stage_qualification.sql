-- Phase 1.2 — New-stage qualification fields
-- Adds explicit data fields for "Assign owner" / "Call customer" / "Qualify lead"
-- so the New-stage checklist becomes a real data-capture step instead of
-- bare on/off checkboxes.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS quality VARCHAR(10)
    CHECK (quality IN ('hot','warm','cold') OR quality IS NULL),
  ADD COLUMN IF NOT EXISTS call_outcome VARCHAR(20)
    CHECK (call_outcome IN ('reached','voicemail','no_answer','wrong_number') OR call_outcome IS NULL),
  ADD COLUMN IF NOT EXISTS call_notes TEXT,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS website_enquiry_id UUID REFERENCES website_enquiries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_website_enquiry ON projects(website_enquiry_id);
