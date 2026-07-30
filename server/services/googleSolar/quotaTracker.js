// ────────────────────────────────────────────────────────────────────────────
// Google Solar API — monthly quota tracker (Q6a cost cap)
//
// Contract: analyseRoof.js MUST call reserveQuota(endpoint) BEFORE hitting
// Google. If reserveQuota returns { allowed: false }, DO NOT call the API —
// mark the roof_analyses row as status='skipped_quota'.
//
// Why increment-BEFORE-call:
//   Google bills for failures too. If we called the API and only incremented
//   on success, a burst of failing requests could bill us past the cap. By
//   reserving the slot up front, the counter is authoritative even if the
//   subsequent API call fails.
//
// Race condition:
//   Two concurrent reserveQuota() calls near the boundary can both pass and
//   both increment. Worst case: 1-2 calls above quota_limit per burst. This
//   is acceptable given Google's own free-tier quota will 429 us anyway.
//   Making this fully atomic would require SELECT FOR UPDATE and a
//   transaction — worth doing later if we ever see meaningful over-shoot.
//
// Admin notification (Q6a):
//   Once call_count crosses alertAtPct% of quota_limit, we fire ONE email to
//   admin per month per endpoint (guarded by admin_notified_at column).
//   Email is fire-and-forget — if it fails, the API call still proceeds.
// ────────────────────────────────────────────────────────────────────────────

import env from '../../config/env.js';

// ── Factory (used by tests for DI) ──────────────────────────────────────────
export function createQuotaTracker({
  supabase,                                     // Supabase JS client — required
  monthlyQuota    = env.googleSolar.monthlyQuota,
  alertAtPct      = env.googleSolar.alertAtPct,
  now             = () => new Date(),
  notifyAdmin     = defaultNotifyAdmin,
  logger          = console,
} = {}) {
  if (!supabase) {
    throw new Error('[quotaTracker] createQuotaTracker: supabase client is required');
  }

  return {
    /**
     * Reserve one quota slot for `endpoint`. Increments the counter atomically
     * (best-effort — see race condition note above).
     *
     * @param {'buildingInsights'|'dataLayers'|'geoTiff'} endpoint
     * @returns {Promise<
     *   { allowed: true,  callCount: number, quota: number, isFirstOfMonth: boolean }
     * | { allowed: false, reason: 'quota_exhausted', callCount: number, quota: number }
     * >}
     */
    async reserveQuota(endpoint) {
      if (!endpoint || typeof endpoint !== 'string') {
        throw new Error('[quotaTracker] reserveQuota: endpoint (string) is required');
      }
      const yyyyMm = monthKey(now());

      // Fetch existing row for this (month, endpoint), if any.
      const { data: existing, error: selErr } = await supabase
        .from('google_solar_usage')
        .select('*')
        .eq('yyyy_mm', yyyyMm)
        .eq('endpoint', endpoint)
        .maybeSingle();

      if (selErr) {
        // Fail loudly (Rule 4) — quota tracking is a hard-cap, don't proceed
        // to the API call if we can't verify we're under the limit.
        throw new Error(`[quotaTracker] SELECT failed: ${selErr.message}`);
      }

      // First call of the month for this endpoint — insert with count=1.
      if (!existing) {
        const { data: created, error: insErr } = await supabase
          .from('google_solar_usage')
          .insert({
            yyyy_mm:     yyyyMm,
            endpoint,
            call_count:  1,
            quota_limit: monthlyQuota,
          })
          .select()
          .single();

        if (insErr) throw new Error(`[quotaTracker] INSERT failed: ${insErr.message}`);
        return {
          allowed:          true,
          callCount:        created.call_count,
          quota:            created.quota_limit,
          isFirstOfMonth:   true,
        };
      }

      // Row exists — check cap first.
      if (existing.call_count >= existing.quota_limit) {
        return {
          allowed:   false,
          reason:    'quota_exhausted',
          callCount: existing.call_count,
          quota:     existing.quota_limit,
        };
      }

      // Under cap — increment.
      const newCount = existing.call_count + 1;
      const { data: updated, error: updErr } = await supabase
        .from('google_solar_usage')
        .update({ call_count: newCount, updated_at: now().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();

      if (updErr) throw new Error(`[quotaTracker] UPDATE failed: ${updErr.message}`);

      // Threshold check: did this increment cross the alert line? Fire admin
      // notification once per month per endpoint. admin_notified_at is the
      // dedupe key — once set, no more emails until next month's row.
      const alertAt = Math.floor(existing.quota_limit * alertAtPct / 100);
      const crossed = newCount >= alertAt;
      const alreadyNotified = !!existing.admin_notified_at;

      if (crossed && !alreadyNotified) {
        // Fire-and-forget admin email — API call must not be delayed by SMTP.
        Promise.resolve()
          .then(() => notifyAdmin({
            yyyyMm,
            endpoint,
            callCount: newCount,
            quota:     existing.quota_limit,
            alertAtPct,
          }))
          .catch(err => logger.error?.('[quotaTracker] admin notify failed:', err));

        // Best-effort update — if this UPDATE fails, we may double-notify next
        // call, which is annoying but not dangerous. Log and continue.
        const { error: notifyErr } = await supabase
          .from('google_solar_usage')
          .update({ admin_notified_at: now().toISOString() })
          .eq('id', existing.id);
        if (notifyErr) {
          logger.warn?.(`[quotaTracker] failed to set admin_notified_at (may double-notify): ${notifyErr.message}`);
        }
      }

      return {
        allowed:        true,
        callCount:      updated.call_count,
        quota:          updated.quota_limit,
        isFirstOfMonth: false,
      };
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
export function monthKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// ── Default admin notify — email via emailService.js ────────────────────────
// Kept separate so tests can inject a spy; production code below wires the
// real emailService. Doesn't import emailService at top of file so a broken
// email import can't take down quota tracking.
async function defaultNotifyAdmin({ yyyyMm, endpoint, callCount, quota, alertAtPct }) {
  const { sendCustomerAckEmail } = await import('../emailService.js').catch(() => ({}));
  // NOTE: sendCustomerAckEmail is a placeholder — emailService.js does not yet
  // export a generic sendAdminAlert. Wiring the real send helper is a
  // follow-up before this feature is enabled in production. For now, log so
  // admin sees the event in Render logs.
  console.warn(
    `[quotaTracker] ALERT: ${endpoint} usage crossed ${alertAtPct}% threshold ` +
    `(${callCount}/${quota}) for ${yyyyMm}. Admin email wiring pending — see quotaTracker.js.`
  );
  // Deliberately silent — email helper wiring lands in a follow-up commit.
}

// ── Singleton for production consumers ──────────────────────────────────────
let _tracker = null;
export async function reserveQuota(endpoint) {
  if (!_tracker) {
    // Lazy import to keep test file free of Supabase side-effects.
    const { supabaseAdmin } = await import('../../config/supabase.js');
    _tracker = createQuotaTracker({ supabase: supabaseAdmin });
  }
  return _tracker.reserveQuota(endpoint);
}

// Test-only reset.
export function _resetTrackerForTests() {
  _tracker = null;
}
