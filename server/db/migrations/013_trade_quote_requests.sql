-- Phase 4 — Trade Shop "Request a Quote" submissions
--
-- B2B electrician browses /shop, builds a cart, submits a Request Quote
-- form. We capture buyer details + a snapshot of the cart contents at
-- request time. Sales follows up from /portal/trade-requests.
--
-- This is intentionally NOT an "orders" table — there's no payment, no
-- fulfilment, no shipping status. It's the lead-capture layer for trade
-- buyers; we deliberately preserve their flexibility to negotiate before
-- a real order is created.

CREATE TABLE IF NOT EXISTS trade_quote_requests (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Buyer details (captured at submission)
  business_name       VARCHAR(200) NOT NULL,
  contact_name        VARCHAR(120) NOT NULL,
  email               VARCHAR(255) NOT NULL,
  phone               VARCHAR(50),
  gst_number          VARCHAR(50),
  delivery_address    TEXT,
  notes               TEXT,

  -- Cart contents — array of line snapshots
  -- Each item: { product_id, sku, name, brand, qty,
  --              unit_cost_at_request, unit_sell_excl_at_request, unit_sell_incl_at_request }
  -- Snapshotted so a later catalogue change can't retroactively shift
  -- what the customer asked for.
  items               JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Roll-up totals at request time
  subtotal_excl_gst   NUMERIC(14,2),
  gst_amount          NUMERIC(14,2),
  total_incl_gst      NUMERIC(14,2),

  -- CRM linkage — created from the same submission for sales tracking
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,

  -- Sales workflow status
  status              VARCHAR(20) NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','contacted','quoted','won','lost')),

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tqr_status     ON trade_quote_requests(status);
CREATE INDEX IF NOT EXISTS idx_tqr_contact    ON trade_quote_requests(contact_id);
CREATE INDEX IF NOT EXISTS idx_tqr_created_at ON trade_quote_requests(created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tqr_updated_at') THEN
    CREATE TRIGGER trg_tqr_updated_at
      BEFORE UPDATE ON trade_quote_requests
      FOR EACH ROW
      EXECUTE FUNCTION update_modified_column();
  END IF;
END $$;
