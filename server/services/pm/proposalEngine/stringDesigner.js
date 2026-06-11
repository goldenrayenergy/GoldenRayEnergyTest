// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — String designer (§2.10 MVP-1 envelope-search algorithm)
//
// Replaces the naive modulo-6/5/4 heuristic in autoSizeSystem.js with an
// envelope-aware search that:
//   • respects the FULL electrical envelope (Voc cold + Vmp hot + MPPT current + Isc)
//   • prefers FEWER + LONGER strings (lower BoS cost, simpler install)
//   • falls back to ASYMMETRIC layouts only when no symmetric layout fits
//   • returns BEST-EFFORT with violations when no layout passes the envelope
//
// Inputs (catalogue objects, not just SKUs):
//   panel       — PANELS row (voc_stc, vmp_stc, isc_stc, imp_stc, temp coef)
//   inverter    — INVERTERS row (uoc_max_v, mppt_v_min, idc_max_a_per_mppt,
//                                isc_max_a_mppt*, mppt_count)
//   panelCount  — number of panels
//   region      — REGIONS row (t_min_celsius)
//   buffer      — multiplier on mppt_v_min (default 1.10 — 10% buffer)
//
// Output:
//   {
//     panels_per_string, string_count, topology, asymmetric,
//     asymmetric_string,
//     string_voc_cold, string_vmp_hot, mppt_current_per_mppt,
//     reason_code: 'optimal' | 'asymmetric_fallback' | 'no_valid_layout',
//     reason: <human-readable>,
//     violations: [...],   // empty when reason_code !== 'no_valid_layout'
//     alternatives: [{...layout summary...}]   // up to 3 runner-ups
//   }
//
// Pure function — no I/O, no DB.
// ────────────────────────────────────────────────────────────────────────────

const HOT_PANEL_CELSIUS = 70;
const DEFAULT_BUFFER = 1.10;
const STC_CELSIUS = 25;
const MIN_PANELS_PER_STRING = 4;  // Fronius hard rule
const ISC_SAFETY_FACTOR = 1.25;   // AS/NZS 5033 §3
const MAX_ALTERNATIVES = 3;

const r2 = (n) => +(+n).toFixed(2);

function vocAtColdTemp(panel, tMinCelsius) {
  const correction = 1 + Math.abs(panel.voltage_temp_coef_pct_per_c) / 100 *
                     (STC_CELSIUS - tMinCelsius);
  return panel.voc_stc * correction;
}

function vmpAtHotTemp(panel, tHotCelsius) {
  const correction = 1 - Math.abs(panel.voltage_temp_coef_pct_per_c) / 100 *
                     (tHotCelsius - STC_CELSIUS);
  return panel.vmp_stc * correction;
}

// Evaluate one candidate layout against the full envelope.
function evaluate(candidate, panel, inverter, region, buffer) {
  const tMin = region?.t_min_celsius ?? -10;
  const vocCold = vocAtColdTemp(panel, tMin);
  const vmpHot  = vmpAtHotTemp(panel, HOT_PANEL_CELSIUS);

  const ps = candidate.panels_per_string;
  const sc = candidate.string_count;

  const stringVocCold = vocCold * ps;
  const stringVmpHot  = vmpHot  * ps;

  // Topology: series if total strings fit one-per-MPPT; otherwise parallel.
  // For asymmetric, the short string counts as a +1 string.
  const totalStrings = sc + (candidate.asymmetric_string ? 1 : 0);
  const seriesFit = totalStrings <= (inverter.mppt_count || 2);
  const topology = seriesFit ? 'series' : 'parallel';
  const stringsPerMppt = seriesFit ? 1 : Math.ceil(totalStrings / (inverter.mppt_count || 2));

  const mppCurrentPerMppt = panel.imp_stc * stringsPerMppt;
  const iscSafetyPerMppt  = panel.isc_stc * stringsPerMppt * ISC_SAFETY_FACTOR;

  const violations = [];

  if (stringVocCold > inverter.uoc_max_v) {
    violations.push({
      code: 'voc_cold_exceeded',
      actual: r2(stringVocCold),
      limit:  inverter.uoc_max_v,
      message: `Voc at ${tMin}°C = ${r2(stringVocCold)}V > Uoc max ${inverter.uoc_max_v}V`,
    });
  }
  if (inverter.mppt_v_min != null && stringVmpHot < inverter.mppt_v_min * buffer) {
    const hard = stringVmpHot < inverter.mppt_v_min;
    violations.push({
      code: hard ? 'vmp_hot_below_floor' : 'vmp_hot_borderline',
      actual: r2(stringVmpHot),
      floor:  r2(inverter.mppt_v_min * buffer),
      hard_limit: inverter.mppt_v_min,
      message: hard
        ? `Vmp at ${HOT_PANEL_CELSIUS}°C = ${r2(stringVmpHot)}V < mppt_v_min ${inverter.mppt_v_min}V`
        : `Vmp at ${HOT_PANEL_CELSIUS}°C = ${r2(stringVmpHot)}V within 10% of mppt_v_min ${inverter.mppt_v_min}V`,
    });
  }
  // Asymmetric short string must also satisfy the same envelope.
  if (candidate.asymmetric_string) {
    const asymPs = candidate.asymmetric_string.panels_per_string;
    const asymVocCold = vocCold * asymPs;
    const asymVmpHot  = vmpHot * asymPs;
    if (asymVocCold > inverter.uoc_max_v) {
      violations.push({
        code: 'asym_voc_cold_exceeded',
        actual: r2(asymVocCold),
        limit:  inverter.uoc_max_v,
        message: `Asymmetric ${asymPs}-panel string Voc cold ${r2(asymVocCold)}V > Uoc max ${inverter.uoc_max_v}V`,
      });
    }
    if (inverter.mppt_v_min != null && asymVmpHot < inverter.mppt_v_min * buffer) {
      const hard = asymVmpHot < inverter.mppt_v_min;
      violations.push({
        code: hard ? 'asym_vmp_hot_below_floor' : 'asym_vmp_hot_borderline',
        actual: r2(asymVmpHot),
        floor:  r2(inverter.mppt_v_min * buffer),
        hard_limit: inverter.mppt_v_min,
        message: hard
          ? `Asymmetric ${asymPs}-panel string Vmp hot ${r2(asymVmpHot)}V < mppt_v_min ${inverter.mppt_v_min}V`
          : `Asymmetric ${asymPs}-panel string Vmp hot ${r2(asymVmpHot)}V borderline against mppt_v_min ${inverter.mppt_v_min}V`,
      });
    }
  }
  if (inverter.idc_max_a_per_mppt != null && mppCurrentPerMppt > inverter.idc_max_a_per_mppt) {
    violations.push({
      code: 'mppt_current_exceeded',
      actual: r2(mppCurrentPerMppt),
      limit:  inverter.idc_max_a_per_mppt,
      message: `MPP current ${r2(mppCurrentPerMppt)}A > IDC max ${inverter.idc_max_a_per_mppt}A`,
    });
  }
  const iscLimit = inverter.isc_max_a_mppt2 || inverter.isc_max_a_mppt1;
  if (iscLimit != null && iscSafetyPerMppt > iscLimit) {
    violations.push({
      code: 'isc_max_exceeded',
      actual: r2(iscSafetyPerMppt),
      limit:  iscLimit,
      message: `String Isc × 1.25 = ${r2(iscSafetyPerMppt)}A > ISC max ${iscLimit}A`,
    });
  }

  return {
    panels_per_string: ps,
    string_count: sc,
    asymmetric: candidate.asymmetric || false,
    asymmetric_string: candidate.asymmetric_string || null,
    topology,
    strings_per_mppt: stringsPerMppt,
    string_voc_cold: r2(stringVocCold),
    string_vmp_hot:  r2(stringVmpHot),
    mppt_current_per_mppt: r2(mppCurrentPerMppt),
    isc_safety_per_mppt:   r2(iscSafetyPerMppt),
    violations,
    passes: violations.length === 0,
  };
}

// Score: prefer fewer strings, then more panels per string.
// Negative for sorting ascending = best first.
function scoreLayout(layout) {
  return [layout.string_count, -layout.panels_per_string];
}

function compareLayouts(a, b) {
  const [a1, a2] = scoreLayout(a);
  const [b1, b2] = scoreLayout(b);
  return a1 - b1 || a2 - b2;
}

function summarizeAlt(layout) {
  return {
    panels_per_string: layout.panels_per_string,
    string_count:      layout.string_count,
    asymmetric:        layout.asymmetric,
    topology:          layout.topology,
    string_voc_cold:   layout.string_voc_cold,
    string_vmp_hot:    layout.string_vmp_hot,
  };
}

// ── Main entry ──────────────────────────────────────────────────────────────
export function recommendLayout({ panel, inverter, panelCount, region, buffer }) {
  buffer = buffer || DEFAULT_BUFFER;

  if (!panel || !inverter || !panelCount || panelCount < MIN_PANELS_PER_STRING) {
    return {
      panels_per_string: null,
      string_count: null,
      topology: null,
      reason_code: 'invalid_input',
      reason: 'panel, inverter, and panelCount (≥ 4) required',
      violations: [],
      alternatives: [],
    };
  }

  // 1. Generate symmetric candidates (panelCount % ps === 0)
  const symmetric = [];
  for (let ps = MIN_PANELS_PER_STRING; ps <= panelCount; ps++) {
    if (panelCount % ps === 0) {
      symmetric.push({ panels_per_string: ps, string_count: panelCount / ps });
    }
  }

  // 2. Evaluate symmetric
  const symEvaluated = symmetric.map(c => evaluate(c, panel, inverter, region, buffer));
  const symValid = symEvaluated.filter(e => e.passes);

  if (symValid.length > 0) {
    symValid.sort(compareLayouts);
    const best = symValid[0];
    const alternatives = symValid.slice(1, 1 + MAX_ALTERNATIVES).map(summarizeAlt);
    return {
      ...best,
      reason_code: 'optimal',
      reason: `Symmetric ${best.string_count} × ${best.panels_per_string} satisfies full envelope ` +
              `(Voc cold ${best.string_voc_cold}V, Vmp hot ${best.string_vmp_hot}V).`,
      alternatives,
    };
  }

  // 3. No symmetric layout: try asymmetric (one short string)
  const asymmetric = [];
  for (let ps = MIN_PANELS_PER_STRING; ps <= panelCount - MIN_PANELS_PER_STRING; ps++) {
    const remainder = panelCount % ps;
    if (remainder >= MIN_PANELS_PER_STRING && remainder !== ps) {
      const mainCount = Math.floor(panelCount / ps);
      asymmetric.push({
        panels_per_string: ps,
        string_count: mainCount,
        asymmetric: true,
        asymmetric_string: {
          panels_per_string: remainder,
          string_count: 1,
        },
      });
    }
  }

  const asymEvaluated = asymmetric.map(c => evaluate(c, panel, inverter, region, buffer));
  const asymValid = asymEvaluated.filter(e => e.passes);

  if (asymValid.length > 0) {
    asymValid.sort(compareLayouts);
    const best = asymValid[0];
    const alternatives = asymValid.slice(1, 1 + MAX_ALTERNATIVES).map(summarizeAlt);
    return {
      ...best,
      reason_code: 'asymmetric_fallback',
      reason: `No symmetric layout fits the envelope. ` +
              `Asymmetric: ${best.string_count} × ${best.panels_per_string} ` +
              `+ 1 × ${best.asymmetric_string.panels_per_string}.`,
      alternatives,
    };
  }

  // 4. Best-effort: pick layout with fewest violations
  const all = [...symEvaluated, ...asymEvaluated];
  if (all.length === 0) {
    return {
      panels_per_string: null,
      string_count: null,
      topology: null,
      reason_code: 'no_valid_layout',
      reason: `Cannot place ${panelCount} panels with minimum ${MIN_PANELS_PER_STRING}/string.`,
      violations: [],
      alternatives: [],
    };
  }
  all.sort((a, b) => a.violations.length - b.violations.length || compareLayouts(a, b));
  const best = all[0];
  return {
    ...best,
    reason_code: 'no_valid_layout',
    reason: `No layout satisfies the full envelope. Closest match: ` +
            `${best.string_count} × ${best.panels_per_string} with ` +
            `${best.violations.length} violation(s). ` +
            `Consider different inverter, different panel, or different panel count.`,
    alternatives: all.slice(1, 1 + MAX_ALTERNATIVES).map(summarizeAlt),
  };
}
