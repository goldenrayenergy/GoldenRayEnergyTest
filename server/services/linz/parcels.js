// ────────────────────────────────────────────────────────────────────────────
// LINZ NZ Parcels client
//
// Queries the NZ Government "NZ Parcels" cadastral dataset (LINZ layer 50823)
// — the LEGAL PROPERTY BOUNDARY for every parcel of land in NZ. This is the
// authoritative source for "which land is your customer's" — critical for
// multi-unit properties (townhouses, unit-titled apartments, cross-lease
// developments) where OSM/LINZ Building Outlines merge multiple units into
// a single polygon.
//
// Why parcels over building outlines:
//   Building outlines (LINZ layer 101290, OSM buildings) describe the physical
//   STRUCTURE. A row of 4 townhouses is one contiguous building → one polygon.
//   Parcels describe the LEGAL PROPERTY. Each of those 4 townhouses has its
//   own parcel (unit title). Panels legally can only be placed on structures
//   attached to the customer's parcel. Using parcels solves the "panels on
//   neighbour's roof" bug for multi-unit properties (~20-30% of urban NZ).
//
// Fallback cascade in /api/roof/analyse:
//   1. LINZ Parcels        (this file, authoritative legal boundary)
//   2. LINZ Building Outlines (physical building — coarser but still NZ-Gov)
//   3. OSM Building Outlines  (community-mapped, may lag reality)
//   4. No polygon (client renders panels without polygon-clip)
//
// LINZ Data Service query API — identical pattern to buildingOutlines.js:
//   GET https://data.linz.govt.nz/services/query/v1/vector.json
//       ?key={API_KEY}
//       &layer=50823               — NZ Parcels
//       &x={longitude}             — WGS84 lng
//       &y={latitude}              — WGS84 lat
//       &max_results=10
//       &radius={metres}
//       &geometry=true             — include the polygon
//       &with_field_names=true     — include column labels in properties
//
// Uses LINZ_DATA_API_KEY (same key that powers buildingOutlines.js). The key
// needs the "Vector API" scope + the "NZ Parcels" layer (id 50823) enabled.
// Missing scope → 401/403 with a clear error message pointing at the fix.
// ────────────────────────────────────────────────────────────────────────────

import env from '../../config/env.js';

const QUERY_URL = 'https://data.linz.govt.nz/services/query/v1/vector.json';
const NZ_PARCELS_LAYER = 50823;
const DEFAULT_TIMEOUT_MS = 12_000;

export function createParcelsClient({
  apiKey    = env.linz?.dataApiKey,
  layer     = NZ_PARCELS_LAYER,
  fetchFn   = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger    = console,
} = {}) {
  if (!apiKey) {
    throw new Error(
      '[linz/parcels] LINZ_DATA_API_KEY not set. Create one at data.linz.govt.nz → ' +
      'My APIs, enable Vector API scope + NZ Parcels layer (id 50823), and add ' +
      'as LINZ_DATA_API_KEY to your .env.'
    );
  }

  return {
    /**
     * Return parcel polygons within `radiusMeters` of a lat/lng.
     *
     * @param {object} args
     * @param {number} args.latitude
     * @param {number} args.longitude
     * @param {number} [args.radiusMeters=30]   — typical NZ residential parcel
     *                                            is 400-800 m² so a 30m radius
     *                                            catches the containing parcel
     *                                            without pulling in neighbours
     * @param {number} [args.maxResults=10]
     * @returns {Promise<
     *   { ok: true, parcels: Array<{
     *       id: string|number,
     *       properties: object,
     *       polygon: number[][][],
     *       centroid: {latitude: number, longitude: number},
     *       area_m2: number,
     *       distance_m: number,
     *     }>,
     *     query: {latitude, longitude, radiusMeters},
     *   }
     * | { ok: false, status: number, error: string }
     * >}
     */
    async queryNear({ latitude, longitude, radiusMeters = 30, maxResults = 10 } = {}) {
      if (typeof latitude !== 'number' || Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
        throw new Error(`[linz/parcels] latitude must be a number in [-90, 90]. Got: ${latitude}`);
      }
      if (typeof longitude !== 'number' || Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
        throw new Error(`[linz/parcels] longitude must be a number in [-180, 180]. Got: ${longitude}`);
      }
      if (typeof radiusMeters !== 'number' || radiusMeters <= 0 || radiusMeters > 10_000) {
        throw new Error(`[linz/parcels] radiusMeters must be in (0, 10000]. Got: ${radiusMeters}`);
      }

      const url = new URL(QUERY_URL);
      url.searchParams.set('key',              apiKey);
      url.searchParams.set('layer',            String(layer));
      url.searchParams.set('x',                String(longitude));
      url.searchParams.set('y',                String(latitude));
      url.searchParams.set('max_results',      String(maxResults));
      url.searchParams.set('radius',           String(radiusMeters));
      url.searchParams.set('geometry',         'true');
      url.searchParams.set('with_field_names', 'true');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetchFn(url.toString(), { signal: controller.signal });
        if (!resp.ok) {
          let bodySnippet = '';
          try { bodySnippet = (await resp.text()).slice(0, 300); } catch { /* noop */ }
          const hint = resp.status === 401 || resp.status === 403
            ? ` — Your LINZ key likely doesn't have Data Service scope for the NZ Parcels layer (id ${layer}). Go to data.linz.govt.nz → My APIs → edit key → enable "Vector API" scope + "NZ Parcels" layer.`
            : '';
          return { ok: false, status: resp.status, error: `${resp.status} ${resp.statusText}${bodySnippet ? ` — ${bodySnippet}` : ''}${hint}` };
        }
        const json = await resp.json();
        return { ok: true, parcels: parseParcels(json, { latitude, longitude }), query: { latitude, longitude, radiusMeters } };
      } catch (err) {
        const isTimeout = err?.name === 'AbortError';
        logger.warn?.(`[linz/parcels] queryNear (${latitude},${longitude}) ${isTimeout ? 'timed out' : 'threw'}: ${err?.message || err}`);
        return { ok: false, status: 0, error: isTimeout ? `timeout after ${timeoutMs}ms` : (err?.message || String(err)) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Response parsing ──────────────────────────────────────────────────────

function parseParcels(json, queryPoint) {
  const features = Array.isArray(json?.vectorQuery?.layers?.[String(NZ_PARCELS_LAYER)]?.features)
    ? json.vectorQuery.layers[String(NZ_PARCELS_LAYER)].features
    : Array.isArray(json?.features) ? json.features
    : [];

  return features.map(f => {
    const props = f.properties || f.attributes || {};
    const geom = f.geometry;
    const rings = extractRings(geom);
    const centroid = polygonCentroidLL(rings);
    return {
      id:         f.id ?? props.id ?? props.parcel_intent ?? null,
      properties: props,
      polygon:    rings,
      centroid,
      area_m2:    approxPolygonAreaM2(rings, centroid.latitude),
      distance_m: haversineMetres(queryPoint.latitude, queryPoint.longitude, centroid.latitude, centroid.longitude),
    };
  });
}

function extractRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates || [];
  if (geom.type === 'MultiPolygon') {
    // Flatten to a single outer ring per polygon, keep them together
    return (geom.coordinates || []).flat();
  }
  return [];
}

// ── Pure helpers (exported for tests + downstream use) ────────────────────

/**
 * Even-odd raycast: is (lng, lat) inside the polygon?
 * Rings are [[lng,lat], ...]. Only the outer ring (rings[0]) is checked.
 */
export function pointInPolygon(lng, lat, rings) {
  const ring = rings?.[0];
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Return the (first) parcel whose polygon contains the point, or null. */
export function parcelContaining(parcels, latitude, longitude) {
  for (const p of parcels || []) {
    if (pointInPolygon(longitude, latitude, p.polygon)) return p;
  }
  return null;
}

/** Return the parcel with the smallest centroid distance from the point. */
export function nearestParcel(parcels) {
  if (!parcels?.length) return null;
  return parcels.reduce((min, p) => (p.distance_m < min.distance_m ? p : min), parcels[0]);
}

/** Centroid of an outer ring in lat/lng (unweighted vertex average). */
export function polygonCentroidLL(rings) {
  const ring = rings?.[0];
  if (!ring || ring.length === 0) return { latitude: NaN, longitude: NaN };
  let latSum = 0, lngSum = 0, count = 0;
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    lngSum += ring[i][0];
    latSum += ring[i][1];
    count++;
  }
  return { latitude: latSum / count, longitude: lngSum / count };
}

/** Approximate polygon area in m² using shoelace in local metres. */
export function approxPolygonAreaM2(rings, referenceLat) {
  const ring = rings?.[0];
  if (!ring || ring.length < 3) return 0;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((referenceLat || 0) * Math.PI / 180);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    sum += (xj * mPerDegLng) * (yi * mPerDegLat) - (xi * mPerDegLng) * (yj * mPerDegLat);
  }
  return Math.abs(sum) / 2;
}

function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Singleton for production consumers ────────────────────────────────────
let _client = null;
export function queryParcelsNear(args) {
  if (!_client) _client = createParcelsClient();
  return _client.queryNear(args);
}
export function _resetClientForTests() { _client = null; }
