-- ════════════════════════════════════════════════════════════════════
-- Migration 002: Solar Finance Applications
-- Run this ONCE in Supabase → SQL Editor to add the finance_applications table
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS finance_applications (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Applicant
  first_name           VARCHAR(80),
  last_name            VARCHAR(80),
  email                VARCHAR(255),
  phone                VARCHAR(50),
  address              TEXT,

  -- Finance details
  product              VARCHAR(50)  NOT NULL CHECK (product IN ('green_loan','interest_free','payment_plan','bank_topup')),
  loan_amount          NUMERIC(12,2) NOT NULL,
  term_years           INTEGER       NOT NULL DEFAULT 5,
  estimated_monthly    NUMERIC(10,2),

  -- Affordability / eligibility
  home_ownership       VARCHAR(20)  CHECK (home_ownership IN ('own','mortgage','renting','other')),
  monthly_income_band  VARCHAR(30),
  employment_type      VARCHAR(30),
  existing_bank        VARCHAR(60),
  credit_consent       BOOLEAN      DEFAULT false,

  -- Linked CRM refs
  contact_id           UUID REFERENCES contacts(id) ON DELETE SET NULL,
  assigned_to          UUID REFERENCES users(id)    ON DELETE SET NULL,

  status               VARCHAR(20)  DEFAULT 'submitted' CHECK (status IN ('submitted','pre_approved','approved','rejected','completed')),
  notes                TEXT,

  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finapps_status     ON finance_applications(status);
CREATE INDEX IF NOT EXISTS idx_finapps_email      ON finance_applications(email);
CREATE INDEX IF NOT EXISTS idx_finapps_created_at ON finance_applications(created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_finapps_updated') THEN
    CREATE TRIGGER trg_finapps_updated BEFORE UPDATE ON finance_applications
      FOR EACH ROW EXECUTE FUNCTION update_modified_column();
  END IF;
END$$;
