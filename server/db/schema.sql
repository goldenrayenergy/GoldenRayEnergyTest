-- ═══════ GoldenRay Energy — PostgreSQL Schema ═══════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Shared trigger function (declared early so triggers below can reference it) ──
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── Users / Employees ──
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'sales_exec'
    CHECK (role IN ('admin','sales_mgr','sales_exec','proposal_mgr')),
  avatar VARCHAR(10),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Contacts / Leads ──
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  type VARCHAR(20) DEFAULT 'residential' CHECK (type IN ('residential','commercial')),
  system_type VARCHAR(20) DEFAULT 'on-grid' CHECK (system_type IN ('on-grid','off-grid','hybrid')),
  location VARCHAR(100),
  monthly_bill NUMERIC(12,2),
  stage VARCHAR(30) DEFAULT 'new',
  source VARCHAR(50),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  company_id UUID,
  estimated_value NUMERIC(14,2),
  lifecycle VARCHAR(30) DEFAULT 'subscriber',
  lead_score INTEGER DEFAULT 0,
  last_activity TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Companies ──
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  domain VARCHAR(255),
  industry VARCHAR(100),
  size VARCHAR(50),
  city VARCHAR(100),
  annual_revenue VARCHAR(50),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  lifecycle VARCHAR(30) DEFAULT 'lead',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contacts ADD CONSTRAINT fk_contact_company
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

-- ── Deals ──
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  stage VARCHAR(30) DEFAULT 'appointment'
    CHECK (stage IN ('appointment','qualified','presentation','proposal','negotiation','closed_won','closed_lost')),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  close_date DATE,
  deal_type VARCHAR(50) DEFAULT 'New Business',
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  probability INTEGER DEFAULT 10,
  lost_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Pipeline States (Lead stages config) ──
CREATE TABLE pipeline_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stage_key VARCHAR(30) UNIQUE NOT NULL,
  label VARCHAR(60) NOT NULL,
  color VARCHAR(10),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

-- ── Campaigns ──
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  type VARCHAR(30) CHECK (type IN ('email','paid','event','referral','content','social')),
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed')),
  channel VARCHAR(50),
  budget NUMERIC(12,2) DEFAULT 0,
  spent NUMERIC(12,2) DEFAULT 0,
  start_date DATE,
  end_date DATE,
  -- Email-specific
  emails_sent INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  emails_bounced INTEGER DEFAULT 0,
  unsubscribed INTEGER DEFAULT 0,
  -- Ad-specific
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  -- Results
  leads_generated INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  revenue_attributed NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tasks ──
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(300) NOT NULL,
  description TEXT,
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  due_date DATE,
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  status VARCHAR(20) DEFAULT 'todo' CHECK (status IN ('todo','in_progress','completed','overdue')),
  task_type VARCHAR(50),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Activities ──
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(30) NOT NULL CHECK (type IN ('call','email','meeting','note','task','system')),
  description TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  duration_minutes INTEGER DEFAULT 0,
  outcome VARCHAR(30),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Proposals ──
CREATE TABLE proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  system_size_kw NUMERIC(8,2),
  panel_count INTEGER,
  battery_kwh NUMERIC(8,2) DEFAULT 0,
  total_cost NUMERIC(14,2),
  monthly_savings NUMERIC(10,2),
  annual_savings NUMERIC(12,2),
  payback_years NUMERIC(4,1),
  roi_percent NUMERIC(6,1),
  co2_tons_year NUMERIC(8,2),
  pdf_url TEXT,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','accepted','rejected')),
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Website Enquiries (public quote form submissions) ──
CREATE TABLE website_enquiries (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  first_name             VARCHAR(80),
  last_name              VARCHAR(80),
  email                  VARCHAR(255),
  phone                  VARCHAR(50),

  address                TEXT,
  owns_home              VARCHAR(10),
  floors                 INTEGER,
  roof_type              VARCHAR(50),

  installation_type      VARCHAR(20),
  battery_option         VARCHAR(30),
  call_to_discuss        VARCHAR(10),
  installation_timeframe VARCHAR(30),
  monthly_bill           NUMERIC(10,2),

  system_size_kw         NUMERIC(8,2),
  panels                 INTEGER,
  battery_kwh            NUMERIC(8,2),
  total_cost             NUMERIC(14,2),
  monthly_savings        NUMERIC(10,2),
  annual_savings         NUMERIC(12,2),
  payback_years          NUMERIC(4,1),
  roi_percent            NUMERIC(6,1),

  lead_score             INTEGER DEFAULT 0,
  status                 VARCHAR(20) DEFAULT 'new',
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── Solar Finance Applications ──
CREATE TABLE finance_applications (
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

CREATE INDEX idx_finapps_status     ON finance_applications(status);
CREATE INDEX idx_finapps_email      ON finance_applications(email);
CREATE INDEX idx_finapps_created_at ON finance_applications(created_at DESC);

CREATE TRIGGER trg_finapps_updated BEFORE UPDATE ON finance_applications FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- ── System Config ──
CREATE TABLE system_config (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX idx_contacts_stage ON contacts(stage);
CREATE INDEX idx_contacts_assigned ON contacts(assigned_to);
CREATE INDEX idx_contacts_source ON contacts(source);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_deals_owner ON deals(owner_id);
CREATE INDEX idx_deals_close_date ON deals(close_date);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_activities_contact ON activities(contact_id);
CREATE INDEX idx_activities_user ON activities(user_id);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_wenq_email      ON website_enquiries(email);
CREATE INDEX idx_wenq_status     ON website_enquiries(status);
CREATE INDEX idx_wenq_created_at ON website_enquiries(created_at DESC);

-- ── Triggers for updated_at (function defined at top of file) ──
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_contacts_updated BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_deals_updated BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_campaigns_updated BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_proposals_updated BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION update_modified_column();
