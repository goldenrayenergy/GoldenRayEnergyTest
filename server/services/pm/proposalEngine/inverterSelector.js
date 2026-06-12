// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Inverter selector (§2.8 MVP-1 decision tree)
//
// Replaces the rep's mental "which inverter to put on this quote" decision
// with the §2.8 decision tree:
//
//   1. Phase match     (1ph → Primo; 3ph → Symo / Verto)
//   2. Battery?        → require Plus variant (battery_capable === true)
//   3. AC kW           → closest to target_dc_kwp / DC_AC_ratio (default 1.30)
//   4. DC/AC envelope  → reject if would land outside [1.00, 1.50] (existing
//                        §2.9 rule kept verbatim per session decision)
//   5. MPPT count      → score bonus if mppt_count ≥ recommended string count
//   6. AS/NZS 4777.2   → all catalogue entries assumed certified for MVP-1
//   7. AC headroom     → if has_ev, prefer ac_kw with ≥ 7 kW spare
//
// Out-of-stock fallback (session decision: option a):
//   • dbLoader already filters by is_active = true, so "out of stock" SKUs
//     never reach the selector
//   • If the highest-scoring candidate had DC/AC > 1.50 (smaller inverter
//     forced because larger wasn't active), reason_code becomes
//     'dc_ac_out_of_envelope' so the rep is warned
//   • If no Plus variant exists for a battery quote, reason_code is
//     'no_plus_variant_in_phase' — rep must drop battery or switch phase
//
// Returns:
//   {
//     sku, inverter, reason_code, reason,
//     dc_ac_ratio, target_ac_kw,
//     alternatives: [{ sku, name, ac_kw, dc_ac_ratio, score }, ...],
//   }
//
// Pure function — no I/O, no DB.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_DC_AC_RATIO = 1.30;     // §2.9 sweet-spot midpoint
const DC_AC_HARD_MAX      = 1.50;     // existing §2.9 rule, no change
const DC_AC_HARD_MIN      = 1.00;     // undersized = wasted inverter
const DC_AC_SWEET_LOW     = 1.25;
const DC_AC_SWEET_HIGH    = 1.35;
const EV_AC_HEADROOM_KW   = 7;         // §2.13
const MAX_ALTERNATIVES    = 3;

function r2(n) { return +(+n).toFixed(2); }

function score(inv, targetDcKwp, targetAcKw, hasBattery, hasEv) {
  const dcAcRatio = targetDcKwp / inv.ac_kw;
  let s = 0;

  // 1. Closeness to target AC kW (closer = better). Each kW off = -10.
  s -= Math.abs(inv.ac_kw - targetAcKw) * 10;

  // 2. DC/AC ratio band.
  if (dcAcRatio > DC_AC_HARD_MAX) s -= 1000;    // outside envelope — last resort only
  else if (dcAcRatio < DC_AC_HARD_MIN) s -= 500; // undersized array on big inverter
  else if (dcAcRatio >= DC_AC_SWEET_LOW && dcAcRatio <= DC_AC_SWEET_HIGH) s += 50;
  else if (dcAcRatio > DC_AC_SWEET_HIGH && dcAcRatio <= 1.43) s += 25;  // standard oversize
  // 1.43–1.50 = reduced-mode oversize — neutral

  // 2b. Reduced-mode oversizing penalty. When targetDcKwp > max_pv_kwp_standard,
  //     Fronius requires reduced-mode operation which adds a string-Voc-STC
  //     ≤ 450V constraint. With high-Voc panels (e.g. 595W Phono Voc 53V) and
  //     normal string lengths, reduced-mode commonly hard-fails the engineering
  //     validator downstream. Prefer inverters whose max_pv_kwp_standard
  //     accommodates the target so the layout stays in standard mode.
  if (inv.max_pv_kwp_standard != null) {
    if (targetDcKwp <= inv.max_pv_kwp_standard) {
      s += 40;          // standard mode bonus
    } else {
      s -= 100;         // reduced-mode penalty (favours next inverter up)
    }
  }

  // 3. Plus variant bonus when battery requested; non-Plus bonus when not
  //    (Plus costs ~$1k more — for solar-only tiers, save the cost).
  if (hasBattery && inv.is_plus_variant) s += 20;
  else if (!hasBattery && !inv.is_plus_variant) s += 5;

  // 4. EV headroom bonus.
  if (hasEv && (inv.ac_kw - targetAcKw) >= EV_AC_HEADROOM_KW) s += 30;

  // 5. MPPT count — more MPPTs is better for design flexibility (Option 3
  //    multi-azimuth later). Soft tiebreaker.
  s += (inv.mppt_count || 0) * 2;

  return { score: s, dc_ac_ratio: dcAcRatio };
}

export function selectInverter({
  targetDcKwp, phase, hasBattery = false, hasEv = false,
  catalogue, dcAcTarget = DEFAULT_DC_AC_RATIO,
}) {
  if (!targetDcKwp || targetDcKwp <= 0) {
    return { sku: null, inverter: null, reason_code: 'invalid_input',
             reason: 'target_dc_kwp required (> 0)', alternatives: [] };
  }
  if (!phase || (phase !== 1 && phase !== 3)) {
    return { sku: null, inverter: null, reason_code: 'invalid_input',
             reason: 'phase must be 1 or 3', alternatives: [] };
  }
  if (!catalogue?.INVERTERS) {
    return { sku: null, inverter: null, reason_code: 'invalid_input',
             reason: 'catalogue.INVERTERS missing', alternatives: [] };
  }

  const targetAcKw = targetDcKwp / dcAcTarget;

  // 1. Filter by phase + (if battery) Plus variant
  let candidates = Object.entries(catalogue.INVERTERS)
    .map(([sku, inv]) => ({ sku, ...inv }))
    .filter(inv => inv.phase === phase && inv.ac_kw != null);

  if (hasBattery) {
    candidates = candidates.filter(inv =>
      inv.battery_capable === true || inv.is_plus_variant === true);
    if (candidates.length === 0) {
      return {
        sku: null, inverter: null,
        reason_code: 'no_plus_variant_in_phase',
        reason: `No Plus / battery-capable inverter available in ${phase}-phase. ` +
                `Drop the battery from this tier OR switch phase.`,
        target_ac_kw: r2(targetAcKw), alternatives: [],
      };
    }
  }

  if (candidates.length === 0) {
    return {
      sku: null, inverter: null,
      reason_code: 'no_inverter_in_phase',
      reason: `No active inverter found for ${phase}-phase in the catalogue.`,
      target_ac_kw: r2(targetAcKw), alternatives: [],
    };
  }

  // 2. Score + sort
  const scored = candidates
    .map(inv => ({ ...inv, ...score(inv, targetDcKwp, targetAcKw, hasBattery, hasEv) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const alternatives = scored.slice(1, 1 + MAX_ALTERNATIVES).map(c => ({
    sku: c.sku, name: c.name, ac_kw: c.ac_kw,
    dc_ac_ratio: r2(c.dc_ac_ratio), score: r2(c.score),
    is_plus_variant: c.is_plus_variant,
  }));

  // 3. Verdict
  const dcAcRatio = best.dc_ac_ratio;
  let reason_code = 'selected';
  let reason = `Selected ${best.name} (${best.ac_kw} kW). DC/AC ratio ${r2(dcAcRatio)} ` +
               `from ${r2(targetDcKwp)} kWp PV — within §2.9 envelope.`;

  if (dcAcRatio > DC_AC_HARD_MAX) {
    reason_code = 'dc_ac_out_of_envelope';
    reason = `Selected ${best.name} but DC/AC ratio ${r2(dcAcRatio)} exceeds ` +
             `§2.9 hard max ${DC_AC_HARD_MAX}. Larger inverter needed but none available — ` +
             `consider reducing panel count OR adding inverter SKU to catalogue.`;
  } else if (dcAcRatio < DC_AC_HARD_MIN) {
    reason_code = 'dc_ac_undersized';
    reason = `Selected ${best.name} but DC/AC ratio ${r2(dcAcRatio)} is below ${DC_AC_HARD_MIN}. ` +
             `Inverter is oversized for this array; consider a smaller inverter.`;
  }

  return {
    sku: best.sku,
    inverter: best,
    reason_code,
    reason,
    dc_ac_ratio: r2(dcAcRatio),
    target_ac_kw: r2(targetAcKw),
    dc_ac_target: dcAcTarget,
    alternatives,
  };
}
