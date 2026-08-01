// ────────────────────────────────────────────────────────────────────────────
// Google Solar API — roof analysis orchestrator
//
// Public entry: analyseRoof({ enquiryId, address, latitude, longitude,
//                              contactId?, projectId? })
//
// Called fire-and-forget from routes/quote.js after wizard submit succeeds.
// Never throws — every branch writes a row to roof_analyses with an
// appropriate `status`, and errors are captured in `error_message`.
//
// Flow:
//
//   1. If FEATURE_GOOGLE_SOLAR is off → insert status='skipped_flag' row.
//   2. Idempotency: if any prior row exists for this enquiry_id → return
//      that row unchanged. (Q4 D2 answer — one analysis per enquiry
//      lifecycle; QR-partial + full-wizard-completion won't double-fire.)
//   3. If latitude/longitude missing → insert status='failed' row with a
//      clear "geocoding required" message. Geocoding is out of Phase 1
//      scope; caller is expected to provide lat/lng or defer.
//   4. Reserve quota. If denied → insert status='skipped_quota' row.
//   5. Insert status='pending' row → call client.buildingInsights.
//      • On ok:  update to status='ok' with parsed summary + raw_response.
//      • On 404: update to status='failed', error='no-building-at-location'.
//      • On other error: update to status='failed', error=<detail>.
//
// The returned promise resolves with { status, id? } — but caller ignores
// (fire-and-forget). Errors are captured in the DB row, not thrown.
//
// UNIT CONVERSION: Google returns carbonOffsetFactor in kg CO₂ / MWh. Our
// DB column is per KWH (kg CO₂ / kWh) for consistency with our energy
// engine, which works in kWh. We divide by 1000. Verified against Google
// docs 2026-07-29 — recheck if the API version changes.
// ────────────────────────────────────────────────────────────────────────────

import env from '../../config/env.js';

const ENDPOINT = 'buildingInsights';

// Google Solar API returns 404 not just for "no building here" but also for
// "no imagery AT THE REQUESTED QUALITY". Google's NZ coverage is mostly
// MEDIUM/LOW tier; HIGH-only requests get 404 even for valid Auckland CBD
// addresses. Cascade from strictest to loosest so we get the best available
// imagery in a single logical operation.
//
// Each attempt reserves its own quota slot — cascade is capped at 3× cost
// per address, but stops early on success (typical urban address = 1 call,
// suburban ≈ 1-2, rural = 3). Cascade also stops on non-404 errors (5xx,
// network) and on quota exhaustion mid-cascade.
const QUALITY_CASCADE = ['HIGH', 'MEDIUM', 'LOW'];

// ── Factory (used by tests) ─────────────────────────────────────────────────
export function createAnalyser({
  supabase,                                      // required
  featureEnabled = env.googleSolar.enabled,
  client,                                        // { buildingInsights({lat,lng}) } — required
  quotaTracker,                                  // { reserveQuota(endpoint) } — required
  roofImagery    = null,                         // { fetchAndStoreRoofImage(...) } — optional (Phase 2)
  now            = () => new Date(),
  logger         = console,
} = {}) {
  if (!supabase)     throw new Error('[analyseRoof] createAnalyser: supabase required');
  if (!client)       throw new Error('[analyseRoof] createAnalyser: client required');
  if (!quotaTracker) throw new Error('[analyseRoof] createAnalyser: quotaTracker required');

  return {
    /**
     * @param {object} args
     * @param {string} args.enquiryId     — website_enquiries.id (required)
     * @param {string} args.address       — human address for logging (required)
     * @param {number} [args.latitude]    — required for API call; if absent, row saved as failed
     * @param {number} [args.longitude]
     * @param {string} [args.contactId]   — optional; filled if wizard has one
     * @param {string} [args.projectId]   — optional; filled if enquiry became a project
     * @returns {Promise<{ status: string, id?: string }>}
     */
    async analyseRoof({ enquiryId, address, latitude, longitude, contactId = null, projectId = null } = {}) {
      // Boundary validation — analyseRoof MUST have an enquiryId to
      // satisfy the NOT NULL FK. address is required for logging + DB.
      if (!enquiryId) throw new Error('[analyseRoof] enquiryId required');
      if (!address)   throw new Error('[analyseRoof] address required');

      // ── 1. Feature flag ────────────────────────────────────────────────
      if (!featureEnabled) {
        const row = await insertRow(supabase, {
          enquiry_id:    enquiryId,
          contact_id:    contactId,
          project_id:    projectId,
          status:        'skipped_flag',
          address_used:  address,
          error_message: 'FEATURE_GOOGLE_SOLAR is off',
          requested_at:  now().toISOString(),
        });
        return { status: 'skipped_flag', id: row?.id };
      }

      // ── 2. Idempotency ─────────────────────────────────────────────────
      const { data: existing, error: selErr } = await supabase
        .from('roof_analyses')
        .select('id, status')
        .eq('enquiry_id', enquiryId)
        .limit(1)
        .maybeSingle();
      if (selErr) {
        logger.error?.('[analyseRoof] SELECT existing failed:', selErr.message);
        // Fall through — allow duplicate rather than silently skip. Two rows
        // for one enquiry is annoying but not dangerous.
      }
      if (existing) {
        return { status: existing.status, id: existing.id };
      }

      // ── 3. Geocoding availability ──────────────────────────────────────
      const latOk = typeof latitude === 'number' && !Number.isNaN(latitude);
      const lngOk = typeof longitude === 'number' && !Number.isNaN(longitude);
      if (!latOk || !lngOk) {
        const row = await insertRow(supabase, {
          enquiry_id:    enquiryId,
          contact_id:    contactId,
          project_id:    projectId,
          status:        'failed',
          address_used:  address,
          error_message: 'geocoding-required: latitude/longitude missing (Phase 1 does not geocode; caller must provide)',
          requested_at:  now().toISOString(),
          responded_at:  now().toISOString(),
        });
        return { status: 'failed', id: row?.id };
      }

      // ── 4. Quota reservation ───────────────────────────────────────────
      let reservation;
      try {
        reservation = await quotaTracker.reserveQuota(ENDPOINT);
      } catch (err) {
        // Quota tracker fails loudly — record the failure and skip the API.
        const row = await insertRow(supabase, {
          enquiry_id:    enquiryId,
          contact_id:    contactId,
          project_id:    projectId,
          status:        'failed',
          address_used:  address,
          latitude, longitude,
          error_message: `quota-tracker-error: ${err.message}`,
          requested_at:  now().toISOString(),
          responded_at:  now().toISOString(),
        });
        return { status: 'failed', id: row?.id };
      }
      if (!reservation.allowed) {
        const row = await insertRow(supabase, {
          enquiry_id:    enquiryId,
          contact_id:    contactId,
          project_id:    projectId,
          status:        'skipped_quota',
          address_used:  address,
          latitude, longitude,
          error_message: `quota-exhausted: ${reservation.callCount}/${reservation.quota} for ${ENDPOINT} this month`,
          requested_at:  now().toISOString(),
          responded_at:  now().toISOString(),
        });
        return { status: 'skipped_quota', id: row?.id };
      }

      // ── 5. Insert pending, call API, update with result ────────────────
      const pending = await insertRow(supabase, {
        enquiry_id:    enquiryId,
        contact_id:    contactId,
        project_id:    projectId,
        status:        'pending',
        address_used:  address,
        latitude, longitude,
        requested_at:  now().toISOString(),
      });

      // ── Quality cascade: HIGH → MEDIUM → LOW ───────────────────────────
      // First iteration uses the quota slot already reserved above.
      // Subsequent iterations reserve fresh slots (respects Q6a cap).
      // Cascade stops on success, non-404 error, or quota exhaustion.
      let result = null;
      const attempted = [];

      for (let i = 0; i < QUALITY_CASCADE.length; i++) {
        const quality = QUALITY_CASCADE[i];

        if (i > 0) {
          let retry;
          try {
            retry = await quotaTracker.reserveQuota(ENDPOINT);
          } catch (err) {
            logger.warn?.(`[analyseRoof] quota reservation failed during ${quality} cascade retry: ${err.message}`);
            break;
          }
          if (!retry.allowed) {
            logger.warn?.(`[analyseRoof] quota exhausted during ${quality} cascade retry (${retry.callCount}/${retry.quota})`);
            break;
          }
        }

        attempted.push(quality);
        try {
          result = await client.buildingInsights({ latitude, longitude, requiredQuality: quality });
        } catch (err) {
          // Client itself throws only on validation errors — network errors
          // return ok:false. This branch handles the unexpected exceptions.
          await updateRow(supabase, pending.id, {
            status:        'failed',
            error_message: `client-exception (attempted ${attempted.join('→')}): ${err.message}`,
            responded_at:  now().toISOString(),
          });
          return { status: 'failed', id: pending.id };
        }

        // Success or non-404 error → stop cascade. 404 → try next tier.
        if (result.ok || result.status !== 404) break;
      }

      // Guard for edge case: cascade broke on i=0 without setting result.
      // Should not happen — the first iteration always sets result.
      if (!result) {
        await updateRow(supabase, pending.id, {
          status:        'failed',
          error_message: `cascade-no-attempt (attempted ${attempted.join('→') || 'none'})`,
          responded_at:  now().toISOString(),
        });
        return { status: 'failed', id: pending.id };
      }

      if (!result.ok) {
        const isNoBuilding = result.status === 404;
        const attemptedNote = attempted.length > 0 ? ` (attempted ${attempted.join('→')})` : '';
        await updateRow(supabase, pending.id, {
          status:        'failed',
          error_message: isNoBuilding
            ? `no-coverage-at-any-quality${attemptedNote}: ${result.error}`
            : `api-${result.status}${attemptedNote}: ${result.error}`,
          responded_at:  now().toISOString(),
        });
        return { status: 'failed', id: pending.id };
      }

      // Success — parse + write. imagery_quality from Google's response tells
      // us what tier we actually got (may differ from what we requested if
      // Google returned better than the minimum floor).
      const parsed = parseBuildingInsightsResponse(result.data);
      await updateRow(supabase, pending.id, {
        ...parsed,
        status:        'ok',
        api_version:   'v1',
        responded_at:  now().toISOString(),
        raw_response:  result.data,
      });

      // ── Phase 2 — kick off aerial imagery fetch (dataLayers → PNG → Storage)
      // Runs synchronously here because we're already inside the wizard's
      // fire-and-forget wrapper. Imagery failure NEVER fails the analysis —
      // status stays 'ok', roof_image_error_message captures the reason.
      // Skipped entirely when roofImagery dep isn't injected (Phase 1 mode).
      //
      // Migration 040: compute an OPTIMAL tile radius from the just-parsed
      // segment bboxes. For a typical NZ house this drops the tile from
      // 100 × 100 m to ~30 × 30 m — the roof fills the image instead of
      // being a small speck in a sea of neighbours' rooftops.
      if (roofImagery) {
        const optimalRadius = computeOptimalTileRadius(parsed.roof_segments);
        await fetchAndStoreRoofImageForRow({
          supabase, pendingId: pending.id, enquiryId,
          latitude, longitude,
          radiusMeters: optimalRadius,
          quotaTracker, roofImagery, logger, now,
        });
      }

      return { status: 'ok', id: pending.id };
    },
  };
}

// ── Parsing (exported for direct testing) ───────────────────────────────────
export function parseBuildingInsightsResponse(data) {
  const sp = data?.solarPotential || {};
  const segments = Array.isArray(sp.roofSegmentStats) ? sp.roofSegmentStats : [];
  return {
    imagery_quality:                 data?.imageryQuality || null,
    imagery_date:                    formatImageryDate(data?.imageryDate),
    max_array_area_m2:               numOrNull(sp.maxArrayAreaMeters2),
    max_array_panels_count:          intOrNull(sp.maxArrayPanelsCount),
    max_sunshine_hours_per_year:     numOrNull(sp.maxSunshineHoursPerYear),
    // UNIT CONVERSION: Google returns kg CO₂ / MWh; our column is kg / kWh.
    carbon_offset_factor_kg_per_kwh: sp.carbonOffsetFactorKgPerMwh != null
      ? Number((sp.carbonOffsetFactorKgPerMwh / 1000).toFixed(4))
      : null,
    roof_segments:                   segments,
  };
}

function formatImageryDate(imgDate) {
  if (!imgDate || typeof imgDate.year !== 'number') return null;
  const y = imgDate.year;
  const m = String(imgDate.month || 1).padStart(2, '0');
  const d = String(imgDate.day   || 1).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function numOrNull(v) { return typeof v === 'number' && !Number.isNaN(v) ? v : null; }
function intOrNull(v) { return typeof v === 'number' && !Number.isNaN(v) ? Math.round(v) : null; }

// ── Optimal-radius helper (Migration 040) ──────────────────────────────────
// Compute a Google-Solar-tile radius (in metres) that tightly frames the
// customer's roof plus a little context. Uses the union of the parsed
// segment bounding boxes to determine the building's on-ground extent.
//
// Returns a whole-metre value in [MIN_TILE_RADIUS_M, FALLBACK_TILE_RADIUS_M].
// Fallback is used when segments are missing/malformed OR the building is
// weirdly big — we don't want to accidentally request tiles bigger than the
// old default.
//
// Exported so tests can hit it in isolation.
const MIN_TILE_RADIUS_M     = 12;   // Google Solar minimum-supported radius
const FALLBACK_TILE_RADIUS_M = 50;  // matches historical hardcoded value
const RADIUS_PADDING_M      = 6;    // extra metres beyond the roof bbox

export function computeOptimalTileRadius(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return FALLBACK_TILE_RADIUS_M;

  // Union bbox of all segments in lat/lng
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  let sumLat = 0, count = 0;
  for (const seg of segments) {
    const bbox = seg?.boundingBox;
    if (!bbox?.ne || !bbox?.sw) continue;
    if (typeof bbox.ne.latitude !== 'number' || typeof bbox.sw.latitude !== 'number') continue;
    if (typeof bbox.ne.longitude !== 'number' || typeof bbox.sw.longitude !== 'number') continue;
    minLat = Math.min(minLat, bbox.sw.latitude);
    maxLat = Math.max(maxLat, bbox.ne.latitude);
    minLng = Math.min(minLng, bbox.sw.longitude);
    maxLng = Math.max(maxLng, bbox.ne.longitude);
    sumLat += (bbox.ne.latitude + bbox.sw.latitude) / 2;
    count++;
  }
  if (!Number.isFinite(minLat) || count === 0) return FALLBACK_TILE_RADIUS_M;

  // Convert lat/lng deltas to metres. Flat-earth approximation is fine at
  // building scale (<50m).
  const midLat = sumLat / count;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  const bboxMetersN = (maxLat - minLat) * metersPerDegLat;
  const bboxMetersE = (maxLng - minLng) * metersPerDegLng;
  const halfMaxDim = Math.max(bboxMetersN, bboxMetersE) / 2;

  const raw = Math.ceil(halfMaxDim + RADIUS_PADDING_M);
  // Clamp: never smaller than Google's minimum, never larger than fallback
  // (biggest building we'd ever see fits in 100m tile).
  return Math.max(MIN_TILE_RADIUS_M, Math.min(FALLBACK_TILE_RADIUS_M, raw));
}

// ── Phase 2 — imagery follow-up helper ──────────────────────────────────────
// Never throws. Any failure inside is captured on the row via
// roof_image_error_message so admin/UI can diagnose without losing the
// primary buildingInsights analysis.
async function fetchAndStoreRoofImageForRow({
  supabase, pendingId, enquiryId, latitude, longitude,
  radiusMeters,
  quotaTracker, roofImagery, logger, now,
}) {
  // Step 1: reserve a dataLayers quota slot (separate from buildingInsights)
  let reservation;
  try {
    reservation = await quotaTracker.reserveQuota('dataLayers');
  } catch (err) {
    logger.warn?.(`[analyseRoof] imagery quota tracker error: ${err?.message || err}`);
    await updateRow(supabase, pendingId, {
      roof_image_error_message: `imagery-quota-tracker-error: ${err?.message || err}`,
    });
    return;
  }
  if (!reservation.allowed) {
    logger.warn?.(`[analyseRoof] imagery quota exhausted (${reservation.callCount}/${reservation.quota})`);
    await updateRow(supabase, pendingId, {
      roof_image_error_message: `imagery-quota-exhausted: ${reservation.callCount}/${reservation.quota} dataLayers this month`,
    });
    return;
  }

  // Step 2: run the imagery pipeline
  let result;
  try {
    result = await roofImagery.fetchAndStoreRoofImage({
      enquiryId, latitude, longitude, radiusMeters,
    });
  } catch (err) {
    logger.warn?.(`[analyseRoof] imagery fetcher threw: ${err?.message || err}`);
    await updateRow(supabase, pendingId, {
      roof_image_error_message: `imagery-fetcher-throw: ${err?.message || err}`,
    });
    return;
  }

  if (result.ok) {
    await updateRow(supabase, pendingId, {
      roof_image_storage_bucket: result.storageBucket,
      roof_image_storage_path:   result.storagePath,
      roof_image_fetched_at:     now().toISOString(),
      tile_radius_m:             result.radiusMeters,   // Migration 040 — record actual radius used
      imagery_source:            result.source || 'google_solar',  // Migration 041 — which provider supplied the tile
    });
  } else {
    await updateRow(supabase, pendingId, {
      roof_image_error_message: `imagery-${result.reason}: ${result.error}`,
    });
  }
}

// ── DB helpers (small, exported for direct test if desired) ────────────────
async function insertRow(supabase, row) {
  const { data, error } = await supabase.from('roof_analyses').insert(row).select().single();
  if (error) {
    // Insertion should never fail under normal conditions. If it does, log
    // loudly — this is the ONE place a failure can silently swallow an
    // analysis attempt. Return null so caller can degrade gracefully.
    console.error('[analyseRoof] INSERT failed:', error.message, 'row:', row);
    return null;
  }
  return data;
}

async function updateRow(supabase, id, patch) {
  const { error } = await supabase.from('roof_analyses').update(patch).eq('id', id);
  if (error) {
    console.error('[analyseRoof] UPDATE failed for id', id, ':', error.message);
  }
}

// ── Singleton for production consumers ──────────────────────────────────────
let _analyser = null;
export async function analyseRoof(args) {
  if (!_analyser) {
    const { default: env } = await import('../../config/env.js');
    const { supabaseAdmin } = await import('../../config/supabase.js');
    const { createClient } = await import('./client.js');
    const { createQuotaTracker } = await import('./quotaTracker.js');
    const { createRoofImageryFetcher } = await import('./roofImagery.js');
    const { createAerialImageryOrchestrator } = await import('../aerialImagery.js');
    const { default: sharp } = await import('sharp');
    const clientSingleton = createClient();

    // Google Solar dataLayers path — always available as the fallback.
    const googleFetcher = createRoofImageryFetcher({
      client:   clientSingleton,
      sharp,
      supabase: supabaseAdmin,
    });

    // LINZ Basemap path — built only if the feature is on + key is set.
    let linzFetcher = null;
    if (env.linz.enabled && env.linz.apiKey) {
      const { createBasemapClient } = await import('../linz/basemapClient.js');
      const { createAerialFetcher } = await import('../linz/aerialFetcher.js');
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

    _analyser = createAnalyser({
      supabase:     supabaseAdmin,
      client:       clientSingleton,
      quotaTracker: createQuotaTracker({ supabase: supabaseAdmin }),
      // Orchestrator picks LINZ if configured, falls back to Google Solar.
      // Both providers write to the same Supabase Storage bucket + return
      // the same {ok, storagePath, storageBucket, radiusMeters, source} shape.
      roofImagery:  createAerialImageryOrchestrator({ linzFetcher, googleFetcher }),
    });
  }
  return _analyser.analyseRoof(args);
}

export function _resetAnalyserForTests() {
  _analyser = null;
}
