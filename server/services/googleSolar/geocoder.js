// ────────────────────────────────────────────────────────────────────────────
// Google Geocoding API client — address → lat/lng
//
// Wraps https://maps.googleapis.com/maps/api/geocode/json.
// Docs: https://developers.google.com/maps/documentation/geocoding/overview
//
// Design mirrors services/googleSolar/client.js:
//   - createGeocoder({ apiKey, fetchFn, timeoutMs }) factory for tests
//   - Lazy singleton geocodeAddress(address) for production consumers
//   - Dev fallback: when GOOGLE_SOLAR_API_KEY is unset, returns a canned
//     lat/lng for downtown Auckland so the pipeline is exercisable without
//     hitting Google
//   - Reuses the SAME API key as the Solar client (Q-KEY = one key, both
//     APIs restricted). Reads env.googleSolar.apiKey.
//
// Return shape:
//   { ok: true,  source: 'live'|'mock', latitude, longitude, formattedAddress, quality }
//   { ok: false, source: 'live',        status, reason, error }
//
// `quality` is Google's `location_type`: ROOFTOP > RANGE_INTERPOLATED >
// GEOMETRIC_CENTER > APPROXIMATE — useful for downstream decisions like
// "trust this for a solar analysis or require a site survey".
//
// `reason` on !ok:
//   'zero-results'          — Google returned status ZERO_RESULTS
//   'over-query-limit'      — Google returned OVER_QUERY_LIMIT
//   'request-denied'        — Google returned REQUEST_DENIED (bad key/config)
//   'invalid-request'       — Google returned INVALID_REQUEST
//   'unknown-error'         — Google returned UNKNOWN_ERROR
//   'network'               — fetch itself failed (timeout, DNS, etc.)
//   'http-{status}'         — HTTP-level failure (rare — Geocoding usually
//                              returns 200 with status field set)
// ────────────────────────────────────────────────────────────────────────────

import env from '../../config/env.js';

const API_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';
const USER_AGENT = 'GoldenrayEnergy/1.0 (goldenrayenergy.nz)';
const DEFAULT_TIMEOUT_MS = 10_000;

// ── Factory (for tests) ─────────────────────────────────────────────────────
export function createGeocoder({
  apiKey    = env.googleSolar.apiKey,
  fetchFn   = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return {
    /**
     * Geocode an address to lat/lng.
     *
     * @param {string} address — free-form address string
     * @returns {Promise<
     *   { ok: true,  source: 'live'|'mock', latitude: number, longitude: number, formattedAddress: string, quality: string }
     * | { ok: false, source: 'live',        status: number|string, reason: string, error: string }
     * >}
     */
    async geocode(address) {
      // Boundary validation (Rule 4): fail fast on empty/whitespace input
      // rather than sending a URL Google will treat as "world" and return
      // wild coordinates for.
      if (typeof address !== 'string' || address.trim().length === 0) {
        throw new Error(`[geocoder] geocode: address must be a non-empty string. Got: ${typeof address}`);
      }
      const trimmed = address.trim();

      // Dev fallback: no key → canned Auckland CBD result so the pipeline
      // is exercisable locally. env.js throws at boot in prod when the
      // feature is enabled without a key, so we only reach here in dev.
      if (!apiKey) {
        console.warn(
          '[geocoder] No GOOGLE_SOLAR_API_KEY set — returning mock Auckland CBD coordinates (dev-only fallback).'
        );
        return {
          ok: true,
          source: 'mock',
          latitude: -36.848461,
          longitude: 174.763336,
          formattedAddress: `${trimmed} (dev-fallback: real geocoding not attempted)`,
          quality: 'APPROXIMATE',
        };
      }

      const url = new URL(API_BASE);
      url.searchParams.set('address', trimmed);
      url.searchParams.set('key', apiKey);
      // Bias results to NZ — improves accuracy for ambiguous addresses that
      // could match multiple countries. Uses ISO 3166-1 alpha-2.
      url.searchParams.set('region', 'nz');

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
        return {
          ok: false,
          source: 'live',
          status: 0,
          reason: 'network',
          error: `network: ${err?.message || String(err)}`,
        };
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false,
          source: 'live',
          status: res.status,
          reason: `http-${res.status}`,
          error: text || res.statusText || `HTTP ${res.status}`,
        };
      }

      let data;
      try {
        data = await res.json();
      } catch (err) {
        return { ok: false, source: 'live', status: res.status, reason: 'bad-json', error: err?.message || String(err) };
      }

      // Google Geocoding API returns HTTP 200 with a status field. Map their
      // string statuses to our reason enum for consistent caller handling.
      const gStatus = data?.status;
      if (gStatus !== 'OK') {
        const REASON_MAP = {
          ZERO_RESULTS:     'zero-results',
          OVER_QUERY_LIMIT: 'over-query-limit',
          REQUEST_DENIED:   'request-denied',
          INVALID_REQUEST:  'invalid-request',
          UNKNOWN_ERROR:    'unknown-error',
        };
        return {
          ok: false,
          source: 'live',
          status: gStatus || 'unknown',
          reason: REASON_MAP[gStatus] || 'unknown-error',
          error: data?.error_message || gStatus || 'no results',
        };
      }

      const top = Array.isArray(data.results) ? data.results[0] : null;
      if (!top?.geometry?.location) {
        return { ok: false, source: 'live', status: 'OK', reason: 'zero-results', error: 'OK but no geometry.location in first result' };
      }

      return {
        ok:               true,
        source:           'live',
        latitude:         top.geometry.location.lat,
        longitude:        top.geometry.location.lng,
        formattedAddress: top.formatted_address || trimmed,
        quality:          top.geometry.location_type || 'APPROXIMATE',
      };
    },
  };
}

// ── Singleton for production consumers ──────────────────────────────────────
let _geocoder = null;
function getGeocoder() {
  if (!_geocoder) _geocoder = createGeocoder();
  return _geocoder;
}

export async function geocodeAddress(address) {
  return getGeocoder().geocode(address);
}

// Test-only reset.
export function _resetGeocoderForTests() {
  _geocoder = null;
}
