// Unit tests for the yield-heatmap colour scale (Week 8 Feature A).
//
// Pure math tests — no Cesium, no React, no network. Runs in Node.
//
// Run:  node server/scripts/test-panel-color-scale.mjs

import {
  yieldToColor,
  gradientCssStops,
  NO_DATA_COLOR,
  CONSTANTS,
} from '../../client/src/pages/poc/3d/panelColorScale.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};
const parseHex = (hex) => {
  const m = String(hex).replace(/^#/, '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

// ── Boundary behaviour ─────────────────────────────────────────────────────
console.log('\n── Boundary values (exact min / max) ──');
{
  const c = yieldToColor(400, 400, 800);
  const [r, g, b] = parseHex(c);
  const bottom = CONSTANTS.STOPS[0].rgb;
  assert(near(r, bottom[0]) && near(g, bottom[1]) && near(b, bottom[2]),
    `value=min returns bottom-stop colour (got ${c}, want #${bottom.map(n => n.toString(16).padStart(2, '0')).join('')})`);
}
{
  const c = yieldToColor(800, 400, 800);
  const [r, g, b] = parseHex(c);
  const top = CONSTANTS.STOPS[CONSTANTS.STOPS.length - 1].rgb;
  assert(near(r, top[0]) && near(g, top[1]) && near(b, top[2]),
    `value=max returns top-stop colour (got ${c})`);
}
{
  const c = yieldToColor(600, 400, 800);   // exact midpoint
  const [r, g, b] = parseHex(c);
  const mid = CONSTANTS.STOPS[1].rgb;
  assert(near(r, mid[0]) && near(g, mid[1]) && near(b, mid[2]),
    `value at midpoint returns middle-stop colour (got ${c})`);
}

// ── Clamping outside the range ────────────────────────────────────────────
console.log('\n── Clamping (values outside [min,max]) ──');
{
  const below = yieldToColor(300, 400, 800);
  const atMin = yieldToColor(400, 400, 800);
  assert(below === atMin, `value < min clamps to min-colour (below=${below} min=${atMin})`);

  const above = yieldToColor(900, 400, 800);
  const atMax = yieldToColor(800, 400, 800);
  assert(above === atMax, `value > max clamps to max-colour (above=${above} max=${atMax})`);
}

// ── Monotonicity along the ramp ───────────────────────────────────────────
console.log('\n── Monotonic ordering (luminance rises with yield) ──');
{
  // Sample 20 values evenly across [min, max] and verify a proxy ordering
  // (sum of R+G+B in the top half is > sum in bottom half — the top-stop
  // is warm orange, higher red channel than the cool-blue bottom-stop).
  const samples = [];
  for (let i = 0; i <= 20; i++) {
    const v = 400 + (i / 20) * 400;
    samples.push(parseHex(yieldToColor(v, 400, 800)));
  }
  const bottomHalfRed = samples.slice(0, 5).reduce((s, [r]) => s + r, 0);
  const topHalfRed    = samples.slice(-5).reduce((s, [r]) => s + r, 0);
  assert(topHalfRed > bottomHalfRed,
    `top-half panels are warmer (higher red) than bottom-half — R sums ${bottomHalfRed}→${topHalfRed}`);
}

// ── Non-finite input handling ─────────────────────────────────────────────
console.log('\n── Non-finite / bad input returns NO_DATA_COLOR ──');
{
  assert(yieldToColor(null,      400, 800) === NO_DATA_COLOR, 'null value → NO_DATA_COLOR');
  assert(yieldToColor(undefined, 400, 800) === NO_DATA_COLOR, 'undefined value → NO_DATA_COLOR');
  assert(yieldToColor(NaN,       400, 800) === NO_DATA_COLOR, 'NaN value → NO_DATA_COLOR');
  assert(yieldToColor(600, NaN,  800) === NO_DATA_COLOR, 'NaN min → NO_DATA_COLOR');
  assert(yieldToColor(600, 400,  NaN) === NO_DATA_COLOR, 'NaN max → NO_DATA_COLOR');
}

// ── Degenerate range (min === max) ────────────────────────────────────────
console.log('\n── Degenerate range (min === max) ──');
{
  const c = yieldToColor(500, 500, 500);
  const top = CONSTANTS.STOPS[CONSTANTS.STOPS.length - 1].rgb;
  const [r, g, b] = parseHex(c);
  assert(near(r, top[0]) && near(g, top[1]) && near(b, top[2]),
    `min===max returns top-stop (all panels equal → all get the "high" colour)`);
}
{
  // Reversed range (max < min) is treated as degenerate too — return top-stop
  // rather than crash or produce nonsense.
  const c = yieldToColor(500, 800, 400);
  assert(parseHex(c) != null, `max < min degenerate case returns a valid hex (got ${c})`);
}

// ── gradientCssStops matches yieldToColor stops ───────────────────────────
console.log('\n── gradientCssStops (legend swatch sync) ──');
{
  const stops = gradientCssStops();
  assert(stops.includes('0%')   && stops.includes('100%'), `stops contain 0% and 100% (got "${stops}")`);
  assert(/^#[0-9a-f]{6} 0%/.test(stops), `stops start with a hex + 0% ("${stops.slice(0, 20)}…")`);
  // The bottom-stop colour string should match what yieldToColor returns
  // at the min end, so the legend swatch left edge matches the coolest panel.
  const bottomFromScale = yieldToColor(0, 0, 100);
  assert(stops.startsWith(bottomFromScale),
    `legend swatch left edge (${stops.slice(0, 7)}) matches scale minimum colour (${bottomFromScale})`);
}

// ── Realistic yield range (NZ typical) ────────────────────────────────────
console.log('\n── Realistic NZ per-panel yield spread ──');
{
  // Real numbers from Phase 2 PVGIS on 6 Woodacre + typical AKL install:
  //   worst panel  ~410 kWh/yr (SW-facing at low pitch)
  //   best panel   ~640 kWh/yr (N-facing at 20° pitch)
  const min = 410, max = 640;
  const worst = yieldToColor(min, min, max);
  const best  = yieldToColor(max, min, max);
  const mid   = yieldToColor(Math.round((min + max) / 2), min, max);
  assert(worst !== best, `worst-yield and best-yield panels get different colours (${worst} vs ${best})`);
  assert(mid !== worst && mid !== best,
    `midpoint colour is distinct from both ends (worst=${worst} mid=${mid} best=${best})`);
  // Sanity: worst colour should have MORE blue than red (cool),
  // best should have MORE red than blue (warm).
  const [wr, , wb] = parseHex(worst);
  const [br, , bb] = parseHex(best);
  assert(wb > wr, `worst-panel colour is cool (blue > red: b=${wb} r=${wr})`);
  assert(br > bb, `best-panel colour is warm (red > blue: r=${br} b=${bb})`);
}

// ── Summary ──
console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);
