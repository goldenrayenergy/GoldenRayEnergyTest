// ────────────────────────────────────────────────────────────────────────────
// fieldHints.js — inline hint generators for editable spec fields.
//
// Each hint surfaces THREE layers of context to the rep:
//   1. Hard allowed range  (engine rejects values outside this — see fieldLimits.js)
//   2. Typical NZ residential band  (informational best-practice — not enforced)
//   3. Engine pick + one-line derivation  (when the engine can derive a value)
//
// Hard limits MUST match server/services/pm/proposalEngine/fieldLimits.js.
// The duplication here is deliberate — client + server are separate bundles —
// but the values are kept in sync by convention. The constants below mirror
// fieldLimits.js exactly; bump in both places when changing.
// ────────────────────────────────────────────────────────────────────────────

// ── Mirrored from server/services/pm/proposalEngine/fieldLimits.js ─────────
// (kept here so the client doesn't need to fetch /api for a hint — keeps form
//  rendering instant. If a limit changes there, update here too.)
export const FIELD_LIMITS = {
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
// Pricing fields don't have static "typical bands" — the meaningful anchor is
// the engine-computed LIST price (HW×margins + BoS×1.3 + labour + GST). These
// hints surface it directly from the cost snapshot so the rep sees the floor /
// ceiling per the discount-cap rule (11% of list, recomputed every change).
//
// costSnapshot shape: the active tier's `engine.cost` block (or root cost for
// single-tier). Pass null if no engine run has happened yet — hint falls back
// to generic guidance.

const DISCOUNT_CAP_PCT = 11;   // memory rule: never freeze; always recompute

// Customer-facing price anchor — engine's LIST. Going BELOW list applies a
// discount (capped at 11%); going above is unusual and prompts owner review.
export function customerPriceHint(costSnapshot) {
  const list = costSnapshot?.totals?.total_list_inc_gst;
  if (!Number.isFinite(list)) {
    return 'Set the customer-facing total inc GST. Save once to see the engine LIST (HW + BoS + labour + GST), then the floor is LIST − 11%.';
  }
  const floor = list * (1 - DISCOUNT_CAP_PCT / 100);
  return `Engine LIST: ${fmtMoney(list)} · Floor (LIST − ${DISCOUNT_CAP_PCT}%): ${fmtMoney(floor)} · Below floor needs owner approval.`;
}

// Discount intake — anchor is 11% of LIST, recomputed on every spec change.
// Owner approval still required even within cap (admin-only flag).
export function discountHint(costSnapshot) {
  const list = costSnapshot?.totals?.total_list_inc_gst;
  if (!Number.isFinite(list)) {
    return `Enter the discount you've offered (NZD inc GST). Save once to see the cap (${DISCOUNT_CAP_PCT}% of engine LIST).`;
  }
  const cap = list * (DISCOUNT_CAP_PCT / 100);
  const declared = costSnapshot?.totals?.discount_applied_inc_gst;
  const declaredPart = Number.isFinite(declared) && declared > 0
    ? ` · Currently ${fmtMoney(declared)} (${(declared / list * 100).toFixed(1)}% of list)`
    : '';
  return `Cap: ${fmtMoney(cap)} (${DISCOUNT_CAP_PCT}% of ${fmtMoney(list)} LIST)${declaredPart} · Owner approval required if > 0.`;
}
