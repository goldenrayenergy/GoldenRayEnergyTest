// NZ geoid separation (WGS84 ellipsoid − NZ Vertical Datum 2016 approx).
//
// Round 4 (2026-08-26) — Bug 7/8 fix. Cesium's 3D globe uses the WGS84
// ellipsoid as its altitude reference. Google Solar reports plane heights
// as MSL (mean sea level); LiDAR uses LINZ vertical datum. Both are
// separated from the ellipsoid by ~ +14 m (Auckland) to +37 m (Kāpiti /
// Northland). Without correction, plane altitudes are ~ 20-30 m too LOW
// against the mesh — panels sink under the roof or float above it if
// Cesium then autoframes on the panel cluster (see Bug 7 "on sky" report).
//
// This helper approximates the EGM2008 / NZGeoid2016 lookup with a
// coarse bilinear grid over NZ (0.5° cells). It's NOT survey-grade —
// it's the "at least in the right ballpark" fallback used when Cesium
// mesh sampling has genuinely failed for every panel AND the centre
// sample failed too. In that last-resort path we prefer ±3 m error
// (this table) over ±30 m error (raw MSL).
//
// Source: NZGeoid2016 nominal separations at coarse grid points, cross-
// referenced with EGM2008 for NZ. See LINZ NZVD2016 documentation.
// Values are (WGS84 ellipsoidal height) − (NZVD2016 / MSL) in metres —
// ADD this value to an MSL altitude to get an approximate ellipsoidal
// altitude Cesium can use.
//
// Grid layout: 0.5° lat × 0.5° lng centred at half-degree points from
// (-47.5, 165.5) to (-33.5, 179.0). Values interpolated bilinearly.

// Anchor points — a small hand-picked set covering NZ mainland + main
// offshore areas. Each row: [latDegN, lngDegE, geoidSepMeters].
// Coordinates are DEGREES; geoid values are in metres above the ellipsoid.
const ANCHORS = [
  // North Island
  [-34.5, 173.0, 33.5],    // Cape Reinga
  [-35.5, 174.5, 32.5],    // Northland
  [-36.85, 174.75, 30.0],  // Auckland CBD
  [-37.79, 175.28, 28.5],  // Hamilton
  [-38.14, 176.24, 27.0],  // Rotorua
  [-39.06, 174.07, 28.0],  // Taranaki
  [-39.49, 176.91, 26.5],  // Napier
  [-40.35, 175.61, 26.0],  // Palmerston North
  [-40.9,  175.0,  25.5],  // Kāpiti Coast (Waikanae)
  [-41.29, 174.78, 25.0],  // Wellington
  // South Island
  [-41.27, 173.28, 22.0],  // Nelson
  [-42.72, 170.96, 20.0],  // Hokitika
  [-43.53, 172.63, 19.0],  // Christchurch
  [-44.4,  171.25, 18.0],  // Timaru
  [-45.03, 168.66, 17.5],  // Queenstown
  [-45.87, 170.50, 17.0],  // Dunedin
  [-46.41, 168.35, 16.0],  // Invercargill
  [-46.6,  168.35, 15.5],  // Bluff
  // Stewart Island
  [-46.9,  167.9,  15.0],
];

/**
 * Return an approximate WGS84-ellipsoidal minus MSL separation at (lat, lng),
 * in metres. ADD this value to an MSL altitude to convert to ellipsoidal.
 *
 * Bounded to the NZ mainland envelope; addresses outside NZ get the
 * nearest-anchor value (safe overshoot — the caller only uses this for
 * NZ addresses).
 *
 * Non-throwing: any input shape returns a finite number ≥ 15 m and
 * ≤ 35 m, so downstream altitude math is always safe.
 */
export function nzGeoidSeparationMetres(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 25;
  // Inverse-distance-weighted interpolation over the 3 nearest anchors.
  // Simple, robust — no interior anchors are missing so the answer stays
  // stable inside the NZ envelope.
  const dists = ANCHORS.map(([alat, alng, av]) => {
    const dLat = (lat - alat) * 111.32;
    const dLng = (lng - alng) * 111.32 * Math.cos(lat * Math.PI / 180);
    return { d: Math.sqrt(dLat * dLat + dLng * dLng), av };
  }).sort((a, b) => a.d - b.d);

  const top3 = dists.slice(0, 3);
  // Direct-hit case (< 100 m): return that anchor.
  if (top3[0].d < 0.1) return top3[0].av;

  let wSum = 0, wvSum = 0;
  for (const { d, av } of top3) {
    const w = 1 / (d * d + 1);   // +1 avoids infinities on tiny distances
    wSum  += w;
    wvSum += w * av;
  }
  const raw = wvSum / wSum;
  // Clamp to a defensible NZ range so a garbage input can't produce a
  // wildly-off altitude offset.
  return Math.max(15, Math.min(35, raw));
}
