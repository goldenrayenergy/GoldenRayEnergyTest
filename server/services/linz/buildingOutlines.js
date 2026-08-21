// ────────────────────────────────────────────────────────────────────────────
// LINZ Building Outlines client
//
// Queries the NZ Government "NZ Building Outlines" dataset (LINZ layer 101290)
// to get authoritative building polygons for a given lat/lng. This dataset is
// updated from recent aerial imagery and is our best source of truth for
// which building actually exists at a customer's address — especially for
// new subdivisions where Google Solar's older imagery misses the mark.
//
// LINZ Data Service query API:
//   GET https://data.linz.govt.nz/services/query/v1/vector.json
//       ?key={API_KEY}
//       &layer=101290              — NZ Building Outlines
//       &x={longitude}             — WGS84 lng
//       &y={latitude}              — WGS84 lat
//       &max_results=10
//       &radius={metres}
//       &geometry=true             — include the polygon
//       &with_field_names=true     — include column labels in properties
//
// Uses the same LINZ_BASEMAP_API_KEY the tile client uses — LINZ has
// unified their key management so a single key covers both tile downloads
// and Data Service vector queries as long as the layer scope is enabled
// on the key. If the key lacks that scope we surface a clear error.
// ────────────────────────────────────────────────────────────────────────────

import env from '../../config/env.js';

const QUERY_URL = 'https://data.linz.govt.nz/services/query/v1/vector.json';
const NZ_BUILDING_OUTLINES_LAYER = 101290;
const DEFAULT_TIMEOUT_MS = 12_000;

export function createBuildingOutlinesClient({
  // Prefer the Data Service key. LINZ Basemap key does NOT work for the Data
  // Service (they're separate products) — falling back to it would 403.
  apiKey    = env.linz?.dataApiKey,
  layer     = NZ_BUILDING_OUTLINES_LAYER,
  fetchFn   = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger    = console,
} = {}) {
  if (!apiKey) {
    throw new Error(
      '[linz/buildingOutlines] LINZ_DATA_API_KEY not set. This is a SEPARATE key from LINZ_BASEMAP_API_KEY. ' +
      'Create one at data.linz.govt.nz → My APIs, enable Vector Query API scope + NZ Building Outlines layer (id 101290), ' +
      'and add as LINZ_DATA_API_KEY to your .env.'
    );
  }

  return {
    /**
     * Return building polygons within `radiusMeters` of a lat/lng.
     *
     * @param {object} args
     * @param {number} args.latitude
     * @param {number} args.longitude
     * @param {number} [args.radiusMeters=50]     — search radius; 50m usually
     *                                              catches the whole property
     * @param {number} [args.maxResults=10]
     * @returns {Promise<
     *   { ok: true, buildings: Array<{
     *       id: string|number,
     *       properties: object,
     *       polygon: number[][][],          — GeoJSON-style [lng,lat] rings
     *       centroid: {latitude: number, longitude: number},
     *       area_m2: number,
     *       distance_m: number,             — distance from query point to centroid
     *     }>,
     *     query: {latitude, longitude, radiusMeters},
     *   }
     * | { ok: false, status: number, error: string }
     * >}
     */
    async queryNear({ latitude, longitude, radiusMeters = 50, maxResults = 10 } = {}) {
      if (typeof latitude !== 'number' || Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
        throw new Error(`[linz/buildingOutlines] latitude must be a number in [-90, 90]. Got: ${latitude}`);
      }
      if (typeof longitude !== 'number' || Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
        throw new Error(`[linz/buildingOutlines] longitude must be a number in [-180, 180]. Got: ${longitude}`);
      }
      if (typeof radiusMeters !== 'number' || radiusMeters <= 0 || radiusMeters > 10_000) {
        throw new Error(`[linz/buildingOutlines] radiusMeters must be in (0, 10000]. Got: ${radiusMeters}`);
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
          // 401/403 typically mean the API key doesn't have Data Service +
          // this layer enabled. Give a clear next-step in the error.
          const hint = resp.status === 401 || resp.status === 403
            ? ` — Your LINZ key likely doesn't have Data Service scope for the NZ Building Outlines layer (id ${layer}). Go to data.linz.govt.nz → My APIs → edit key → enable "Vector API" scope + "NZ Building Outlines" layer.`
            : '';
          return { ok: false, status: resp.status, error: `${resp.status} ${resp.statusText}${bodySnippet ? ` — ${bodySnippet}` : ''}${hint}` };
        }
        const json = await resp.json();
        return { ok: true, buildings: parseBuildings(json, { latitude, longitude }), query: { latitude, longitude, radiusMeters } };
      } catch (err) {
        const isTimeout = err?.name === 'AbortError';
        logger.warn?.(`[linz/buildingOutlines] queryNear (${latitude},${longitude}) ${isTimeout ? 'timed out' : 'threw'}: ${err?.message || err}`);
        return { ok: false, status: 0, error: isTimeout ? `timeout after ${timeoutMs}ms` : (err?.message || String(err)) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Response parsing ──────────────────────────────────────────────────────

function parseBuildings(json, queryPoint) {
  const features = Array.isArray(json?.vectorQuery?.layers?.[String(NZ_BUILDING_OUTLINES_LAYER)]?.features)
    ? json.vectorQuery.layers[String(NZ_BUILDING_OUTLINES_LAYER)].features
    : Array.isArray(json?.features) ? json.features
    : [];

  return features.map(f => {
    const props = f.properties || f.attributes || {};
    // LINZ Building Outlines geometry is Polygon or MultiPolygon
    const geom = f.geometry;
    const rings = extractRings(geom);
    const centroid = polygonCentroidLL(rings);
    return {
      id:         f.id ?? props.id ?? props.building_id ?? null,
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

/** Return the (first) building whose polygon contains the point, or null. */
export function buildingContaining(buildings, latitude, longitude) {
  for (const b of buildings || []) {
    if (pointInPolygon(longitude, latitude, b.polygon)) return b;
  }
  return null;
}

/** Return the building with the smallest centroid distance from the point. */
export function nearestBuilding(buildings) {
  if (!buildings?.length) return null;
  return buildings.reduce((min, b) => (b.distance_m < min.distance_m ? b : min), buildings[0]);
}

/** Centroid of an outer ring in lat/lng (unweighted average — good enough for buildings). */
export function polygonCentroidLL(rings) {
  const ring = rings?.[0];
  if (!ring || ring.length === 0) return { latitude: NaN, longitude: NaN };
  let latSum = 0, lngSum = 0, count = 0;
  // Skip the closing duplicate vertex if present
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    lngSum += ring[i][0];
    latSum += ring[i][1];
    count++;
  }
  return { latitude: latSum / count, longitude: lngSum / count };
}

/** Approximate polygon area in m² using the shoelace formula in local metres. */
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
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Singleton for production consumers ────────────────────────────────────
let _client = null;
export function queryBuildingsNear(args) {
  if (!_client) _client = createBuildingOutlinesClient();
  return _client.queryNear(args);
}
export function _resetClientForTests() { _client = null; }
