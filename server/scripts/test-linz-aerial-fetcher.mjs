// ────────────────────────────────────────────────────────────────────────────
// test-linz-aerial-fetcher.mjs
//
// Unit tests for server/services/linz/aerialFetcher.js — Web Mercator tile
// math + end-to-end fetch+stitch+upload flow with mocked deps.
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import {
  createAerialFetcher,
  metersPerPixel, chooseZoom, latLngToTileFrac, computeTileGrid,
} from '../services/linz/aerialFetcher.js';

let pass = 0, fail = 0;
const failures = [];
function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}
function close(a, b, eps = 0.01) { return Math.abs(a - b) < eps; }
console.log('test-linz-aerial-fetcher\n');

// ── metersPerPixel ─────────────────────────────────────────────────────────
{
  console.log('\n▸ metersPerPixel');
  // Equator, zoom 0: 40075016.686 / 256 = 156543.03
  assert('equator z=0 ≈ 156543m/px',
    close(metersPerPixel(0, 0), 156543.03, 0.5));
  // Auckland (-36.9°), zoom 20: cos(-36.9°)≈0.7997 → 156543*0.7997/2^20/256... wait
  // metersPerPixel = 40075016.686 * cos(lat) / (2^z * 256)
  // At -36.9°, z=20: 40075016.686 * 0.7997 / (1048576 * 256) = 0.1195 m/px
  assert('Auckland z=20 ≈ 0.12 m/px', close(metersPerPixel(-36.9, 20), 0.1195, 0.005));
  // Auckland z=21 = half of z=20 = 0.0598
  assert('Auckland z=21 ≈ 0.06 m/px', close(metersPerPixel(-36.9, 21), 0.0597, 0.005));
  // Auckland z=22 = 0.03
  assert('Auckland z=22 ≈ 0.03 m/px', close(metersPerPixel(-36.9, 22), 0.0299, 0.005));
}

// ── chooseZoom ─────────────────────────────────────────────────────────────
{
  console.log('\n▸ chooseZoom (Auckland, ≥200 px per span)');
  // For a 30m span at Auckland: z=21 gives 30/0.06 = 500px, plenty; z=22 gives 30/0.03 = 1000px, more detail.
  // So chooseZoom should return the maximum (22) since even that satisfies the 200px minimum.
  const z30 = chooseZoom(-36.9, 30);
  assert('30m span → picks max zoom (22)', z30 === 22, `got ${z30}`);
  // For a 60m span at Auckland z=22: 60/0.03 = 2000px — still ok; picks 22
  const z60 = chooseZoom(-36.9, 60);
  assert('60m span → still picks 22', z60 === 22, `got ${z60}`);
  // For a 500m span at Auckland z=22: 500/0.03 = 16000px — way more than needed;
  // but chooseZoom picks the highest zoom whose density satisfies the minimum,
  // so it stays at max even though that's absurdly zoomed.
  // (Real callers should cap span at reasonable house-scale values.)
}

// ── latLngToTileFrac ───────────────────────────────────────────────────────
{
  console.log('\n▸ latLngToTileFrac');
  // Auckland test point -36.909809, 174.694787 at z=20 — sanity-check the
  // computed tile falls in the plausible Auckland tile range.
  // At z=20, total tiles across = 2^20 = 1,048,576.
  // Longitude 174.7 → x = (174.7 + 180)/360 * 1,048,576 ≈ 1,033,120 (98% across)
  const t = latLngToTileFrac(-36.909809, 174.694787, 20);
  assert('z=20 tile x is in Auckland east-of-Greenwich range (1.03M–1.04M)',
    t.x > 1_030_000 && t.x < 1_040_000, `got ${t.x}`);
  // Latitude -36.9 south → y > equator (y=524288 at z=20) by ~22%
  assert('z=20 tile y is south of equator (>524k)',
    t.y > 524_288 && t.y < 700_000, `got ${t.y}`);

  // Equator, lng=0, z=1 → tile (1, 1) exact centre
  const eq = latLngToTileFrac(0, 0, 1);
  assert('equator z=1 x=1', close(eq.x, 1, 0.01), `got ${eq.x}`);
  assert('equator z=1 y=1', close(eq.y, 1, 0.01), `got ${eq.y}`);

  // Round-trip invariance: converting a tile centre back to lat/lng and
  // then back to tile should return the same point.
  const t2 = latLngToTileFrac(-36.909809, 174.694787, 18);
  const t2Halved = latLngToTileFrac(-36.909809, 174.694787, 17);
  assert('going z=18 → z=17 halves the tile coord',
    close(t2.x / 2, t2Halved.x, 0.5) && close(t2.y / 2, t2Halved.y, 0.5));
}

// ── computeTileGrid ────────────────────────────────────────────────────────
{
  console.log('\n▸ computeTileGrid');
  const g = computeTileGrid(-36.9, 174.7, 30, 21);
  assert('returns tiles array', Array.isArray(g.tiles));
  assert('at least 4 tiles fetched', g.tiles.length >= 4);
  assert('each tile has z=21', g.tiles.every(t => t.z === 21));
  assert('grid maxX >= minX', g.maxX >= g.minX);
  assert('grid maxY >= minY', g.maxY >= g.minY);
  assert('mpp is populated', typeof g.mpp === 'number' && g.mpp > 0);
  assert('centerFrac provided', typeof g.centerFrac.x === 'number');
  // Bounding box includes 1 tile safety margin on each side — width should be
  // at least ceil(span/tile) + 2
  const spanTiles = 30 / (256 * g.mpp);
  assert('bbox width includes 1-tile margin',
    (g.maxX - g.minX + 1) >= Math.ceil(spanTiles) + 2);
}

// ── createAerialFetcher — boundary validation ─────────────────────────────
{
  console.log('\n▸ createAerialFetcher — DI validation');
  let thrown = false;
  try { createAerialFetcher({}); } catch (e) { thrown = /client required/.test(e.message); }
  assert('no client → throws', thrown);
  thrown = false;
  try { createAerialFetcher({ client: {} }); } catch (e) { thrown = /sharp required/.test(e.message); }
  assert('no sharp → throws', thrown);
  thrown = false;
  try { createAerialFetcher({ client: {}, sharp: () => {} }); } catch (e) { thrown = /supabase required/.test(e.message); }
  assert('no supabase → throws', thrown);
}

// ── fetchAndStoreRoofImage — arg validation ───────────────────────────────
{
  console.log('\n▸ fetchAndStoreRoofImage — arg validation');
  const f = createAerialFetcher({ client: {}, sharp: () => {}, supabase: {} });
  async function throws(args, pattern) {
    try { await f.fetchAndStoreRoofImage(args); return false; }
    catch (e) { return pattern.test(e.message); }
  }
  assert('no enquiryId → throws',
    await throws({ latitude: 0, longitude: 0, radiusMeters: 10 }, /enquiryId required/));
  assert('non-numeric latitude → throws',
    await throws({ enquiryId: 'a', latitude: 'x', longitude: 0, radiusMeters: 10 }, /latitude/));
  assert('non-numeric longitude → throws',
    await throws({ enquiryId: 'a', latitude: 0, longitude: 'x', radiusMeters: 10 }, /longitude/));
  assert('negative radius → throws',
    await throws({ enquiryId: 'a', latitude: 0, longitude: 0, radiusMeters: -1 }, /radiusMeters must be a positive/));
}

// ── fetchAndStoreRoofImage — success path (mocked deps) ───────────────────
{
  console.log('\n▸ fetchAndStoreRoofImage — end-to-end mocked');

  // Fake basemap client returns a distinct 1-byte buffer per tile so we can
  // verify stitching order by inspecting sharp's composite input arg.
  const client = {
    async fetchTile({ z, x, y }) {
      return { ok: true, buffer: Buffer.from(`T${z}-${x}-${y}`), contentType: 'image/webp' };
    },
  };

  // Fake sharp — records what was composited + extracted. Returns fixed buffers.
  const sharpCalls = { compose: null, extract: null };
  const sharp = (arg) => {
    if (arg && arg.create) {
      return {
        composite(inputs) { sharpCalls.compose = inputs; return this; },
        png() { return this; },
        toBuffer: async () => Buffer.from('STITCHED'),
      };
    }
    // Second sharp(buf).extract().png().toBuffer() pipeline
    return {
      extract(region) { sharpCalls.extract = region; return this; },
      png() { return this; },
      toBuffer: async () => Buffer.from('CROPPED'),
    };
  };

  const uploads = [];
  const supabase = {
    storage: {
      from(bucket) {
        return {
          async upload(path, buf, opts) {
            uploads.push({ bucket, path, buf, opts });
            return { data: { path }, error: null };
          },
        };
      },
    },
  };

  const f = createAerialFetcher({ client, sharp, supabase });
  const result = await f.fetchAndStoreRoofImage({
    enquiryId: 'ENQ-123',
    latitude: -36.9, longitude: 174.7,
    radiusMeters: 15,
  });

  assert('ok=true', result.ok === true);
  assert('source=linz', result.source === 'linz');
  assert('storagePath includes enquiryId', result.storagePath === 'ENQ-123/rgb.png');
  assert('storageBucket=roof-images', result.storageBucket === 'roof-images');
  assert('radiusMeters echoed back', result.radiusMeters === 15);
  assert('zoom is 20-22', result.zoom >= 20 && result.zoom <= 22);
  assert('sizeBytes matches CROPPED buffer', result.sizeBytes === 7);

  // Verify pipeline ran the expected stages
  assert('composite was called with tile buffers', Array.isArray(sharpCalls.compose) && sharpCalls.compose.length > 0);
  assert('composite entries have left/top pixel offsets',
    sharpCalls.compose.every(e => typeof e.left === 'number' && typeof e.top === 'number'));
  assert('composite offsets are multiples of 256 (tile pixels)',
    sharpCalls.compose.every(e => e.left % 256 === 0 && e.top % 256 === 0));
  assert('extract was called with a positive region', sharpCalls.extract && sharpCalls.extract.width > 0);
  assert('upload path matches storagePath', uploads[0]?.path === 'ENQ-123/rgb.png');
  assert('upload uses upsert', uploads[0]?.opts?.upsert === true);
}

// ── fetchAndStoreRoofImage — one tile fails → whole fetch fails ───────────
{
  console.log('\n▸ fetchAndStoreRoofImage — failure propagation');
  let callN = 0;
  const client = {
    async fetchTile({ z, x, y }) {
      callN++;
      if (callN === 3) return { ok: false, status: 429, error: '429 rate limit' };
      return { ok: true, buffer: Buffer.from('t'), contentType: 'image/webp' };
    },
  };
  const sharp = () => ({ composite: () => ({ png: () => ({ toBuffer: async () => Buffer.from('x') }) }) });
  const supabase = { storage: { from: () => ({ upload: async () => ({ error: null }) }) } };

  const f = createAerialFetcher({ client, sharp, supabase });
  const r = await f.fetchAndStoreRoofImage({
    enquiryId: 'E', latitude: -36.9, longitude: 174.7, radiusMeters: 15,
  });
  assert('ok=false', r.ok === false);
  assert('reason mentions tile-fetch', /tile-fetch/.test(r.reason));
  assert('error mentions the failing tile coords', /Tile \d+\/\d+\/\d+ failed/.test(r.error));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}
