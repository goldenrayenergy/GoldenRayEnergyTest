// ────────────────────────────────────────────────────────────────────────────
// Aerial imagery orchestrator — picks the best provider for a roof-image
// fetch given the current env config, and falls back to a secondary
// provider if the primary fails.
//
// Current strategy:
//   1. LINZ Basemap (if FEATURE_LINZ_IMAGERY=true + key configured)
//        — free, ~6cm/px in Auckland urban → sharpest for NZ addresses
//   2. Google Solar dataLayers
//        — 10cm/px MEDIUM everywhere else, works globally
//   3. Return {ok:false} if both fail (caller records the error)
//
// Callers (analyseRoof, refetch endpoint) treat every result the same shape
// as services/googleSolar/roofImagery.js's fetchAndStoreRoofImage — so the
// switch is invisible upstream.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Factory — takes providers via DI so tests can inject fakes.
 * @param {object} args
 * @param {object|null} args.linzFetcher    LINZ fetcher, or null if disabled
 * @param {object}      args.googleFetcher  Google Solar roofImagery fetcher (fallback; required)
 * @param {object}      [args.logger]
 */
export function createAerialImageryOrchestrator({
  linzFetcher,
  googleFetcher,
  logger = console,
} = {}) {
  if (!googleFetcher) {
    throw new Error('[aerialImagery] createOrchestrator: googleFetcher (fallback) required');
  }

  return {
    /**
     * Fetch + store a roof image via the best available provider.
     * Same return shape as services/googleSolar/roofImagery.js.
     *
     * @param {object} args
     * @param {string} args.enquiryId
     * @param {number} args.latitude
     * @param {number} args.longitude
     * @param {number} args.radiusMeters
     * @returns {Promise<
     *    { ok:true, storagePath, storageBucket, sizeBytes, imageryQuality,
     *      imageryDate, radiusMeters, source:'linz'|'google_solar', ...
     *    }
     *  | { ok:false, reason, error, attempts?:{linz?:{reason,error}, google?:{reason,error}} }
     * >}
     */
    async fetchAndStoreRoofImage(args) {
      const attempts = {};

      // ── Try LINZ first if configured ───────────────────────────────
      if (linzFetcher) {
        let linzResult;
        try {
          linzResult = await linzFetcher.fetchAndStoreRoofImage(args);
        } catch (err) {
          linzResult = { ok: false, reason: 'linz-throw', error: err?.message || String(err) };
        }
        if (linzResult.ok) {
          return { ...linzResult, source: 'linz' };
        }
        attempts.linz = { reason: linzResult.reason, error: linzResult.error };
        logger.warn?.(`[aerialImagery] LINZ failed (${linzResult.reason}: ${linzResult.error}) — falling back to Google Solar`);
      }

      // ── Fallback to Google Solar dataLayers ────────────────────────
      let googleResult;
      try {
        googleResult = await googleFetcher.fetchAndStoreRoofImage(args);
      } catch (err) {
        googleResult = { ok: false, reason: 'google-throw', error: err?.message || String(err) };
      }
      if (googleResult.ok) {
        return { ...googleResult, source: 'google_solar' };
      }
      attempts.google = { reason: googleResult.reason, error: googleResult.error };
      return { ok: false, reason: 'all-providers-failed', error: 'no provider returned a usable tile', attempts };
    },
  };
}

// ── Singleton for production consumers ─────────────────────────────────────
let _orchestrator = null;
export async function fetchAndStoreRoofImage(args) {
  if (!_orchestrator) {
    const { default: env } = await import('../config/env.js');
    const { default: sharp } = await import('sharp');
    const { supabaseAdmin } = await import('../config/supabase.js');

    // Always build the Google fallback (guaranteed globally-available path)
    const { createRoofImageryFetcher } = await import('./googleSolar/roofImagery.js');
    const { createClient: createGoogleClient } = await import('./googleSolar/client.js');
    const googleFetcher = createRoofImageryFetcher({
      client: createGoogleClient(),
      sharp,
      supabase: supabaseAdmin,
    });

    // Build LINZ fetcher only if enabled + key present
    let linzFetcher = null;
    if (env.linz.enabled && env.linz.apiKey) {
      const { createBasemapClient } = await import('./linz/basemapClient.js');
      const { createAerialFetcher } = await import('./linz/aerialFetcher.js');
      linzFetcher = createAerialFetcher({
        client: createBasemapClient({
          apiKey:     env.linz.apiKey,
          baseUrl:    env.linz.baseUrl,
          tileFormat: env.linz.tileFormat,
        }),
        sharp,
        supabase: supabaseAdmin,
      });
    }

    _orchestrator = createAerialImageryOrchestrator({ linzFetcher, googleFetcher });
  }
  return _orchestrator.fetchAndStoreRoofImage(args);
}

// Test-only reset.
export function _resetOrchestratorForTests() { _orchestrator = null; }
