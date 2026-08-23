-- ────────────────────────────────────────────────────────────────────────────
-- Migration 043 — Referral system (Phase 3 of Step-5 What-Next CTA rebuild)
--
-- Owner decisions captured 2026-08-22:
--   1. Credit amount:  $250 symmetric (both referrer AND referred friend).
--   2. Unlock trigger: BOTH credits unlock when friend's install completes
--                      (projects_v2.status transitions to 'completed').
--   3. Redemption:     Admin manually processes payout (cheque or bank
--                      transfer at admin's discretion). No auto-payout.
--   4. Expiry:         6 months from unlock. Unclaimed credit past that
--                      auto-expires (nightly job — see server code).
--   5. Cap:            Max 5 SUCCESSFUL referrals per referrer per rolling
--                      12-month window. Enforced at attribution time.
--   6. Fraud handling: Auto-block if friend's email OR phone matches the
--                      referrer's contact record. Address matching deferred
--                      (contacts table only has coarse `location`; would
--                      need a separate normaliser to fuzzy-match street/
--                      suburb/postcode). Admin can manually approve
--                      blocked referrals in the portal.
--
-- Two-table design:
--   `referral_codes`  — one row per (contact, active code) pair. Codes are
--                       generated on-demand when a customer clicks "Refer a
--                       friend" on Step 5. Admin can revoke by setting
--                       revoked_at — no cascade delete of the referrals
--                       already attributed to the code.
--   `referrals`       — one row per attribution attempt. Tracks lifecycle
--                       from 'attributed' → 'blocked_fraud_check' →
--                       'install_complete' → 'credit_paid' | 'expired' |
--                       'cancelled'. Both credit amounts + payout metadata
--                       live here (no separate ledger table for MVP — the
--                       status transitions ARE the ledger, and updated_at
--                       + credit_paid_at give the audit trail we need).
--
-- No foreign key to `contacts` from `referral_codes.owner_contact_id` with
-- CASCADE — if a contact is deleted (data-cleanup), we keep the referral
-- code inert but present so historical `referrals` rows still resolve.
--
-- Additive only. Zero impact on existing writes.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── Table 1: referral_codes ─────────────────────────────────────────────
-- One row per (contact, generated-code) pair. A contact may have multiple
-- rows over time (each revoked-and-regenerated code is a new row). The
-- ACTIVE code is the one where revoked_at IS NULL — server enforces at
-- most one active code per contact at any given time.
CREATE TABLE IF NOT EXISTS referral_codes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Human-shareable code. Format: {4-6 char slug from owner name}-{4 char
  -- random from safe alphabet}. e.g. "SARAH-XY7K". Safe alphabet excludes
  -- 0/O/1/I/L to avoid mis-transcription over phone/handwriting. Uniqueness
  -- enforced globally so the URL `/get-quote?ref=SARAH-XY7K` resolves
  -- unambiguously.
  code              VARCHAR(20) NOT NULL UNIQUE,

  -- The referrer. On contact deletion the code stays (set null) so
  -- attributed referrals still resolve. Server will refuse to accept new
  -- attributions on a code whose owner is null.
  owner_contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ,
  revoked_reason    TEXT,
  revoked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE referral_codes IS
  'Referral codes generated for existing customers to share with friends. One active code per contact at a time (server-enforced). Codes never delete — revoke via revoked_at so historical referrals stay resolvable.';

COMMENT ON COLUMN referral_codes.code IS
  'Shareable code in URL like /get-quote?ref=SARAH-XY7K. Format: NAME-SLUG (uppercase, safe alphabet excluding 0/O/1/I/L).';

-- Partial index: fast lookup of the one active code per contact. Enables
-- ON CONFLICT DO NOTHING pattern when the same customer clicks "Refer a
-- friend" twice — the second click resolves to the existing active code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_active_per_owner
  ON referral_codes (owner_contact_id)
  WHERE revoked_at IS NULL AND owner_contact_id IS NOT NULL;

-- Fast lookup at attribution time (POST /api/quote/submit-with-design with
-- ?ref=CODE in the payload → SELECT ... WHERE code = $1 AND revoked_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_referral_codes_code_active
  ON referral_codes (code)
  WHERE revoked_at IS NULL;


-- ─── Table 2: referrals ──────────────────────────────────────────────────
-- One row per attribution attempt. Lifecycle:
--
--   friend submits quote with ?ref=CODE
--     ↓
--   fraud check runs
--     ↓                            ↓
--   PASS: 'attributed'            FAIL: 'blocked_fraud_check'
--     ↓                            ↓ (admin manually approves)
--   friend's install completes    'attributed'
--   (projects_v2.status = 'completed')
--     ↓
--   trigger unlocks both credits    'install_complete'
--     ↓
--   admin mails cheque / bank tx    'credit_paid'
--     ↓                            OR
--   6-month clock (nightly job)    'expired'
--
-- Cancellation ('cancelled') is for admin override — e.g. friend disputes
-- referral, referrer withdraws consent.

CREATE TABLE IF NOT EXISTS referrals (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Attribution
  referral_code_id          UUID NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
  referrer_contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
    -- Denormalised from referral_codes.owner_contact_id at attribution time
    -- so cap enforcement + admin queries stay simple. If the referrer's
    -- contact is deleted, we keep the row (with null referrer) so admin
    -- can still see historical referrals.

  referred_contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  referred_enquiry_id       UUID REFERENCES website_enquiries(id) ON DELETE SET NULL,
  referred_project_id       UUID REFERENCES projects_v2(id) ON DELETE SET NULL,
    -- Populated when the enquiry gets converted to a project (Phase 6.6
    -- integration). This is the FK the install-complete trigger watches.

  -- Lifecycle
  status                    VARCHAR(30) NOT NULL DEFAULT 'attributed'
                              CHECK (status IN (
                                'attributed',            -- friend submitted quote, fraud check passed
                                'blocked_fraud_check',   -- fraud check failed, awaiting admin decision
                                'install_complete',      -- friend's install marked complete, credit unlocked
                                'credit_paid',           -- admin has mailed cheque/transferred payment
                                'expired',               -- 6 months elapsed without payout
                                'cancelled'              -- admin override
                              )),

  -- Fraud check details. Populated on attribution regardless of pass/fail
  -- so admin can see WHY a referral was blocked (or confirm it passed).
  fraud_check               JSONB,
    -- Shape:
    -- {
    --   "checked_at": "2026-08-22T10:15:00Z",
    --   "result": "pass" | "block",
    --   "matched_fields": ["email"] | ["phone"] | ["email", "phone"] | [],
    --   "referrer_email_hash": "...",   // for audit; store hashes not raw email
    --   "referrer_phone_normalised": "+64...",
    --   "referred_email_hash": "...",
    --   "referred_phone_normalised": "+64..."
    -- }

  -- Credit amounts. Cents to avoid floating-point issues. Defaults reflect
  -- owner's $250-each policy (2026-08-22). Kept editable per-row so admin
  -- can bump a specific referral (e.g. promo period, apology credit).
  credit_amount_referrer    INTEGER NOT NULL DEFAULT 25000,   -- $250.00 NZD
  credit_amount_referred    INTEGER NOT NULL DEFAULT 25000,   -- $250.00 NZD

  -- Payout lifecycle
  credit_unlocked_at        TIMESTAMPTZ,   -- set by install-complete trigger
  credit_expires_at         TIMESTAMPTZ,   -- unlocked_at + 6 months
  credit_paid_at            TIMESTAMPTZ,   -- set when admin marks paid
  credit_paid_method        VARCHAR(30),   -- 'cheque' | 'bank_transfer' | 'other'
  credit_paid_reference     TEXT,          -- cheque number / bank tx ref
  credit_paid_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Admin metadata
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent double-attribution: the same code + same friend enquiry combo
  -- can only produce one referral row. If a friend re-submits (edits their
  -- quote) with the same ref code, this uniqueness dedups so the code cap
  -- isn't burned twice.
  CONSTRAINT uniq_referral_code_enquiry
    UNIQUE (referral_code_id, referred_enquiry_id)
);

COMMENT ON TABLE referrals IS
  'One row per attribution attempt from a shared referral code. Lifecycle: attributed → install_complete → credit_paid | expired. Fraud checks recorded inline. Both referrer and referred credits denormalised so an admin refunding one side does not require touching the other.';

-- Fast admin dashboard queries: "show me referrals awaiting my action"
-- (status IN ('install_complete', 'blocked_fraud_check')).
CREATE INDEX IF NOT EXISTS idx_referrals_status
  ON referrals (status);

-- Cap enforcement query: "how many successful referrals has this referrer
-- had in the last 12 months?"
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_created
  ON referrals (referrer_contact_id, created_at DESC)
  WHERE status IN ('install_complete', 'credit_paid');

-- Expiry check query (nightly): "which unpaid credits are past their
-- expiry window?"
CREATE INDEX IF NOT EXISTS idx_referrals_expires
  ON referrals (credit_expires_at)
  WHERE status = 'install_complete';

-- Reverse lookup: which referral belongs to a given project? Needed when
-- projects_v2.status transitions to 'completed' — the server queries
-- referrals WHERE referred_project_id = X to unlock the credit.
CREATE INDEX IF NOT EXISTS idx_referrals_project
  ON referrals (referred_project_id)
  WHERE referred_project_id IS NOT NULL;

-- Auto-touch updated_at on every UPDATE (matches the pattern used by
-- contacts / projects_v2 / etc — see server/db/schema.sql for the
-- shared update_modified_column() function).
DROP TRIGGER IF EXISTS trg_referrals_updated_at ON referrals;
CREATE TRIGGER trg_referrals_updated_at
  BEFORE UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();


-- ─── Column on website_enquiries: raw referral code as captured ──────────
-- The client stores ?ref=CODE in sessionStorage + a cookie on landing at
-- /get-quote. On submit, that code goes into the design payload. Server
-- copies it here as raw text (even if it later fails the referral lookup
-- for whatever reason — bad code, revoked, or the whole referrals system
-- being down) so we have the original attribution string for debugging /
-- backfill. The `referrals.referred_enquiry_id` FK is the authoritative
-- link once attribution succeeds.
ALTER TABLE website_enquiries
  ADD COLUMN IF NOT EXISTS referral_code_used TEXT;

COMMENT ON COLUMN website_enquiries.referral_code_used IS
  'Raw ?ref=CODE captured from the URL when this enquiry was submitted. Kept even if attribution failed (bad/revoked code) for debugging + potential backfill. The authoritative attribution is referrals.referred_enquiry_id, this column is a breadcrumb.';

COMMIT;
