// ────────────────────────────────────────────────────────────────────────────
// Google Solar API — roof imagery orchestrator
//
// Given lat/lng + enquiry_id, fetches Google's aerial RGB tile, converts
// the GeoTIFF to a proposal-friendly PNG via sharp, and uploads it to a
// private Supabase Storage bucket. Returns the storage path + metadata
// for callers (analyseRoof.js) to persist on the roof_analyses row.
//
// Pipeline: dataLayers → fetchTileBuffer → sharp resize+png → supabase upload
//
// All four steps individually fail-shaped: any failure returns
//   { ok: false, reason: <stage>-<code>, error: <detail> }
// without throwing, so analyseRoof.js can decorate the row and continue.
//
// SIZING: Native Google RGB tiles are large (several MB, ~2000+ pixels wide).
// Proposal PDF pages are ~800px wide at print DPI, so we resize to a max
// 1000px wide (withoutEnlargement so we never upscale small tiles). Keeps
// PDF file size manageable when embedded as base64 data URI.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_BUCKET = 'roof-images';
const MAX_PNG_WIDTH = 1000;

// ── Factory (for tests to inject client/sharp/supabase) ────────────────────
export function createRoofImageryFetcher({
  client,                        // { dataLayers({lat,lng}), fetchTileBuffer(url) } — required
  sharp,                         // sharp constructor function — required
  supabase,                      // Supabase JS client — required
  bucket = DEFAULT_BUCKET,
  maxPngWidth = MAX_PNG_WIDTH,
  logger = console,
} = {}) {
  if (!client)   throw new Error('[roofImagery] createRoofImageryFetcher: client required');
  if (!sharp)    throw new Error('[roofImagery] createRoofImageryFetcher: sharp required');
  if (!supabase) throw new Error('[roofImagery] createRoofImageryFetcher: supabase required');

  return {
    /**
     * @param {object} args
     * @param {string} args.enquiryId — used in the storage path
     * @param {number} args.latitude
     * @param {number} args.longitude
     * @returns {Promise<
     *   { ok: true,  storagePath: string, storageBucket: string, sizeBytes: number,
     *     imageryQuality: string|null, imageryDate: object|null }
     * | { ok: false, reason: string, error: string, dataLayersStatus?: number, tileStatus?: number }
     * >}
     */
    async fetchAndStoreRoofImage({ enquiryId, latitude, longitude } = {}) {
      // Boundary validation (Rule 4): fail loud if caller mis-uses.
      if (!enquiryId) {
        throw new Error('[roofImagery] fetchAndStoreRoofImage: enquiryId required');
      }
      if (typeof latitude !== 'number' || Number.isNaN(latitude)
          || typeof longitude !== 'number' || Number.isNaN(longitude)) {
        throw new Error('[roofImagery] fetchAndStoreRoofImage: latitude/longitude required as numbers');
      }

      // ── Step 1: dataLayers → get URLs ──────────────────────────────────
      let dlResult;
      try {
        dlResult = await client.dataLayers({ latitude, longitude });
      } catch (err) {
        return { ok: false, reason: 'datalayers-throw', error: err?.message || String(err) };
      }

      if (!dlResult.ok) {
        return {
          ok: false,
          reason: `datalayers-${dlResult.status}`,
          error: dlResult.error,
          dataLayersStatus: dlResult.status,
        };
      }

      const rgbUrl = dlResult.data?.rgbUrl;
      if (!rgbUrl || typeof rgbUrl !== 'string') {
        return {
          ok: false,
          reason: 'no-rgb-url',
          error: 'dataLayers response missing rgbUrl',
        };
      }

      // ── Step 2: fetch RGB tile (GeoTIFF binary) ────────────────────────
      let tileResult;
      try {
        tileResult = await client.fetchTileBuffer(rgbUrl);
      } catch (err) {
        return { ok: false, reason: 'tile-fetch-throw', error: err?.message || String(err) };
      }

      if (!tileResult.ok) {
        return {
          ok: false,
          reason: `tile-fetch-${tileResult.status}`,
          error: tileResult.error,
          tileStatus: tileResult.status,
        };
      }

      // ── Step 3: GeoTIFF → PNG via sharp (resize down to max width) ─────
      // sharp reads TIFF/GeoTIFF via libvips; withoutEnlargement prevents
      // scaling up small tiles which would waste bytes and blur pixels.
      let pngBuffer;
      try {
        pngBuffer = await sharp(tileResult.buffer)
          .resize({ width: maxPngWidth, withoutEnlargement: true })
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch (err) {
        return {
          ok: false,
          reason: 'sharp-convert-error',
          error: err?.message || String(err),
        };
      }

      // ── Step 4: upload PNG to Supabase Storage ─────────────────────────
      const storagePath = `${enquiryId}/rgb.png`;
      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(storagePath, pngBuffer, {
          contentType: 'image/png',
          upsert: true,     // re-analyses overwrite in place
        });
      if (uploadErr) {
        return {
          ok: false,
          reason: 'storage-upload-error',
          error: uploadErr.message || String(uploadErr),
        };
      }

      return {
        ok: true,
        storagePath,
        storageBucket: bucket,
        sizeBytes: pngBuffer.length,
        imageryQuality: dlResult.data.imageryQuality || null,
        imageryDate:    dlResult.data.imageryDate    || null,
      };
    },
  };
}

// ── Singleton for production consumers ──────────────────────────────────────
let _fetcher = null;
export async function fetchAndStoreRoofImage(args) {
  if (!_fetcher) {
    // Lazy imports to keep test file free of side-effects (sharp is slow
    // to load; supabase creates a client) and to avoid loading these when
    // Google Solar feature is disabled.
    const { default: sharp } = await import('sharp');
    const { supabaseAdmin }   = await import('../../config/supabase.js');
    const { createClient }    = await import('./client.js');
    _fetcher = createRoofImageryFetcher({
      client:   createClient(),
      sharp,
      supabase: supabaseAdmin,
    });
  }
  return _fetcher.fetchAndStoreRoofImage(args);
}

// Test-only reset.
export function _resetFetcherForTests() {
  _fetcher = null;
}

// Export constants so tests + downstream can reference (e.g. for signed URLs)
export const ROOF_IMAGES_BUCKET = DEFAULT_BUCKET;

// ── One-off bucket setup helper ────────────────────────────────────────────
// Mirrors ensureQuotesBucket() in services/pm/quoteStorageService.js. Not
// called at server boot (matches existing pattern) — invoke via the
// scripts/ensure-roof-images-bucket.js one-off script OR create the bucket
// manually in Supabase Studio (as private bucket named 'roof-images').
// Backend uses service_role which has BYPASSRLS, so no storage policies
// need to be added — signed URLs (Commit Q) handle browser-side access.
export async function ensureRoofImagesBucket({ supabase, bucket = DEFAULT_BUCKET } = {}) {
  if (!supabase) throw new Error('[roofImagery] ensureRoofImagesBucket: supabase required');
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(`listBuckets failed: ${listErr.message}`);
  if (buckets?.some(b => b.name === bucket)) {
    return { created: false, bucket };
  }
  const { error: createErr } = await supabase.storage.createBucket(bucket, { public: false });
  if (createErr && !/already exists/i.test(createErr.message)) {
    throw new Error(`createBucket failed: ${createErr.message}`);
  }
  return { created: true, bucket };
}
