-- Phase 2 — Lead capture enhancements
--   - Structured lead source ("How did you hear about us?")
--   - Friend referral capture (referrer name + phone) for the rewards program
--   - Structured address columns populated by autocomplete (Nominatim now, swap to Google later)
--
-- Applies to website_enquiries (where public submissions land) and contacts
-- (the CRM-side mirror created from the same submission).

-- ── website_enquiries ────────────────────────────────────────────────────────
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS lead_source       VARCHAR(30),
  ADD COLUMN IF NOT EXISTS lead_source_other TEXT,
  ADD COLUMN IF NOT EXISTS referrer_name     VARCHAR(120),
  ADD COLUMN IF NOT EXISTS referrer_phone    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS street            VARCHAR(200),
  ADD COLUMN IF NOT EXISTS suburb            VARCHAR(120),
  ADD COLUMN IF NOT EXISTS city              VARCHAR(120),
  ADD COLUMN IF NOT EXISTS postcode          VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_enquiries_lead_source_check'
  ) THEN
    ALTER TABLE website_enquiries
      ADD CONSTRAINT website_enquiries_lead_source_check
      CHECK (lead_source IS NULL OR lead_source IN
        ('online_search','google_ads','facebook','instagram','friend_referral','other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_enquiries_battery_option_check'
  ) THEN
    ALTER TABLE website_enquiries
      ADD CONSTRAINT website_enquiries_battery_option_check
      CHECK (battery_option IS NULL OR battery_option IN ('with-battery','without-battery'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_website_enquiries_lead_source ON website_enquiries(lead_source);

-- ── contacts (CRM mirror) ────────────────────────────────────────────────────
-- contacts.source already exists as VARCHAR(50) free-text — we add the
-- structured companions so reports can group cleanly without breaking history.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_source       VARCHAR(30),
  ADD COLUMN IF NOT EXISTS lead_source_other TEXT,
  ADD COLUMN IF NOT EXISTS referrer_name     VARCHAR(120),
  ADD COLUMN IF NOT EXISTS referrer_phone    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS street            VARCHAR(200),
  ADD COLUMN IF NOT EXISTS suburb            VARCHAR(120),
  ADD COLUMN IF NOT EXISTS city              VARCHAR(120),
  ADD COLUMN IF NOT EXISTS postcode          VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_lead_source_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_lead_source_check
      CHECK (lead_source IS NULL OR lead_source IN
        ('online_search','google_ads','facebook','instagram','friend_referral','other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_lead_source ON contacts(lead_source);
