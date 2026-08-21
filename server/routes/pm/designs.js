// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm/quotes/:id/design
//
// Panel-layout design state per quote. Phase 3a shape:
//
//   GET  /api/pm/quotes/:id/design
//        → 200 { id, quote_id, state, version, created_at, updated_at, ... }
//        → 204 if no design exists yet for this quote
//        → 404 if the quote itself doesn't exist
//
//   PUT  /api/pm/quotes/:id/design
//        body: { state: {...}, version: <expected current version> }
//        → 200 { ...design row } on success (version incremented)
//        → 409 if body.version doesn't match current DB version (stale save)
//        → 404 if the quote doesn't exist
//        → 400 if body.state is missing/malformed
//
//   POST /api/pm/quotes/:id/refetch-roof-image
//        (no body) — re-fetches the roof aerial image from Google Solar at
//        the OPTIMAL tile radius (computed from the roof segments of the
//        contact's existing analysis). Used to upgrade pre-Migration-040
//        rows in place. Consumes 1 dataLayers quota call.
//        → 200 { updated: true, tile_radius_m: <n>, storage_path: <path> }
//        → 204 if the analysis is already at a tight radius (≤20m) — no
//              refetch needed, saves quota
//        → 404 if the quote / contact / roof analysis doesn't exist
//        → 429 if Google Solar monthly quota is exhausted
//        → 503 if Google Solar API isn't configured
//
// Optimistic concurrency: client sends the version it loaded; backend rejects
// if the DB has moved on. First-ever save uses version=0 (matches the DEFAULT
// on freshly-created rows and empty-lookup path where we synthesise a "new"
// design with version=0 to hand back to the client).
//
// RLS: table is service_role-only (Migration 039). Backend uses supabaseAdmin
// which has BYPASSRLS, so writes go through unaffected.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin as supabaseFromConfig } from '../../config/supabase.js';

let _supabaseAdmin = supabaseFromConfig;
export function __setSupabaseForTests(client) { _supabaseAdmin = client; }
const sb = () => _supabaseAdmin;

const router = Router();
router.use(authenticate);

// ── GET /:id/design ────────────────────────────────────────────────────────
router.get('/:id/design', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    // Confirm the quote exists first — cleaner 404 than a silent 204.
    const { data: quote, error: qErr } = await sb()
      .from('quotes').select('id').eq('id', req.params.id).maybeSingle();
    if (qErr) throw qErr;
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const { data, error } = await sb()
      .from('designs')
      .select('id, quote_id, state, version, created_at, updated_at, created_by, updated_by')
      .eq('quote_id', req.params.id)
      .maybeSingle();
    if (error) throw error;

    if (!data) return res.status(204).end();  // no design yet — client synthesises a v0

    res.json(data);
  } catch (e) {
    console.error('[pm/designs GET] failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /:id/design ────────────────────────────────────────────────────────
router.put('/:id/design', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { state, version } = req.body || {};
    if (state == null || typeof state !== 'object' || Array.isArray(state)) {
      return res.status(400).json({ error: 'Body must include `state` object' });
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      return res.status(400).json({ error: 'Body must include `version` (non-negative integer)' });
    }

    // Confirm quote exists.
    const { data: quote, error: qErr } = await sb()
      .from('quotes').select('id').eq('id', req.params.id).maybeSingle();
    if (qErr) throw qErr;
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const userId = req.user?.id || null;

    // Fetch existing (if any) to check version.
    const { data: existing, error: exErr } = await sb()
      .from('designs')
      .select('id, version')
      .eq('quote_id', req.params.id)
      .maybeSingle();
    if (exErr) throw exErr;

    if (existing) {
      // Update path — enforce optimistic concurrency.
      if (existing.version !== version) {
        return res.status(409).json({
          error: 'Version mismatch — design was modified elsewhere. Reload before saving.',
          server_version: existing.version,
          client_version: version,
        });
      }
      const nextVersion = existing.version + 1;
      const { data: updated, error: upErr } = await sb()
        .from('designs')
        .update({
          state,
          version: nextVersion,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq('id', existing.id)
        .select('id, quote_id, state, version, created_at, updated_at, created_by, updated_by')
        .single();
      if (upErr) throw upErr;
      return res.json(updated);
    }

    // Insert path — first-ever save. Client should have sent version=0.
    if (version !== 0) {
      return res.status(409).json({
        error: 'Version mismatch — no design exists yet; expected version=0 for first save.',
        server_version: 0,
        client_version: version,
      });
    }
    const { data: inserted, error: insErr } = await sb()
      .from('designs')
      .insert({
        quote_id: req.params.id,
        state,
        version: 1,   // first save → v1
        created_by: userId,
        updated_by: userId,
      })
      .select('id, quote_id, state, version, created_at, updated_at, created_by, updated_by')
      .single();
    if (insErr) throw insErr;
    res.status(201).json(inserted);
  } catch (e) {
    console.error('[pm/designs PUT] failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /:id/refetch-roof-image ───────────────────────────────────────────
// Upgrade a pre-Migration-040 roof analysis in place: re-fetch the aerial
// tile from Google Solar at the OPTIMAL radius computed from the existing
// segments. Idempotent — no-op if the tile is already tight (≤20m).
//
// Dependency injection points below let tests substitute in-memory fakes
// for the Google Solar client + quotaTracker + roofImagery + optimal-radius
// helper. Production uses the singletons.
const REFETCH_TIGHT_THRESHOLD_M = 20;

let _refetchDeps = null;    // { roofImagery, quotaTracker, computeOptimalTileRadius }
export function __setRefetchDepsForTests(deps) { _refetchDeps = deps; }

async function getRefetchDeps() {
  if (_refetchDeps) return _refetchDeps;
  // Lazy-load production deps only when the endpoint is hit — keeps route
  // startup fast + means tests never hit the real providers.
  //
  // roofImagery here is the aerialImagery orchestrator (Migration 041):
  // it tries LINZ first if configured, then falls back to Google Solar.
  // Quota check below still calls reserveQuota('dataLayers') — LINZ has
  // its own generous rate limits and doesn't share Google's quota, so
  // reserving Google's quota is only strictly required for the fallback
  // path. We reserve up-front to keep the flow simple; a future refinement
  // is to skip Google quota reservation when LINZ is the primary path.
  const { computeOptimalTileRadius } = await import('../../services/googleSolar/analyseRoof.js');
  const { fetchAndStoreRoofImage }   = await import('../../services/aerialImagery.js');
  const { reserveQuota }             = await import('../../services/googleSolar/quotaTracker.js');
  return {
    computeOptimalTileRadius,
    roofImagery: { fetchAndStoreRoofImage },
    quotaTracker: { reserveQuota },
  };
}

router.post('/:id/refetch-roof-image', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    // Resolve quote → contact → most recent roof_analyses row
    const { data: quote, error: qErr } = await sb()
      .from('quotes').select('id, contact_id').eq('id', req.params.id).maybeSingle();
    if (qErr) throw qErr;
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (!quote.contact_id) return res.status(404).json({ error: 'Quote has no contact' });

    const { data: analysis, error: aErr } = await sb()
      .from('roof_analyses')
      .select('id, enquiry_id, latitude, longitude, roof_segments, tile_radius_m, status')
      .eq('contact_id', quote.contact_id)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    if (aErr) throw aErr;
    if (!analysis) return res.status(404).json({ error: 'No roof analysis on file for this customer' });
    if (analysis.status !== 'ok') {
      return res.status(409).json({ error: `Roof analysis is in '${analysis.status}' state — cannot refetch` });
    }
    if (typeof analysis.latitude !== 'number' || typeof analysis.longitude !== 'number') {
      return res.status(422).json({ error: 'Roof analysis missing latitude/longitude — cannot refetch' });
    }

    // Skip if already tight — saves a quota call
    if (analysis.tile_radius_m != null && Number(analysis.tile_radius_m) <= REFETCH_TIGHT_THRESHOLD_M) {
      return res.status(204).end();
    }

    const deps = await getRefetchDeps();
    const optimalRadius = deps.computeOptimalTileRadius(analysis.roof_segments);

    // Reserve quota
    const reservation = await deps.quotaTracker.reserveQuota('dataLayers');
    if (!reservation.allowed) {
      return res.status(429).json({
        error: 'Google Solar monthly quota exhausted',
        callCount: reservation.callCount,
        quota: reservation.quota,
      });
    }

    const result = await deps.roofImagery.fetchAndStoreRoofImage({
      enquiryId: analysis.enquiry_id,
      latitude:  Number(analysis.latitude),
      longitude: Number(analysis.longitude),
      radiusMeters: optimalRadius,
    });

    if (!result.ok) {
      return res.status(502).json({ error: `Roof imagery fetch failed: ${result.reason}`, detail: result.error });
    }

    const { data: updated, error: uErr } = await sb()
      .from('roof_analyses')
      .update({
        roof_image_storage_bucket: result.storageBucket,
        roof_image_storage_path:   result.storagePath,
        roof_image_fetched_at:     new Date().toISOString(),
        tile_radius_m:             result.radiusMeters,
        imagery_source:            result.source || 'google_solar',
        roof_image_error_message:  null,   // clear any prior failure
      })
      .eq('id', analysis.id)
      .select('id, tile_radius_m, roof_image_storage_path, imagery_source')
      .single();
    if (uErr) throw uErr;

    res.json({
      updated: true,
      tile_radius_m:  updated.tile_radius_m,
      storage_path:   updated.roof_image_storage_path,
      imagery_source: updated.imagery_source,
    });
  } catch (e) {
    console.error('[pm/designs refetch-roof-image] failed:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
