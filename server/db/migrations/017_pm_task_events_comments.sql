-- ────────────────────────────────────────────────────────────────────────────
-- PM Tool — Phase A.2: per-task audit log + slack-style comments
--
-- Each "task" is identified by a composite key (project_id + lane + item_key).
-- We don't promote tasks to first-class rows because their definitions live in
-- code (laneDefinitions.js) and per-task structured data lives in the
-- projects_v2.lane_status JSONB. This keeps tasks malleable as the schema
-- evolves without N migrations per task type added.
--
-- pm_task_events: append-only audit log. Every state transition, field edit,
--                 file upload, comment, gate-check is one row. Drives the
--                 activity-timeline view and is the legal record for warranty
--                 / compliance disputes.
--
-- pm_task_comments: slack-style internal thread per task. Threaded via
--                   parent_id. @mentions stored as a UUID array for easy
--                   notification fan-out (later phase).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pm_task_events (
  id              BIGSERIAL PRIMARY KEY,
  project_id      UUID NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  lane            VARCHAR(20) NOT NULL
                    CHECK (lane IN ('sales','engineering','compliance','operations','finance')),
  item_key        VARCHAR(60) NOT NULL,

  event_type      VARCHAR(40) NOT NULL,
  -- Common types: state_changed | field_edited | file_uploaded | file_deleted |
  --               gate_check_passed | gate_check_blocked | comment_added |
  --               assigned | unassigned | reopened

  actor_user_id   UUID,                        -- soft FK to staff/users
  payload         JSONB DEFAULT '{}'::jsonb,   -- e.g., { from: 'submitted', to: 'approved' }
  ip_address      VARCHAR(45),                 -- IPv4/IPv6 for legal trail
  user_agent      TEXT,

  occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pm_events_task
  ON pm_task_events(project_id, lane, item_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_events_project_time
  ON pm_task_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_events_actor
  ON pm_task_events(actor_user_id) WHERE actor_user_id IS NOT NULL;


-- ── pm_task_comments ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pm_task_comments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  lane            VARCHAR(20) NOT NULL
                    CHECK (lane IN ('sales','engineering','compliance','operations','finance')),
  item_key        VARCHAR(60) NOT NULL,

  parent_id       UUID REFERENCES pm_task_comments(id) ON DELETE CASCADE,
  author_user_id  UUID,                        -- soft FK to staff/users
  body            TEXT NOT NULL,
  mentions        UUID[] DEFAULT '{}',         -- @-mentioned user IDs

  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,                 -- soft delete
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pm_comments_task
  ON pm_task_comments(project_id, lane, item_key, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pm_comments_parent
  ON pm_task_comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pm_comments_mentions
  ON pm_task_comments USING GIN (mentions);
