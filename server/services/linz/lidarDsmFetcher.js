// ────────────────────────────────────────────────────────────────────────────
// LINZ 1m DSM (Digital Surface Model) fetcher — the M2 fallback for
// addresses Google Solar doesn't cover (new NZ subdivisions).
//
// Data source: nz-elevation open-data S3 bucket (ap-southeast-2, no auth).
//   Root:       https://nz-elevation.s3-ap-southeast-2.amazonaws.com/catalog.json
//   Collection: <root>/auckland/auckland-part-1_2024/dsm_1m/2193/collection.json
//   Item:       <collection>/BA31_10000_0205.json
//   COG:        <collection>/BA31_10000_0205.tiff
//
// Files are Cloud Optimized GeoTIFFs (COG) in EPSG:2193 (NZTM2000) with 1m
// pixel resolution and LERC compression. COG format supports HTTP range
// requests → we can read just the small window over the customer's building
// (~100×100 metres = ~40 KB per building) instead of downloading the whole
// tile (~200 MB).
//
// This service is the FOUNDATION for M2. Downstream:
//   1. THIS FILE     — pixels → { x_nztm, y_nztm, z_meters } points
//   2. lidarRoofPlanes.js (NEXT SESSION) — RANSAC to detect roof planes
//   3. lidarAnalyseRoof.js (NEXT SESSION) — planes → Google-Solar-compatible segments
// ────────────────────────────────────────────────────────────────────────────

import { fromUrl, Pool } from 'geotiff';
import proj4 from 'proj4';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// EPSG:2193 (New Zealand Transverse Mercator 2000) definition. LINZ uses this
// as the native projection for all elevation data. WGS84 (EPSG:4326) is the
// standard lat/lng we use everywhere else. proj4 needs both defs to convert.
proj4.defs(
  'EPSG:2193',
  '+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

const NZTM = 'EPSG:2193';
const WGS84 = 'EPSG:4326';

const CATALOG_ROOT = 'https://nz-elevation.s3-ap-southeast-2.amazonaws.com';

// All 102 NZ-wide 1m DSM collections, pre-loaded with their bboxes from
// LINZ's STAC catalog by server/scripts/discover-nz-elevation-collections.mjs.
// findDsmCogForPoint filters this list by bbox BEFORE fetching any item.json,
// so a Wellington request only touches the 3–5 Wellington collections instead
// of all 102.
//
// Re-run the discovery script quarterly (or when LINZ adds new surveys) —
// output is `server/services/linz/nz-elevation-collections.json`.
let _allCollections = null;   // lazy-loaded on first use
async function loadAllCollections() {
  if (_allCollections) return _allCollections;
  const jsonPath = path.join(__dirname, 'nz-elevation-collections.json');
  const raw = await fs.readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  // Sort newer surveys first (year is in the path, e.g. 'auckland-part-1_2024').
  // This makes the newest survey the primary candidate when multiple cover
  // the same coord — important for new subdivisions.
  _allCollections = [...parsed.collections].sort((a, b) => {
    const yrA = (a.collectionPath.match(/_(\d{4})(?:-\d{4})?\//)?.[1]) || '0';
    const yrB = (b.collectionPath.match(/_(\d{4})(?:-\d{4})?\//)?.[1]) || '0';
    return Number(yrB) - Number(yrA);
  });
  return _allCollections;
}

// ── Coord transforms ─────────────────────────────────────────────────────
// Wraps proj4 with named helpers so intent is obvious in call sites.

export function wgs84ToNztm(lng, lat) {
  const [x, y] = proj4(WGS84, NZTM, [lng, lat]);
  return { x, y };
}

export function nztmToWgs84(x, y) {
  const [lng, lat] = proj4(NZTM, WGS84, [x, y]);
  return { lng, lat };
}

// ── STAC catalog lookup ──────────────────────────────────────────────────
// Given a WGS84 point, find the COG item(s) that contain it.
//
// Strategy:
//   1. Fetch the collection.json for each Auckland survey (in order)
//   2. Iterate the item refs — each ref has a link but no bbox at collection
//      level. Fetch item.json to get its bbox.
//   3. Return the FIRST item whose bbox contains our point.
//
// This is expensive on cold cache: each collection has ~50-150 items, so
// worst-case ~600 HTTP requests. We solve it via aggressive memoisation:
//   - `_collectionCache[collectionPath] = { items: [{href, bbox}], loadedAt }`
//   - Cache lives for the process lifetime; a Node restart re-fetches.
//   - For production: persist to disk or Redis with a 24h TTL.

const _collectionCache = new Map();   // collectionPath → { items: [{href, bbox}] }

/**
 * Load a collection's item index, resolving each item.json to get its
 * exact bbox. Cached across the process lifetime.
 *
 * @param {string} collectionPath e.g. 'auckland/auckland-part-1_2024/dsm_1m/2193'
 * @returns {Promise<Array<{ href, bbox: [minLng, minLat, maxLng, maxLat] }>>}
 */
export async function loadCollectionItemIndex(collectionPath) {
  const cached = _collectionCache.get(collectionPath);
  if (cached) return cached.items;

  const collectionUrl = `${CATALOG_ROOT}/${collectionPath}/collection.json`;
  const cResp = await fetch(collectionUrl);
  if (!cResp.ok) {
    throw new Error(`[linz/lidarDsmFetcher] failed to fetch collection ${collectionPath}: ${cResp.status}`);
  }
  const collection = await cResp.json();
  const itemRefs = (collection.links || [])
    .filter(l => l.rel === 'item' && l.href)
    .map(l => ({
      href:   new URL(l.href, `${collectionUrl}`).toString(),
      title:  l.title || null,
    }));

  // Resolve each item.json to get its exact bbox. Do this in parallel
  // (bounded concurrency) to avoid slamming S3.
  const CONCURRENCY = 12;
  const resolved = [];
  for (let i = 0; i < itemRefs.length; i += CONCURRENCY) {
    const chunk = itemRefs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async ref => {
      try {
        const r = await fetch(ref.href);
        if (!r.ok) return null;
        const item = await r.json();
        if (!Array.isArray(item.bbox) || item.bbox.length < 4) return null;
        // Locate the COG asset. STAC convention: `assets.visual` or
        // `assets.data` typically holds the geotiff.
        const assets = item.assets || {};
        const cog = assets.visual || assets.data || Object.values(assets).find(a => a?.href?.endsWith('.tiff'));
        if (!cog?.href) return null;
        return {
          href: ref.href,
          cogUrl: new URL(cog.href, ref.href).toString(),
          bbox:  item.bbox,   // [minLng, minLat, maxLng, maxLat] in WGS84 (STAC convention)
        };
      } catch { return null; }
    }));
    resolved.push(...results.filter(Boolean));
  }
  _collectionCache.set(collectionPath, { items: resolved, loadedAt: Date.now() });
  return resolved;
}

/**
 * Find the COG URL(s) that contain the given WGS84 lat/lng, searching
 * Auckland surveys in newer-first order.
 *
 * @param {object} p
 * @param {number} p.latitude
 * @param {number} p.longitude
 * @returns {Promise<{cogUrl:string, bbox:number[], collectionPath:string} | null>}
 */
export async function findDsmCogForPoint({ latitude, longitude }) {
  const all = await loadAllCollections();
  // First pass: filter to collections whose bbox contains the target point.
  // 102 collections nationwide → typically 1–5 will match for any given coord.
  const candidateCollections = all.filter(c => {
    const [minLng, minLat, maxLng, maxLat] = c.bbox;
    return longitude >= minLng && longitude <= maxLng &&
           latitude  >= minLat && latitude  <= maxLat;
  });
  if (candidateCollections.length === 0) return null;

  // Second pass: for each candidate, find the tile-level bbox containing
  // the point. Return the FIRST hit — newer surveys come first.
  //
  // Note: returning multiple candidates is done via findAllDsmCogsForPoint
  // (below) — the analyser calls that if the first returned zero valid
  // pixels (survey-boundary tiles can have their bbox contain a point but
  // the actual DSM raster be all no-data there).
  for (const coll of candidateCollections) {
    const items = await loadCollectionItemIndex(coll.collectionPath);
    const hit = items.find(it => {
      const [minLng, minLat, maxLng, maxLat] = it.bbox;
      return longitude >= minLng && longitude <= maxLng &&
             latitude  >= minLat && latitude  <= maxLat;
    });
    if (hit) return { cogUrl: hit.cogUrl, bbox: hit.bbox, collectionPath: coll.collectionPath };
  }
  return null;
}

/**
 * Return ALL candidate COGs covering the given lat/lng (across multiple
 * surveys / adjacent tiles). Ordered newest survey first. Caller can iterate
 * until a tile returns valid non-no-data pixels — necessary because bboxes
 * can overlap between adjacent surveys (e.g. Auckland part-1 + part-2 both
 * cover a boundary coord, but only one has actual data at that point).
 *
 * @param {{latitude, longitude}} p
 * @returns {Promise<Array<{cogUrl, bbox, collectionPath}>>}
 */
export async function findAllDsmCogsForPoint({ latitude, longitude }) {
  const all = await loadAllCollections();
  const candidateCollections = all.filter(c => {
    const [minLng, minLat, maxLng, maxLat] = c.bbox;
    return longitude >= minLng && longitude <= maxLng &&
           latitude  >= minLat && latitude  <= maxLat;
  });
  const hits = [];
  for (const coll of candidateCollections) {
    const items = await loadCollectionItemIndex(coll.collectionPath);
    for (const it of items) {
      const [minLng, minLat, maxLng, maxLat] = it.bbox;
      if (longitude >= minLng && longitude <= maxLng &&
          latitude  >= minLat && latitude  <= maxLat) {
        hits.push({ cogUrl: it.cogUrl, bbox: it.bbox, collectionPath: coll.collectionPath });
      }
    }
  }
  return hits;
}

// ── COG windowed read ────────────────────────────────────────────────────

/**
 * Read an axis-aligned window of a COG DSM around the given WGS84 point,
 * returning an array of {x, y, z} elevation samples in NZTM coordinates.
 *
 * Uses HTTP range requests so we only download the ~40 KB slice covering
 * the customer's building, not the ~200 MB full tile.
 *
 * @param {object} p
 * @param {string} p.cogUrl              full URL to the COG
 * @param {number} p.latitude            centre lat/lng of the window
 * @param {number} p.longitude
 * @param {number} [p.radiusMeters=60]   half-width of the square window
 * @returns {Promise<{
 *   points: Array<{ x:number, y:number, z:number }>,   // NZTM easting/northing/elevation
 *   resolutionM: number,                               // metres/pixel (usually 1)
 *   center: { x:number, y:number },                    // NZTM centre of the window
 *   windowSize: { widthPx:number, heightPx:number },
 * }>}
 */
export async function readDsmWindow({ cogUrl, latitude, longitude, radiusMeters = 60 }) {
  const centre = wgs84ToNztm(longitude, latitude);
  const half = Math.max(20, radiusMeters);   // guard: don't ever read less than 40m×40m

  // Open the COG (HTTP-backed).
  const tiff = await fromUrl(cogUrl, { allowFullFile: false });
  const image = await tiff.getImage();       // first (highest-res) IFD

  // Compute pixel window covering [x-half, y-half, x+half, y+half] in NZTM.
  // COG bbox is [ulx, uly, lrx, lry] in NZTM (EPSG:2193). Pixels are
  // 1m so pixelIdxX = (x - ulx). Y axis is flipped: pixelIdxY = (uly - y).
  const bbox = image.getBoundingBox();       // [minX, minY, maxX, maxY] in NZTM
  const [minX, minY, maxX, maxY] = bbox;
  const width  = image.getWidth();
  const height = image.getHeight();
  const pxW = (maxX - minX) / width;         // metres per pixel X
  const pxH = (maxY - minY) / height;        // metres per pixel Y

  // Convert NZTM window to pixel indices, clip to image bounds.
  const winMinX = Math.max(minX, centre.x - half);
  const winMaxX = Math.min(maxX, centre.x + half);
  const winMinY = Math.max(minY, centre.y - half);
  const winMaxY = Math.min(maxY, centre.y + half);

  const px0 = Math.max(0, Math.floor((winMinX - minX) / pxW));
  const px1 = Math.min(width,  Math.ceil((winMaxX - minX) / pxW));
  // Y-flip: image row 0 is at maxY, row (height-1) is at minY.
  const py0 = Math.max(0, Math.floor((maxY - winMaxY) / pxH));
  const py1 = Math.min(height, Math.ceil((maxY - winMinY) / pxH));

  if (px1 <= px0 || py1 <= py0) {
    return {
      points: [],
      resolutionM: pxW,
      center: centre,
      windowSize: { widthPx: 0, heightPx: 0 },
    };
  }

  const raster = await image.readRasters({
    window: [px0, py0, px1, py1],
    interleave: true,
  });
  const wPx = px1 - px0;
  const hPx = py1 - py0;

  // LINZ DSM uses -9999 as no-data (open water, out-of-survey pixels).
  const NO_DATA = -9999;

  const points = [];
  for (let row = 0; row < hPx; row++) {
    for (let col = 0; col < wPx; col++) {
      const z = raster[row * wPx + col];
      if (!Number.isFinite(z) || z === NO_DATA || z < -100 || z > 5000) continue;
      // Pixel centre in NZTM. Add half a pixel so we sample the centre of
      // the pixel, not the corner.
      const x = minX + (px0 + col + 0.5) * pxW;
      const y = maxY - (py0 + row + 0.5) * pxH;
      points.push({ x, y, z });
    }
  }

  return {
    points,
    resolutionM: pxW,
    center: centre,
    windowSize: { widthPx: wPx, heightPx: hPx },
  };
}

// ── Polygon clipping ─────────────────────────────────────────────────────
// Once we have DSM points across a bounding box, we typically want just the
// points inside the customer's building polygon (from OSM/LINZ). Even-odd
// ray-cast — no lib needed for the simple case.

/**
 * Filter DSM points to those inside a polygon. Polygon is in WGS84 lng/lat
 * (matching OSM/LINZ output); points are converted on the fly.
 *
 * @param {Array<{x,y,z}>} points        NZTM points from readDsmWindow
 * @param {Array<[number,number]>} ring  building outer ring as [[lng, lat], ...]
 * @returns {Array<{x,y,z}>}
 */
export function clipPointsToPolygon(points, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return points;
  return points.filter(p => {
    const { lng, lat } = nztmToWgs84(p.x, p.y);
    return pointInRing(lng, lat, ring);
  });
}

function pointInRing(lng, lat, ring) {
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

// Test-only cache reset
export function _resetCache() { _collectionCache.clear(); }
