// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Battery selector (Option 4b — §3.1 decision tree)
//
// Picks the battery SKU + module count for a quote.
//
// Selection logic (per session decision + §3.1):
//   1. Inverter must be battery-capable (Plus variant). Otherwise no battery
//      can be added; selector returns reason_code: 'inverter_not_plus'.
//   2. Compatibility: filter to battery series allowed for this inverter.
//      Uses explicit COMPATIBILITY map if present, else defaults to all LFP
//      (HVM, HVS, Reserva) per §3.5 cell chemistry rule (LFP only).
//   3. Sizing: for each compatible battery, compute the minimum module count
//      such that:
//        usable_kwh = module_count × module_kwh × dod_factor ≥ target_usable_kwh
//      where dod_factor = 1.00 for BYD HVM/HVS (100% DoD usable, §3.6) and
//      0.90 for Fronius Reserva (90% DoD usable, §3.6).
//   4. The chosen module count must be within BMS_RULES.valid_module_counts.
//   5. Score:
//        • lower $/kWh-usable → better (primary)
//        • more expansion headroom (chosen < modules_per_tower_max) → bonus
//        • mixed-vendor when inverter is Fronius and battery is BYD → small
//          penalty (warranty pathway is split; §3.12 disclosure required)
//   6. Return best + 3 alternatives + violations if no battery meets target.
//
// Returns:
//   {
//     sku, battery, module_count, total_usable_kwh, dod_factor,
//     reason_code, reason, dollars_per_usable_kwh,
//     target_usable_kwh,
//     alternatives: [...]
//   }
//
// Pure function — no I/O, no DB.
// ────────────────────────────────────────────────────────────────────────────

const MAX_ALTERNATIVES = 3;

function r2(n) { return +(+n).toFixed(2); }
function r0(n) { return Math.round(+n); }

// §3.6 round-trip + depth of discharge
function dodFactor(series) {
  if (series === 'HVM' || series === 'HVS') return 1.00;
  if (series === 'Reserva') return 0.90;
  return 1.00;  // unknown LFP — assume conservative 100% DoD
}

function summarizeAlt(c) {
  return {
    sku: c.sku,
    name: c.name,
    brand: c.brand,
    series: c.series,
    module_count: c.module_count,
    total_usable_kwh: r2(c.total_usable_kwh),
    dollars_per_usable_kwh: r0(c.dollars_per_usable_kwh),
    headroom_pct: r0(c.headroom * 100),
  };
}

export function selectBattery({
  targetUsableKwh,
  inverter,
  catalogue,
  COMPATIBILITY,
  BMS_RULES,
}) {
  if (!inverter) {
    return {
      sku: null, battery: null,
      reason_code: 'no_inverter',
      reason: 'Inverter required before battery can be selected.', alternatives: [],
    };
  }
  if (!(inverter.battery_capable === true || inverter.is_plus_variant === true)) {
    return {
      sku: null, battery: null,
      reason_code: 'inverter_not_plus',
      reason: `Inverter ${inverter.name || inverter.sku} is not battery-capable. ` +
              `Switch to a Plus variant to add a battery.`,
      alternatives: [],
    };
  }
  if (!targetUsableKwh || targetUsableKwh <= 0) {
    return {
      sku: null, battery: null,
      reason_code: 'invalid_input',
      reason: 'target_usable_kwh required (> 0)', alternatives: [],
    };
  }
  if (!catalogue?.BATTERIES) {
    return {
      sku: null, battery: null,
      reason_code: 'invalid_input',
      reason: 'catalogue.BATTERIES missing', alternatives: [],
    };
  }

  // Compatibility: explicit list per inverter if available, else default LFP set
  const explicit = COMPATIBILITY?.[inverter.sku]?.compatible_battery_series;
  const compatSeries = explicit && explicit.length > 0
    ? explicit
    : ['HVM', 'HVS', 'Reserva'];

  const batteries = Object.entries(catalogue.BATTERIES)
    .map(([sku, b]) => ({ sku, ...b }))
    .filter(b => compatSeries.includes(b.series))
    .filter(b => (b.chemistry || 'LFP') === 'LFP');  // §3.5 LFP only

  if (batteries.length === 0) {
    return {
      sku: null, battery: null,
      reason_code: 'no_compatible_battery',
      reason: `No LFP battery in catalogue compatible with ${inverter.name || inverter.sku}.`,
      alternatives: [],
    };
  }

  // Score every compatible battery
  const scored = [];
  for (const b of batteries) {
    const rule = BMS_RULES?.[b.series];
    if (!rule || !rule.valid_module_counts) continue;
    const dod = dodFactor(b.series);

    // Minimum modules to satisfy target_usable_kwh
    const requiredNominalKwh = targetUsableKwh / dod;
    const minModules = Math.ceil(requiredNominalKwh / b.module_kwh);
    const chosenCount = rule.valid_module_counts.find(c => c >= minModules);
    if (!chosenCount) continue;  // can't satisfy target

    const totalNominalKwh = chosenCount * b.module_kwh;
    const totalUsableKwh  = totalNominalKwh * dod;
    const totalCost = Number(b.cost_nzd || 0) * chosenCount *
                      (1 + Number(b.margin_pct || 30) / 100);
    const dollarsPerUsableKwh = totalUsableKwh > 0 ? totalCost / totalUsableKwh : Infinity;

    const maxModules = rule.modules_per_tower_max || chosenCount;
    const headroom = (maxModules - chosenCount) / maxModules;  // 0..1

    // §3.12 mixed-vendor penalty: small score deduction (rep still sees option)
    const mixedVendor = inverter.brand && b.brand && inverter.brand !== b.brand;

    let score = -dollarsPerUsableKwh + headroom * 50 + (mixedVendor ? -10 : 0);

    scored.push({
      ...b,
      module_count: chosenCount,
      total_nominal_kwh: totalNominalKwh,
      total_usable_kwh: totalUsableKwh,
      dollars_per_usable_kwh: dollarsPerUsableKwh,
      headroom,
      dod_factor: dod,
      mixed_vendor: mixedVendor,
      score,
    });
  }

  if (scored.length === 0) {
    return {
      sku: null, battery: null,
      reason_code: 'cannot_meet_target',
      reason: `No compatible battery can reach ${r2(targetUsableKwh)} kWh usable ` +
              `within BMS module-count rules. Consider smaller target or different ` +
              `inverter compatibility list.`,
      target_usable_kwh: r2(targetUsableKwh),
      alternatives: [],
    };
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  const reasonParts = [
    `${best.name} × ${best.module_count} modules = ${r2(best.total_usable_kwh)} kWh usable`,
    `(${r0(best.dod_factor * 100)}% DoD)`,
    `at $${r0(best.dollars_per_usable_kwh)}/kWh-usable`,
  ];
  if (best.headroom > 0) {
    reasonParts.push(`with ${r0(best.headroom * 100)}% expansion headroom (§3.14)`);
  }
  if (best.mixed_vendor) {
    reasonParts.push(`— mixed-vendor (§3.12 disclosure required)`);
  }

  return {
    sku: best.sku,
    battery: best,
    module_count: best.module_count,
    total_usable_kwh: r2(best.total_usable_kwh),
    total_nominal_kwh: r2(best.total_nominal_kwh),
    dod_factor: best.dod_factor,
    dollars_per_usable_kwh: r0(best.dollars_per_usable_kwh),
    reason_code: 'selected',
    reason: reasonParts.join(' '),
    target_usable_kwh: r2(targetUsableKwh),
    alternatives: scored.slice(1, 1 + MAX_ALTERNATIVES).map(summarizeAlt),
  };
}
