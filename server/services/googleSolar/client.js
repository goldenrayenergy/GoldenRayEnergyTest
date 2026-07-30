// ────────────────────────────────────────────────────────────────────────────
// Google Solar API client — thin HTTP wrapper
//
// Wraps buildingInsights:findClosest (Phase 1). Later phases (2/3) add
// dataLayers + geoTiff.
//
// Docs: https://developers.google.com/maps/documentation/solar/reference/rest
//
// Design mirrors services/emailService.js:
//   - Lazy singleton for production consumers via `buildingInsights(args)`.
//   - Dev fallback when GOOGLE_SOLAR_API_KEY is absent (logs a warning and
//     returns a canned response so the downstream pipeline is exercisable
//     without hitting Google).
//   - Factory `createClient({ apiKey, fetchFn, timeoutMs })` for tests that
//     inject a mock fetch — see test-google-solar-client.mjs.
//
// Return shape is a discriminated object rather than throw-on-non-2xx so
// callers (analyseRoof.js) can distinguish "no building at this location"
// (404 — legitimate coverage gap) from "network / server error"
// (retry-able) without wrapping every call in try/catch.
// ────────────────────────────────────────────────────────────────────────────

import env from '../../config/env.js';

const API_BASE = 'https://solar.googleapis.com/v1';
const USER_AGENT = 'GoldenrayEnergy/1.0 (goldenrayenergy.nz)';
const DEFAULT_TIMEOUT_MS = 15_000;

// ── Factory (used by tests to inject dependencies) ──────────────────────────
export function createClient({
  apiKey = env.googleSolar.apiKey,
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return {
    /**
     * Call buildingInsights:findClosest.
     *
     * @param {object} args
     * @param {number} args.latitude
     * @param {number} args.longitude
     * @param {'HIGH'|'MEDIUM'|'LOW'} [args.requiredQuality='HIGH']
     * @returns {Promise<
     *   { ok: true,  source: 'live'|'mock', data: object }
     * | { ok: false, source: 'live',        status: number, error: string }
     * >}
     */
    async buildingInsights({ latitude, longitude, requiredQuality = 'HIGH' } = {}) {
      // Boundary validation (Rule 4): fail loud on bad input rather than
      // constructing a URL that Google would 400 on.
      if (typeof latitude !== 'number' || Number.isNaN(latitude)
          || latitude < -90 || latitude > 90) {
        throw new Error(`[googleSolar/client] buildingInsights: latitude must be a number in [-90, 90]. Got: ${latitude}`);
      }
      if (typeof longitude !== 'number' || Number.isNaN(longitude)
          || longitude < -180 || longitude > 180) {
        throw new Error(`[googleSolar/client] buildingInsights: longitude must be a number in [-180, 180]. Got: ${longitude}`);
      }

      // Dev fallback: no key → canned response so the pipeline can be
      // exercised locally. env.js throws at boot in production if the
      // feature is enabled without a key, so we only reach here in dev.
      if (!apiKey) {
        console.warn(
          '[googleSolar/client] No GOOGLE_SOLAR_API_KEY set — returning mock buildingInsights response (dev-only fallback).'
        );
        return { ok: true, source: 'mock', data: mockBuildingInsights({ latitude, longitude }) };
      }

      const url = new URL(`${API_BASE}/buildingInsights:findClosest`);
      url.searchParams.set('location.latitude', String(latitude));
      url.searchParams.set('location.longitude', String(longitude));
      url.searchParams.set('requiredQuality', requiredQuality);
      url.searchParams.set('key', apiKey);

      // Node's fetch has no built-in timeout — wire one via AbortController
      // so a hanging Google endpoint can't stall the caller indefinitely.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res;
      try {
        res = await fetchFn(url, {
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
          signal: controller.signal,
        });
      } catch (err) {
        // AbortError, network failure, DNS error — all end up here.
        return {
          ok: false,
          source: 'live',
          status: 0,
          error: `network: ${err?.message || String(err)}`,
        };
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        let data;
        try {
          data = await res.json();
        } catch (err) {
          return { ok: false, source: 'live', status: res.status, error: `bad-json: ${err?.message || String(err)}` };
        }
        return { ok: true, source: 'live', data };
      }

      // Non-2xx — read body as text so caller can log Google's error message.
      const text = await res.text().catch(() => '');
      return { ok: false, source: 'live', status: res.status, error: text || res.statusText };
    },
  };
}

// ── Singleton (production consumers) ────────────────────────────────────────
let _client = null;
function getClient() {
  if (!_client) _client = createClient();
  return _client;
}

export async function buildingInsights(args) {
  return getClient().buildingInsights(args);
}

// Test-only reset — lets the test suite blow away the cached singleton
// between cases without needing to re-import the module.
export function _resetClientForTests() {
  _client = null;
}

// ── Mock response (dev fallback + test fixture) ─────────────────────────────
// Structure matches Google's live response shape as best we know at time of
// writing. If the live shape diverges, update analyseRoof.js's parser in
// tandem — raw_response in Supabase preserves the true shape for audit.
function mockBuildingInsights({ latitude, longitude }) {
  return {
    name: 'buildings/mock-fixture-only',
    center: { latitude, longitude },
    imageryDate: { year: 2024, month: 5, day: 15 },
    imageryQuality: 'HIGH',
    solarPotential: {
      maxArrayPanelsCount: 42,
      maxArrayAreaMeters2: 82.4,
      maxSunshineHoursPerYear: 1650.5,
      carbonOffsetFactorKgPerMwh: 421.0,
      roofSegmentStats: [
        { pitchDegrees: 22.3, azimuthDegrees: 45.1,  stats: { areaMeters2: 41.2 }, center: { latitude, longitude } },
        { pitchDegrees: 22.3, azimuthDegrees: 225.1, stats: { areaMeters2: 41.2 }, center: { latitude, longitude } },
      ],
    },
  };
}
