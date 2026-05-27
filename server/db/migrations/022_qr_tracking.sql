-- ────────────────────────────────────────────────────────────────────────────
-- Migration 022 — QR-code campaign tracking
--
-- Adds two new tables and a small set of UTM columns to existing lead tables:
--
--   qr_codes   — one row per dynamic QR (business card, trade show, flyer…).
--                The slug is the URL path: /qr/<slug>. Editing destination
--                or UTM tags here changes behaviour for printed QRs without
--                reprinting (the QR encodes only the slug, not the dest).
--
--   qr_scans   — one row per scan event. Captures device/IP/referrer for
--                analytics. Links to a lead (website_enquiries / contacts)
--                once the scanned visitor submits the /get-quote form.
--
--   website_enquiries + contacts — three new columns each: utm_source,
--                utm_medium, utm_campaign. Capture which marketing surface
--                produced this lead. Populated by /api/quote/submit reading
--                the request body's utm_* fields.
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. qr_codes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_codes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug              VARCHAR(50)  NOT NULL UNIQUE,
  campaign_name     VARCHAR(200) NOT NULL,
  destination_path  VARCHAR(200) NOT NULL DEFAULT '/get-quote',
  utm_source        VARCHAR(50)  NOT NULL,
  utm_medium        VARCHAR(50)  NOT NULL,
  utm_campaign      VARCHAR(80)  NOT NULL,
  is_active         BOOLEAN      NOT NULL DEFAULT true,
  notes             TEXT,
  created_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT qr_codes_slug_format   CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,49}$'),
  CONSTRAINT qr_codes_dest_starts_w_slash CHECK (destination_path LIKE '/%')
);
CREATE INDEX IF NOT EXISTS idx_qr_codes_slug      ON qr_codes(slug);
CREATE INDEX IF NOT EXISTS idx_qr_codes_active    ON qr_codes(is_active) WHERE is_active = true;

COMMENT ON TABLE  qr_codes IS
  'Dynamic QR campaigns. Each row maps a URL-safe slug to a destination + UTM params. Print the slug-encoded URL once; change behaviour via this table without reprinting.';
COMMENT ON COLUMN qr_codes.slug IS
  'URL-safe identifier appearing as /qr/<slug>. Lowercase alphanumeric + hyphens. Once printed on physical materials it should be considered immutable.';

-- ── 2. qr_scans ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_scans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  qr_code_id      UUID NOT NULL REFERENCES qr_codes(id) ON DELETE CASCADE,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent      TEXT,
  device_type     VARCHAR(30),    -- 'iPhone' / 'Android' / 'Desktop' / 'Other'
  ip_address      INET,
  referrer        TEXT,
  -- Filled when this scan's visitor later submits the /get-quote form.
  -- Linkage happens via a session/scan cookie (qr_scan_id) the redirect sets.
  lead_enquiry_id UUID REFERENCES website_enquiries(id) ON DELETE SET NULL,
  lead_contact_id UUID REFERENCES contacts(id)          ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_qr_scans_code_id    ON qr_scans(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_qr_scans_scanned_at ON qr_scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_qr_scans_lead_enq   ON qr_scans(lead_enquiry_id) WHERE lead_enquiry_id IS NOT NULL;

COMMENT ON TABLE qr_scans IS
  'One row per QR scan event. Used for the admin "QR performance" dashboard (scans → form-submits → confirmed leads).';

-- ── 3. UTM columns on the two lead tables ─────────────────────────────────
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS utm_source   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS utm_medium   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(80),
  ADD COLUMN IF NOT EXISTS qr_scan_id   UUID REFERENCES qr_scans(id) ON DELETE SET NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS utm_source   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS utm_medium   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(80),
  ADD COLUMN IF NOT EXISTS qr_scan_id   UUID REFERENCES qr_scans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_website_enquiries_utm_source ON website_enquiries(utm_source) WHERE utm_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_utm_source          ON contacts(utm_source)          WHERE utm_source IS NOT NULL;

-- ── 4. updated_at trigger on qr_codes ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qr_codes_updated_at') THEN
    CREATE TRIGGER trg_qr_codes_updated_at
      BEFORE UPDATE ON qr_codes
      FOR EACH ROW EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;
