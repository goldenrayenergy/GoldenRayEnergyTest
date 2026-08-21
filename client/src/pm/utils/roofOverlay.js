// ────────────────────────────────────────────────────────────────────────────
// Panel-layout design tool — coordinate helpers for overlaying Google Solar
// roof segments on top of the aerial RGB tile.
//
// Google Solar returns a tile centered on the requested (lat, lng) covering
// `radiusMeters` on each side. So the tile is (2 * radiusMeters) wide and
// tall, in metres. The RGB PNG we store may be resized (aspect ratio kept),
// so we normalise everything to the actual pixel dimensions of the loaded
// image and let the caller scale into the canvas viewport.
//
// Simplifying assumptions (fine at the 50-metre scale we work at):
//   • Locally flat Earth — no Mercator distortion at 100m × 100m.
//   • 1° latitude ≈ 111,320 m, everywhere.
//   • 1° longitude ≈ 111,320 * cos(latitude) m, using the tile centre's lat.
//   • The tile is axis-aligned with true North (Google confirms this for the
//     RGB dataLayer — no rotation applied).
// ────────────────────────────────────────────────────────────────────────────

const METERS_PER_DEG_LAT = 111320;

/**
 * Build a lat/lng → pixel converter for a specific aerial tile.
 *
 * @param {object} args
 * @param {number} args.centerLat        Latitude the tile is centred on
 * @param {number} args.centerLng        Longitude the tile is centred on
 * @param {number} args.radiusMeters     Half-width of the tile in metres (matches dataLayers request)
 * @param {number} args.imgWidth         Image width in native pixels
 * @param {number} args.imgHeight        Image height in native pixels
 * @returns {(lat:number, lng:number) => {x:number, y:number}}
 */
export function makeLatLngToPixel({ centerLat, centerLng, radiusMeters, imgWidth, imgHeight }) {
  const metersPerDegreeLng = METERS_PER_DEG_LAT * Math.cos(centerLat * Math.PI / 180);
  const halfW = imgWidth  / 2;
  const halfH = imgHeight / 2;

  return function latLngToPixel(lat, lng) {
    const metersEast  = (lng - centerLng) * metersPerDegreeLng;
    const metersNorth = (lat - centerLat) * METERS_PER_DEG_LAT;
    // normalised [-1, 1] within the tile (radius=1)
    const nx =  metersEast  / radiusMeters;
    const ny = -metersNorth / radiusMeters;   // north = up = smaller y
    return {
      x: halfW + nx * halfW,
      y: halfH + ny * halfH,
    };
  };
}

/**
 * INVERSE of makeLatLngToPixel — returns a function that converts an
 * image-pixel coordinate back to lat/lng using the SAME tile parameters
 * (centre, radius, image dimensions). Needed by the manual-roof-tracing
 * flow (Phase 3b.3) where the rep clicks a canvas point and we need to
 * record it in lat/lng so it survives pan/zoom + can be rendered at any
 * future canvas size.
 *
 * The math is exactly the forward transform inverted; kept in the same
 * file so the two functions stay in lockstep if we ever change the tile
 * projection (which we won't for Web Mercator, but still).
 */
export function makePixelToLatLng({ centerLat, centerLng, radiusMeters, imgWidth, imgHeight }) {
  const metersPerDegreeLng = METERS_PER_DEG_LAT * Math.cos(centerLat * Math.PI / 180);
  const halfW = imgWidth  / 2;
  const halfH = imgHeight / 2;
  return function pixelToLatLng(x, y) {
    const nx =  (x - halfW) / halfW;
    const ny = -(y - halfH) / halfH;   // reverse the ny = -metersNorth/radius from forward
    const metersEast  = nx * radiusMeters;
    const metersNorth = ny * radiusMeters;
    return {
      latitude:  centerLat + metersNorth / METERS_PER_DEG_LAT,
      longitude: centerLng + metersEast  / metersPerDegreeLng,
    };
  };
}

/**
 * Convert a Google roof-segment boundingBox {ne, sw} to a 4-corner polygon
 * in image-pixel coordinates. Corners returned clockwise starting NW.
 *
 * @param {(lat:number, lng:number) => {x:number, y:number}} toPixel
 * @param {{ne:{latitude,longitude}, sw:{latitude,longitude}}} bbox
 * @returns {{x:number, y:number}[]}   4 corners: NW, NE, SE, SW
 */
export function segmentBboxToPolygon(toPixel, bbox) {
  const { ne, sw } = bbox || {};
  if (!ne || !sw) return [];
  const nw = toPixel(ne.latitude, sw.longitude);
  const neP = toPixel(ne.latitude, ne.longitude);
  const seP = toPixel(sw.latitude, ne.longitude);
  const swP = toPixel(sw.latitude, sw.longitude);
  return [nw, neP, seP, swP];
}

// Format a short label for a segment — human-readable summary the rep sees.
export function segmentLabel(seg, index) {
  const area = seg?.stats?.areaMeters2;
  const pitch = seg?.pitchDegrees;
  const az    = seg?.azimuthDegrees;
  const facing = azimuthToCompass(az);
  const parts = [];
  parts.push(`#${index + 1}`);
  if (area != null)  parts.push(`${area.toFixed(1)}m²`);
  if (facing)        parts.push(facing);
  if (pitch != null) parts.push(`${pitch.toFixed(0)}°`);
  return parts.join(' · ');
}

function azimuthToCompass(deg) {
  if (deg == null || Number.isNaN(deg)) return '';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}
