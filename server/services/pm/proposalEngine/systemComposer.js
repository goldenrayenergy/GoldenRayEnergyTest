// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — System composer (Option 4c — full-system orchestration)
//
// One pure-function call that chains every Option 4 selector into a complete
// tier-ready system. Loads the catalogue once (caller does), then runs:
//
//     panel  → inverter  → battery (if requested)  → string layout
//
// Output is everything a single tier card needs.
//
// Inputs:
//   targetDcKwp                — required, drives everything downstream
//   phase                      — 1 or 3
//   targetBatteryUsableKwh     — optional. null → no battery in this tier
//   hasEv                      — optional. Tier 3 only.
//   region                     — REGIONS row (for string layout cold-temp check)
//   catalogue                  — loaded by caller (loadCatalogueFromDb)
//   COMPATIBILITY, BMS_RULES   — battery-selector inputs
//
// Output:
//   {
//     panel:    { sku, count }              | null,
//     inverter: { sku }                     | null,
//     battery:  { sku, module_count, kwh }  | null,
//     string_design: { panels_per_string, string_count, topology } | null,
//     wattpilot_included: bool,
//     reasons:  { panel, inverter, battery, string },
//     warnings: [{ code, message }],
//     inputs_resolved: { target_dc_kwp, phase, has_battery, has_ev, ... },
//   }
//
// Failure modes:
//   • A sub-selector returning a non-'selected' reason_code is captured as
//     a warning + the corresponding field is null. Downstream tiers still
//     render — rep sees the gap rather than a crash.
//
// Pure function — no I/O, no DB.
// ────────────────────────────────────────────────────────────────────────────

import { selectPanel }     from './panelSelector.js';
import { selectInverter }  from './inverterSelector.js';
import { selectBattery }   from './batterySelector.js';
import { recommendLayout } from './stringDesigner.js';

const r2 = (n) => +(+n).toFixed(2);

export function composeSystem({
  targetDcKwp,
  phase,
  targetBatteryUsableKwh = null,
  hasEv = false,
  region,
  catalogue,
  COMPATIBILITY,
  BMS_RULES,
}) {
  const warnings = [];
  const reasons  = {};
  const hasBattery = targetBatteryUsableKwh != null && targetBatteryUsableKwh > 0;

  // 1. Panel — highest-watt with full specs
  const panelResult = selectPanel({ catalogue, targetKwp: targetDcKwp });
  reasons.panel = panelResult.reason;
  if (panelResult.reason_code !== 'selected') {
    warnings.push({ code: 'panel_' + panelResult.reason_code, message: panelResult.reason });
    return { panel: null, inverter: null, battery: null, string_design: null,
             wattpilot_included: false, reasons, warnings,
             inputs_resolved: makeInputsResolved(targetDcKwp, phase, hasBattery, hasEv) };
  }
  const panel = { sku: panelResult.sku, count: panelResult.panels_needed };

  // 2. Inverter — §2.8 decision tree
  const invResult = selectInverter({
    targetDcKwp, phase,
    hasBattery, hasEv,
    catalogue,
  });
  reasons.inverter = invResult.reason;
  if (invResult.reason_code === 'no_plus_variant_in_phase' ||
      invResult.reason_code === 'no_inverter_in_phase') {
    warnings.push({ code: 'inverter_' + invResult.reason_code, message: invResult.reason });
    return { panel, inverter: null, battery: null, string_design: null,
             wattpilot_included: false, reasons, warnings,
             inputs_resolved: makeInputsResolved(targetDcKwp, phase, hasBattery, hasEv) };
  }
  // dc_ac_out_of_envelope / dc_ac_undersized still let us continue — surface as warning
  if (invResult.reason_code !== 'selected') {
    warnings.push({ code: 'inverter_' + invResult.reason_code, message: invResult.reason });
  }
  const inverter = { sku: invResult.sku };
  const inverterFull = { ...invResult.inverter, sku: invResult.sku };

  // 3. Battery (only if requested)
  let battery = null;
  if (hasBattery) {
    const batResult = selectBattery({
      targetUsableKwh: targetBatteryUsableKwh,
      inverter: inverterFull,
      catalogue, COMPATIBILITY, BMS_RULES,
    });
    reasons.battery = batResult.reason;
    if (batResult.reason_code === 'selected') {
      battery = {
        sku: batResult.sku,
        module_count: batResult.module_count,
        kwh: r2(batResult.total_usable_kwh),
      };
    } else {
      warnings.push({ code: 'battery_' + batResult.reason_code, message: batResult.reason });
    }
  }

  // 4. String layout — §2.10 envelope search
  let stringDesign = null;
  if (panel.sku && inverter.sku && panel.count) {
    const panelFull    = catalogue.PANELS[panel.sku];
    const layoutResult = recommendLayout({
      panel: panelFull,
      inverter: inverterFull,
      panelCount: panel.count,
      region,
    });
    reasons.string = layoutResult.reason;
    if (layoutResult.reason_code === 'optimal' ||
        layoutResult.reason_code === 'asymmetric_fallback') {
      stringDesign = {
        panels_per_string: layoutResult.panels_per_string,
        string_count:      layoutResult.string_count,
        topology:          layoutResult.topology,
      };
    } else {
      warnings.push({ code: 'string_' + layoutResult.reason_code, message: layoutResult.reason });
    }
  }

  return {
    panel,
    inverter,
    battery,
    string_design: stringDesign,
    wattpilot_included: !!hasEv,
    reasons,
    warnings,
    inputs_resolved: makeInputsResolved(targetDcKwp, phase, hasBattery, hasEv),
  };
}

function makeInputsResolved(targetDcKwp, phase, hasBattery, hasEv) {
  return {
    target_dc_kwp: r2(targetDcKwp || 0),
    phase: phase || null,
    has_battery: !!hasBattery,
    has_ev: !!hasEv,
  };
}
