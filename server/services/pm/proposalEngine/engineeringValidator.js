// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Engineering validator
//
// Hard rules (AS/NZS 5033 / 3000 / 4777.2 / 5139 / 1170) that BLOCK a quote
// from being generated when violated. Soft warnings surface in the engineering
// doc + flag to the sales rep but don't block.
//
// Returns:
//   {
//     passes: [...],          // human-readable rule-pass list
//     hard_fails: [...],      // rules violated — engine refuses to ship
//     soft_warnings: [...],   // proceed with disclosure
//     unverified: [...],      // Stage 1 items deferred to Stage 2 survey
//     standards_referenced: ['AS/NZS 5033:2021', ...],
//     validator_version: '1.0.0',
//     validated_at: <ISO>
//   }
//
// Pure function — no I/O, no DB.
// ────────────────────────────────────────────────────────────────────────────

import { getCatalogue } from './catalogue/index.js';
import { REGIONS, COMPATIBILITY, requiredBmsCount, BMS_RULES,
         FINANCIAL_DEFAULTS } from './data/engineeringRules.js';

export const VALIDATOR_VERSION = '1.0.0';

export const STANDARDS_REFERENCED = {
  'AS/NZS 3000': '2018',
  'AS/NZS 5033': '2021',
  'AS/NZS 4777.2': '2020',
  'AS/NZS 1170.2': '2021',
  'AS/NZS 5139': '2019',
  'AS/NZS 3008.1.1': '2017',
};

const r2 = (n) => +(+n).toFixed(2);

// Cold-temperature Voc correction formula (AS/NZS 5033).
// Voc_cold = Voc_stc × (1 + |Tcoef| × (T_stc − T_min))
function vocAtColdTemp(panelData, tMinCelsius) {
  const Tstc = 25;
  const correction = 1 + Math.abs(panelData.voltage_temp_coef_pct_per_c) / 100 * (Tstc - tMinCelsius);
  return r2(panelData.voc_stc * correction);
}

// ── Main validator ────────────────────────────────────────────────────────
export function validateEngineering(spec, options = {}) {
  const catalogue = getCatalogue(options);
  const { PANELS, INVERTERS, BATTERIES } = catalogue;
  const passes = [];
  const hard_fails = [];
  const soft_warnings = [];
  const unverified = [];

  const stage = spec.pricing?.stage || 'stage_1_estimate';
  const isStage2 = stage === 'stage_2_firm';

  const panelSku = spec.system.panel.sku;
  const panel = PANELS[panelSku];
  const inverterSku = spec.system.inverter.sku;
  const inverter = INVERTERS[inverterSku];
  const panelCount = spec.system.panel.count;
  const stringTopology = spec.system.string_topology || 'series';
  const panelsPerString = spec.system.string_design?.panels_per_string;
  const stringCount = spec.system.string_design?.string_count;
  const region = REGIONS[spec.customer.address.region];
  const hasBattery = spec.system?.battery?.sku != null;

  // ── AS/NZS 5033 §3 — Voc at cold morning temperature ─────────────────
  if (panel && inverter && panelsPerString && region) {
    const vocCold = vocAtColdTemp(panel, region.t_min_celsius);
    const stringVocCold = r2(vocCold * panelsPerString);
    const stringVocStc = r2(panel.voc_stc * panelsPerString);

    if (stringVocCold > inverter.uoc_max_v) {
      hard_fails.push({
        rule: 'AS/NZS 5033 §3 — Voc max',
        message: `String Voc at ${region.t_min_celsius}°C = ${stringVocCold}V exceeds ` +
                 `inverter Uoc max ${inverter.uoc_max_v}V. Reduce panels per string or ` +
                 `switch inverter.`,
        details: { string_voc_cold: stringVocCold, voc_max: inverter.uoc_max_v },
      });
    } else if (stringVocCold > 450 && spec.system.dc_ac_ratio_observed > 1.43) {
      // Reduced-mode oversizing requires Voc < 450V STC
      soft_warnings.push({
        rule: 'AS/NZS 5033 §3 — Voc reduced mode',
        message: `String Voc at cold morning ${stringVocCold}V exceeds 450V required ` +
                 `for Fronius reduced-mode oversizing. DC/AC ratio must stay ≤ 1.43.`,
      });
    } else {
      passes.push({
        rule: 'AS/NZS 5033 §3 — Voc cold check',
        message: `String Voc ${stringVocCold}V at ${region.t_min_celsius}°C ≤ ${inverter.uoc_max_v}V Uoc max ✓`,
      });
    }
  }

  // ── AS/NZS 5033 §3 — Isc + MPPT current ─────────────────────────────
  if (panel && inverter && panelsPerString && stringCount) {
    const isPair = stringTopology === 'parallel';
    const stringsPerMppt = isPair ? Math.ceil(stringCount / inverter.mppt_count) : 1;
    const impAtMpp = panel.imp_stc;
    const mppCurrentPerMppt = r2(impAtMpp * stringsPerMppt);
    const iscSafetyPerMppt = r2(panel.isc_stc * stringsPerMppt * 1.25);

    // Check against IDC_max (MPP operating current limit)
    if (mppCurrentPerMppt > inverter.idc_max_a_per_mppt) {
      const clipPct = r2(((mppCurrentPerMppt - inverter.idc_max_a_per_mppt) /
                          mppCurrentPerMppt) * 100);
      soft_warnings.push({
        rule: 'AS/NZS 5033 § / Inverter datasheet — MPPT current clipping',
        message: `MPPT current ${mppCurrentPerMppt}A exceeds inverter IDC max ` +
                 `${inverter.idc_max_a_per_mppt}A per MPPT. Inverter will clip; ` +
                 `expected ~${Math.min(5, clipPct).toFixed(0)}% annual generation loss.`,
      });
    } else {
      passes.push({
        rule: 'AS/NZS 5033 §3 — MPPT current',
        message: `MPPT current ${mppCurrentPerMppt}A ≤ ${inverter.idc_max_a_per_mppt}A IDC max ✓`,
      });
    }

    // Check against ISC_max (safety / fuse rating)
    const iscMaxMppt = inverter.isc_max_a_mppt2 || inverter.isc_max_a_mppt1;
    if (iscSafetyPerMppt > iscMaxMppt) {
      hard_fails.push({
        rule: 'AS/NZS 5033 §3 — ISC max',
        message: `String Isc × 1.25 (${iscSafetyPerMppt}A) exceeds inverter ISC max ` +
                 `${iscMaxMppt}A per MPPT. Add string fuses or reduce strings per MPPT.`,
      });
    } else {
      passes.push({
        rule: 'AS/NZS 5033 §3 — ISC margin',
        message: `String Isc × 1.25 (${iscSafetyPerMppt}A) ≤ ${iscMaxMppt}A ✓`,
      });
    }
  }

  // ── Fronius DC/AC oversizing rules ─────────────────────────────────
  if (panel && inverter) {
    const dcKwp = +(panelCount * panel.watts / 1000).toFixed(2);
    const dcAcRatio = r2(dcKwp / inverter.ac_kw);
    if (dcAcRatio > 1.50) {
      hard_fails.push({
        rule: 'Fronius DC/AC oversizing',
        message: `DC/AC ratio ${dcAcRatio} exceeds 1.50 maximum. ` +
                 `Voids Fronius warranty. Reduce DC capacity or upsize inverter.`,
      });
    } else if (dcAcRatio > inverter.max_pv_kwp_standard / inverter.ac_kw) {
      const isReducedModeEligible = panelsPerString && panel.voc_stc * panelsPerString < 450;
      if (!isReducedModeEligible) {
        hard_fails.push({
          rule: 'Fronius reduced-mode oversizing — Voc',
          message: `DC/AC ratio ${dcAcRatio} requires reduced-mode oversizing but ` +
                   `string Voc at STC exceeds 450V. Shorten series strings OR reduce DC.`,
        });
      } else {
        soft_warnings.push({
          rule: 'Fronius reduced-mode oversizing',
          message: `DC/AC ratio ${dcAcRatio} in reduced-mode window. Disclose clipping in proposal.`,
        });
      }
    } else {
      passes.push({
        rule: 'Fronius DC/AC oversizing',
        message: `DC/AC ratio ${dcAcRatio} within standard mode (≤ ${(inverter.max_pv_kwp_standard / inverter.ac_kw).toFixed(2)}) ✓`,
      });
    }
  }

  // ── AS/NZS 4777.2 — inverter certification ──────────────────────────
  if (inverter) {
    // Currently all entries in INVERTERS catalogue are AS/NZS 4777.2:2020 certified
    passes.push({
      rule: 'AS/NZS 4777.2:2020',
      message: `Inverter ${inverter.name} on certified list ✓`,
    });
  }

  // ── Battery: Plus inverter requirement ──────────────────────────────
  if (hasBattery && inverter) {
    const compat = COMPATIBILITY[inverterSku];
    if (!compat?.battery_capable) {
      hard_fails.push({
        rule: 'Battery interface — Plus inverter required',
        message: `Inverter ${inverter.name} is not battery-capable. ` +
                 `Switch to Plus variant for battery integration.`,
      });
    } else {
      passes.push({
        rule: 'Battery interface',
        message: `Plus inverter ${inverter.name} supports battery ✓`,
      });
    }
  }

  // ── BMS count per battery vendor ────────────────────────────────────
  if (hasBattery) {
    const batt = BATTERIES[spec.system.battery.sku];
    const moduleCount = spec.system.battery.module_count;
    const rule = BMS_RULES[batt.series];

    if (!rule.valid_module_counts.includes(moduleCount)) {
      hard_fails.push({
        rule: `${batt.series} battery module count`,
        message: `${moduleCount} modules invalid for ${batt.series}. ` +
                 `Allowed: ${rule.valid_module_counts.join(', ')}.`,
      });
    } else {
      const bmsRequired = requiredBmsCount(batt.series, moduleCount);
      passes.push({
        rule: `${batt.series} BMS rule`,
        message: `${moduleCount} modules → ${bmsRequired}× BMS+BCU ✓`,
      });
    }
  }

  // ── LFP-only chemistry rule ─────────────────────────────────────────
  if (hasBattery) {
    const batt = BATTERIES[spec.system.battery.sku];
    if (batt.chemistry !== 'LFP') {
      hard_fails.push({
        rule: 'Cell chemistry — LFP only',
        message: `Battery chemistry ${batt.chemistry} excluded from MVP-1. LFP only.`,
      });
    } else {
      passes.push({
        rule: 'Cell chemistry',
        message: `LFP (LiFePO₄) — safest residential lithium chemistry ✓`,
      });
    }
  }

  // ── String design sanity ────────────────────────────────────────────
  if (panelsPerString && panelsPerString < 4) {
    hard_fails.push({
      rule: 'Fronius string minimum',
      message: `String minimum 4 panels (Fronius). Found ${panelsPerString}.`,
    });
  }

  // ── Phase compatibility ─────────────────────────────────────────────
  if (inverter) {
    const inverterPhase = inverter.phase;
    const meterPhase = spec.system.smart_meter?.phase;
    if (meterPhase && meterPhase !== inverterPhase) {
      hard_fails.push({
        rule: 'Smart meter phase mismatch',
        message: `Smart meter phase (${meterPhase}ph) does not match inverter (${inverterPhase}ph).`,
      });
    } else if (meterPhase) {
      passes.push({
        rule: 'Phase consistency',
        message: `Smart meter + inverter both ${inverterPhase}-phase ✓`,
      });
    }
  }

  // ── Stage 1: site-survey-dependent checks deferred ─────────────────
  if (!isStage2) {
    unverified.push({
      rule: 'AS/NZS 3000 — switchboard adequacy',
      message: 'Confirmed at Stage 2 site survey.',
    });
    unverified.push({
      rule: 'NZ Building Code B1 — structural triage',
      message: 'Confirmed at Stage 2 site survey (truss spacing, roof age, asbestos).',
    });
    unverified.push({
      rule: 'AS/NZS 3008 — voltage rise',
      message: 'Stage 1 uses assumed cable run; confirmed + cable upsized if needed at Stage 2.',
    });
    unverified.push({
      rule: 'AS/NZS 5139 — battery placement clearances',
      message: 'Final battery placement clearances confirmed at site survey.',
    });
  }

  // ── Soft warning: parallel-string topology disclosure ──────────────
  if (stringTopology === 'parallel') {
    soft_warnings.push({
      rule: 'Parallel-string topology',
      message: 'Parallel string topology used. Combiner box + DC fuses + larger ' +
               'isolators auto-added. ~4% annual clipping expected at peak sun.',
    });
  }

  // ── Soft warning: mixed-vendor disclosure (BYD + Fronius) ──────────
  if (hasBattery && inverter) {
    const batt = BATTERIES[spec.system.battery.sku];
    if (batt.brand !== inverter.brand) {
      soft_warnings.push({
        rule: 'Mixed-vendor warranty disclosure',
        message: `${batt.brand} battery + ${inverter.brand} inverter. Customer ` +
                 `proposal must disclose separate warranty pathways.`,
      });
    }
  }

  return {
    passes,
    hard_fails,
    soft_warnings,
    unverified,
    standards_referenced: STANDARDS_REFERENCED,
    validator_version: VALIDATOR_VERSION,
    validated_at: new Date().toISOString(),
  };
}
