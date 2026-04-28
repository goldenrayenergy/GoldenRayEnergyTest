-- Phase 1 — Projects workflow (pipeline: new → design → selling → installation → maintenance → exit)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── projects ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code             VARCHAR(20) UNIQUE NOT NULL,
  customer_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  stage            VARCHAR(20) NOT NULL DEFAULT 'new'
                     CHECK (stage IN ('new','design','selling','installation','maintenance','exit')),
  sub_status       VARCHAR(20)
                     CHECK (sub_status IN ('lost','cancelled','on_hold') OR sub_status IS NULL),
  owner_id         UUID REFERENCES users(id) ON DELETE SET NULL,

  address          TEXT,
  suburb           VARCHAR(100),
  city             VARCHAR(100),
  region           VARCHAR(100),
  postcode         VARCHAR(10),

  system_size_kw   NUMERIC(6,2),
  panels           INTEGER,
  battery_kwh      NUMERIC(6,2),
  system_type      VARCHAR(20),
  estimated_value  NUMERIC(14,2),

  notes            TEXT,
  stage_entered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_stage      ON projects(stage);
CREATE INDEX IF NOT EXISTS idx_projects_customer   ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner      ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

-- ── link tasks and activities to projects (optional FK) ──────────────────
ALTER TABLE tasks      ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_project      ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_activities_project ON activities(project_id);

-- ── trigger: bump updated_at on row change ───────────────────────────────
CREATE TRIGGER trg_projects_updated
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();
