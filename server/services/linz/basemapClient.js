// ────────────────────────────────────────────────────────────────────────────
// LINZ Basemap API client — thin HTTP wrapper around the aerial tile service.
//
// Docs:  https://basemaps.linz.govt.nz/docs
// Terms: https://basemaps.linz.govt.nz/docs/legal
//
// Standard access key gives 1,000 tile requests/minute and 1,000,000/month —
// plenty for our per-quote refetch usage. Keys expire after 90 days; for
// production get a Developer key by emailing basemaps@linz.govt.nz.
//
// Tile URL format:
//   {baseUrl}/v1/tiles/aerial/EPSG:3857/{z}/{x}/{y}.{format}?api={key}
//
// Tiles are 256x256 pixels in Web Mercator (EPSG:3857), same XYZ scheme as
// Google Maps and OpenStreetMap. Zoom levels 0–22 supported; NZ urban areas
// like Auckland typically go to z=21/22 (~6cm/px or better).
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Factory — takes injected env + fetch for testability.
 * @param {object} args
 * @param {string} args.apiKey            LINZ Basemap API key (required)
 * @param {string} [args.baseUrl]         Override base URL (defaults to prod)
 * @param {string} [args.tileFormat]      'webp' | 'png' | 'jpeg' | 'avif' (default 'webp')
 * @param {Function} [args.fetch]         Custom fetch impl (defaults to global fetch — required in tests to inject fakes)
 * @param {number} [args.timeoutMs]       Per-request timeout (default 10s)
 * @param {object} [args.logger]          console-shaped logger (default console)
 */
export function createBasemapClient({
  apiKey,
  baseUrl    = 'https://basemaps.linz.govt.nz',
  tileFormat = 'webp',
  fetch      = globalThis.fetch,
  timeoutMs  = DEFAULT_TIMEOUT_MS,
  logger     = console,
} = {}) {
  if (!apiKey) {
    throw new Error('[linz/basemapClient] createBasemapClient: apiKey required');
  }
  if (typeof fetch !== 'function') {
    throw new Error('[linz/basemapClient] fetch is required (global fetch missing? use Node 18+ or inject one)');
  }

  return {
    /**
     * Fetch a single WMTS/XYZ tile.
     *
     * @param {object} args
     * @param {number} args.z  Zoom level (0–22)
     * @param {number} args.x  Tile column (0 .. 2^z-1)
     * @param {number} args.y  Tile row (0 .. 2^z-1)
     * @returns {Promise<{ok:true, buffer:Buffer, contentType:string}
     *                 | {ok:false, status:number, error:string}>}
     */
    async fetchTile({ z, x, y } = {}) {
      // Boundary validation (Rule 4)
      if (!Number.isInteger(z) || z < 0 || z > 22) {
        throw new Error(`[linz/basemapClient] fetchTile: z must be integer 0..22, got ${z}`);
      }
      if (!Number.isInteger(x) || x < 0) {
        throw new Error(`[linz/basemapClient] fetchTile: x must be non-negative integer, got ${x}`);
      }
      if (!Number.isInteger(y) || y < 0) {
        throw new Error(`[linz/basemapClient] fetchTile: y must be non-negative integer, got ${y}`);
      }

      const url = `${baseUrl}/v1/tiles/aerial/EPSG:3857/${z}/${x}/${y}.${tileFormat}?api=${apiKey}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) {
          // Try to grab a helpful error snippet without blocking on the body
          let bodySnippet = '';
          try { bodySnippet = (await resp.text()).slice(0, 200); } catch { /* noop */ }
          return {
            ok: false,
            status: resp.status,
            error: `${resp.status} ${resp.statusText}${bodySnippet ? ` — ${bodySnippet}` : ''}`,
          };
        }
        const arrayBuffer = await resp.arrayBuffer();
        return {
          ok: true,
          buffer: Buffer.from(arrayBuffer),
          contentType: resp.headers.get('content-type') || `image/${tileFormat}`,
        };
      } catch (err) {
        // AbortError → timeout; other errors → network / DNS / etc.
        const isTimeout = err?.name === 'AbortError';
        logger.warn?.(`[linz/basemapClient] fetchTile z=${z} x=${x} y=${y} ${isTimeout ? 'timed out' : 'threw'}: ${err?.message || err}`);
        return {
          ok: false,
          status: 0,
          error: isTimeout ? `timeout after ${timeoutMs}ms` : (err?.message || String(err)),
        };
      } finally {
        clearTimeout(timer);
      }
    },

    // Expose the configured base URL so callers (or tests) can construct
    // client-facing URLs (e.g. for WMTS capabilities documents) without
    // duplicating the config.
    getBaseUrl() { return baseUrl; },
    getTileFormat() { return tileFormat; },
  };
}

// ── Singleton for production consumers ─────────────────────────────────────
let _client = null;
export async function fetchTile(args) {
  if (!_client) {
    const { default: env } = await import('../../config/env.js');
    if (!env.linz.apiKey) {
      throw new Error('[linz/basemapClient] LINZ_BASEMAP_API_KEY not set — see docs/setup.md');
    }
    _client = createBasemapClient({
      apiKey: env.linz.apiKey,
      baseUrl: env.linz.baseUrl,
      tileFormat: env.linz.tileFormat,
    });
  }
  return _client.fetchTile(args);
}

// Test-only reset.
export function _resetClientForTests() { _client = null; }
