// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — BoM (Bill of Materials) builder
//
// Given a spec, derive the full materials list including:
//   - Major hardware (panels, inverter, battery modules, BMS, smart meter)
//   - BoS items (isolators, SPDs, cables, conduit, mounting kit, etc.) with
//     quantities calculated per system size
//   - Optional accessories (EV charger, diverter for non-battery quotes)
//
// Pure function — no I/O.
//
// MVP1_003 (P3c): Two BoS-picking paths.
//   - JS-fallback catalogue (legacy) → hardcoded SKUs (preserves all tests
//     and existing engine behaviour exactly)
//   - DB catalogue              → role-based pickers via bosRoles.js so the
//     engine works against whatever SKUs admin has in the products table
//
// Sniff: if the catalogue contains the canonical legacy SKU 'HOP-TIN-KIT-4P'
// we're in JS-fallback mode; otherwise DB mode.
// ────────────────────────────────────────────────────────────────────────────

import { getCatalogue } from './catalogue/index.js';
import { findBosByRole, findBmsForBattery } from './catalogue/bosRoles.js';
import { requiredBmsCount, BMS_RULES } from './data/engineeringRules.js';

// Sniff: legacy JS-fallback catalogue contains the canonical seed SKU.
function isLegacyJsCatalogue(catalogue) {
  return !!(catalogue.BOS_ITEMS && catalogue.BOS_ITEMS['HOP-TIN-KIT-4P']);
}

// Returns a list of { sku, qty, reason, group } for the engine to cost.
// `options.warnings` (optional) — array that receives BoS picker warnings.
export function buildBom(spec, options = {}) {
  const catalogue = getCatalogue(options);
  const { BATTERIES } = catalogue;
  const items = [];
  const warnings = options.warnings || [];

  const panels = spec.system.panel.count;
  const inverter_sku = spec.system.inverter.sku;
  const hasBattery = spec.system?.battery?.sku != null;
  const topology = spec.system.string_topology || 'series';
  const cableRun = spec.system.cable_run_metres_estimate || 24;
  const legacy = isLegacyJsCatalogue(catalogue);

  // Helper: pick BoS item — legacy by SKU, modern by role.
  function pushBos(legacySku, role, qty, reasonFn, group = 'bos') {
    if (legacy) {
      // Legacy SKU path — preserves exact pre-P3c behaviour for tests
      const item = catalogue.BOS_ITEMS?.[legacySku];
      if (!item) {
        warnings.push({ severity: 'warn', code: 'legacy_sku_missing',
                        message: `Legacy SKU ${legacySku} not in catalogue.` });
        return;
      }
      items.push({
        sku: legacySku, qty,
        reason: reasonFn ? reasonFn(item) : item.name,
        group,
      });
      return;
    }
    // DB path — role-based pick
    const item = findBosByRole(catalogue, role);
    if (!item) {
      warnings.push({ severity: 'warn', code: 'bos_role_unmatched',
                      message: `No catalogue match for BoS role '${role}' — line skipped.` });
      return;
    }
    items.push({
      sku: item.sku, qty,
      reason: reasonFn ? reasonFn(item) : item.name,
      group,
    });
  }

  // ── Major hardware ─────────────────────────────────────────────────────
  items.push({
    sku: spec.system.panel.sku,
    qty: panels,
    reason: `${panels} solar panels`,
    group: 'hardware',
  });
  items.push({
    sku: inverter_sku,
    qty: 1,
    reason: 'Hybrid inverter',
    group: 'hardware',
  });

  if (hasBattery) {
    const batt = BATTERIES[spec.system.battery.sku];
    if (!batt) {
      warnings.push({ severity: 'error', code: 'battery_sku_unknown',
                      message: `Battery SKU ${spec.system.battery.sku} not in catalogue.` });
    } else {
      const moduleCount = spec.system.battery.module_count;
      items.push({
        sku: spec.system.battery.sku,
        qty: moduleCount,
        reason: `${moduleCount} battery modules (${(moduleCount * batt.module_kwh).toFixed(2)} kWh)`,
        group: 'hardware',
      });

      // BMS controller — legacy uses BMS_RULES.bms_sku, DB picks by series.
      // Missing-BMS is a HARD error on battery quotes: every certified lithium
      // battery system requires a BMS controller per AS/NZS 5139. The
      // engineeringValidator picks up `severity: 'error'` warnings emitted
      // here and surfaces them as hard_fails so the engine refuses to ship.
      const bmsCount = requiredBmsCount(batt.series, moduleCount);
      let bmsSku = null;
      if (legacy) {
        bmsSku = BMS_RULES[batt.series]?.bms_sku;
        // Legacy path: also require the row to actually exist in the catalogue.
        // Without this, a BMS_RULES.bms_sku pointing at a deleted row would
        // silently push a phantom BoM line that costEngine would later fail on.
        if (bmsSku && !catalogue.BMS_CONTROLLERS?.[bmsSku]) {
          warnings.push({ severity: 'error', code: 'bms_unmatched',
                          message: `BMS_RULES.${batt.series}.bms_sku='${bmsSku}' is not in the ` +
                                   `catalogue. Add the row before this quote can ship.` });
          bmsSku = null;
        }
      } else {
        const bmsItem = findBmsForBattery(catalogue, batt.series);
        bmsSku = bmsItem?.sku;
        if (!bmsItem) {
          warnings.push({ severity: 'error', code: 'bms_unmatched',
                          message: `No BMS controller in catalogue for battery series ${batt.series}. ` +
                                   `Add a product row with specs.for_battery_series='${batt.series}' before ` +
                                   `this quote can ship.` });
        }
      }
      if (bmsSku && bmsCount && bmsCount > 0) {
        items.push({
          sku: bmsSku, qty: bmsCount,
          reason: `${bmsCount}× BMS+BCU required for ${moduleCount} ${batt.series} modules`,
          group: 'hardware',
        });
      }
    }
  }

  // Smart meter (default 1ph if not specified)
  const meterSku = spec.system.smart_meter?.sku || 'FRN-MTR-63-S1P';
  items.push({
    sku: meterSku,
    qty: 1,
    reason: 'Bidirectional smart meter',
    group: 'hardware',
  });

  // ── BoS items (legacy SKU or role-based depending on catalogue) ────────
  pushBos('HOP-TIN-KIT-4P', 'mounting_kit_4p', Math.ceil(panels / 4),
    () => `${panels} panels ÷ 4 = ${Math.ceil(panels / 4)} mounting kits`);

  pushBos('SLF-BOS-32-30M', 'dc_conduit_30m', 1,
    () => '30m pre-wired DC conduit (standard run)');

  pushBos('GEN-BOS-MC4', 'mc4_connector_pack', 1,
    () => 'MC4 connector bulk pack');

  pushBos('GEN-BOS-40-DC', 'dc_isolator_rooftop', 1,
    () => 'Rooftop DC isolator');

  // Pick 1ph or 3ph AC isolator based on smart meter phase
  const phase = spec.system?.smart_meter?.phase || spec.system?.phase || 1;
  pushBos(
    phase === 3 ? 'GEN-BOS-40-T3P-AC' : 'GEN-BOS-40-S1P-AC',
    phase === 3 ? 'ac_isolator_3ph' : 'ac_isolator_1ph',
    1,
    () => 'Switchboard AC isolator');

  pushBos('GEN-BOS-SPD-AC', 'ac_spd', 1,
    () => 'AC surge protection');

  pushBos('GEN-BOS-SPD-DC', 'dc_spd', 1,
    () => 'DC surge protection');

  pushBos('ECS-BOS-ENC', 'enclosure_pv', 1,
    () => 'IP65 enclosure for SPDs + isolators');

  pushBos('GEN-RCK-SEAL-EPD-B', 'roof_seal_per_panel', panels,
    () => `1 EPDM seal per panel mount (${panels} panels)`);

  pushBos('GEN-BOS-CABLE-AC', 'ac_cable_per_metre', cableRun,
    () => `${cableRun}m AC cable run inverter → switchboard`);

  pushBos('GEN-BOS-LABEL', 'label_kit', 1,
    () => 'AS/NZS 4777 compliance labels');

  pushBos('GEN-BOS-EARTH', 'earth_rod_kit', 1,
    () => 'Earth rod + bonding cable');

  pushBos('GEN-BOS-SUNDRY', 'sundries', 1,
    () => 'Cable ties, glands, sealants');

  // ── Parallel topology surcharge bundle ─────────────────────────────────
  if (topology === 'parallel') {
    pushBos('GEN-BOS-COMBINER', 'combiner_box', 1,
      () => 'DC string combiner box + DC fuses for parallel-string topology');
  }

  // ── Wattpilot EV charger (optional) ────────────────────────────────────
  if (spec.system.wattpilot_included) {
    if (legacy) {
      const wattSku = (spec.system.phase || 1) === 1 ? 'FRN-EV-WATTPILOT-11' : 'FRN-EV-WATTPILOT-11';
      items.push({
        sku: wattSku, qty: 1,
        reason: 'Fronius Wattpilot EV charger',
        group: 'hardware',
      });
    } else {
      const ev = Object.values(catalogue.EV_CHARGERS || {})[0];
      if (ev) {
        items.push({
          sku: ev.sku, qty: 1,
          reason: `EV charger (${ev.name})`,
          group: 'hardware',
        });
      }
    }
  }

  // ── Hot water diverter for non-battery quotes ──────────────────────────
  if (!hasBattery && spec.system.diverter_included !== false) {
    if (legacy) {
      items.push({
        sku: 'CTP-ACC-DIVERTER', qty: 1,
        reason: 'Hot water diverter (auto-added for non-battery quotes per §2.18)',
        group: 'hardware',
      });
    } else {
      const diverter = findBosByRole(catalogue, 'hot_water_diverter');
      if (diverter) {
        items.push({
          sku: diverter.sku, qty: 1,
          reason: `Hot water diverter (${diverter.name})`,
          group: 'hardware',
        });
      } else {
        warnings.push({ severity: 'warn', code: 'diverter_unmatched',
                        message: 'No hot water diverter in catalogue — line skipped.' });
      }
    }
  }

  return items;
}
