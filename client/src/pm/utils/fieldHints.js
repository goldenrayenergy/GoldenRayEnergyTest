// ────────────────────────────────────────────────────────────────────────────
// fieldHints.js — inline hint generators for editable spec fields.
//
// Each hint surfaces THREE layers of context to the rep:
//   1. Hard allowed range  (engine rejects values outside this — server-tunable)
//   2. Typical NZ residential band  (informational best-practice — not enforced)
//   3. Engine pick + one-line derivation  (when the engine can derive a value)
//
// Values flow:
//   • Boot:  bootstrapFieldLimits() is called once from PmApp.jsx mount —
//            fetches /api/pm/admin/field-limits and merges into the in-memory
//            map. Hint generators below read from FIELD_LIMITS directly so
//            this is a fire-and-forget.
//   • Admin edit: when admin saves a limit, the server invalidates its cache
//            AND the Admin page calls bootstrapFieldLimits() so this client
//            picks up the new value immediately. Other open tabs pick it up
//            on their next reload.
//   • Fallback: if the fetch fails (network, RLS, server down), the hardcoded
//            STATIC_DEFAULTS below are used. These mirror migration 030's seed
//            so behaviour is identical pre/post boot in steady state.
// ────────────────────────────────────────────────────────────────────────────

// ── Static defaults (mirrors server/migrations/030 seed) ───────────────────
// Kept here so the client never falls back to "no hint at all" on first paint
// or when the API is unreachable. Bump in both places when the seed changes.
const STATIC_DEFAULTS = {
  'system.panel.count':                                  { hard_min: 4,    hard_max: 60,    typical_min: 12,   typical_max: 24,   unit: 'panels' },
  'system.battery.module_count':                         { hard_min: 1,    hard_max: 24,    typical_min: 3,    typical_max: 8,    unit: 'modules' },
  'system.cable_run_metres_estimate':                    { hard_min: 5,    hard_max: 200,   typical_min: 15,   typical_max: 35,   unit: 'm' },
  'system.string_design.groups.panels_per_string':       { hard_min: 4,    hard_max: 30,    typical_min: 6,    typical_max: 12,   unit: 'panels' },
  'system.string_design.groups.string_count':            { hard_min: 1,    hard_max: 8,     typical_min: 1,    typical_max: 4,    unit: 'strings' },
  'bills.annual_kwh':                                    { hard_min: 1500, hard_max: 35000, typical_min: 7000, typical_max: 15000, unit: 'kWh/yr' },
  'bills.annual_spend':                                  { hard_min: 500,  hard_max: 15000, typical_min: 2500, typical_max: 5500,  unit: 'NZD/yr' },
  'bills.variable_rate_per_kwh_incl_gst':                { hard_min: 0.10, hard_max: 0.50,  typical_min: 0.20, typical_max: 0.35,  unit: '$/kWh inc GST' },
  'bills.daily_fixed_charge_incl_gst':                   { hard_min: 0.50, hard_max: 5.00,  typical_min: 1.50, typical_max: 3.50,  unit: '$/day inc GST' },
  'bills.buyback_rate':                                  { hard_min: 0.00, hard_max: 0.20,  typical_min: 0.07, typical_max: 0.13,  unit: '$/kWh' },
};

// Live map — starts as a copy of STATIC_DEFAULTS. bootstrapFieldLimits()
// merges in DB-backed values from /pm/admin/field-limits on app mount.
// Generators below read from this directly so updates are picked up live.
// Exported so a test runner can spy on it without going through the network.
export const FIELD_LIMITS = { ...STATIC_DEFAULTS };

// Fetch field_limits from the server + merge into FIELD_LIMITS. Silent on
// error (the in-memory STATIC_DEFAULTS still cover every hint). Safe to call
// repeatedly — replaces values rather than appending.
//
// Call from PmApp.jsx on mount. Also call again after admin edits so the
// open tab picks up new values without reload.
export async function bootstrapFieldLimits(api) {
  if (!api?.get) return;
  try {
    const r = await api.get('/pm/admin/field-limits');
    const rows = r?.data?.rows || [];
    for (const row of rows) {
      if (!row?.path) continue;
      FIELD_LIMITS[row.path] = {
        hard_min:    Number(row.hard_min),
        hard_max:    Number(row.hard_max),
        typical_min: Number(row.typical_min),
        typical_max: Number(row.typical_max),
        unit:        row.unit,
      };
    }
    return { merged: rows.length, source: 'db' };
  } catch (e) {
    // Never throw — UI must keep rendering with static defaults.
    return { merged: 0, source: 'static_fallback', error: e?.message };
  }
}

// ── Format helpers ─────────────────────────────────────────────────────────
function fmtNum(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}
function fmtMoney(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  return `$${n.toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`;
}

// Build the base hint string from limits — "Allowed X-Y unit · Typical A-B".
// Caller can append " · Engine: Z (reason)" via composeHint() below.
function rangeHint(path, opts = {}) {
  const l = FIELD_LIMITS[path];
  if (!l) return '';
  const useMoneyFmt = opts.money;
  const fmt = useMoneyFmt ? fmtMoney : fmtNum;
  const allowed = `Allowed ${fmt(l.hard_min)}-${fmt(l.hard_max)}${l.unit ? ' ' + l.unit : ''}`;
  const typical = `Typical NZ residential ${fmt(l.typical_min)}-${fmt(l.typical_max)}`;
  return `${allowed} · ${typical}`;
}

// Compose the full hint by appending an optional engine-pick line.
function composeHint(base, enginePart) {
  return enginePart ? `${base} · Engine: ${enginePart}` : base;
}

// ── System tab generators ──────────────────────────────────────────────────

// panel count — engine pick = recommended_kw × 1000 ÷ panel.watts, rounded up to clean × 4
export function panelCountHint(spec, panelWatts, recommendedKw) {
  const base = rangeHint('system.panel.count');
  if (!panelWatts || !recommendedKw) return base;
  const raw = (recommendedKw * 1000) / panelWatts;
  const target = Math.round(raw / 4) * 4;
  return composeHint(base, `~${target} (${recommendedKw} kWp ÷ ${panelWatts}W, clean ×4)`);
}

// battery module count
export function batteryModuleCountHint(spec, moduleKwh, recommendedKwh, series) {
  const base = rangeHint('system.battery.module_count');
  const vendorHint = series === 'HVM' ? ' (BYD HVM: 3-8)'
                  : series === 'HVS' ? ' (BYD HVS: 2-5)'
                  : series === 'Reserva' ? ' (Reserva: 2-5)'
                  : '';
  if (!moduleKwh || !recommendedKwh) return base + vendorHint;
  const target = Math.ceil(recommendedKwh / moduleKwh);
  return composeHint(base + vendorHint, `${target} (${recommendedKwh} kWh ÷ ${moduleKwh.toFixed(2)} kWh/module)`);
}

export function cableRunHint() {
  return rangeHint('system.cable_run_metres_estimate') + ' · Inverter→switchboard. Refined at Stage 2 site survey.';
}

export function panelsPerStringHint() {
  return rangeHint('system.string_design.groups.panels_per_string') + ' · Voc cold + Vmp hot checked per group';
}

export function stringCountHint() {
  return rangeHint('system.string_design.groups.string_count') + ' · per group; sum of all groups must equal panel count';
}

export function phaseHint() {
  return '1 = single-phase residential (most common). 3 = three-phase (commercial / large residential). Must match smart meter.';
}

// ── Bills tab generators ──────────────────────────────────────────────────

export function annualKwhHint() {
  return rangeHint('bills.annual_kwh');
}

export function annualSpendHint() {
  return rangeHint('bills.annual_spend', { money: true });
}

export function variableRateHint() {
  return rangeHint('bills.variable_rate_per_kwh_incl_gst');
}

export function dailyFixedHint() {
  return rangeHint('bills.daily_fixed_charge_incl_gst');
}

export function buybackHint() {
  return rangeHint('bills.buyback_rate') + ' · Mercury current ~$0.09; some retailers $0.07-$0.13';
}

// ── Pricing tab generators ─────────────────────────────────────────────────
// Pricing hints surface the live engine LIST so the rep can see what they're
// charging vs. what the system actually costs. Discounts run on owner
// discretion (no fixed cap) but always require a reason + owner approval.
//
// costSnapshot shape: the active tier's `engine.cost` block (or root cost for
// single-tier). Pass null if no engine run has happened yet.

// Customer-facing price anchor — engine's LIST.
export function customerPriceHint(costSnapshot) {
  const list = costSnapshot?.totals?.total_list_inc_gst;
  if (!Number.isFinite(list)) {
    return 'Customer-facing total inc GST. By default the price tracks the engine LIST (HW + BoS + labour + GST). Lock manually to negotiate a specific number.';
  }
  return `Engine LIST: ${fmtMoney(list)} · Auto-priced quotes track this number; locked quotes hold whatever you set.`;
}

// Discount intake — owner discretion (no fixed %); audit trail is mandatory.
export function discountHint(costSnapshot) {
  const list = costSnapshot?.totals?.total_list_inc_gst;
  const applied = costSnapshot?.totals?.discount_applied_inc_gst;
  if (!Number.isFinite(list)) {
    return 'Discount amount in NZD inc GST. Reason text and owner approval are required for any discount > 0.';
  }
  const appliedPart = Number.isFinite(applied) && applied > 0
    ? ` · Currently ${fmtMoney(applied)} (${(applied / list * 100).toFixed(1)}% of list)`
    : '';
  return `Engine LIST: ${fmtMoney(list)}${appliedPart} · Owner approval + reason required for any discount.`;
}
