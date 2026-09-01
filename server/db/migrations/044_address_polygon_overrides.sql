-- ────────────────────────────────────────────────────────────────────────────
-- Migration 044 — Address polygon overrides (Layer 3 / Session 2)
--
-- The problem this solves:
--   Google Solar + LINZ Parcels + LINZ Buildings + OSM combined get us
--   panel placement right for ~84% of NZ addresses. The remaining ~16%
--   fall into three buckets:
--     1. Google Solar identifies a genuinely-wrong building the LINZ
--        parcel doesn't help isolate (e.g. multi-unit developments
--        where parcel = shared land)
--     2. Google Solar's per-face azimuth is off — panels render at
--        wrong direction on right building
--     3. New builds / cross-lease / unusual property shapes where NO
--        automated source has good data
--
--   For these ~16%, an admin/owner needs to be able to manually draw
--   the correct polygon on aerial and have the server use THAT instead
--   of any automated source going forward.
--
--   This migration adds the storage for those manual overrides.
--
-- Design decisions (Session 2, 2026-08-28):
--   1. Key: (latitude, longitude) rounded to 6 decimals — matches Google
--      Places API precision (~10cm) and is stable across formatted-address
--      string variations (e.g. "10 Newnham Terrace" vs "10 Newnham Tce").
--      Alternative — key by `place_id` — rejected because place_id can
--      change if Google merges/splits an address (rare but has happened).
--      Lat/lng is authoritative to the physical location, place_id is
--      Google's index of it. Physical wins.
--
--   2. Match strategy: server accepts a lat/lng and finds the override
--      whose (lat, lng) is within a small tolerance (say 20m). Small
--      enough that neighbour's overrides don't spuriously match, big
--      enough that Google Places geocode drift between visits doesn't
--      miss the override. Enforced via geodesic distance in the query.
--
--   3. Polygon format: GeoJSON-compatible [[[lng, lat], ...]] rings,
--      matching the shape our existing building.polygon field uses.
--      One outer ring only for MVP — no holes, no MultiPolygon.
--
--   4. Segments override: OPTIONAL. Some overrides only need to correct
--      the polygon (Layer 2 LiDAR will then find the right roof faces).
--      Others need to also correct which roof faces get panels (e.g.
--      Newnham where Google picks the wrong sub-face on a long building).
--      When segments_override is present, server bypasses Google Solar
--      + LiDAR segment identification entirely and uses these directly.
--
--   5. Audit: created_by + updated_by track WHO made the override for
--      accountability. notes field for admin to explain WHY (e.g.
--      "customer confirmed roof extends east 4m past OSM outline —
--      new extension not in aerial yet").
--
--   6. Soft-delete: is_active boolean + deactivated_at timestamp + reason.
--      Overrides shouldn't be hard-deleted — even a reverted override
--      is useful history when a similar issue recurs at the same address.
--
--   7. RLS: read requires authenticated staff, write requires role=admin.
--      Overrides affect what customers see on their quote — only owner
--      should create/edit.
--
-- Additive only. Zero impact on existing behavior — server checks this
-- table BEFORE the normal Parcels→OSM→LINZ Buildings cascade; if there
-- is no active override for the address the code path is unchanged.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS address_polygon_overrides (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Location key. Rounded to 6 decimals (~10cm precision). Match strategy
  -- at query time is "within 20m radius of these coords" — not exact
  -- equality — so trivial geocode drift between visits doesn't miss the
  -- override.
  latitude          NUMERIC(10, 6) NOT NULL,
  longitude         NUMERIC(11, 6) NOT NULL,

  -- Human-readable address at time of override creation. Not used for
  -- matching (physical coords are authoritative) — this field is for
  -- admin UX so the overrides list is scannable.
  address_snapshot  TEXT NOT NULL,

  -- The custom polygon that overrides all automated building-lookup
  -- sources. GeoJSON-style outer ring only — [[[lng, lat], ...]].
  -- Single ring, no holes, no MultiPolygon (deferred until needed).
  polygon           JSONB NOT NULL,

  -- Optional segment override. When present, server bypasses Google
  -- Solar + LiDAR segment identification and uses these roof faces
  -- directly. Format matches the existing roof.segments shape:
  --   [{ center: {latitude, longitude, altitude?},
  --      azimuthDegrees, pitchDegrees,
  --      stats: {areaMeters2},
  --      planeHeightAtCenterMeters? }, ...]
  -- Null (default) means "use my polygon but let Google Solar/LiDAR
  -- identify the actual roof faces within it".
  segments_override JSONB,

  -- Why this override exists. Free-text. Required for audit trail.
  notes             TEXT NOT NULL,

  -- Draw source — 'linz_parcel' (edited from LINZ starting shape) or
  -- 'blank' (drawn from scratch). Purely for admin analytics — helps
  -- track which starting-point works better.
  draw_source       VARCHAR(20) NOT NULL DEFAULT 'blank'
                    CHECK (draw_source IN ('linz_parcel','blank')),

  -- Soft-delete. Never hard-delete an override — history is useful.
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated_at    TIMESTAMPTZ,
  deactivated_reason TEXT,

  -- Audit
  created_by        UUID NOT NULL,        -- users.id (staff who created)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        UUID,                 -- users.id (staff who last edited)
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE address_polygon_overrides IS
  'Manual per-address polygon overrides for cases where Google Solar / LINZ Parcels / LINZ Buildings all identify the wrong roof. Checked first in findCustomerBuilding before the automated cascade.';

-- Location index — for the "find overrides within 20m of this point"
-- query pattern. Simple B-tree covers the common case (bbox pre-filter
-- then geodesic distance filter in-query). Not GiST because we don't
-- need arbitrary-shape queries — just point-radius lookups.
CREATE INDEX IF NOT EXISTS idx_address_polygon_overrides_location
  ON address_polygon_overrides (latitude, longitude)
  WHERE is_active = TRUE;

-- Active-only index — the admin list page shows active overrides
-- first, filtered separately. Partial index keeps it lean.
CREATE INDEX IF NOT EXISTS idx_address_polygon_overrides_active_created
  ON address_polygon_overrides (created_at DESC)
  WHERE is_active = TRUE;

-- Trigger to keep updated_at fresh on every write. Same pattern used
-- across the codebase (see migration 043).
CREATE OR REPLACE FUNCTION address_polygon_overrides_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_address_polygon_overrides_touch
  ON address_polygon_overrides;
CREATE TRIGGER trg_address_polygon_overrides_touch
  BEFORE UPDATE ON address_polygon_overrides
  FOR EACH ROW EXECUTE FUNCTION address_polygon_overrides_touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Read: any authenticated staff user (so reps can see WHY a quote looks
--       the way it does when investigating a customer report).
-- Write: admin role only (creating/editing an override affects every
--        future quote at that location — owner's responsibility).
-- Anon: no access — this data is internal.
--
-- Follows the same pattern as migrations 034/036/037. `auth.jwt() ->> 'role'`
-- reads the JWT claim our authenticate middleware writes.
ALTER TABLE address_polygon_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_authenticated_staff"
  ON address_polygon_overrides
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "insert_admin_only"
  ON address_polygon_overrides
  FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "update_admin_only"
  ON address_polygon_overrides
  FOR UPDATE
  USING (auth.jwt() ->> 'role' = 'admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- No DELETE policy — server uses soft-delete (is_active=false), NEVER
-- hard-delete. This makes accidental "revoke by DELETE" impossible.

COMMIT;
