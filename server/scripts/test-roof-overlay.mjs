// ────────────────────────────────────────────────────────────────────────────
// test-roof-overlay.mjs
//
// Unit tests for client/src/pm/utils/roofOverlay.js — the lat/lng → pixel
// transform that overlays Google Solar roof segments on top of the aerial
// tile. Pure math, no browser needed, testable in Node.
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../');
const overlayUrl = pathToFileURL(path.join(
  REPO_ROOT, 'client/src/pm/utils/roofOverlay.js'
)).href;

const { makeLatLngToPixel, makePixelToLatLng, segmentBboxToPolygon, segmentLabel } = await import(overlayUrl);

let pass = 0;
let fail = 0;
const failures = [];
function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}
function close(a, b, eps = 0.5) { return Math.abs(a - b) < eps; }

console.log('test-roof-overlay\n');

// ── Real test coordinates from the Auckland customer ─────────────────────
// centre: -36.909809, 174.694787 (property in Blockhouse Bay)
// radius: 50 metres (matches server/services/googleSolar/client.js default)
// image:  1000 × 1000 px (matches typical dataLayers response after sharp resize)
const CENTER_LAT = -36.909809;
const CENTER_LNG = 174.694787;
const RADIUS_M   = 50;
const IMG_W      = 1000;
const IMG_H      = 1000;

const toPixel = makeLatLngToPixel({
  centerLat: CENTER_LAT, centerLng: CENTER_LNG,
  radiusMeters: RADIUS_M,
  imgWidth: IMG_W, imgHeight: IMG_H,
});

{
  console.log('\n▸ centre lat/lng maps to image centre');
  const p = toPixel(CENTER_LAT, CENTER_LNG);
  assert('x = imgWidth/2',  close(p.x, 500));
  assert('y = imgHeight/2', close(p.y, 500));
}

{
  console.log('\n▸ 25m north of centre → upper-half of image');
  // 25m north = latitude + (25 / 111320) degrees
  const dLat = 25 / 111320;
  const p = toPixel(CENTER_LAT + dLat, CENTER_LNG);
  assert('x stays at centre', close(p.x, 500));
  assert('y is above centre (smaller)', p.y < 500);
  assert('y roughly at 250 (halfway to top edge)', close(p.y, 250, 5));
}

{
  console.log('\n▸ 25m south of centre → lower half');
  const dLat = -25 / 111320;
  const p = toPixel(CENTER_LAT + dLat, CENTER_LNG);
  assert('y is below centre', p.y > 500);
  assert('y roughly at 750', close(p.y, 750, 5));
}

{
  console.log('\n▸ 25m east of centre → right half');
  // 25m east at this latitude: (25 / (111320 * cos(centerLat))) degrees
  const metersPerDegLng = 111320 * Math.cos(CENTER_LAT * Math.PI / 180);
  const dLng = 25 / metersPerDegLng;
  const p = toPixel(CENTER_LAT, CENTER_LNG + dLng);
  assert('x is right of centre', p.x > 500);
  assert('x roughly at 750', close(p.x, 750, 5));
}

{
  console.log('\n▸ Corner of tile — 50m NE');
  const dLat = 50 / 111320;
  const metersPerDegLng = 111320 * Math.cos(CENTER_LAT * Math.PI / 180);
  const dLng = 50 / metersPerDegLng;
  const p = toPixel(CENTER_LAT + dLat, CENTER_LNG + dLng);
  assert('x at right edge (1000)', close(p.x, 1000, 2));
  assert('y at top edge (0)',      close(p.y, 0,    2));
}

{
  console.log('\n▸ segmentBboxToPolygon returns 4 corners in NW/NE/SE/SW order');
  const bbox = {
    ne: { latitude: -36.9097781, longitude: 174.69479769999998 },
    sw: { latitude: -36.9098441, longitude: 174.69473399999998 },
  };
  const poly = segmentBboxToPolygon(toPixel, bbox);
  assert('4 points returned', poly.length === 4);
  // NW: lat=ne.lat, lng=sw.lng → highest y-value smaller than SW & smaller x than NE
  assert('NW is top-left', poly[0].x < poly[1].x && poly[0].y < poly[3].y);
  assert('NE is top-right', poly[1].x > poly[0].x && poly[1].y < poly[2].y);
  assert('SE is bottom-right', poly[2].x > poly[3].x && poly[2].y > poly[1].y);
  assert('SW is bottom-left', poly[3].x < poly[2].x && poly[3].y > poly[0].y);

  // Missing bbox → empty array
  assert('missing bbox → []',
    segmentBboxToPolygon(toPixel, null).length === 0);
  assert('missing ne → []',
    segmentBboxToPolygon(toPixel, { sw: bbox.sw }).length === 0);
}

{
  console.log('\n▸ segmentLabel');
  const seg = {
    stats: { areaMeters2: 23.437878 },
    pitchDegrees: 12.183244,
    azimuthDegrees: 236.38373,
  };
  const label = segmentLabel(seg, 0);
  assert('starts with segment number', label.startsWith('#1'));
  assert('includes area rounded to 1dp', label.includes('23.4m²'));
  assert('includes pitch degrees', label.includes('12°'));
  assert('includes compass — 236° = W or SW', label.includes('SW') || label.includes('W'));

  // Missing fields → still returns SOMETHING sensible
  const bare = segmentLabel({}, 4);
  assert('bare segment → returns just #5', bare === '#5');
}

{
  console.log('\n▸ Aspect-ratio-aware — non-square image');
  const wide = makeLatLngToPixel({
    centerLat: CENTER_LAT, centerLng: CENTER_LNG,
    radiusMeters: 50, imgWidth: 2000, imgHeight: 1000,
  });
  const c = wide(CENTER_LAT, CENTER_LNG);
  assert('non-square: centre still maps to centre',
    close(c.x, 1000) && close(c.y, 500));
  // 50m east reaches right edge → x=2000
  const metersPerDegLng = 111320 * Math.cos(CENTER_LAT * Math.PI / 180);
  const eastEdge = wide(CENTER_LAT, CENTER_LNG + 50 / metersPerDegLng);
  assert('non-square: 50m east reaches right edge (2000)',
    close(eastEdge.x, 2000, 5));
}

// ── Phase 3b.3 — inverse transform (canvas pixel → lat/lng) ─────────────
{
  console.log('\n▸ makePixelToLatLng round-trip');
  const params = {
    centerLat: CENTER_LAT, centerLng: CENTER_LNG,
    radiusMeters: RADIUS_M,
    imgWidth: IMG_W, imgHeight: IMG_H,
  };
  const forward = makeLatLngToPixel(params);
  const inverse = makePixelToLatLng(params);

  // Centre pixel → centre lat/lng
  const centreLL = inverse(IMG_W / 2, IMG_H / 2);
  assert('centre pixel → centre lat',   close(centreLL.latitude,  CENTER_LAT, 1e-9));
  assert('centre pixel → centre lng',   close(centreLL.longitude, CENTER_LNG, 1e-9));

  // Round-trip 25 test points across the tile
  let maxErrDeg = 0;
  for (let i = 0; i < 25; i++) {
    const dLat = (i - 12) / 12 * 0.0001;
    const dLng = ((i * 7) % 25 - 12) / 12 * 0.0001;
    const p = forward(CENTER_LAT + dLat, CENTER_LNG + dLng);
    const back = inverse(p.x, p.y);
    maxErrDeg = Math.max(maxErrDeg,
      Math.abs(back.latitude  - (CENTER_LAT + dLat)),
      Math.abs(back.longitude - (CENTER_LNG + dLng)));
  }
  assert('round-trip max error < 1e-9°', maxErrDeg < 1e-9, `maxErr=${maxErrDeg}`);

  // 25m east of centre → back to correct lng
  const metersPerDegLng = 111320 * Math.cos(CENTER_LAT * Math.PI / 180);
  const p25E = forward(CENTER_LAT, CENTER_LNG + 25 / metersPerDegLng);
  const back25E = inverse(p25E.x, p25E.y);
  assert('25m east round-trips within 1cm',
    Math.abs((back25E.longitude - CENTER_LNG) * metersPerDegLng - 25) < 0.01);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}
