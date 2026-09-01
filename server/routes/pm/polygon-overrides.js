// ────────────────────────────────────────────────────────────────────────────
// PM Tool — Address polygon overrides admin endpoints.
//
//   GET    /api/pm/admin/polygon-overrides         → list active overrides
//   GET    /api/pm/admin/polygon-overrides?all=1   → list all (including deactivated)
//   POST   /api/pm/admin/polygon-overrides         → create new override
//   GET    /api/pm/admin/polygon-overrides/:id     → single override
//   PATCH  /api/pm/admin/polygon-overrides/:id     → edit polygon/segments/notes
//   POST   /api/pm/admin/polygon-overrides/:id/deactivate → soft-delete (with reason)
//   POST   /api/pm/admin/polygon-overrides/:id/reactivate → restore
//
// Reads: any authenticated staff (so reps can see WHY a quote looks the way
//        it does when investigating).
// Writes: admin role only (overrides affect every future quote at that
//         location — owner's responsibility).
//
// Look-up helper for the roof analysis pipeline lives in
// findOverrideForCoords() below — imported by server/routes/roof.js.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';

const router = Router();

// Admin-only gate matching the pattern in pm/admin.js.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required.' });
  }
  next();
}

// Validate a polygon payload — must be a GeoJSON-style outer-ring array
// of [lng, lat] pairs with at least 3 vertices (triangle minimum) and
// coords within NZ bounds (rough sanity check).
function validatePolygonRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) {
    return { ok: false, error: 'polygon must be an array of at least 3 [lng, lat] pairs' };
  }
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i];
    if (!Array.isArray(pt) || pt.length < 2) {
      return { ok: false, error: `polygon[${i}] must be [lng, lat]` };
    }
    const [lng, lat] = pt;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return { ok: false, error: `polygon[${i}] contains non-numeric coord` };
    }
    // Rough NZ bounds: lat in [-48, -33], lng in [165, 180]. Rejects
    // obvious garbage (e.g. someone accidentally sent an Australian
    // polygon) without being so strict that Chatham Islands would fail.
    if (lat < -48 || lat > -33) {
      return { ok: false, error: `polygon[${i}] latitude ${lat} outside NZ range [-48, -33]` };
    }
    if (lng < 165 || lng > 180) {
      return { ok: false, error: `polygon[${i}] longitude ${lng} outside NZ range [165, 180]` };
    }
  }
  return { ok: true };
}

// ── LIST ──────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const includeAll = req.query.all === '1';
    let q = supabaseAdmin
      .from('address_polygon_overrides')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);   // hard cap — if we ever have 500+ overrides UX will need paging
    if (!includeAll) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ overrides: data || [], count: data?.length ?? 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SINGLE ────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { data, error } = await supabaseAdmin
      .from('address_polygon_overrides')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Override not found' });
      throw error;
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CREATE ────────────────────────────────────────────────────────────────
router.post('/', authenticate, requireAdmin, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
  const {
    latitude, longitude, address_snapshot, polygon, segments_override,
    notes, draw_source,
  } = req.body || {};

  // Required-field validation with specific error messages so the UI can
  // point at the exact field. Vague "Invalid input" is worse than useless.
  if (!Number.isFinite(latitude))  return res.status(400).json({ error: 'latitude required (number)' });
  if (!Number.isFinite(longitude)) return res.status(400).json({ error: 'longitude required (number)' });
  if (!address_snapshot || typeof address_snapshot !== 'string')
    return res.status(400).json({ error: 'address_snapshot required (string)' });
  if (!notes || typeof notes !== 'string' || notes.trim().length < 10)
    return res.status(400).json({ error: 'notes required (min 10 chars) — explain WHY this override exists for the audit trail' });
  if (!['linz_parcel', 'blank'].includes(draw_source))
    return res.status(400).json({ error: "draw_source must be 'linz_parcel' or 'blank'" });

  const ring = Array.isArray(polygon) && Array.isArray(polygon[0]) && !Array.isArray(polygon[0][0])
    ? polygon               // caller sent a raw ring [[lng,lat],...]
    : polygon?.[0];         // caller sent GeoJSON-style rings [[[lng,lat],...]]
  const polyCheck = validatePolygonRing(ring);
  if (!polyCheck.ok) return res.status(400).json({ error: polyCheck.error });

  // Optional: segments_override — if present, must be a non-empty array
  if (segments_override != null) {
    if (!Array.isArray(segments_override) || segments_override.length === 0) {
      return res.status(400).json({ error: 'segments_override must be a non-empty array when provided' });
    }
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('address_polygon_overrides')
      .insert({
        latitude:          Number(latitude).toFixed(6),
        longitude:         Number(longitude).toFixed(6),
        address_snapshot:  address_snapshot.trim(),
        // Store as GeoJSON-style [[ring1],[ring2?],…]. We only support one
        // outer ring; wrap for future compatibility with holes/multi.
        polygon:           [ring],
        segments_override: segments_override || null,
        notes:             notes.trim(),
        draw_source,
        created_by:        req.user.id,
        updated_by:        req.user.id,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── UPDATE ────────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
  const patch = {};
  const { polygon, segments_override, notes, address_snapshot } = req.body || {};

  if (polygon !== undefined) {
    const ring = Array.isArray(polygon) && Array.isArray(polygon[0]) && !Array.isArray(polygon[0][0])
      ? polygon
      : polygon?.[0];
    const polyCheck = validatePolygonRing(ring);
    if (!polyCheck.ok) return res.status(400).json({ error: polyCheck.error });
    patch.polygon = [ring];
  }
  if (segments_override !== undefined) {
    if (segments_override !== null &&
        (!Array.isArray(segments_override) || segments_override.length === 0)) {
      return res.status(400).json({ error: 'segments_override must be a non-empty array when provided (or null to clear)' });
    }
    patch.segments_override = segments_override;
  }
  if (notes !== undefined) {
    if (typeof notes !== 'string' || notes.trim().length < 10) {
      return res.status(400).json({ error: 'notes must be at least 10 chars when provided' });
    }
    patch.notes = notes.trim();
  }
  if (address_snapshot !== undefined) {
    if (typeof address_snapshot !== 'string' || !address_snapshot.trim()) {
      return res.status(400).json({ error: 'address_snapshot must be a non-empty string when provided' });
    }
    patch.address_snapshot = address_snapshot.trim();
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no updatable fields in body' });
  }
  patch.updated_by = req.user.id;

  try {
    const { data, error } = await supabaseAdmin
      .from('address_polygon_overrides')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Override not found' });
      throw error;
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DEACTIVATE (soft-delete) ──────────────────────────────────────────────
router.post('/:id/deactivate', authenticate, requireAdmin, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
  const { reason } = req.body || {};
  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return res.status(400).json({ error: 'reason required (min 5 chars) — explain WHY this override is being deactivated' });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('address_polygon_overrides')
      .update({
        is_active:          false,
        deactivated_at:     new Date().toISOString(),
        deactivated_reason: reason.trim(),
        updated_by:         req.user.id,
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Override not found' });
      throw error;
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── REACTIVATE ────────────────────────────────────────────────────────────
router.post('/:id/reactivate', authenticate, requireAdmin, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { data, error } = await supabaseAdmin
      .from('address_polygon_overrides')
      .update({
        is_active:          true,
        deactivated_at:     null,
        deactivated_reason: null,
        updated_by:         req.user.id,
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Override not found' });
      throw error;
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

// ────────────────────────────────────────────────────────────────────────────
// LOOKUP HELPER — imported by server/routes/roof.js.
//
// Given a lat/lng, find the nearest ACTIVE override within `radiusMeters`.
// Returns the full override row or null. Called BEFORE the normal Parcels
// → OSM → LINZ Buildings cascade in findCustomerBuilding.
//
// Radius default 20m matches the migration's design note — small enough
// that a neighbour's override doesn't spuriously match, big enough that
// trivial Google Places geocode drift between visits still resolves.
//
// Bbox pre-filter keeps this cheap even at scale (partial index on
// (latitude, longitude) WHERE is_active — see migration 044).
// ────────────────────────────────────────────────────────────────────────────
export async function findOverrideForCoords({ latitude, longitude, radiusMeters = 20 }) {
  if (!supabaseAdmin) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  // Bbox pre-filter — 1° lat ≈ 111,320m; 1° lng at NZ latitudes ≈ 84,000m.
  // Pad by 1.5× the search radius so edge cases don't get missed.
  const latDeg = (radiusMeters * 1.5) / 111320;
  const lngDeg = (radiusMeters * 1.5) / (111320 * Math.cos(latitude * Math.PI / 180));

  try {
    const { data, error } = await supabaseAdmin
      .from('address_polygon_overrides')
      .select('*')
      .eq('is_active', true)
      .gte('latitude',  latitude  - latDeg)
      .lte('latitude',  latitude  + latDeg)
      .gte('longitude', longitude - lngDeg)
      .lte('longitude', longitude + lngDeg)
      .limit(10);   // if a customer has 10+ overrides within 20m something's wrong upstream
    if (error) {
      console.warn('[polygon-overrides] findOverrideForCoords query failed:', error.message);
      return null;
    }
    if (!data?.length) return null;

    // Geodesic distance filter — bbox above catches candidates cheaply,
    // this trims to the true radius. Haversine is overkill at ~20m but
    // costs nothing to be accurate.
    const withDist = data.map(row => {
      const dLat = (Number(row.latitude)  - latitude)  * 111320;
      const dLng = (Number(row.longitude) - longitude) * 111320 * Math.cos(latitude * Math.PI / 180);
      return { ...row, _distanceM: Math.sqrt(dLat * dLat + dLng * dLng) };
    }).filter(r => r._distanceM <= radiusMeters);

    if (!withDist.length) return null;
    // Nearest wins if multiple overrides exist in the radius
    withDist.sort((a, b) => a._distanceM - b._distanceM);
    return withDist[0];
  } catch (e) {
    console.warn('[polygon-overrides] findOverrideForCoords threw:', e.message);
    return null;
  }
}
