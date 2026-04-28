-- Phase 1.1 — Stage-gate checklist progress
-- Tracks which required items have been completed per project.
-- Structure: { "new.owner": true, "design.photos": false, ... }
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS stage_progress JSONB NOT NULL DEFAULT '{}'::jsonb;
