-- Phase 1.3 — Link proposals to projects
-- Lets the Selling-stage tabs (Online Proposal, PDF Proposal) list and create
-- proposals scoped to a specific project, while keeping legacy contact_id /
-- deal_id linkage intact for any older rows.

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version    INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS viewed_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals(project_id);
