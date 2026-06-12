// ────────────────────────────────────────────────────────────────────────────
// fieldLimits.js — admin-tunable hard/typical ranges for spec fields.
//
// Backed by the `field_limits` DB table (migration 030). Admin edits flow
// through /api/pm/admin/field-limits which calls invalidate() so the next
// validator run pulls the new values.
//
// Static fallback (STATIC_FIELD_LIMITS) below is used:
//   • Before the first DB load completes (cold start, first ms)
//   • When the DB load throws (e.g. Supabase unreachable, RLS misconfig)
//   • When a specific path is missing from the DB (someone deleted a row)
//
// The fallback values match the migration 030 seed exactly so behaviour is
// identical pre/post migration in steady state.
//
// Consumers:
//   • configValidator.js — awaits ensureLoaded() once at the top of validate
//     then uses the sync getHardRange(path) accessor.
//   • client/src/pm/utils/fieldHints.js — mirrors STATIC_FIELD_LIMITS as a
//     hardcoded fallback, but also fetches /pm/admin/field-limits at boot.
// ────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '../../../config/supabase.js';

// ── Static fallback (mirrors migration 030 seed) ──────────────────────────
export const STATIC_FIELD_LIMITS = {
  'system.panel.count': {
    hard_min: 4, hard_max: 60, typical_min: 12, typical_max: 24,
    unit: 'panels',
  },
  'system.battery.module_count': {
    hard_min: 1, hard_max: 24, typical_min: 3, typical_max: 8,
    unit: 'modules',
  },
  'system.cable_run_metres_estimate': {
    hard_min: 5, hard_max: 200, typical_min: 15, typical_max: 35,
    unit: 'm',
  },
  'system.string_design.groups.panels_per_string': {
    hard_min: 4, hard_max: 30, typical_min: 6, typical_max: 12,
    unit: 'panels',
  },
  'system.string_design.groups.string_count': {
    hard_min: 1, hard_max: 8, typical_min: 1, typical_max: 4,
    unit: 'strings',
  },
  'bills.annual_kwh': {
    hard_min: 1500, hard_max: 35000, typical_min: 7000, typical_max: 15000,
    unit: 'kWh/yr',
  },
  'bills.annual_spend': {
    hard_min: 500, hard_max: 15000, typical_min: 2500, typical_max: 5500,
    unit: 'NZD/yr',
  },
  'bills.variable_rate_per_kwh_incl_gst': {
    hard_min: 0.10, hard_max: 0.50, typical_min: 0.20, typical_max: 0.35,
    unit: '$/kWh inc GST',
  },
  'bills.daily_fixed_charge_incl_gst': {
    hard_min: 0.50, hard_max: 5.00, typical_min: 1.50, typical_max: 3.50,
    unit: '$/day inc GST',
  },
  'bills.buyback_rate': {
    hard_min: 0.00, hard_max: 0.20, typical_min: 0.07, typical_max: 0.13,
    unit: '$/kWh',
  },
};

// ── Cache state ───────────────────────────────────────────────────────────
const TTL_MS = 5 * 60 * 1000;   // 5 min — short enough that admin edits
                                 //         show up fast, long enough that
                                 //         hot validators don't thrash the DB.
let _cache         = null;       // populated map of path → limits
let _cacheLoadedAt = 0;
let _inFlight      = null;       // promise from in-progress load (dedup)

// Old name re-export for any caller that still imports FIELD_LIMITS directly.
// New code should call getLimits(path) / getHardRange(path) instead.
export const FIELD_LIMITS = STATIC_FIELD_LIMITS;

// ── DB loader ─────────────────────────────────────────────────────────────
async function _loadFromDb() {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from('field_limits')
    .select('path, hard_min, hard_max, typical_min, typical_max, unit, notes');
  if (error) throw error;
  const out = {};
  for (const r of data || []) {
    out[r.path] = {
      hard_min:    Number(r.hard_min),
      hard_max:    Number(r.hard_max),
      typical_min: Number(r.typical_min),
      typical_max: Number(r.typical_max),
      unit:        r.unit,
      notes:       r.notes,
    };
  }
  return out;
}

// Ensure cache is fresh. Call once at the top of any validate path. Safe to
// call concurrently — in-flight loads are deduped via _inFlight.
//
// Returns the live cache map. On DB error, returns STATIC_FIELD_LIMITS (never
// throws) so the engine can keep running with hardcoded values.
export async function ensureLoaded() {
  const now = Date.now();
  if (_cache && now - _cacheLoadedAt < TTL_MS) return _cache;
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    try {
      const fresh = await _loadFromDb();
      if (fresh && Object.keys(fresh).length > 0) {
        _cache = fresh;
        _cacheLoadedAt = now;
      } else if (!_cache) {
        _cache = STATIC_FIELD_LIMITS;
        _cacheLoadedAt = now;
      }
    } catch (e) {
      console.warn('[fieldLimits] DB load failed; using static fallback:', e.message);
      if (!_cache) _cache = STATIC_FIELD_LIMITS;
    } finally {
      _inFlight = null;
    }
    return _cache;
  })();

  return _inFlight;
}

// Called by /api/pm/admin/field-limits PATCH after a successful update so the
// next validator call picks up the new value instead of waiting for TTL.
export function invalidate() {
  _cacheLoadedAt = 0;
}

// ── Sync accessors (use after ensureLoaded() resolves) ────────────────────
// Falls back to STATIC_FIELD_LIMITS per-path if the cache is missing the path
// (which shouldn't happen in normal operation — covered for defensive depth).
function _read(path) {
  return (_cache && _cache[path]) || STATIC_FIELD_LIMITS[path] || null;
}

export function getLimits(path)       { return _read(path); }
export function getHardRange(path)    {
  const l = _read(path);
  return l ? { min: l.hard_min, max: l.hard_max } : null;
}
export function getTypicalRange(path) {
  const l = _read(path);
  return l ? { min: l.typical_min, max: l.typical_max } : null;
}

// Test/diagnostic helpers — not used in production code paths.
export function _peekCache() {
  return { cache: _cache, loadedAt: _cacheLoadedAt, ttlMs: TTL_MS };
}
export function _resetForTest() {
  _cache = null;
  _cacheLoadedAt = 0;
  _inFlight = null;
}
