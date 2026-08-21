// ────────────────────────────────────────────────────────────────────────────
// LINZ aerial imagery fetcher — orchestrates:
//   1. Compute the tile grid needed to cover a given ground area at the
//      chosen zoom, centred on a lat/lng
//   2. Fetch every tile in parallel via the basemap client
//   3. Stitch the tiles into one big raster with `sharp`
//   4. Crop to the exact ground extent centred on the target lat/lng
//   5. Upload the resulting PNG to Supabase Storage
//
// Return shape matches services/googleSolar/roofImagery.js so the imagery
// orchestrator can treat them interchangeably.
//
// Web Mercator conventions:
//   • Tiles are 256×256 pixels
//   • Origin is top-left, y grows downward
//   • Pixel size at latitude L, zoom Z:
//       metersPerPx = 156543.03392 * cos(L * π/180) / 2^Z
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_BUCKET = 'roof-images';
const TILE_PIXELS    = 256;
const EARTH_CIRCUMFERENCE_M = 40075016.686;
// Below this many pixels covering the target span we consider the imagery
// "too low resolution" and reject — the caller can fall back to another
// provider. 200px for a 30m target = 15cm/px, roughly parity with a good
// Google Solar MEDIUM tile.
const MIN_ACCEPTABLE_PIXELS_PER_SPAN = 200;

// ── Web Mercator tile math (pure, testable) ────────────────────────────────

/** Meters per pixel at latitude L and zoom Z. */
export function metersPerPixel(latitude, zoom) {
  return EARTH_CIRCUMFERENCE_M * Math.cos(latitude * Math.PI / 180) / (2 ** zoom * TILE_PIXELS);
}

/**
 * Convert lat/lng to fractional tile coordinates at a given zoom.
 * Returned x/y are floats — floor() them for integer tile indices, and use
 * the fractional part to find the exact sub-pixel position within a tile.
 */
export function latLngToTileFrac(latitude, longitude, zoom) {
  const n = 2 ** zoom;
  const x = (longitude + 180) / 360 * n;
  const latRad = latitude * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return { x, y };
}

/**
 * Choose the highest zoom level whose tiles still give us ≥ MIN_ACCEPTABLE_PIXELS_PER_SPAN
 * pixels covering `spanMeters`. Capped at 22 (LINZ Basemap max). The lower
 * bound is 15 (below that, imagery is useless for roof-level detail).
 *
 * Sample values at latitude -36.9 (Auckland):
 *   spanMeters=30 → zoom 21 (12cm/px, 250px)  ✓
 *   spanMeters=60 → zoom 20 (24cm/px, 250px)  ✓
 *   spanMeters=15 → zoom 22 (6cm/px, 250px)   ✓
 */
export function chooseZoom(latitude, spanMeters, {
  min = 15, max = 22, minPixelsPerSpan = MIN_ACCEPTABLE_PIXELS_PER_SPAN,
} = {}) {
  for (let z = max; z >= min; z--) {
    const mpp = metersPerPixel(latitude, z);
    const pixelsPerSpan = spanMeters / mpp;
    if (pixelsPerSpan >= minPixelsPerSpan) return z;
  }
  return min;
}

/**
 * Compute the tile grid (integer x/y range) needed to cover a spanMeters
 * square centred on (latitude, longitude) at the given zoom, PLUS a 1-tile
 * safety margin on every side so cropping doesn't run off the edge.
 */
export function computeTileGrid(latitude, longitude, spanMeters, zoom) {
  const centerFrac = latLngToTileFrac(latitude, longitude, zoom);
  const mpp        = metersPerPixel(latitude, zoom);
  const halfSpanPx = (spanMeters / 2) / mpp;
  const halfSpanTiles = halfSpanPx / TILE_PIXELS;

  const minX = Math.floor(centerFrac.x - halfSpanTiles) - 1;
  const maxX = Math.floor(centerFrac.x + halfSpanTiles) + 1;
  const minY = Math.floor(centerFrac.y - halfSpanTiles) - 1;
  const maxY = Math.floor(centerFrac.y + halfSpanTiles) + 1;

  const tiles = [];
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      tiles.push({ z: zoom, x: tx, y: ty });
    }
  }
  return { tiles, minX, maxX, minY, maxY, centerFrac, mpp };
}

// ── Factory + main API ─────────────────────────────────────────────────────

export function createAerialFetcher({
  client,      // basemap client (from basemapClient.js)
  sharp,       // sharp constructor function
  supabase,    // Supabase JS client
  bucket = DEFAULT_BUCKET,
  logger = console,
} = {}) {
  if (!client)   throw new Error('[linz/aerialFetcher] createAerialFetcher: client required');
  if (!sharp)    throw new Error('[linz/aerialFetcher] createAerialFetcher: sharp required');
  if (!supabase) throw new Error('[linz/aerialFetcher] createAerialFetcher: supabase required');

  return {
    /**
     * @param {object} args
     * @param {string} args.enquiryId          Row id used in the storage path
     * @param {number} args.latitude           Property centre latitude
     * @param {number} args.longitude          Property centre longitude
     * @param {number} args.radiusMeters       Half the ground span to fetch (matches Google Solar's radiusMeters convention)
     * @returns {Promise<
     *    { ok:true,  storagePath:string, storageBucket:string, sizeBytes:number,
     *      imageryQuality:'HIGH'|'MEDIUM'|'LOW'|null, imageryDate:string|null,
     *      radiusMeters:number, zoom:number, source:'linz' }
     *  | { ok:false, reason:string, error:string }
     * >}
     */
    async fetchAndStoreRoofImage({ enquiryId, latitude, longitude, radiusMeters } = {}) {
      if (!enquiryId) throw new Error('[linz/aerialFetcher] enquiryId required');
      if (typeof latitude  !== 'number' || Number.isNaN(latitude))  throw new Error('[linz/aerialFetcher] latitude must be a number');
      if (typeof longitude !== 'number' || Number.isNaN(longitude)) throw new Error('[linz/aerialFetcher] longitude must be a number');
      if (typeof radiusMeters !== 'number' || radiusMeters <= 0) {
        throw new Error('[linz/aerialFetcher] radiusMeters must be a positive number');
      }

      const spanMeters = radiusMeters * 2;
      const zoom = chooseZoom(latitude, spanMeters);
      const { tiles, minX, minY, centerFrac, mpp } =
        computeTileGrid(latitude, longitude, spanMeters, zoom);

      // ── Step 1: fetch all tiles in parallel ─────────────────────────
      let tileResults;
      try {
        tileResults = await Promise.all(tiles.map(t => client.fetchTile(t)));
      } catch (err) {
        return { ok: false, reason: 'tile-fetch-throw', error: err?.message || String(err) };
      }

      // Any failed tile → whole fetch fails (missing tiles would leave blank
      // gaps in the stitched image). Report the first failure verbosely.
      const failedIdx = tileResults.findIndex(r => !r.ok);
      if (failedIdx !== -1) {
        const failed = tileResults[failedIdx];
        const tile = tiles[failedIdx];
        return {
          ok: false,
          reason: `tile-fetch-${failed.status}`,
          error: `Tile ${tile.z}/${tile.x}/${tile.y} failed: ${failed.error}`,
        };
      }

      // ── Step 2: stitch tiles into one raster ─────────────────────────
      // Compute how many tiles wide/tall we fetched
      const tilesWide = (Math.max(...tiles.map(t => t.x)) - minX) + 1;
      const tilesTall = (Math.max(...tiles.map(t => t.y)) - minY) + 1;
      const rasterW   = tilesWide * TILE_PIXELS;
      const rasterH   = tilesTall * TILE_PIXELS;

      let stitched;
      try {
        stitched = await sharp({
          create: {
            width: rasterW, height: rasterH,
            channels: 3,
            background: { r: 0, g: 0, b: 0 },
          },
        })
          .composite(tiles.map((t, i) => ({
            input: tileResults[i].buffer,
            left: (t.x - minX) * TILE_PIXELS,
            top:  (t.y - minY) * TILE_PIXELS,
          })))
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch (err) {
        return { ok: false, reason: 'stitch-error', error: err?.message || String(err) };
      }

      // ── Step 3: crop to exact ground extent centred on target ────────
      // Sub-tile pixel of the target centre WITHIN the stitched raster:
      const centerPxInRaster = {
        x: (centerFrac.x - minX) * TILE_PIXELS,
        y: (centerFrac.y - minY) * TILE_PIXELS,
      };
      const cropHalfPx = Math.round((spanMeters / 2) / mpp);
      const cropLeft = Math.max(0, Math.round(centerPxInRaster.x - cropHalfPx));
      const cropTop  = Math.max(0, Math.round(centerPxInRaster.y - cropHalfPx));
      const cropSize = Math.min(cropHalfPx * 2, rasterW - cropLeft, rasterH - cropTop);

      let cropped;
      try {
        cropped = await sharp(stitched)
          .extract({ left: cropLeft, top: cropTop, width: cropSize, height: cropSize })
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch (err) {
        return { ok: false, reason: 'crop-error', error: err?.message || String(err) };
      }

      // ── Step 4: upload to Supabase Storage ────────────────────────────
      const storagePath = `${enquiryId}/rgb.png`;
      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(storagePath, cropped, { contentType: 'image/png', upsert: true });
      if (uploadErr) {
        return {
          ok: false, reason: 'storage-upload-error',
          error: uploadErr.message || String(uploadErr),
        };
      }

      return {
        ok: true,
        storagePath,
        storageBucket: bucket,
        sizeBytes:     cropped.length,
        // LINZ Basemap serves best-available imagery; quality/date aren't
        // per-request metadata like Google Solar. We report the target
        // pixel density as a proxy — client compares to Google MEDIUM.
        imageryQuality: null,
        imageryDate:    null,
        radiusMeters,
        zoom,
        source:         'linz',
      };
    },
  };
}

// ── Singleton for production consumers ─────────────────────────────────────
let _fetcher = null;
export async function fetchAndStoreRoofImage(args) {
  if (!_fetcher) {
    const { default: env }     = await import('../../config/env.js');
    const { default: sharp }   = await import('sharp');
    const { supabaseAdmin }    = await import('../../config/supabase.js');
    const { createBasemapClient } = await import('./basemapClient.js');

    if (!env.linz.apiKey) {
      throw new Error('[linz/aerialFetcher] LINZ_BASEMAP_API_KEY not set');
    }
    _fetcher = createAerialFetcher({
      client: createBasemapClient({
        apiKey:     env.linz.apiKey,
        baseUrl:    env.linz.baseUrl,
        tileFormat: env.linz.tileFormat,
      }),
      sharp,
      supabase: supabaseAdmin,
    });
  }
  return _fetcher.fetchAndStoreRoofImage(args);
}

// Test-only reset.
export function _resetFetcherForTests() { _fetcher = null; }
