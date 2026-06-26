-- ────────────────────────────────────────────────────────────────────────────
-- 033 — error_reports — the "Report it" backend.
--
-- One row per DISTINCT problem (deduped by fingerprint, default = the catalogue
-- error code). Repeated reports of the same problem increment `occurrences` and
-- refresh last_reported_* instead of creating a new row — so the dev team sees
-- "happened 50× this week", not 50 tickets. Powers the owner dashboard (Slice 5)
-- and the auto-GitHub-issue routing.
--
-- Backs: docs/TEAM_ERROR_PLAYBOOK.md "Report it — how it works".
-- Additive only — no existing table touched.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS error_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dedup key. Defaults to the catalogue code; the client may pass a more
  -- specific fingerprint (e.g. 'render_crash:/pm/quotes/123') when one code
  -- spans many distinct situations.
  fingerprint         VARCHAR(200) NOT NULL UNIQUE,

  -- Snapshot of the catalogue entry at report time (so the dashboard reads
  -- without re-deriving, and history survives catalogue wording changes).
  code                VARCHAR(120) NOT NULL,
  area                VARCHAR(40),               -- bill | quote | pricing | sales | system
  owner               VARCHAR(20),               -- rep | admin | dev  (routing)
  severity            VARCHAR(20),               -- block | flag | info
  title               TEXT,
  screen              VARCHAR(120),              -- where it was reported from

  -- Latest sample of the technical detail + structured context (quote/customer/
  -- upload ids, raw message) — enough for the dev team to reproduce.
  sample_detail       TEXT,
  sample_context      JSONB NOT NULL DEFAULT '{}'::jsonb,

  occurrences         INTEGER NOT NULL DEFAULT 1,
  status              VARCHAR(20) NOT NULL DEFAULT 'open',   -- open | resolved

  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID,

  first_reported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_reported_by   UUID,
  last_reported_by    UUID
);

-- Dashboard reads: open reports, busiest first.
CREATE INDEX IF NOT EXISTS idx_error_reports_status_occ
  ON error_reports (status, occurrences DESC);
CREATE INDEX IF NOT EXISTS idx_error_reports_code
  ON error_reports (code);
