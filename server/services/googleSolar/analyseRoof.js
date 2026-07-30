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

// ── Factory (used by tests) ─────────────────────────────────────────────────
export function createAnalyser({
  supabase,                                      // required
  featureEnabled = env.googleSolar.enabled,
  client,                                        // { buildingInsights({lat,lng}) } — required
  quotaTracker,                                  // { reserveQuota(endpoint) } — required
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

      let result;
      try {
        result = await client.buildingInsights({ latitude, longitude });
      } catch (err) {
        // Client itself throws only on validation errors — network errors
        // return ok:false. This branch handles the unexpected exceptions.
        await updateRow(supabase, pending.id, {
          status:        'failed',
          error_message: `client-exception: ${err.message}`,
          responded_at:  now().toISOString(),
        });
        return { status: 'failed', id: pending.id };
      }

      if (!result.ok) {
        const isNoBuilding = result.status === 404;
        await updateRow(supabase, pending.id, {
          status:        'failed',
          error_message: isNoBuilding
            ? `no-building-at-location: ${result.error}`
            : `api-${result.status}: ${result.error}`,
          responded_at:  now().toISOString(),
        });
        return { status: 'failed', id: pending.id };
      }

      // Success — parse + write.
      const parsed = parseBuildingInsightsResponse(result.data);
      await updateRow(supabase, pending.id, {
        ...parsed,
        status:        'ok',
        api_version:   'v1',
        responded_at:  now().toISOString(),
        raw_response:  result.data,
      });
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
    const { supabaseAdmin } = await import('../../config/supabase.js');
    const { createClient } = await import('./client.js');
    const { createQuotaTracker } = await import('./quotaTracker.js');
    _analyser = createAnalyser({
      supabase:     supabaseAdmin,
      client:       createClient(),
      quotaTracker: createQuotaTracker({ supabase: supabaseAdmin }),
    });
  }
  return _analyser.analyseRoof(args);
}

export function _resetAnalyserForTests() {
  _analyser = null;
}
