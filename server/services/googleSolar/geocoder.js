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

    /**
     * Reverse-geocode a lat/lng to a formatted address. Used by the
     * pin-drag confirmation flow (2026-08-27) so that when the customer
     * drags the map pin, we can show them the ACTUAL address at the pin
     * position — catches accidental drops onto a neighbour's house.
     *
     * @param {number} latitude
     * @param {number} longitude
     * @returns {Promise<
     *   { ok: true,  source: 'live'|'mock', formattedAddress: string, quality: string, place_id?: string }
     * | { ok: false, source: 'live',        status, reason, error }
     * >}
     */
    async reverseGeocode(latitude, longitude) {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return { ok: false, source: 'live', status: 0, reason: 'invalid-coord', error: 'lat/lng must be finite numbers' };
      }
      if (!apiKey) {
        // Dev fallback — canned response
        return {
          ok: true, source: 'mock',
          formattedAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)} (mock — no API key)`,
          quality: 'APPROXIMATE',
        };
      }

      const url = new URL(API_BASE);
      url.searchParams.set('latlng', `${latitude},${longitude}`);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('region', 'nz');
      // result_type=street_address biases toward premise-level results
      // over generic POI/postal_code entries, matching what the customer
      // pin-drag flow needs — "what's at this rooftop coord?"
      url.searchParams.set('result_type', 'street_address|premise|subpremise');

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
        return { ok: false, source: 'live', status: 0, reason: 'network', error: `network: ${err?.message || String(err)}` };
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, source: 'live', status: res.status, reason: `http-${res.status}`, error: text || res.statusText || `HTTP ${res.status}` };
      }

      let data;
      try { data = await res.json(); }
      catch (err) { return { ok: false, source: 'live', status: res.status, reason: 'bad-json', error: err?.message || String(err) }; }

      // ZERO_RESULTS on a strict result_type filter is common — retry
      // without the filter before giving up. Better a slightly-less-
      // precise "route" or "locality" result than nothing.
      if (data?.status === 'ZERO_RESULTS') {
        const relaxedUrl = new URL(API_BASE);
        relaxedUrl.searchParams.set('latlng', `${latitude},${longitude}`);
        relaxedUrl.searchParams.set('key', apiKey);
        relaxedUrl.searchParams.set('region', 'nz');
        const controller2 = new AbortController();
        const timer2 = setTimeout(() => controller2.abort(), timeoutMs);
        try {
          const res2 = await fetchFn(relaxedUrl, { method: 'GET', headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }, signal: controller2.signal });
          if (res2.ok) data = await res2.json();
        } catch { /* fall through with original data */ }
        finally { clearTimeout(timer2); }
      }

      if (data?.status !== 'OK') {
        const REASON_MAP = {
          ZERO_RESULTS: 'zero-results', OVER_QUERY_LIMIT: 'over-query-limit',
          REQUEST_DENIED: 'request-denied', INVALID_REQUEST: 'invalid-request',
          UNKNOWN_ERROR: 'unknown-error',
        };
        return {
          ok: false, source: 'live', status: data?.status || 'unknown',
          reason: REASON_MAP[data?.status] || 'unknown-error',
          error: data?.error_message || data?.status || 'no results',
        };
      }

      const top = Array.isArray(data.results) ? data.results[0] : null;
      if (!top?.formatted_address) {
        return { ok: false, source: 'live', status: 'OK', reason: 'zero-results', error: 'OK but no formatted_address in first result' };
      }
      return {
        ok: true, source: 'live',
        formattedAddress: top.formatted_address,
        quality:          top.geometry?.location_type || 'APPROXIMATE',
        place_id:         top.place_id || null,
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

export async function reverseGeocode(latitude, longitude) {
  return getGeocoder().reverseGeocode(latitude, longitude);
}

// Test-only reset.
export function _resetGeocoderForTests() {
  _geocoder = null;
}
