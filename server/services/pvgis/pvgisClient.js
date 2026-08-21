// ────────────────────────────────────────────────────────────────────────────
// PVGIS client — Week-7 Phase 2
//
// PVGIS (Photovoltaic Geographical Information System) is the European
// Commission's Joint Research Centre free API for solar-yield estimates,
// used by every serious PV modelling tool. Zero-auth: no signup, no API
// key, no billing. Global coverage including NZ via the SARAH-3 satellite
// climatology (2005-2020 dataset).
//
// Why PVGIS for our POC:
//   - Google Solar's sunshineQuantiles cover ~80% of NZ. LiDAR-fallback
//     addresses (new subdivisions, rural) have no equivalent data — we
//     were falling back to a coarse regional average (see engineeringRules
//     REGIONS: 9 hardcoded numbers covering the whole country). PVGIS
//     fills this gap with per-address, per-face satellite-derived yield.
//   - Chosen over NIWA CliFlo (SOAP + auth + 40-station spatial coarseness)
//     and NASA POWER (0.5° grid ≈ 50 km cells) — see the POC plan memory.
//
// Endpoint: https://re.jrc.ec.europa.eu/api/v5_3/PVcalc
//   Params:
//     lat, lon            — location (WGS84 decimal degrees)
//     peakpower           — kWp of the PV system (we use 1.0 to get per-kWp yield)
//     loss                — system losses % (14 is PVGIS default & our engine's baseline)
//     angle               — panel tilt in degrees from horizontal
//     aspect              — panel azimuth in PVGIS convention:
//                             0 = SOUTH, ±180 = NORTH, +90 = WEST, -90 = EAST
//                           (compass_azimuth − 180 in [-180, 180])
//     outputformat        — json
//   Returns:
//     outputs.totals.fixed.E_y     — annual production in kWh (per kWp if peakpower=1)
//     outputs.monthly.fixed[].E_m  — monthly production per month (kWh) — 12 entries,
//                                    one per calendar month, used for the V3 seasonal chart
//
// Rate limit: 30 req/s per IP. Well above any single-address burst.
// ────────────────────────────────────────────────────────────────────────────

const PVGIS_ENDPOINT = 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LOSS_PCT = 14;
// Round lat/lng to 3 decimal places (~111 m precision) for cache key.
// PVGIS climatology varies on km scales, so 111 m sharing is safe.
const CACHE_COORD_PRECISION = 3;

/**
 * Convert compass azimuth (0=N, 90=E, 180=S, 270=W) to PVGIS aspect
 * (0=S, -90=E, ±180=N, +90=W). Result normalised to [-180, 180].
 */
export function compassAzimuthToPvgisAspect(compassAz) {
  const az = ((Number(compassAz) % 360) + 360) % 360;   // [0, 360)
  let aspect = az - 180;
  if (aspect < -180) aspect += 360;
  if (aspect > 180)  aspect -= 360;
  return aspect;
}

export function createPvgisClient({
  fetchFn   = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger    = console,
  cache     = new Map(),      // in-memory; injectable for tests
} = {}) {
  return {
    /**
     * Query PVGIS for annual yield at a specific (lat, lng, tilt, azimuth).
     *
     * @param {object} args
     * @param {number} args.latitude
     * @param {number} args.longitude
     * @param {number} args.tiltDeg      — panel tilt from horizontal (roof pitch)
     * @param {number} args.azimuthDeg   — COMPASS azimuth (0=N; converted internally)
     * @param {number} [args.lossPct=14] — PVGIS "loss" param
     * @param {number} [args.peakPowerKw=1] — kWp; use 1 for per-kWp yield
     * @returns {Promise<{
     *   ok: boolean,
     *   kwhPerKwpPerYear?: number,     // when ok=true
     *   pvgisAspect?: number,          // computed aspect (for debug)
     *   cacheHit?: boolean,            // whether served from cache
     *   error?: string,                // when ok=false
     *   status?: number,               // HTTP status when ok=false + fetch happened
     * }>}
     */
    async queryYield({ latitude, longitude, tiltDeg, azimuthDeg,
                       lossPct = DEFAULT_LOSS_PCT, peakPowerKw = 1 }) {
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        return { ok: false, error: `bad latitude: ${latitude}` };
      }
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        return { ok: false, error: `bad longitude: ${longitude}` };
      }
      if (!Number.isFinite(tiltDeg) || tiltDeg < 0 || tiltDeg > 90) {
        return { ok: false, error: `bad tiltDeg: ${tiltDeg}` };
      }
      const aspect = compassAzimuthToPvgisAspect(azimuthDeg);

      // Cache key: rounded coord + tilt(0.5°) + aspect(1°).
      // Climatology varies slowly, so nearby queries share results.
      const key = `${latitude.toFixed(CACHE_COORD_PRECISION)}|`
        + `${longitude.toFixed(CACHE_COORD_PRECISION)}|`
        + `${(Math.round(tiltDeg * 2) / 2).toFixed(1)}|`
        + `${Math.round(aspect)}|${lossPct}|${peakPowerKw}`;
      if (cache.has(key)) {
        return { ...cache.get(key), cacheHit: true };
      }

      const url = `${PVGIS_ENDPOINT}?`
        + `lat=${latitude}&lon=${longitude}`
        + `&peakpower=${peakPowerKw}&loss=${lossPct}`
        + `&angle=${tiltDeg.toFixed(1)}&aspect=${aspect.toFixed(1)}`
        + `&outputformat=json`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetchFn(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          const result = {
            ok: false,
            status: resp.status,
            error: `PVGIS ${resp.status}: ${body.slice(0, 200)}`,
          };
          // Only cache 4xx (deterministic bad input); 5xx is transient, don't cache.
          if (resp.status >= 400 && resp.status < 500) cache.set(key, result);
          return result;
        }
        const json = await resp.json();
        const Ey = json?.outputs?.totals?.fixed?.E_y;
        if (!Number.isFinite(Ey) || Ey <= 0) {
          const result = { ok: false, error: `PVGIS returned no E_y (json shape unexpected)` };
          return result;
        }
        // V3 (2026-08-18): extract monthly E_m too so the seasonal chart
        // can render a per-address curve instead of one Auckland-shape-
        // fits-all fallback. Monthly array is Jan→Dec (12 entries), each
        // scaled to per-kWp by the same peakpower we sent. null if PVGIS
        // omitted the block or any month was malformed (we require all 12
        // to be finite — no half-populated chart).
        let monthlyKwhPerKwp = null;
        const monthlyArr = json?.outputs?.monthly?.fixed;
        if (Array.isArray(monthlyArr) && monthlyArr.length === 12) {
          const byMonth = new Array(12).fill(null);
          for (const m of monthlyArr) {
            const idx = Number(m?.month) - 1;
            if (idx >= 0 && idx < 12 && Number.isFinite(m?.E_m)) {
              byMonth[idx] = Number((m.E_m / peakPowerKw).toFixed(1));
            }
          }
          if (byMonth.every(v => Number.isFinite(v))) monthlyKwhPerKwp = byMonth;
        }
        const result = {
          ok: true,
          kwhPerKwpPerYear: Number((Ey / peakPowerKw).toFixed(1)),
          monthlyKwhPerKwp,   // Jan→Dec array, or null if missing/malformed
          pvgisAspect: aspect,
        };
        cache.set(key, result);
        return result;
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = err?.name === 'AbortError';
        const result = {
          ok: false,
          error: isTimeout ? `PVGIS timeout after ${timeoutMs}ms` : `PVGIS fetch threw: ${err?.message || err}`,
        };
        logger.warn?.(`[pvgis] ${result.error}`);
        return result;
      }
    },

    // Escape hatch for tests + admin diagnostics.
    _cacheSize() { return cache.size; },
    _resetCache() { cache.clear(); },
  };
}

// ── Singleton for production ──────────────────────────────────────────────
let _singleton = null;
export function getPvgisClient() {
  if (!_singleton) _singleton = createPvgisClient();
  return _singleton;
}
export function _resetSingletonForTests() { _singleton = null; }
