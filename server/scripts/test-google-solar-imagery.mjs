// ────────────────────────────────────────────────────────────────────────────
// test-google-solar-imagery.mjs
//
// Offline unit tests for services/googleSolar/roofImagery.js.
// Uses fake client + fake supabase + fake sharp to verify the 4-step
// pipeline (dataLayers → fetchTileBuffer → sharp → upload) end-to-end
// without hitting Google or Supabase.
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import { createRoofImageryFetcher, ROOF_IMAGES_BUCKET } from '../services/googleSolar/roofImagery.js';

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}

console.log('test-google-solar-imagery\n');

// ── Fake sharp — chainable API returning a predictable Buffer ──────────────
// Real sharp signature: sharp(buffer).resize(opts).png(opts).toBuffer()
// This mock records calls so tests can verify the pipeline.
function makeFakeSharp() {
  const calls = { instances: 0, resizeArgs: null, pngArgs: null };
  const factory = (inputBuffer) => {
    calls.instances++;
    calls.lastInput = inputBuffer;
    return {
      resize(args) { calls.resizeArgs = args; return this; },
      png(args)    { calls.pngArgs = args;    return this; },
      async toBuffer() {
        // Return a 4-byte fake PNG buffer — enough for tests to verify
        // it flowed through and got uploaded.
        return Buffer.from([0x89, 0x50, 0x4E, 0x47]);   // PNG magic (partial)
      },
    };
  };
  factory._calls = calls;
  return factory;
}

// ── Fake supabase storage — records uploads ────────────────────────────────
function makeFakeSupabase(uploadImpl) {
  const uploads = [];
  return {
    _uploads: uploads,
    storage: {
      from(bucket) {
        return {
          upload: uploadImpl || (async (path, buffer, opts) => {
            uploads.push({ bucket, path, buffer, opts });
            return { error: null };
          }),
        };
      },
    },
  };
}

// Default happy client
function makeHappyClient(rgbUrl = 'https://solar.googleapis.com/v1/geoTiff:get?id=rgb') {
  return {
    async dataLayers() {
      return { ok: true, source: 'mock', data: {
        rgbUrl, imageryQuality: 'MEDIUM', imageryDate: { year: 2024, month: 5, day: 15 },
      }};
    },
    async fetchTileBuffer() {
      return { ok: true, source: 'mock', buffer: Buffer.from([0x49, 0x49, 0x2A, 0x00]) };   // TIFF magic
    },
  };
}

const AKL = { latitude: -36.85, longitude: 174.76 };
const silentLogger = { warn: () => {}, error: () => {} };

// ── Case 1: Happy path — end-to-end pipeline succeeds ──────────────────────
{
  const sharp = makeFakeSharp();
  const supabase = makeFakeSupabase();
  const fetcher = createRoofImageryFetcher({
    client: makeHappyClient(), sharp, supabase, logger: silentLogger,
  });
  const res = await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e1', ...AKL });
  assert('happy path returns ok:true', res.ok === true);
  assert('happy path storagePath = "{enquiryId}/rgb.png"', res.storagePath === 'e1/rgb.png');
  assert('happy path storageBucket = roof-images', res.storageBucket === 'roof-images');
  assert('happy path returns sizeBytes', typeof res.sizeBytes === 'number' && res.sizeBytes > 0);
  assert('happy path returns imageryQuality', res.imageryQuality === 'MEDIUM');
  assert('happy path returns imageryDate', res.imageryDate?.year === 2024);
  // Verify pipeline was called correctly
  assert('sharp called once', sharp._calls.instances === 1);
  assert('sharp.resize called with maxWidth=1000', sharp._calls.resizeArgs?.width === 1000);
  assert('sharp.resize withoutEnlargement=true', sharp._calls.resizeArgs?.withoutEnlargement === true);
  assert('supabase upload was called', supabase._uploads.length === 1);
  assert('upload bucket=roof-images', supabase._uploads[0].bucket === 'roof-images');
  assert('upload contentType=image/png', supabase._uploads[0].opts?.contentType === 'image/png');
  assert('upload upsert=true', supabase._uploads[0].opts?.upsert === true);
}

// ── Case 2: dataLayers returns non-ok → fetcher returns failed reason ──────
{
  const client = {
    async dataLayers() { return { ok: false, source: 'live', status: 404, error: 'no imagery' }; },
    async fetchTileBuffer() { throw new Error('should not be called'); },
  };
  const supabase = makeFakeSupabase();
  const fetcher = createRoofImageryFetcher({
    client, sharp: makeFakeSharp(), supabase, logger: silentLogger,
  });
  const res = await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e2', ...AKL });
  assert('dataLayers 404 → ok:false', res.ok === false);
  assert('dataLayers 404 → reason="datalayers-404"', res.reason === 'datalayers-404');
  assert('dataLayers 404 → dataLayersStatus set', res.dataLayersStatus === 404);
  assert('dataLayers 404 → no upload attempted', supabase._uploads.length === 0);
}

// ── Case 3: dataLayers throws → reason="datalayers-throw" ──────────────────
{
  const client = {
    async dataLayers() { throw new Error('network kaboom'); },
    async fetchTileBuffer() { throw new Error('should not be called'); },
  };
  const fetcher = createRoofImageryFetcher({
    client, sharp: makeFakeSharp(), supabase: makeFakeSupabase(), logger: silentLogger,
  });
  const res = await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e3', ...AKL });
  assert('dataLayers throw → ok:false', res.ok === false);
  assert('dataLayers throw → reason=datalayers-throw', res.reason === 'datalayers-throw');
  assert('dataLayers throw → error preserved', res.error.includes('network kaboom'));
}

// ── Case 4: dataLayers OK but no rgbUrl → reason=no-rgb-url ────────────────
{
  const client = {
    async dataLayers() { return { ok: true, source: 'live', data: { imageryQuality: 'LOW' } }; },   // no rgbUrl!
    async fetchTileBuffer() { throw new Error('should not be called'); },
  };
  const fetcher = createRoofImageryFetcher({
    client, sharp: makeFakeSharp(), supabase: makeFakeSupabase(), logger: silentLogger,
  });
  const res = await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e4', ...AKL });
  assert('no rgbUrl → ok:false', res.ok === false);
  assert('no rgbUrl → reason=no-rgb-url', res.reason === 'no-rgb-url');
}

// ── Case 5: fetchTileBuffer returns non-ok → reason=tile-fetch-{status} ────
{
  const client = {
    ...makeHappyClient(),
    async fetchTileBuffer() { return { ok: false, source: 'live', status: 500, error: 'server error' }; },
  };
  const supabase = makeFakeSupabase();
  const fetcher = createRoofImageryFetcher({
    client, sharp: makeFakeSharp(), supabase, logger: silentLogger,
  });
  const res = await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e5', ...AKL });
  assert('tile fetch 500 → ok:false', res.ok === false);
  assert('tile fetch 500 → reason=tile-fetch-500', res.reason === 'tile-fetch-500');
  assert('tile fetch 500 → tileStatus=500', res.tileStatus === 500);
  assert('tile fetch failure → no upload', supabase._uploads.length === 0);
}

// ── Case 6: fetchTileBuffer throws → reason=tile-fetch-throw ───────────────
{
  const client = {
    ...makeHappyClient(),
    async fetchTileBuffer() { throw new Error('abort signal'); },
  };
  const fetcher = createRoofImageryFetcher({
    client, sharp: makeFakeSharp(), supabase: makeFakeSupabase(), logger: silentLogger,
  });
  const res = await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e6', ...AKL });
  assert('tile fetch throw → ok:false', res.ok === false);
  assert('tile fetch throw → reason=tile-fetch-throw', res.reason === 'tile-fetch-throw');
}

// ── Case 7: sharp throws during conversion → reason=sharp-convert-error ────
{
  const brokenSharp = () => ({
    resize() { return this; },
    png() { return this; },
    async toBuffer() { throw new Error('corrupt TIFF header'); },
  });
  const supabase = makeFakeSupabase();
  const fetcher = createRoofImageryFetcher({
    client: makeHappyClient(), sharp: brokenSharp, supabase, logger: silentLogger,
  });
  const res = await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e7', ...AKL });
  assert('sharp throw → ok:false', res.ok === false);
  assert('sharp throw → reason=sharp-convert-error', res.reason === 'sharp-convert-error');
  assert('sharp throw → error includes original', res.error.includes('corrupt TIFF'));
  assert('sharp failure → no upload', supabase._uploads.length === 0);
}

// ── Case 8: Supabase upload returns error → reason=storage-upload-error ────
{
  const brokenUpload = async () => ({ error: { message: 'permission denied on bucket' } });
  const supabase = makeFakeSupabase(brokenUpload);
  const fetcher = createRoofImageryFetcher({
    client: makeHappyClient(), sharp: makeFakeSharp(), supabase, logger: silentLogger,
  });
  const res = await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e8', ...AKL });
  assert('upload error → ok:false', res.ok === false);
  assert('upload error → reason=storage-upload-error', res.reason === 'storage-upload-error');
  assert('upload error → error preserved', res.error.includes('permission denied'));
}

// ── Case 9: Boundary validation — missing / invalid args throw ─────────────
{
  const fetcher = createRoofImageryFetcher({
    client: makeHappyClient(), sharp: makeFakeSharp(), supabase: makeFakeSupabase(),
    logger: silentLogger,
  });
  let threw = false;
  try { await fetcher.fetchAndStoreRoofImage({ ...AKL }); } catch { threw = true; }
  assert('missing enquiryId throws', threw === true);
  threw = false;
  try { await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e', latitude: 'x', longitude: 0 }); } catch { threw = true; }
  assert('non-numeric latitude throws', threw === true);
  threw = false;
  try { await fetcher.fetchAndStoreRoofImage({ enquiryId: 'e', latitude: 0 }); } catch { threw = true; }
  assert('missing longitude throws', threw === true);
}

// ── Case 10: Factory boundary — missing deps throw ─────────────────────────
{
  let threw = false;
  try { createRoofImageryFetcher({ sharp: makeFakeSharp(), supabase: makeFakeSupabase() }); } catch { threw = true; }
  assert('factory throws without client', threw === true);
  threw = false;
  try { createRoofImageryFetcher({ client: makeHappyClient(), supabase: makeFakeSupabase() }); } catch { threw = true; }
  assert('factory throws without sharp', threw === true);
  threw = false;
  try { createRoofImageryFetcher({ client: makeHappyClient(), sharp: makeFakeSharp() }); } catch { threw = true; }
  assert('factory throws without supabase', threw === true);
}

// ── Case 11: Custom bucket + maxPngWidth respected ────────────────────────
{
  const sharp = makeFakeSharp();
  const supabase = makeFakeSupabase();
  const fetcher = createRoofImageryFetcher({
    client: makeHappyClient(), sharp, supabase,
    bucket: 'custom-bucket', maxPngWidth: 500,
    logger: silentLogger,
  });
  const res = await fetcher.fetchAndStoreRoofImage({ enquiryId: 'ec', ...AKL });
  assert('custom bucket used', res.storageBucket === 'custom-bucket');
  assert('custom bucket in upload', supabase._uploads[0]?.bucket === 'custom-bucket');
  assert('custom maxPngWidth=500 passed to sharp', sharp._calls.resizeArgs?.width === 500);
}

// ── Case 12: ROOF_IMAGES_BUCKET export is 'roof-images' ────────────────────
{
  assert('ROOF_IMAGES_BUCKET exported as "roof-images"', ROOF_IMAGES_BUCKET === 'roof-images');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}
