// Package validator — applies engineering + business rules to a proposed package.
//
// A "package" for validation purposes is:
//   {
//     panel_sku: string,
//     panel_qty: number,
//     inverter_sku: string,
//     battery_system_sku?: string,   // optional — solar-only if omitted
//     smart_meter_sku?: string,      // optional — validator suggests if missing
//     site_phase?: 1 | 3,            // optional — usually from bill_analyses.connection_type
//     roof_type?: 'metal'|'tile'|'tin'|'asphalt',  // for racking BOM check
//     racking_items?: [{ sku, qty }] // optional — package's racking BOM
//   }
//
// Returns:
//   {
//     ok: boolean,
//     errors:   [{ code, message, ... }]   // hard violations, must fix
//     warnings: [{ code, message, ... }]   // soft — flag but don't block
//     summary:  { ... }                    // computed numbers (kW DC, kW AC, panels/MPPT, etc.)
//   }

import {
  getProduct, getBatterySystem, checkCompat,
  recommendedSmartMeterSku, computeRackingBom, summariseRackingItems,
} from './packageCompatService.js';

const DC_AC_HARD_LIMIT = 1.25;   // hard cap — manufacturers may void warranty above this
const DC_AC_SOFT_WARN  = 1.05;   // warning threshold — typical safe ratio is ≤ 1.05

export async function validatePackage(pkg) {
  const errors = [];
  const warnings = [];
  const summary = {};

  // ── 1. Panel ──────────────────────────────────────────────────────────
  if (!pkg.panel_sku || !pkg.panel_qty || pkg.panel_qty < 1) {
    errors.push({ code: 'PANEL_MISSING', message: 'panel_sku and panel_qty are required (qty >= 1)' });
    return finalize(errors, warnings, summary);
  }
  const panel = await getProduct(pkg.panel_sku);
  if (!panel) {
    errors.push({ code: 'PANEL_NOT_FOUND', message: `Panel SKU not in catalogue: ${pkg.panel_sku}` });
    return finalize(errors, warnings, summary);
  }
  if (panel.is_active === false) {
    errors.push({ code: 'PANEL_INACTIVE', message: `Panel ${panel.sku} is_active=false (deactivated)` });
  }
  const wattage = Number(panel.specs?.wattage_w);
  if (!wattage || wattage < 100) {
    errors.push({ code: 'PANEL_NO_WATTAGE', message: `Panel ${panel.sku} has no wattage_w in specs — fill it before pricing` });
    return finalize(errors, warnings, summary);
  }
  summary.panel = { sku: panel.sku, name: panel.name, brand: panel.brand, wattage_w: wattage, qty: pkg.panel_qty };
  summary.total_dc_w  = wattage * pkg.panel_qty;
  summary.total_dc_kw = +(summary.total_dc_w / 1000).toFixed(3);

  // ── 2. Inverter ───────────────────────────────────────────────────────
  if (!pkg.inverter_sku) {
    errors.push({ code: 'INVERTER_MISSING', message: 'inverter_sku is required' });
    return finalize(errors, warnings, summary);
  }
  const inverter = await getProduct(pkg.inverter_sku);
  if (!inverter) {
    errors.push({ code: 'INVERTER_NOT_FOUND', message: `Inverter SKU not in catalogue: ${pkg.inverter_sku}` });
    return finalize(errors, warnings, summary);
  }
  if (inverter.is_active === false) {
    errors.push({ code: 'INVERTER_INACTIVE', message: `Inverter ${inverter.sku} is deactivated` });
  }
  const ispec = inverter.specs || {};
  const rated_kw   = Number(ispec.rated_kw);
  const max_dc_kw  = Number(ispec.max_dc_kw);
  const mppts      = Number(ispec.mppts);
  const panels_per_mppt_max = Number(ispec.panels_per_mppt_max);
  const phase = ispec.phase;
  const hybrid_ready = !!ispec.hybrid_ready;
  summary.inverter = {
    sku: inverter.sku, name: inverter.name, rated_kw, max_dc_kw, mppts, phase,
    hybrid_ready, hybrid_status: ispec.hybrid_status || null,
    panels_per_mppt_max,
    panels_per_mppt_assumption_w: ispec.panels_per_mppt_assumption_w || null,
  };
  if (!rated_kw)  warnings.push({ code: 'INV_NO_RATED_KW',  message: `Inverter ${inverter.sku} missing rated_kw in specs` });
  if (!max_dc_kw) warnings.push({ code: 'INV_NO_MAX_DC',    message: `Inverter ${inverter.sku} missing max_dc_kw — cannot enforce DC/AC ratio` });
  if (!mppts)     warnings.push({ code: 'INV_NO_MPPTS',     message: `Inverter ${inverter.sku} missing mppts in specs` });

  // ── 3. DC/AC ratio + MPPT capacity ────────────────────────────────────
  if (max_dc_kw && summary.total_dc_kw) {
    const ratio = summary.total_dc_kw / max_dc_kw;
    summary.dc_max_ratio = +ratio.toFixed(3);
    if (ratio > DC_AC_HARD_LIMIT) {
      errors.push({
        code: 'DC_EXCEEDS_MAX',
        message: `DC array ${summary.total_dc_kw} kW exceeds inverter max DC ${max_dc_kw} kW by ${((ratio - 1) * 100).toFixed(1)}% (hard cap ${(DC_AC_HARD_LIMIT * 100 - 100).toFixed(0)}%)`,
      });
    } else if (ratio > DC_AC_SOFT_WARN) {
      warnings.push({
        code: 'DC_OVERSIZED',
        message: `DC array ${summary.total_dc_kw} kW is ${((ratio - 1) * 100).toFixed(1)}% over inverter max DC ${max_dc_kw} kW — acceptable but check manufacturer guidance`,
      });
    }
  }
  if (rated_kw) {
    summary.dc_ac_ratio = +(summary.total_dc_kw / rated_kw).toFixed(3);
  }
  if (mppts && panels_per_mppt_max) {
    // Simple test: panels / mppts ≤ panels_per_mppt_max per string
    const min_panels_per_mppt = Math.ceil(pkg.panel_qty / mppts);
    summary.min_panels_per_mppt = min_panels_per_mppt;
    if (min_panels_per_mppt > panels_per_mppt_max) {
      errors.push({
        code: 'MPPT_OVERLOADED',
        message: `${pkg.panel_qty} panels over ${mppts} MPPTs = ${min_panels_per_mppt} per MPPT, exceeds max ${panels_per_mppt_max} (assumed ${ispec.panels_per_mppt_assumption_w || 475}W panel)`,
      });
    }
  }

  // ── 4. Battery system (if any) ───────────────────────────────────────
  if (pkg.battery_system_sku) {
    const bs = await getBatterySystem(pkg.battery_system_sku);
    if (!bs) {
      errors.push({ code: 'BATTERY_NOT_FOUND', message: `Battery system SKU not in battery_systems table: ${pkg.battery_system_sku}` });
      return finalize(errors, warnings, summary);
    }
    summary.battery = {
      system_sku: bs.system_sku, display_name: bs.display_name, brand: bs.brand, family: bs.family,
      capacity_kwh: Number(bs.capacity_kwh), usable_kwh: bs.usable_kwh ? Number(bs.usable_kwh) : null,
    };
    if (!hybrid_ready) {
      errors.push({
        code: 'INV_NOT_HYBRID',
        message: `Inverter ${inverter.sku} is not hybrid_ready — cannot pair with battery ${bs.system_sku} without inverter swap`,
      });
    }
    // Check compat row
    const compat = await checkCompat(inverter.sku, bs.system_sku);
    if (!compat || compat.is_compatible === false) {
      errors.push({
        code: 'NO_COMPAT_ROW',
        message: `No compatibility row in inverter_battery_compat for ${inverter.sku} × ${bs.system_sku} — pairing not validated`,
      });
    } else {
      summary.compat = {
        min_battery_kwh: compat.min_battery_kwh,
        max_battery_kwh: compat.max_battery_kwh,
        charge_kw: compat.charge_kw,
        discharge_kw: compat.discharge_kw,
        full_backup: compat.full_backup,
        max_towers: compat.max_towers,
      };
      // Battery size within range?
      const cap = Number(bs.capacity_kwh);
      if (compat.min_battery_kwh && cap < Number(compat.min_battery_kwh)) {
        errors.push({
          code: 'BATTERY_TOO_SMALL',
          message: `Battery ${bs.system_sku} (${cap} kWh) below minimum ${compat.min_battery_kwh} kWh for inverter ${inverter.sku}`,
        });
      }
      if (compat.max_battery_kwh && cap > Number(compat.max_battery_kwh)) {
        errors.push({
          code: 'BATTERY_TOO_LARGE',
          message: `Battery ${bs.system_sku} (${cap} kWh) exceeds maximum ${compat.max_battery_kwh} kWh for inverter ${inverter.sku}`,
        });
      }
    }
  } else {
    summary.battery = null;
    if (hybrid_ready && ispec.hybrid_status === 'ready') {
      warnings.push({
        code: 'HYBRID_UNUSED',
        message: `Inverter ${inverter.sku} is hybrid-capable but no battery selected — consider battery-ready upsell or use the base GEN24 variant`,
      });
    }
  }

  // ── 5. Phase consistency ──────────────────────────────────────────────
  // Rules:
  //   site 1P + inverter 1P → OK
  //   site 1P + inverter 3P → ERROR (3P inverter physically needs 3 phases)
  //   site 3P + inverter 1P → WARNING (will work but causes phase imbalance; some networks reject)
  //   site 3P + inverter 3P → OK
  if (pkg.site_phase !== undefined && pkg.site_phase !== null) {
    const sitePhase = Number(pkg.site_phase);
    summary.site_phase = sitePhase;
    if (phase && sitePhase) {
      if (sitePhase === 1 && phase === 3) {
        errors.push({
          code: 'PHASE_MISMATCH',
          message: `Inverter ${inverter.sku} is 3-phase but site is single-phase — physically cannot connect`,
        });
      } else if (sitePhase === 3 && phase === 1) {
        warnings.push({
          code: 'PHASE_IMBALANCE',
          message: `Single-phase inverter ${inverter.sku} on a 3-phase site will only feed one phase — may need network operator approval and causes phase imbalance`,
        });
      }
    }
  }

  // ── 6. Smart meter pairing ────────────────────────────────────────────
  // Every inverter installation needs a smart meter for import/export tracking.
  // Each Fronius inverter's specs include `recommended_smart_meter` — we map to
  // the canonical catalogue SKU and check the package included it.
  const recMeterSku = recommendedSmartMeterSku(inverter);
  summary.recommended_smart_meter_sku = recMeterSku;
  if (recMeterSku) {
    if (!pkg.smart_meter_sku) {
      errors.push({
        code: 'METER_MISSING',
        message: `Inverter ${inverter.sku} requires a smart meter. Add ${recMeterSku} to the package (recommended).`,
      });
    } else if (pkg.smart_meter_sku !== recMeterSku) {
      // Look up what they chose
      const chosen = await getProduct(pkg.smart_meter_sku);
      if (!chosen) {
        errors.push({
          code: 'METER_NOT_FOUND',
          message: `Smart meter SKU not in catalogue: ${pkg.smart_meter_sku}`,
        });
      } else {
        // Check phase compatibility
        const meterPhase = chosen.specs?.phase;
        if (phase && meterPhase && Number(meterPhase) !== phase && meterPhase !== '1 or 3') {
          errors.push({
            code: 'METER_PHASE_MISMATCH',
            message: `Smart meter ${pkg.smart_meter_sku} is ${meterPhase}-phase but inverter is ${phase}-phase`,
          });
        } else {
          warnings.push({
            code: 'METER_NON_STANDARD',
            message: `Package uses ${pkg.smart_meter_sku} instead of Fronius-recommended ${recMeterSku}. Will work, but matched pairing is preferred for Solar.web integration.`,
          });
        }
        summary.smart_meter = { sku: chosen.sku, name: chosen.name, phase: meterPhase };
      }
    } else {
      const chosen = await getProduct(pkg.smart_meter_sku);
      if (chosen) summary.smart_meter = { sku: chosen.sku, name: chosen.name, phase: chosen.specs?.phase };
    }
  } else if (pkg.smart_meter_sku) {
    // No recommendation in inverter spec, but package has a meter — accept it
    const chosen = await getProduct(pkg.smart_meter_sku);
    if (chosen) summary.smart_meter = { sku: chosen.sku, name: chosen.name, phase: chosen.specs?.phase };
    warnings.push({
      code: 'METER_NO_RECOMMENDATION',
      message: `Inverter ${inverter.sku} has no recommended_smart_meter in specs — please verify ${pkg.smart_meter_sku} is correct`,
    });
  } else {
    warnings.push({
      code: 'METER_NOT_SPECIFIED',
      message: `No smart meter in package and no recommendation on inverter — Solar.web monitoring + battery dispatch won't function without one`,
    });
  }

  // ── 7. Racking BOM math ──────────────────────────────────────────────
  // Compute expected racking from panel count + roof type, compare to package's
  // racking_items[]. Flag missing essentials as errors, mismatched counts as warnings.
  const expected = computeRackingBom(pkg.panel_qty, pkg.roof_type);
  if (expected) {
    summary.racking_expected = expected;
    const provided = await summariseRackingItems(pkg.racking_items);
    summary.racking_provided = provided;
    if (!pkg.racking_items || !pkg.racking_items.length) {
      warnings.push({
        code: 'RACKING_MISSING',
        message: `No racking items in package. Expected ~${expected.rails} rails, ${expected.end_clamps} end clamps, ${expected.mid_clamps} mid clamps, ${expected.feet} feet/hooks for ${pkg.panel_qty} panels on ${pkg.roof_type || 'unspecified'} roof.`,
      });
    } else {
      // Compare key categories
      const checks = [
        { key: 'rails',       label: 'Rails',         critical: true,  tolerance: 0 },
        { key: 'end_clamps',  label: 'End clamps',    critical: true,  tolerance: 0 },
        { key: 'mid_clamps',  label: 'Mid clamps',    critical: false, tolerance: 2 },
        { key: 'feet',        label: 'Feet/hooks',    critical: true,  tolerance: 1 },
        { key: 'earthing_lugs',   label: 'Earthing lugs',   critical: false, tolerance: 0 },
        { key: 'earthing_plates', label: 'Earthing plates', critical: false, tolerance: 1 },
      ];
      for (const c of checks) {
        const e = expected[c.key] || 0;
        const p = provided[c.key] || 0;
        if (e === 0) continue;
        const short = e - p;
        if (short > c.tolerance) {
          (c.critical ? errors : warnings).push({
            code: c.critical ? 'RACKING_SHORT' : 'RACKING_LOW',
            message: `${c.label}: expected ${e}, package has ${p} (short by ${short})`,
          });
        } else if (p > e * 1.5) {
          warnings.push({
            code: 'RACKING_OVER',
            message: `${c.label}: package has ${p}, only ${e} expected (oversupplied by ${p - e})`,
          });
        }
      }
      if (provided.missing_specs.length) {
        warnings.push({
          code: 'RACKING_UNKNOWN_KIND',
          message: `Some racking items have unknown 'kind' in specs and weren't counted: ${provided.missing_specs.join(', ')}`,
        });
      }
    }
  }

  return finalize(errors, warnings, summary);
}

function finalize(errors, warnings, summary) {
  return { ok: errors.length === 0, errors, warnings, summary };
}
