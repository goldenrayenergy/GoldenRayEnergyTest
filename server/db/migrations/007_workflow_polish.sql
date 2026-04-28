-- Phase 2 — Solar-business-owner workflow polish
-- Combines several related additions into one migration:
--   - First-call SLA timestamp
--   - Site-visit completion timestamp (gates "final" proposals)
--   - Cadence email IDs (so we can cancel scheduled emails on Lost/Disqualified)
--   - Disqualified sub_status
--   - Preliminary vs final proposal mode
--   - override_requests table for the two-step admin approval workflow

-- ── projects: SLA, site visit, cadence email tracking ─────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sla_first_call_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS site_visit_done_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cadence_email_ids     JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── projects: disqualified sub_status ─────────────────────────────────────
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_sub_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_sub_status_check
  CHECK (sub_status IS NULL OR sub_status IN ('lost', 'cancelled', 'on_hold', 'disqualified'));

-- ── proposals: preliminary vs final mode ──────────────────────────────────
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'preliminary'
    CHECK (mode IN ('preliminary', 'final'));

-- ── override_requests: two-step admin approval ────────────────────────────
CREATE TABLE IF NOT EXISTS override_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  proposal_id     UUID REFERENCES proposals(id) ON DELETE CASCADE,
  requested_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at    TIMESTAMPTZ DEFAULT NOW(),
  action_type     VARCHAR(50) NOT NULL
    CHECK (action_type IN ('force_advance', 'force_accept', 'backward_move')),
  action_payload  JSONB DEFAULT '{}'::jsonb,
  reason          TEXT NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decision_reason TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_override_requests_status     ON override_requests(status);
CREATE INDEX IF NOT EXISTS idx_override_requests_project    ON override_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_override_requests_requested_by ON override_requests(requested_by);
