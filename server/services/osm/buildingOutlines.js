// ────────────────────────────────────────────────────────────────────────────
// OpenStreetMap Building Outlines client (Overpass API)
//
// Queries the OpenStreetMap Overpass API for building polygons around a
// lat/lng. Zero-auth: OSM is a public crowdsourced dataset — no API key,
// no signup, just be polite with rate (soft cap ~1 req/sec).
//
// Why OSM in addition to LINZ:
//   LINZ's NZ Building Outlines is derived from aerial-imagery batch
//   captures (Auckland's is from 2017). Post-2017 subdivisions are missing.
//   OSM is community-mapped and often captures new builds within weeks —
//   we saw this for the test address (LINZ: 0 buildings within 30m; OSM: 4).
//
// Overpass query used:
//   [out:json][timeout:25];
//   (
//     way["building"](around:R,LAT,LNG);
//     relation["building"](around:R,LAT,LNG);
//   );
//   out geom;
//
// `out geom;` inlines each way's node coordinates directly so we don't need
// to make a second query to resolve node IDs.
//
// Same output shape as services/linz/buildingOutlines.js so downstream code
// doesn't care which source provided the polygon.
// ────────────────────────────────────────────────────────────────────────────

import {
  pointInPolygon,
  buildingContaining,
  nearestBuilding,
  polygonCentroidLL,
  approxPolygonAreaM2,
} from '../linz/buildingOutlines.js';

// Overpass mirrors — main endpoint returns 504 under load. We try in order.
// If all fail, the client returns the last error verbatim so the caller sees
// it wasn't a transient issue.
const DEFAULT_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',           // main
  'https://overpass.kumi.systems/api/interpreter',     // Kumi Systems — reliable, community-run
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter', // Mail.ru mirror
  'https://overpass.private.coffee/api/interpreter',   // private.coffee — small backup
];
// 4s per mirror — Overpass API is unreliable. Worst case 16s across 4 mirrors
// keeps us well under the Vite proxy's ~30s default. Google Solar's own
// building match + LiDAR fallback both work without OSM, so failing fast
// here is fine — we just miss the "verified building polygon" step.
const DEFAULT_TIMEOUT_MS = 4_000;
const OSM_USER_AGENT = 'GoldenrayEnergy/1.0 (poc; goldenrayenergy.nz)';

export function createOsmBuildingOutlinesClient({
  endpoints = DEFAULT_ENDPOINTS,
  fetchFn   = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger    = console,
} = {}) {
  // Accept a single string for testing convenience — normalise to array.
  const endpointList = Array.isArray(endpoints) ? endpoints : [endpoints];
  return {
    /**
     * Return building polygons within `radiusMeters` of a lat/lng.
     *
     * @param {object} args
     * @param {number} args.latitude
     * @param {number} args.longitude
     * @param {number} [args.radiusMeters=30]
     * @returns {Promise<
     *   { ok: true, buildings: Array<{id, properties, polygon, centroid, area_m2, distance_m, source: 'osm'}>,
     *              query: {latitude, longitude, radiusMeters} }
     * | { ok: false, status: number, error: string }
     * >}
     */
    async queryNear({ latitude, longitude, radiusMeters = 30 } = {}) {
      if (typeof latitude !== 'number' || Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
        throw new Error(`[osm/buildingOutlines] latitude must be a number in [-90, 90]. Got: ${latitude}`);
      }
      if (typeof longitude !== 'number' || Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
        throw new Error(`[osm/buildingOutlines] longitude must be a number in [-180, 180]. Got: ${longitude}`);
      }
      if (typeof radiusMeters !== 'number' || radiusMeters <= 0 || radiusMeters > 5000) {
        throw new Error(`[osm/buildingOutlines] radiusMeters must be in (0, 5000]. Got: ${radiusMeters}`);
      }

      // Overpass QL query — buildings as ways OR relations (multi-polygon
      // buildings like L-shapes are relations). `out geom;` returns node
      // coords inline so we can build the polygon without a second query.
      const q = `
        [out:json][timeout:40];
        (
          way["building"](around:${radiusMeters},${latitude},${longitude});
          relation["building"](around:${radiusMeters},${latitude},${longitude});
        );
        out geom;
      `.trim();

      let lastError = null;
      for (let i = 0; i < endpointList.length; i++) {
        const endpoint = endpointList[i];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const resp = await fetchFn(endpoint, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent':   OSM_USER_AGENT,
            },
            body:    `data=${encodeURIComponent(q)}`,
            signal:  controller.signal,
          });
          clearTimeout(timer);
          if (!resp.ok) {
            let bodySnippet = '';
            try { bodySnippet = (await resp.text()).slice(0, 200); } catch { /* noop */ }
            lastError = { ok: false, status: resp.status, error: `Overpass ${resp.status} @ ${endpoint} — ${bodySnippet}` };
            // 4xx = client error, don't retry other mirrors. 5xx/timeout = try next.
            if (resp.status >= 400 && resp.status < 500) return lastError;
            logger.warn?.(`[osm/buildingOutlines] ${endpoint} returned ${resp.status}, trying next mirror…`);
            continue;
          }
          const json = await resp.json();
          return {
            ok: true,
            buildings: parseOsmBuildings(json, { latitude, longitude }),
            query: { latitude, longitude, radiusMeters },
            endpoint_used: endpoint,
          };
        } catch (err) {
          clearTimeout(timer);
          const isTimeout = err?.name === 'AbortError';
          lastError = {
            ok: false,
            status: 0,
            error: isTimeout ? `Overpass timeout @ ${endpoint} after ${timeoutMs}ms` : `${endpoint}: ${err?.message || String(err)}`,
          };
          logger.warn?.(`[osm/buildingOutlines] ${endpoint} ${isTimeout ? 'timed out' : 'threw'}: ${err?.message || err}. Trying next mirror…`);
          // Fall through to try next mirror
        }
      }
      return lastError || { ok: false, status: 0, error: 'All Overpass mirrors failed' };
    },
  };
}

// ── Response parsing ──────────────────────────────────────────────────────

function parseOsmBuildings(json, queryPoint) {
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  const results = [];

  for (const el of elements) {
    if (el.type === 'way') {
      const ring = wayGeometryToRing(el.geometry);
      if (!ring || ring.length < 3) continue;
      results.push(makeBuilding(el, [ring], queryPoint));
    } else if (el.type === 'relation') {
      // Multi-polygon relation: has members with role 'outer' / 'inner'.
      // For POC we take only the outer ring(s).
      const outerRings = (el.members || [])
        .filter(m => m.type === 'way' && m.role === 'outer' && Array.isArray(m.geometry))
        .map(m => wayGeometryToRing(m.geometry))
        .filter(r => r && r.length >= 3);
      if (outerRings.length === 0) continue;
      // Use the first outer ring as the primary polygon — good enough for
      // most residential buildings which are single-outer relations.
      results.push(makeBuilding(el, [outerRings[0]], queryPoint));
    }
  }
  return results;
}

function wayGeometryToRing(geom) {
  if (!Array.isArray(geom) || geom.length < 3) return null;
  // Overpass returns nodes as {lat, lon}. Our polygon convention is [lng, lat].
  const ring = geom.map(n => [n.lon, n.lat]);
  // Ensure the ring closes
  const first = ring[0];
  const last  = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function makeBuilding(el, rings, queryPoint) {
  const centroid = polygonCentroidLL(rings);
  return {
    source: 'osm',
    id:     el.id,
    // OSM tags become "properties" so it matches the LINZ shape
    properties: {
      ...(el.tags || {}),
      timestamp: el.timestamp,
      osm_type:  el.type,
    },
    polygon:    rings,
    centroid,
    area_m2:    approxPolygonAreaM2(rings, centroid.latitude),
    distance_m: haversineMetres(queryPoint.latitude, queryPoint.longitude, centroid.latitude, centroid.longitude),
  };
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

// Re-export the pure helpers so downstream can `import from 'osm/buildingOutlines'`
// without knowing they live in the linz folder.
export { pointInPolygon, buildingContaining, nearestBuilding, polygonCentroidLL };

// ── Singleton ─────────────────────────────────────────────────────────────
let _client = null;
export function queryOsmBuildingsNear(args) {
  if (!_client) _client = createOsmBuildingOutlinesClient();
  return _client.queryNear(args);
}
export function _resetClientForTests() { _client = null; }
