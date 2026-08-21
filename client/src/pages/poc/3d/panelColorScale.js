// ────────────────────────────────────────────────────────────────────────────
// Yield-heatmap colour scale (Week 8, Feature A).
//
// Maps a per-panel yield value (kWh/yr) to a hex colour on a three-stop
// gradient: cool blue at the low end → warm neutral in the middle →
// GoldenRay orange at the top. Brand-aligned, intuitive (cool = low, hot =
// high), and colour-blind-friendly (luminance rises monotonically across
// the ramp so the ordering survives desaturation).
//
// Pure JS. No React / Cesium imports so it can be unit-tested from Node
// (server/scripts/test-panel-color-scale.mjs) and reused for the SVG /
// CSS legend swatch that sits next to the 3D view.
// ────────────────────────────────────────────────────────────────────────────

// Stops chosen so:
//   - #1E5A9C at t=0    — cool blue, distinct from Cesium's dark scene
//   - #E6DCC3 at t=0.5  — warm bone/greige neutral, ties to page palette
//   - #D9531E at t=1    — GoldenRay orange, matches the existing "Your
//                          house" pin so heat = brand
const STOPS = [
  { pos: 0.00, rgb: [30, 90, 156] },
  { pos: 0.50, rgb: [230, 220, 195] },
  { pos: 1.00, rgb: [217, 83, 30] },
];

// "No data" swatch — used when yield is missing (source === 'placeholder',
// non-finite value, or degenerate min===max range). Deliberately desaturated
// so it doesn't get confused with a low-yield reading.
export const NO_DATA_COLOR = '#7A8899';

/**
 * Convert a yield value to a hex colour on the blue→neutral→orange gradient.
 *
 * @param {number} value  the per-panel yield (kWh/yr)
 * @param {number} min    lowest yield across all panels being rendered
 * @param {number} max    highest yield across all panels being rendered
 * @returns {string} a hex colour string like '#a1b2c3'.
 */
export function yieldToColor(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return NO_DATA_COLOR;
  }
  // Degenerate range → gradient has no meaning; return top-stop so the
  // caller still gets a legible colour. Caller should ideally have detected
  // this earlier and rendered without a heatmap.
  if (max <= min) return rgbToHex(STOPS[STOPS.length - 1].rgb);

  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (t >= a.pos && t <= b.pos) {
      const localT = (t - a.pos) / (b.pos - a.pos);
      return rgbToHex([
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * localT),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * localT),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * localT),
      ]);
    }
  }
  return rgbToHex(STOPS[STOPS.length - 1].rgb);
}

/**
 * CSS `linear-gradient` stops string for the legend swatch — kept in sync
 * with the yieldToColor stops above so the swatch and the panel colours
 * describe the same ramp.
 *
 * Usage: <div style={{background: `linear-gradient(to right, ${gradientCssStops()})`}}/>
 */
export function gradientCssStops() {
  return STOPS
    .map(s => `${rgbToHex(s.rgb)} ${(s.pos * 100).toFixed(0)}%`)
    .join(', ');
}

function rgbToHex([r, g, b]) {
  const h = n => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export const CONSTANTS = { STOPS };
