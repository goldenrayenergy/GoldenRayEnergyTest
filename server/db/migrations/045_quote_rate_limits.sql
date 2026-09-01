-- ────────────────────────────────────────────────────────────────────────────
-- Migration 045 — Quote rate limits (2026-08-31 fix for broken in-memory limit)
--
-- Root cause this fixes:
--   server/middleware/quoteRateLimit.js originally stored per-IP counters in
--   an in-memory Map. On Render (our host):
--     - Every deploy restarts the Node process → Map wiped → counters reset
--     - Free-tier idle-sleep after ~15 min → cold-start next request → wiped
--   Effect: the "3 unique addresses per IP per NZ day" limit was effectively
--   unenforceable. Team ran 30+ addresses in a session; owner's paid Google
--   Solar quota was at risk.
--
-- Design:
--   One row per (ip, nz_date, address_key). Composite PK gives natural
--   dedupe — the same customer refining the same address doesn't count
--   twice. Count-of-rows for a given (ip, nz_date) is the customer's
--   "addresses used today"; if that count ≥ 3 AND the current address isn't
--   already in the set, we 429.
--
--   Purge nightly: rows older than 2 days are dropped by a cleanup job
--   (server-side setInterval, see quoteRateLimit.js). Table stays small
--   even under heavy traffic.
--
-- RLS: none. This is written by the anon-authenticated backend middleware
--   (uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS). Customer-facing
--   readers never touch this table.
--
-- Additive-only. Adds table + index. No impact on existing behavior — the
-- middleware code change (in a separate commit) is what activates use of
-- this table.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS quote_rate_limits (
  -- The customer's client IP as seen by Render's proxy (trust proxy = 1
  -- means req.ip is the real customer IP, not the proxy's). IPv4 (~15
  -- chars) or IPv6 (~45 chars max) — 64 gives comfortable headroom.
  ip           VARCHAR(64)  NOT NULL,

  -- NZ calendar date (Pacific/Auckland). Reset boundary is midnight NZT.
  -- Stored as DATE not TIMESTAMPTZ so the day-boundary comparison in the
  -- middleware is trivial (both sides are 'YYYY-MM-DD' strings).
  nz_date      DATE         NOT NULL,

  -- Stable per-address key. Middleware derives it from either place_id
  -- (preferred — stable across sessions) or lat,lng rounded to 4 decimals
  -- (~10m — customer nudging the pin still counts as same address).
  -- Format: 'pid:<google_place_id>' or 'coord:<lat>,<lng>'. Max 200
  -- covers the longest place_id we've seen (~150 chars).
  address_key  VARCHAR(200) NOT NULL,

  -- When this row was created. Used only for cleanup + audit.
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Composite PK gives free dedupe: same customer refining the same
  -- address on the same day → INSERT ... ON CONFLICT DO NOTHING is a
  -- no-op → count doesn't double-count. Also the natural index for the
  -- middleware's per-(ip, day) lookup.
  PRIMARY KEY (ip, nz_date, address_key)
);

-- Cleanup lookup: nightly job runs `DELETE FROM quote_rate_limits WHERE
-- nz_date < CURRENT_DATE - INTERVAL '2 days'`. Partial index on old rows
-- would optimise the DELETE but isn't worth the write cost at our volume.

COMMENT ON TABLE quote_rate_limits IS
  'Per-IP-per-day-per-address counter for /api/roof/analyse rate limiting. Replaces the earlier in-memory Map which was silently wiped on every Render restart/idle.';

COMMIT;
