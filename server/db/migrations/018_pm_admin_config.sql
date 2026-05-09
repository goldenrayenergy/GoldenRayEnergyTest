-- ────────────────────────────────────────────────────────────────────────────
-- PM Tool — admin-editable config tables for the proposal generator.
--
-- Three tables let owners/admins edit values that today are hardcoded in
-- the sample PDF scripts, without needing a code redeploy:
--
--   company_settings   — single-row config: bank account, phone, signer,
--                        logo, FAQ copy, Why-us bullets, validity windows
--   financing_options  — bank loan options shown on the proposal (rates
--                        change quarterly; admin updates without redeploy)
--   proposal_terms     — versioned T&Cs. Customer accepts a specific
--                        version. Audit trail for legal disputes.
--
-- All three include seed data based on the values used in the standalone
-- sample PDFs so the generator works out of the box.
-- ────────────────────────────────────────────────────────────────────────────


-- ── company_settings ──────────────────────────────────────────────────────
-- Single-row config. CHECK constraint ensures only one row exists.
CREATE TABLE IF NOT EXISTS company_settings (
  id                          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Legal & contact
  legal_name                  VARCHAR(120),
  trading_name                VARCHAR(120),
  contact_phone               VARCHAR(40),
  contact_email               VARCHAR(120),
  support_phone               VARCHAR(40),

  -- Bank (for deposit instructions on proposals)
  bank_account_name           VARCHAR(120),
  bank_account_number         VARCHAR(40),
  bank_name                   VARCHAR(40),
  bank_reference_template     VARCHAR(80),     -- e.g., '${proposal_number}'

  -- Default proposal signer (the company-side counter-signer)
  signer_name                 VARCHAR(120),
  signer_title                VARCHAR(80),
  signer_email                VARCHAR(120),

  -- Branding
  logo_url                    TEXT,            -- public URL to logo image (or relative /logo.jpg)

  -- Operational defaults
  crew_capacity_per_week      INTEGER DEFAULT 4,
  proposal_validity_days_stage1 INTEGER DEFAULT 14,
  proposal_validity_days_stage2 INTEGER DEFAULT 30,
  default_deposit_pct         NUMERIC(5,2) DEFAULT 30.00,
  default_progress_pct        NUMERIC(5,2) DEFAULT 35.00,

  -- Customer-facing copy editable by admin (proposal-page sections)
  faq_json                    JSONB DEFAULT '[]'::jsonb,         -- [{q, a}]
  why_us_json                 JSONB DEFAULT '[]'::jsonb,         -- [{icon, title, desc}]
  closing_statement           TEXT,                              -- "We're a small NZ team..."

  -- Email
  email_from_address          VARCHAR(120),                      -- e.g., "Goldenray <hello@goldenray.energy>"

  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger: bump updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_company_settings_updated_at') THEN
    CREATE TRIGGER trg_company_settings_updated_at
      BEFORE UPDATE ON company_settings
      FOR EACH ROW
      EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;

-- Seed initial row (idempotent — only inserts if not present)
INSERT INTO company_settings (
  id, legal_name, trading_name, contact_phone, contact_email, support_phone,
  bank_account_name, bank_account_number, bank_name, bank_reference_template,
  signer_name, signer_title, signer_email,
  logo_url, crew_capacity_per_week,
  proposal_validity_days_stage1, proposal_validity_days_stage2,
  default_deposit_pct, default_progress_pct,
  faq_json, why_us_json, closing_statement,
  email_from_address
) VALUES (
  1,
  'Goldenray Energy NZ Ltd',
  'Goldenray Energy',
  '0800 GOLDENRAY',
  'hello@goldenray.energy',
  'support@goldenray.energy',
  'Goldenray Energy NZ Ltd',
  '12-3456-7890123-00',
  'ASB Bank',
  '${proposal_number}',
  'Sarah Chen',
  'Director',
  'sarah@goldenray.energy',
  '/logo.jpg',
  4,
  14,
  30,
  30.00,
  35.00,
  '[
    {"q":"What if I sell the house?","a":"The system transfers to the new owner with all warranties intact. Real-estate studies in NZ show a typical $10,000–$15,000 increase in resale value for a 6-15 kW system, plus faster sale. We provide a clean transfer pack."},
    {"q":"What if a panel fails?","a":"Panels carry a 30-year performance warranty. Our monitoring detects underperformance automatically. Replacement is at no cost during the warranty period."},
    {"q":"What about hail, storms, or a falling branch?","a":"Manufacturer warranty covers manufacturing defects. Storm/hail/impact damage is covered by your home insurance — solar panels are treated the same as roofing material."},
    {"q":"Can I add a battery later if I start with solar-only?","a":"Yes. We always quote with a hybrid-ready inverter — adding a battery later is a half-day install, no inverter swap needed."},
    {"q":"What if my roof needs replacing in 10 years?","a":"We can remove the panels, store them on-site for 1-2 days while your roofer works, and reinstall — typically $1,500-2,000."},
    {"q":"What if NZ electricity prices fall?","a":"Your savings shrink (we model conservatively at 5%/year inflation). But your bill never goes negative — solar always offsets some consumption."}
  ]'::jsonb,
  '[
    {"icon":"👷","title":"100% in-house install crew","desc":"Same people who design your system bolt the panels on. No sub-contractors."},
    {"icon":"🛡️","title":"5-year workmanship warranty","desc":"Industry standard is 2. We back our work for 5 years on labour, parts and call-out."},
    {"icon":"👤","title":"Single point of contact","desc":"One person is your designer, installer-coordinator and 5-year support contact."},
    {"icon":"📊","title":"Monitoring pre-set on day one","desc":"You see live generation on the inverter app before our crew leaves your house."},
    {"icon":"🩺","title":"Free first-year health check","desc":"Most installers charge $250. We include it because issues are easiest caught early."}
  ]'::jsonb,
  'We''re a small NZ team — you''ll get the same person every time.',
  'Goldenray Energy <hello@goldenray.energy>'
) ON CONFLICT (id) DO NOTHING;


-- ── financing_options ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financing_options (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(80) NOT NULL,           -- e.g. "ASB Green Loan"
  bank            VARCHAR(40),                    -- e.g. "ASB"
  base_rate_pct   NUMERIC(5,2),                   -- rate AFTER promo period ends
  promo_rate_pct  NUMERIC(5,2),                   -- promotional rate (0 = interest-free)
  promo_years     INTEGER DEFAULT 0,              -- duration of promo period
  term_years      INTEGER NOT NULL DEFAULT 7,
  max_amount_nzd  NUMERIC(12,2),                  -- loan cap
  notes           TEXT,                            -- displayed under the option on proposal
  is_active       BOOLEAN DEFAULT true,
  display_order   INTEGER DEFAULT 100,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_financing_options_updated_at') THEN
    CREATE TRIGGER trg_financing_options_updated_at
      BEFORE UPDATE ON financing_options
      FOR EACH ROW
      EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;

-- Seed (idempotent — checks by name)
INSERT INTO financing_options (name, bank, base_rate_pct, promo_rate_pct, promo_years, term_years, max_amount_nzd, notes, display_order)
SELECT 'ASB Green Loan', 'ASB', 5.50, 1.00, 3, 7, 50000, 'Available to ASB home-owner accounts. 1% for first 3 years, then floats. Verify rate directly with ASB.', 10
WHERE NOT EXISTS (SELECT 1 FROM financing_options WHERE name = 'ASB Green Loan');

INSERT INTO financing_options (name, bank, base_rate_pct, promo_rate_pct, promo_years, term_years, max_amount_nzd, notes, display_order)
SELECT 'BNZ Better Home Loan', 'BNZ', 6.20, 1.00, 5, 5, 80000, 'Top-up on existing BNZ home loan. 1% for 5 years. Verify directly with BNZ.', 20
WHERE NOT EXISTS (SELECT 1 FROM financing_options WHERE name = 'BNZ Better Home Loan');

INSERT INTO financing_options (name, bank, base_rate_pct, promo_rate_pct, promo_years, term_years, max_amount_nzd, notes, display_order)
SELECT 'Cash', NULL, 0.00, 0.00, 0, 0, NULL, 'Single payment. Best long-term value.', 5
WHERE NOT EXISTS (SELECT 1 FROM financing_options WHERE name = 'Cash');


-- ── proposal_terms ────────────────────────────────────────────────────────
-- Versioned T&Cs. The customer accepts a specific version (audit trail).
CREATE TABLE IF NOT EXISTS proposal_terms (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version         VARCHAR(20) UNIQUE NOT NULL,    -- e.g., '2026.1'
  effective_from  DATE NOT NULL,
  terms_json      JSONB NOT NULL,                  -- [{title, body}]
  is_current      BOOLEAN DEFAULT false,
  notes           TEXT,                            -- internal note about why this version differs
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      UUID                             -- soft FK to staff/users
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_terms_current
  ON proposal_terms (is_current) WHERE is_current = true;

-- Seed v2026.1 — same content as the Stage 2 sample script
INSERT INTO proposal_terms (version, effective_from, is_current, terms_json, notes)
SELECT
  '2026.1',
  '2026-01-01'::date,
  true,
  '[
    {"title":"1. Acceptance & Pricing","body":"This proposal is valid for the period stated. The total price is locked subject to acceptance within validity, site conditions remaining as observed during the site visit, and component availability. Material price changes >5% may be passed through with prior written notice and customer approval."},
    {"title":"2. Payment Schedule","body":"Deposit (typically 30%) due within 7 days of acceptance. Progress payment (typically 35%) due on materials delivery. Final (typically 35%) due within 7 days of commissioning. Late payments (>14 days) may incur interest at 1.5% per month on outstanding balance."},
    {"title":"3. Workmanship & Warranty","body":"Goldenray Energy NZ Ltd warrants installation workmanship for 5 years from commissioning. Manufacturer warranties for panels, inverter, and battery are passed through with original duration. Consumer Guarantees Act 1993 rights are not affected."},
    {"title":"4. Performance Estimates","body":"Annual generation and savings are modeled estimates using PVsyst, NIWA SolarView irradiance data, and 5% retail electricity inflation. Actual outcomes depend on weather, household behaviour, retailer pricing, and policy changes. Goldenray does not guarantee specific generation, savings, or payback periods."},
    {"title":"5. Site Conditions & Variations","body":"This proposal assumes the site conditions documented in the Site Visit Summary. If hidden conditions are discovered (asbestos, structural defects, switchboard non-compliance, hidden roof damage), Goldenray will notify the customer in writing with itemised costs and obtain written approval before proceeding."},
    {"title":"6. Title & Risk","body":"Title to all installed equipment passes to the customer on receipt of final payment. Risk passes on commissioning. Goldenray retains the right to reclaim equipment for non-payment >60 days overdue."},
    {"title":"7. Cancellation","body":"Customer may cancel within 7 days of acceptance for full refund of deposit. After 7 days, deposit is non-refundable except where Goldenray fails to perform or invokes a variation under §5."},
    {"title":"8. Privacy","body":"Customer details, bills, and bill-analysis data are stored securely and used only for project delivery, ongoing support, and (with explicit consent) future VPP enrollment offers. Data is never sold or shared with third parties beyond compliance requirements."},
    {"title":"9. Dispute Resolution","body":"Parties will first attempt direct resolution. If unresolved within 30 days, mediation through the New Zealand Dispute Resolution Centre. New Zealand law applies; New Zealand courts have exclusive jurisdiction."},
    {"title":"10. VPP Enrollment (Future)","body":"Customer is under no obligation to enroll in any future Goldenray Virtual Power Plant programme. If customer opts in, separate VPP enrollment terms apply. Goldenray makes no representations about VPP earnings."}
  ]'::jsonb,
  'Initial T&Cs version. Approved by Sarah Chen (Director) on 2026-01-01.'
WHERE NOT EXISTS (SELECT 1 FROM proposal_terms WHERE version = '2026.1');
