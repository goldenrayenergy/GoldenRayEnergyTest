// ────────────────────────────────────────────────────────────────────────────
// Proposal data adapter
//
// Takes raw engine outputs (spec, cost, scenarios, engineering, bom) and
// produces a flat, render-ready data object the page builders consume. All
// formatting, name resolution, and derived metrics live here so the page
// templates stay declarative.
//
// Output shape — `d`:
//   meta:         quote ref, date, validity, consultant
//   customer:     name, surname, address (one-line), icp
//   bills:        annual_kwh, annual_spend, blended_rate
//   system:       kw, panels, panel_brand, inverter_model, battery_label,
//                 bom_lines (display-friendly hardware rows)
//   pricing:      list_inc_gst, discount_inc_gst, customer_inc_gst,
//                 customer_ex_gst, profit_ex_gst, margin_pct, floor_status
//   financial:    yr1, monthly, yearly (= Expected scenario)
//   scenarios:    summary table (Conservative / Expected / Optimistic)
//   engineering:  passes, hard_fails, soft_warnings, unverified, standards
//   warranties:   term-by-component
// ────────────────────────────────────────────────────────────────────────────

import { getCatalogue } from '../catalogue/index.js';
import { findBmsForBattery } from '../catalogue/bosRoles.js';
import { REGIONS, WARRANTY_TERMS, requiredBmsCount } from '../data/engineeringRules.js';
import { normalizeStringDesign } from '../stringDesignShape.js';
import { simulateTypicalDays } from '../dailyProfile.js';

const fmt$ = n => '$' + Math.round(n).toLocaleString('en-NZ');
const fmtNum = n => Math.round(n).toLocaleString('en-NZ');
const fmtPct = (n, decimals = 1) => n.toFixed(decimals) + '%';

function surnameOf(fullName) {
  return (fullName || '').split(/\s+/).filter(Boolean).slice(-1)[0] || 'Customer';
}

function addressOneLine(addr) {
  if (!addr) return '';
  const parts = [addr.street, addr.suburb, addr.city, addr.postcode].filter(Boolean);
  return parts.join(', ');
}

function blendedRate(annualSpend, annualKwh) {
  return annualKwh > 0 ? +(annualSpend / annualKwh).toFixed(3) : 0;
}

function quoteRef(customerName, year, sequence = 1) {
  const surname = surnameOf(customerName).toUpperCase().replace(/[^A-Z]/g, '');
  return `PR-${surname}-${year}-${String(sequence).padStart(3, '0')}`;
}

function formatDateNZ(date) {
  return new Date(date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Convert one BoM item to a display row used by hardware-list pages.
function bomDisplayRow(item, catalogue) {
  const cat = catalogue.PANELS[item.sku] || catalogue.INVERTERS[item.sku] || catalogue.BATTERIES[item.sku] ||
              catalogue.BMS_CONTROLLERS[item.sku] || catalogue.SMART_METERS[item.sku] || catalogue.BOS_ITEMS[item.sku] || null;
  return {
    sku: item.sku,
    qty: item.qty,
    name: cat?.name || item.sku,
    brand: cat?.brand || '',
    category: cat?.category || null,
    reason: item.reason,
    group: item.group,
  };
}

// Phase H6 — map inverter brand → monitoring portal name + URL hint.
// Used by systemSummary, pricing, typicalDays etc. so the customer PDF
// doesn't claim "SolarWeb" when a Victron inverter is being quoted.
export function monitoringPortalForBrand(brand) {
  const b = String(brand || '').toLowerCase();
  if (b.includes('fronius'))   return { name: 'SolarWeb',          app: 'Solar.web app' };
  if (b.includes('victron'))   return { name: 'VRM Portal',         app: 'VRM Portal app' };
  if (b.includes('enphase'))   return { name: 'Enphase Enlighten',  app: 'Enlighten Mobile' };
  if (b.includes('sma'))       return { name: 'Sunny Portal',       app: 'SMA Energy app' };
  if (b.includes('huawei'))    return { name: 'FusionSolar',        app: 'FusionSolar app' };
  return { name: 'cloud monitoring portal', app: 'monitoring app' };
}

// Phase H6 — find a BoM row whose name matches a regex (for pulling the
// actual mounting kit / DC conduit / cable / etc. on this quote rather
// than hardcoding "Hopergy tin kit" or "Solarflex").
export function findBomRowByPattern(bomRows, pattern, group) {
  if (!Array.isArray(bomRows)) return null;
  return bomRows.find(r => (!group || r.group === group) &&
                            pattern.test(String(r.name || '')));
}

function batteryLabel(catalogue, batterySku, moduleCount) {
  if (!batterySku || !moduleCount) return null;
  const batt = catalogue.BATTERIES[batterySku];
  if (!batt) return null;
  const kwh = +(moduleCount * batt.module_kwh).toFixed(2);
  return `${batt.brand} ${batt.series} ${kwh} kWh (${moduleCount} × ${batt.module_kwh} kWh + ${requiredBmsCount(batt.series, moduleCount)} BMS+BCU)`;
}

function warrantyTerms(spec, catalogue) {
  const panelSku = spec.system.panel.sku;
  const inverterSku = spec.system.inverter.sku;
  const batterySku = spec.system?.battery?.sku;
  const panelW = WARRANTY_TERMS.panels[panelSku];
  const invW = WARRANTY_TERMS.inverters[inverterSku];
  const battW = batterySku ? WARRANTY_TERMS.batteries[catalogue.BATTERIES[batterySku]?.series] : null;
  return {
    panel: panelW
      ? `${panelW.product_warranty_years}yr product · ${panelW.linear_performance_years}yr linear performance to ${panelW.linear_performance_endpoint_pct}%`
      : 'Per datasheet',
    inverter: invW
      ? `${invW.product_warranty_years}yr base + ${invW.extension_years_free_via_solarweb}yr free SolarWeb extension = ${invW.total_with_extension}yr total`
      : 'Per datasheet',
    battery: battW
      ? `${battW.product_warranty_years}yr product / ${battW.performance_soh_pct_at_year_10}% SOH at year 10`
      : null,
    smart_meter: `${WARRANTY_TERMS.smart_meter_years}yr`,
    racking_bos: `${WARRANTY_TERMS.racking_bos_years}yr`,
    workmanship: `${WARRANTY_TERMS.goldenray_workmanship_years}yr`,
  };
}

// ── Main export ────────────────────────────────────────────────────────────
export function buildProposalData({ spec, costResult, scenarios, engineering, bom, options = {} }) {
  const catalogue = getCatalogue(options);
  const year = options.quote_year || new Date(options.quote_date || Date.now()).getFullYear();
  const quoteDate = options.quote_date || new Date().toISOString();
  const validUntil = new Date(new Date(quoteDate).getTime() + (options.valid_days || 14) * 86400000);

  // Bills — use manual_entry or aggregated bills[]
  let annualKwh, annualSpend;
  if (spec.bills.manual_entry) {
    annualKwh = spec.bills.manual_entry.annual_kwh;
    annualSpend = spec.bills.manual_entry.annual_spend;
  } else {
    const days = spec.bills.bills.reduce((s, b) => s + b.days, 0);
    const kwh = spec.bills.bills.reduce((s, b) => s + b.kwh, 0);
    const spend = spec.bills.bills.reduce((s, b) => s + b.total, 0);
    annualKwh = Math.round(kwh / days * 365);
    annualSpend = +(spend / days * 365).toFixed(2);
  }

  // System
  const panel = catalogue.PANELS[spec.system.panel.sku];
  const inverter = catalogue.INVERTERS[spec.system.inverter.sku];
  const battery = spec.system?.battery?.sku ? catalogue.BATTERIES[spec.system.battery.sku] : null;
  const systemKw = +(spec.system.panel.count * panel.watts / 1000).toFixed(2);
  const usableKwh = battery ? +(spec.system.battery.module_count * battery.module_kwh).toFixed(2) : 0;
  const region = REGIONS[spec.customer.address.region];

  // BoM display rows (grouped)
  const bomRows = bom.map(item => bomDisplayRow(item, catalogue));
  const hardwareRows = bomRows.filter(r => r.group === 'hardware');
  const bosRows = bomRows.filter(r => r.group === 'bos');

  // Pricing snapshot
  const t = costResult.totals;
  const pricing = {
    list_ex_gst: t.total_list_ex_gst,
    list_inc_gst: t.total_list_inc_gst,
    discount_ex_gst: t.discount_applied_ex_gst,
    discount_inc_gst: t.discount_applied_inc_gst,
    discount_pct_of_list: t.discount_pct_of_list,
    discount_reason: spec.pricing?.discount?.reason || null,
    customer_ex_gst: t.customer_total_ex_gst,
    customer_inc_gst: t.customer_total_inc_gst,
    gst_on_customer: t.gst_on_customer_total,
    cost_ex_gst: t.total_cost_ex_gst,
    profit_ex_gst: t.profit_ex_gst,
    margin_pct: t.project_margin_pct,
    floor_status: costResult.margin_floor_status,
  };

  // Financial (Expected scenario) + scenario summary
  const headline = scenarios.headline;
  const financial = {
    yr1: headline.yr1,
    monthly: headline.monthly,
    yearly: headline.yearly,
    payback_yrs: headline.payback_inflation_degradation_yrs,
    payback_discounted_yrs: headline.payback_discounted_yrs,
    lifetime_net_savings: headline.lifetime_net_savings,
    lifetime_gross_savings: headline.lifetime_gross_savings,
    total_roi_pct: headline.total_roi_pct,
    irr_pct: headline.irr_pct,
    npv_5pct: headline.npv_5pct,
    financing: headline.financing,
    assumptions: headline.assumptions,
  };

  // Normalize string design so the proposal PDF surfaces a clean groups[]
  // and a first-group { panels_per_string, string_count } for legacy
  // templates. Handles both legacy + canonical shapes.
  const stringGroupsForPdf = normalizeStringDesign(spec.system.string_design).groups;

  return {
    meta: {
      quote_ref: options.quote_ref || quoteRef(spec.customer.full_name, year, options.sequence || 1),
      quote_date: formatDateNZ(quoteDate),
      valid_until: formatDateNZ(validUntil),
      valid_days: options.valid_days || 14,
      stage: spec.pricing.stage || 'stage_1_estimate',
      final_mode: spec.pricing.final_mode === true,
      consultant: options.consultant || {
        name: 'Rajeshwar Reddy',
        phone: '+64 21 839 356',
        office: '0800 999 1999',
        email: 'reddy@gripl.co',
        title: 'Senior Solar Consultant',
      },
      logo_data_uri: options.logo_data_uri || null,
    },
    customer: {
      name: spec.customer.full_name,
      surname: surnameOf(spec.customer.full_name),
      address_one_line: addressOneLine(spec.customer.address),
      address: spec.customer.address,
      icp: spec.customer.icp_number,
      email: spec.customer.email,
      phone: spec.customer.phone,
    },
    bills: {
      annual_kwh: annualKwh,
      annual_spend: annualSpend,
      blended_rate_per_kwh: blendedRate(annualSpend, annualKwh),
      retailer: spec.bills.manual_entry?.retailer || '',
      variable_rate_per_kwh_incl_gst: spec.bills.manual_entry?.variable_rate_per_kwh_incl_gst,
      daily_fixed_charge_incl_gst: spec.bills.manual_entry?.daily_fixed_charge_incl_gst,
      buyback_rate: spec.bills.manual_entry?.buyback_rate,
    },
    system: {
      kw: systemKw,
      panels: spec.system.panel.count,
      panel_sku: spec.system.panel.sku,
      panel_name: panel.name,
      panel_brand: panel.brand,
      panel_watts: panel.watts,
      inverter_sku: spec.system.inverter.sku,
      inverter_name: inverter.name,
      battery_sku: spec.system?.battery?.sku || null,
      battery_label: batteryLabel(catalogue, spec.system?.battery?.sku, spec.system?.battery?.module_count),
      usable_battery_kwh: usableKwh,
      topology: spec.system.string_topology || 'series',
      // Read from canonical groups[] — falls back to legacy fields via the
      // normalizer. The proposal PDF surfaces the first group at the top
      // level (most common case is a single group) and exposes the full
      // groups array for multi-group templates.
      panels_per_string: stringGroupsForPdf[0]?.panels_per_string ?? null,
      string_count:      stringGroupsForPdf[0]?.string_count ?? null,
      string_groups:     stringGroupsForPdf,
      phase: spec.system.phase || 1,
      cable_run_metres: spec.system.cable_run_metres_estimate,
      region: spec.customer.address.region,
      region_label: region?.label || spec.customer.address.region,
      yield_kwh_per_kwp: region?.yield_kwh_per_kwp_per_year || null,
      losses_pct: region?.base_losses_pct ?? null,
      hardware_rows: hardwareRows,
      bos_rows: bosRows,
    },
    pricing,
    financial,
    scenarios: {
      summary: scenarios.summary,        // 3-row table for credibility page
      headline_label: 'Expected',
    },
    engineering: {
      passes: engineering.passes,
      hard_fails: engineering.hard_fails,
      soft_warnings: engineering.soft_warnings,
      unverified: engineering.unverified,
      standards: engineering.standards_referenced,
      validator_version: engineering.validator_version,
    },
    warranties: warrantyTerms(spec, catalogue),
    hardware: hardwareDetailBlocks(spec, catalogue, costResult),
    // Phase H6 — thread preferences through so SLD / scenarios can adapt
    // backup-circuit list, financing options, etc. to THIS customer.
    preferences: {
      backup_priority: spec.preferences?.backup_priority || null,
      decision_makers: spec.preferences?.decision_makers || null,
      financing: spec.preferences?.financing || null,
    },
    // Phase H1 — bill_analysis-sourced sections. Null when no bill on file
    // (those pages just don't render). financial.kwhYr1 + Expected scenario
    // are used to derive environmental + cash flow.
    insights: buildInsights({
      billAnalysis: options.billAnalysis || null,
      scenarios,
      annualKwh,
      annualSpend,
      systemKw,
      usableKwh,
      // Phase H2 — 4 typical-day simulations: summer/winter × sunny/cloudy.
      // Engine-derived from this customer's system kWp + bills + region.
      typical_days: simulateTypicalDays({ spec, catalogue }),
    }),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase H1 — Insights derived from bill_analysis + engine scenarios.
// Five sections, each optional (null when source data missing):
//   • do_nothing      — 25-yr trajectory of paying retail forever
//   • tariff          — engine-recommended retailer/plan switch + savings
//   • patterns        — seasonal/daily usage patterns from the bill parser
//   • environmental   — CO2 saved + equivalents over 25 yrs
//   • cash_flow       — yearly net position (Expected scenario)
// ────────────────────────────────────────────────────────────────────────────
function buildInsights({ billAnalysis, scenarios, annualKwh, annualSpend, systemKw, usableKwh, typical_days }) {
  const out = { do_nothing: null, tariff: null, patterns: null,
                environmental: null, cash_flow: null, typical_days: typical_days || null };

  // ── Do nothing — bill_analysis.scenarios[do-nothing] ────────────────────
  const doNothing = billAnalysis?.scenarios?.find?.(s => s.id === 'do-nothing');
  if (doNothing) {
    out.do_nothing = {
      year_1_cost: doNothing.year_1_cost,
      year_10_cost: doNothing.year_10_cost,
      year_25_cost: doNothing.year_25_cost,
      net_25yr: doNothing.net_25yr,
      label: doNothing.label,
      // Trajectory points for charting (yr 1 / 5 / 10 / 15 / 20 / 25 cumulative)
      // Estimated via geometric interpolation between known knots
      trajectory: estimateCumulativeTrajectory(doNothing),
    };
  } else if (annualKwh && annualSpend) {
    // Fallback: project from annual spend + 7% energy inflation (engine default)
    const yrly = [];
    let cum = 0;
    for (let y = 1; y <= 25; y++) {
      cum += annualSpend * Math.pow(1.07, y - 1);
      if ([1, 5, 10, 15, 20, 25].includes(y)) yrly.push({ year: y, cum_cost: Math.round(cum) });
    }
    out.do_nothing = {
      year_1_cost: annualSpend,
      year_10_cost: yrly.find(p => p.year === 10)?.cum_cost,
      year_25_cost: yrly.find(p => p.year === 25)?.cum_cost,
      net_25yr: yrly[yrly.length - 1].cum_cost,
      label: 'Pay retail rates for 25 years',
      trajectory: yrly,
      derived: true,
    };
  }

  // ── Recommended tariff (post-install) ───────────────────────────────────
  if (billAnalysis?.switch_recommended && billAnalysis?.switch_to_retailer) {
    out.tariff = {
      switch_to_retailer: billAnalysis.switch_to_retailer,
      switch_to_plan: billAnalysis.switch_to_plan || null,
      annual_saving: billAnalysis.switch_annual_saving || 0,
      current_retailer: billAnalysis.retailer || null,
      current_plan: billAnalysis.plan_name || null,
    };
  }

  // ── Usage patterns (winter spike / high baseline / etc.) ────────────────
  if (Array.isArray(billAnalysis?.patterns) && billAnalysis.patterns.length > 0) {
    out.patterns = billAnalysis.patterns.map(p => ({
      code: p.code,
      label: p.label,
      details: p.details,
      severity: p.severity || 'info',
      recommendation: p.recommendation || null,
    }));
  }

  // ── Environmental impact ─────────────────────────────────────────────────
  // NZ grid average emission factor: 0.085 kg CO2 per kWh (MBIE 2024)
  // 25-year solar generation = systemKw × 1250 kWh/kWp/yr × 25 × degradation
  // Approximated as 21,000 kWh/kWp over 25 years (~6% lifetime degradation)
  if (systemKw > 0) {
    const lifetimeKwh = Math.round(systemKw * 21000);
    const kgCo2Saved = Math.round(lifetimeKwh * 0.085);
    out.environmental = {
      yr1_kwh_generated: Math.round(systemKw * 1250),
      lifetime_kwh: lifetimeKwh,
      lifetime_co2_kg: kgCo2Saved,
      // Equivalents — sourced from EPA/NZTA reference figures
      equiv_trees:  Math.round(kgCo2Saved / 22),           // 22 kg CO2/yr per mature tree × 25 yrs ≈ 550 → divide
      equiv_cars_off_road_years: Math.round(kgCo2Saved / 4600), // 4600 kg CO2/yr per average car
      equiv_flights_AKL_LON: Math.round(kgCo2Saved / 3500),  // ~3500 kg CO2 per return AKL→LON economy
    };
  }

  // ── 25-year cash flow (Expected scenario) ───────────────────────────────
  if (scenarios?.expected?.yearly && Array.isArray(scenarios.expected.yearly)) {
    let cumulative = -Math.abs(scenarios.expected.upfront_cost || 0);
    const points = scenarios.expected.yearly.map((row, idx) => {
      const net = (row.savings || 0) - (row.maintenance_cost || 0);
      cumulative += net;
      return { year: idx + 1, net_annual: Math.round(net), cumulative: Math.round(cumulative) };
    });
    const payback = points.find(p => p.cumulative >= 0);
    out.cash_flow = {
      upfront_cost: scenarios.expected.upfront_cost || 0,
      points,
      payback_year: payback?.year || null,
      final_cumulative: points[points.length - 1]?.cumulative || 0,
    };
  }

  return out;
}

// Project a cumulative-cost trajectory from the known year-1/10/25 knots that
// the bill parser emits, using geometric growth between them.
function estimateCumulativeTrajectory(doNothing) {
  const knots = [
    { year: 1,  cum_cost: doNothing.year_1_cost },
    { year: 10, cum_cost: doNothing.year_10_cost },
    { year: 25, cum_cost: doNothing.year_25_cost },
  ].filter(k => k.cum_cost != null);
  if (knots.length < 2) return knots;
  const out = [];
  for (const yr of [1, 5, 10, 15, 20, 25]) {
    // Find surrounding knots
    const lower = knots.filter(k => k.year <= yr).slice(-1)[0] || knots[0];
    const upper = knots.find(k => k.year >= yr) || knots[knots.length - 1];
    if (lower.year === upper.year) { out.push({ year: yr, cum_cost: Math.round(lower.cum_cost) }); continue; }
    const t = (yr - lower.year) / (upper.year - lower.year);
    const interpolated = lower.cum_cost + (upper.cum_cost - lower.cum_cost) * t;
    out.push({ year: yr, cum_cost: Math.round(interpolated) });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase C-1 — hardware detail blocks for the new Components page.
//
// Returns ONE block per hardware kind (panel/inverter/battery/smart_meter)
// that the components page renders as a row with image + name + specs +
// warranty + count. Each block degrades gracefully when image_url /
// datasheet_url aren't yet filled in for the SKU — page just shows the
// spec block without the photo.
// ────────────────────────────────────────────────────────────────────────────
function hardwareDetailBlocks(spec, catalogue, costResult) {
  const w = warrantyTerms(spec, catalogue);

  const panel = catalogue.PANELS[spec.system.panel.sku];
  const inverter = catalogue.INVERTERS[spec.system.inverter.sku];
  const battery = spec.system?.battery?.sku ? catalogue.BATTERIES[spec.system.battery.sku] : null;
  // Bug #3 fix — mirror the bomBuilder default. Composer leaves smart_meter.sku
  // null until the rep flips the phase manually, but the customer PDF still
  // needs to surface the meter that will actually be installed. Fall back to
  // the 1ϕ default (which the BoM also uses) when sku is null.
  const meterSku = spec.system?.smart_meter?.sku || 'FRN-MTR-63-S1P';
  const meter = catalogue.SMART_METERS?.[meterSku] || null;

  // BMS resolved the same way bomBuilder does — by battery series, not hardcoded.
  const batteryModuleCount = spec.system?.battery?.module_count || 0;
  const batteryUsableKwh = battery ? +(batteryModuleCount * battery.module_kwh).toFixed(2) : 0;
  const bms = battery ? findBmsForBattery(catalogue, battery.series) : null;
  const bmsCount = battery ? requiredBmsCount(battery.series, batteryModuleCount) : null;

  // Effective continuous + peak — derived per the engineering rules. Falls
  // back to N/A strings if the spec hasn't been populated for a SKU.
  const inverterAcKw = inverter?.ac_kw;
  const inverterDcAc = inverterAcKw && panel?.watts && spec.system.panel.count
    ? +((spec.system.panel.count * panel.watts / 1000) / inverterAcKw).toFixed(2)
    : null;

  return {
    panel: panel ? {
      sku: panel.sku,
      name: panel.name,
      brand: panel.brand,
      count: spec.system.panel.count,
      watts: panel.watts,
      total_kwp: panel.watts && spec.system.panel.count
        ? +(spec.system.panel.count * panel.watts / 1000).toFixed(2) : null,
      voc_stc: panel.voc_stc,
      isc_stc: panel.isc_stc,
      vmp_stc: panel.vmp_stc,
      imp_stc: panel.imp_stc,
      peak_efficiency_pct: panel.peak_efficiency_pct ?? null,
      image_url: panel.image_url,
      datasheet_url: panel.datasheet_url,
      warranty: w.panel,
    } : null,

    inverter: inverter ? {
      sku: inverter.sku,
      name: inverter.name,
      brand: inverter.brand,
      ac_kw: inverterAcKw,
      phase: inverter.phase,
      is_plus_variant: inverter.is_plus_variant === true,
      battery_capable: inverter.battery_capable === true,
      dc_ac_ratio: inverterDcAc,
      uoc_max_v: inverter.uoc_max_v,
      mppt_v_min: inverter.mppt_v_min,
      mppt_count: inverter.mppt_count,
      peak_efficiency_pct: inverter.peak_efficiency_pct,
      image_url: inverter.image_url,
      datasheet_url: inverter.datasheet_url,
      warranty: w.inverter,
    } : null,

    battery: battery ? {
      sku: battery.sku,
      name: battery.name,
      brand: battery.brand,
      series: battery.series,
      module_count: batteryModuleCount,
      module_kwh: battery.module_kwh,
      total_usable_kwh: batteryUsableKwh,
      chemistry: battery.chemistry || 'LFP',
      image_url: battery.image_url,
      datasheet_url: battery.datasheet_url,
      warranty: w.battery,
    } : null,

    bms: bms && bmsCount ? {
      sku: bms.sku,
      name: bms.name,
      brand: bms.brand,
      count: bmsCount,
      for_battery_series: bms.for_battery_series || battery?.series || null,
      image_url: bms.image_url,
      datasheet_url: bms.datasheet_url,
      warranty: w.battery,
    } : null,

    smart_meter: meter ? {
      sku: meter.sku,
      name: meter.name,
      brand: meter.brand,
      phase: meter.phase,
      amps: meter.amps,
      image_url: meter.image_url,
      datasheet_url: meter.datasheet_url,
      warranty: w.smart_meter,
    } : null,
  };
}

// ── Re-export helpers so page templates don't need to redefine them ───────
export { fmt$, fmtNum, fmtPct, surnameOf };

// ────────────────────────────────────────────────────────────────────────────
// P4.5 — Multi-tier proposal data adapter.
//
// Takes the full engine result (output of runEngine for a multi-tier spec)
// plus an array of per-tier scenarios. Produces a single `d` object where:
//   • d.system / d.financial / d.scenarios / d.pricing / d.warranties / d.engineering
//     are sourced from the RECOMMENDED (headline) tier — so all existing
//     pages render headline numbers without changes
//   • d.tiers is a new array carrying per-tier summary cards for the new
//     comparison page
//   • d.meta and d.customer + d.bills are shared across tiers (single source)
//
// Usage from caller (after runEngine + per-tier scenarios):
//   const data = buildMultiTierProposalData({
//     spec, engineResult, tierScenarios,   // tierScenarios = [scenarios per tier]
//     options,
//   });
// ────────────────────────────────────────────────────────────────────────────
import {
  ensureTierIds, buildEffectiveSpec, pickHeadlineTierId,
} from '../tiers.js';

export function buildMultiTierProposalData({
  spec, engineResult, tierScenarios, options = {},
}) {
  if (!engineResult?.is_multi_tier) {
    throw new Error('buildMultiTierProposalData: engineResult must be multi-tier');
  }
  if (!Array.isArray(tierScenarios) || tierScenarios.length !== engineResult.tiers.length) {
    throw new Error('buildMultiTierProposalData: tierScenarios must match tier count');
  }

  const specWithIds = ensureTierIds(spec);
  const headlineTierId = engineResult.recommended_tier_id || pickHeadlineTierId(specWithIds);
  const headlineIdx = engineResult.tiers.findIndex(t => t.tier_id === headlineTierId);
  const headlineTier = engineResult.tiers[headlineIdx];
  const headlineSpecTier = specWithIds.tiers[headlineIdx];
  const headlineEffectiveSpec = buildEffectiveSpec(specWithIds, headlineSpecTier);
  const headlineScenarios = tierScenarios[headlineIdx];

  // Build the canonical `d` using the headline tier as if it were a single-tier spec
  const d = buildProposalData({
    spec: headlineEffectiveSpec,
    costResult: headlineTier.cost,
    scenarios: headlineScenarios,
    engineering: headlineTier.engineering,
    bom: headlineTier.bom,
    options,
  });

  // Add a tier-summary array for the new comparison page
  d.tiers = engineResult.tiers.map((t, i) => {
    const effectiveSpec = buildEffectiveSpec(specWithIds, specWithIds.tiers[i]);
    const tierScenariosObj = tierScenarios[i];
    const expectedRow = tierScenariosObj?.summary?.find?.(s => s.key === 'expected');
    const tierCost = t.cost?.totals || {};
    const sysKw = +(effectiveSpec.system.panel.count *
                    (d.system?.panel_watts || 595) / 1000).toFixed(2);
    const battery = effectiveSpec.system?.battery;
    return {
      tier_id: t.tier_id,
      label: t.label,
      is_recommended: t.is_recommended,
      can_ship: t.can_ship,
      system: {
        kw: sysKw,
        panels: effectiveSpec.system.panel.count,
        battery_kwh: battery
          ? +((battery.module_count || 0) * 2.76).toFixed(2)
          : 0,
        wattpilot_included: !!effectiveSpec.system?.wattpilot_included,
      },
      pricing: {
        customer_inc_gst: tierCost.customer_total_inc_gst,
        discount_inc_gst: tierCost.discount_applied_inc_gst || 0,
        discount_pct_of_list: tierCost.discount_pct_of_list || 0,
      },
      headline_savings_yr1: expectedRow?.yr1_savings || null,
      headline_payback_yrs: expectedRow?.payback_yrs || null,
      headline_30yr_net: expectedRow?.lifetime_net_savings || null,
      headline_irr_pct: expectedRow?.irr_pct || null,
      margin_floor_status: t.cost?.margin_floor_status,
    };
  });
  d.is_multi_tier = true;
  d.recommended_tier_id = headlineTierId;
  d.recommended_tier_label = headlineTier?.label || null;

  return d;
}
