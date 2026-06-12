// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Panel selector (Option 4b)
//
// Picks the panel SKU for a quote when the rep hasn't manually chosen.
//
// Selection logic (per session decision: "no defaults — engine recommends"):
//   1. Filter to panels with all required engineering specs populated
//      (voc_stc, vmp_stc, isc_stc, imp_stc, watts, voltage_temp_coef).
//      Panels without specs are unusable by Option 1/2 envelope checks.
//   2. Primary sort: highest wattage first (fewer panels → less BoS, labour,
//      roof area). This matches the field guidance "highest-wattage usually
//      wins".
//   3. Tiebreaker: lowest $/kWp (sell price ÷ kWp per panel).
//   4. Return top pick + 3 alternatives + per-candidate panels_needed for
//      the requested target_kwp (informational).
//
// Returns:
//   {
//     sku, panel, reason_code, reason,
//     target_kwp, panels_needed,
//     alternatives: [{ sku, name, watts, dollars_per_kwp, panels_needed, ... }, ...],
//   }
//
// Pure function — no I/O, no DB.
// ────────────────────────────────────────────────────────────────────────────

const MAX_ALTERNATIVES = 3;

function r2(n) { return +(+n).toFixed(2); }
function r0(n) { return Math.round(+n); }

function hasRequiredSpecs(p) {
  return p.watts && p.voc_stc && p.vmp_stc && p.isc_stc && p.imp_stc &&
         p.voltage_temp_coef_pct_per_c != null;
}

function dollarsPerKwp(p) {
  const sell = Number(p.cost_nzd || 0) * (1 + Number(p.margin_pct || 30) / 100);
  const kwpPerPanel = Number(p.watts || 0) / 1000;
  if (kwpPerPanel <= 0) return Infinity;
  return sell / kwpPerPanel;
}

function summarizeAlt(c, targetKwp) {
  return {
    sku: c.sku,
    name: c.name,
    brand: c.brand,
    watts: c.watts,
    dollars_per_kwp: r0(c.dollars_per_kwp),
    panels_needed: targetKwp ? Math.ceil(targetKwp / (c.watts / 1000)) : null,
  };
}

export function selectPanel({ catalogue, targetKwp }) {
  if (!catalogue?.PANELS) {
    return {
      sku: null, panel: null,
      reason_code: 'invalid_input',
      reason: 'catalogue.PANELS missing', alternatives: [],
    };
  }

  const candidates = Object.entries(catalogue.PANELS)
    .map(([sku, p]) => ({ sku, ...p }))
    .filter(hasRequiredSpecs)
    .map(p => ({ ...p, dollars_per_kwp: dollarsPerKwp(p) }));

  if (candidates.length === 0) {
    return {
      sku: null, panel: null,
      reason_code: 'no_active_panels',
      reason: 'No panel in the catalogue has the engineering specs populated ' +
              '(voc_stc, vmp_stc, isc_stc, imp_stc, voltage_temp_coef). ' +
              'Fill specs via admin import before this engine can pick.',
      alternatives: [],
    };
  }

  // Sort: watts desc, then $/kWp asc
  candidates.sort((a, b) => (b.watts - a.watts) || (a.dollars_per_kwp - b.dollars_per_kwp));

  const best = candidates[0];
  const panelsNeeded = targetKwp ? Math.ceil(targetKwp / (best.watts / 1000)) : null;

  return {
    sku: best.sku,
    panel: best,
    reason_code: 'selected',
    reason: `Highest-wattage panel with full specs: ${best.name} (${best.watts}W) at ` +
            `$${r0(best.dollars_per_kwp)}/kWp.${
              targetKwp ? ` Needs ~${panelsNeeded} panels for ${r2(targetKwp)} kWp target.` : ''
            }`,
    target_kwp: targetKwp ? r2(targetKwp) : null,
    panels_needed: panelsNeeded,
    dollars_per_kwp: r0(best.dollars_per_kwp),
    alternatives: candidates.slice(1, 1 + MAX_ALTERNATIVES).map(c => summarizeAlt(c, targetKwp)),
  };
}
