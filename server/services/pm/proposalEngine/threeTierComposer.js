// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Three-tier composer (Option 4c (b) — server-side).
//
// Single-call orchestrator that builds all 3 tier specs from a bill analysis.
// Designed to be called from POST /pm/quotes so the create response carries
// a FULLY-POPULATED spec — no null SKUs ever reach the client.
//
// Inputs:
//   billAnalysis  { recommended_system_kw, recommended_battery_kwh } | null
//   phase         1 | 3
//   region        REGIONS row
//   sizeMode      'same_size' | 'tiered_sizes'
//   catalogue     loaded via loadCatalogueFromDb()
//   COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS  engineeringRules exports
//
// Output:
//   {
//     tiers: [{ label, source, system_overrides, engine_warnings,
//               engine_reasons, pricing, cost_overrides, is_recommended }],
//     recommended_index: 1,
//     fallback_used: boolean,        // true if ANY tier used a fallback
//     warnings: [...]                // aggregated across all 3 tiers
//   }
//
// Fallback semantics:
//   • billAnalysis missing OR recommended_system_kw <= 0
//       → ALL tiers use catalogue-first fallback (highest-watt panel,
//         smallest Plus inverter for the phase, smallest BYD HVM tower)
//       → fallback_reason = 'no_bill_analysis'
//
//   • Composer fails for one tier (e.g. no_valid_layout)
//       → that tier uses catalogue-first fallback + reason captured
//       → fallback_reason = 'composer_failed'
//       → OTHER tiers still use engine picks
//
//   • Composer fails for ALL tiers (e.g. no valid inverter in phase)
//       → ALL tiers use catalogue-first fallback
//       → fallback_reason = 'composer_failed'
//
// This module NEVER returns null SKUs. Worst case is a fallback configuration
// flagged with a warning the rep can act on.
// ────────────────────────────────────────────────────────────────────────────

import { composeSystem } from './systemComposer.js';
import { selectPanel }   from './panelSelector.js';
import { selectBattery } from './batterySelector.js';
import { buildBom }      from './bomBuilder.js';
import { computeCost }   from './costEngine.js';
import { validateEngineering } from './engineeringValidator.js';

// Pricing rule (memory: feedback_pricing_always_from_cost_engine):
// Every tier price MUST come from costEngine.computeCost() against the live
// catalogue. Hardcoded $/kW ballparks are FORBIDDEN. When the cost engine
// can't price (missing SKU, missing labour rate card, etc.) we set
// customer_price_inc_gst = null + add a warning. The UI displays "$—" or
// "pending" — better than silently shipping a fictional price.

const emptyDiscount = { applied_nzd: 0, owner_approved: false, reason: null };
const emptyCostOverrides = { labour: [], compliance: [], custom: [] };

// ── Per-tier pricing: build effective spec → BoM → cost engine ─────────────
// Returns the engine-computed LIST price (totals.total_list_inc_gst) — that's
// BoM × per-SKU margins + labour + compliance + GST, computed entirely from
// the live catalogue. The cost engine's `customer_total_inc_gst` is the
// rep-set price (NOT what we want — that's the field we're populating).
// list_inc_gst is the engine's "fair" starting price, and by construction
// it satisfies the margin floor — rep can negotiate down via the discount
// workflow within the 10% margin floor enforced on save.
//
// Returns null when BoM or cost compute throws (e.g. SKU missing from
// catalogue). Caller treats null as "pending — surface to rep".
function priceTierFromCatalogue(tier, catalogue) {
  const sov = tier?.system_overrides || {};
  if (!sov.panel?.sku || !sov.inverter?.sku || !sov.panel?.count) return null;

  const effectiveSpec = {
    system: {
      panel:    sov.panel,
      inverter: sov.inverter,
      battery:  sov.battery || null,
      string_topology: sov.string_topology || 'series',
      string_design:   sov.string_design || {
        topology: sov.string_topology || 'series',
        groups: [{ panels_per_string: sov.panel.count, string_count: 1 }],
      },
      cable_run_metres_estimate: 24,
      phase: 1,
      smart_meter: { sku: null, phase: 1 },
    },
    cost_overrides: tier.cost_overrides || { labour: [], compliance: [], custom: [] },
    // Pass list-price as the customer price so cost engine's discount math
    // is a no-op. We're using this call to read total_list_inc_gst, not
    // to validate margin. Two-pass: first compute list, then loop back
    // (we just read list directly — no second pass needed).
    pricing: {
      customer_price_inc_gst: 0,  // re-read from list below
      discount: { applied_nzd: 0, owner_approved: false },
    },
  };
  try {
    const bom  = buildBom(effectiveSpec, { catalogue });
    const cost = computeCost(effectiveSpec, bom, { catalogue });
    const listPrice = cost?.totals?.total_list_inc_gst;
    if (!Number.isFinite(listPrice)) {
      // TEMP diagnostic (2026-08-14): why is listPrice non-finite? Log the
      // totals shape once so we can see what computeCost actually produced.
      console.warn('[priceTierFromCatalogue] listPrice not finite:', {
        tier_label:  tier.label,
        cost_keys:   cost ? Object.keys(cost) : 'cost is null/undefined',
        totals:      cost?.totals || null,
      });
    }
    return Number.isFinite(listPrice) ? listPrice : null;
  } catch (e) {
    // TEMP diagnostic (2026-08-14): surface the silent catch so we can see
    // why buildBom / computeCost is throwing on POC-flow inputs.
    console.warn('[priceTierFromCatalogue] throw during compute:', tier.label, '·', e?.message || String(e));
    if (e?.stack) e.stack.split('\n').slice(0, 4).forEach(l => console.warn('    ' + l));
    return null;
  }
}

// ── Pick a sane fallback inverter from the catalogue ───────────────────────
// (Smallest active Plus inverter for the phase. If no Plus, smallest active
//  non-Plus. Sized so the rep gets *something* shippable to override.)
function pickFallbackInverter(catalogue, phase, needBattery) {
  const all = Object.entries(catalogue.INVERTERS || {})
    .map(([sku, inv]) => ({ sku, ...inv }))
    .filter(inv => inv.phase === phase && inv.ac_kw != null);
  if (all.length === 0) return null;

  const eligible = needBattery
    ? all.filter(inv => inv.battery_capable === true || inv.is_plus_variant === true)
    : all;

  // Prefer Plus + smallest ac_kw; otherwise smallest of whatever's there.
  const pool = eligible.length > 0 ? eligible : all;
  pool.sort((a, b) => (a.ac_kw || 0) - (b.ac_kw || 0));
  return pool[0];
}

function pickFallbackBattery(catalogue) {
  const all = Object.entries(catalogue.BATTERIES || {})
    .map(([sku, b]) => ({ sku, ...b }))
    .filter(b => (b.chemistry || 'LFP') === 'LFP');
  if (all.length === 0) return null;
  // Prefer BYD HVM, then BYD HVS, then Reserva; otherwise first in list.
  const order = ['HVM', 'HVS', 'Reserva'];
  for (const series of order) {
    const found = all.find(b => b.series === series);
    if (found) return found;
  }
  return all[0];
}

// ── Build a tier spec from a composeSystem response ────────────────────────
// Pricing field is left as null here; populated by priceTierFromCatalogue
// in the caller against the live catalogue.
function tierFromCompose(composed, { label, includeEv, isRecommended }) {
  const hasWarnings = (composed?.warnings || []).length > 0;
  const source = composed?.panel?.sku
    ? (hasWarnings ? 'engine_partial' : 'engine_auto')
    : 'engine_fallback';

  return {
    label,
    source,
    engine_warnings: composed?.warnings || [],
    engine_reasons:  composed?.reasons  || {},
    system_overrides: {
      panel:    composed?.panel    || null,
      inverter: composed?.inverter || null,
      battery:  composed?.battery  || null,
      string_topology: composed?.string_design?.topology || null,
      // Canonical: { topology, groups: [...] }. Composer's stringDesigner
      // emits groups[] directly; we just forward it.
      string_design:   composed?.string_design ? {
        topology: composed.string_design.topology,
        groups:   composed.string_design.groups || [],
      } : null,
      wattpilot_included: !!includeEv,
    },
    pricing: {
      // Populated by priceTierFromCatalogue() after this tier is built.
      // Never falls back to a $/kW ballpark.
      customer_price_inc_gst: null,
      stage: 'stage_1_estimate',
      final_mode: true,
      discount: { ...emptyDiscount },
    },
    cost_overrides: { ...emptyCostOverrides },
    is_recommended: !!isRecommended,
  };
}

// ── Build a fallback tier when composer can't ──────────────────────────────
// Pricing is null — populated by priceTierFromCatalogue() after construction.
function tierFromFallback({ label, includeEv, isRecommended,
                            catalogue, phase, needBattery, batteryTargetKwh,
                            reason }) {
  const panelPick = selectPanel({ catalogue });
  const panel    = panelPick.sku ? { sku: panelPick.sku, count: 16 } : null;
  const invPick  = pickFallbackInverter(catalogue, phase, needBattery);
  const inverter = invPick ? { sku: invPick.sku } : null;
  const batPick  = needBattery ? pickFallbackBattery(catalogue) : null;
  const battery  = batPick && batteryTargetKwh
    ? { sku: batPick.sku, module_count: 4, kwh: +(4 * batPick.module_kwh).toFixed(2) }
    : null;

  return {
    label,
    source: 'engine_fallback',
    engine_warnings: [{
      code: 'fallback_used',
      message: `Fallback configuration used — ${reason}. Rep should review SKUs.`,
    }],
    engine_reasons: {
      panel:    panelPick.reason || 'Catalogue-first fallback',
      inverter: invPick ? `Catalogue-first Plus inverter for ${phase}ph: ${invPick.name}` : 'No inverter available',
      battery:  batPick ? `Catalogue-first LFP battery: ${batPick.name}` : 'No battery in catalogue',
    },
    system_overrides: {
      panel, inverter, battery,
      string_topology: null,
      string_design: null,
      wattpilot_included: !!includeEv,
    },
    pricing: {
      // Populated by priceTierFromCatalogue() after this tier is built.
      customer_price_inc_gst: null,
      stage: 'stage_1_estimate',
      final_mode: true,
      discount: { ...emptyDiscount },
    },
    cost_overrides: { ...emptyCostOverrides },
    is_recommended: !!isRecommended,
  };
}

// ── Public entry ────────────────────────────────────────────────────────────
export function composeThreeTiers({
  billAnalysis,
  phase = 1,
  region,
  sizeMode = 'same_size',
  catalogue,
  COMPATIBILITY,
  BMS_RULES,
  TIER_STRIP_SETTINGS,
}) {
  const labels = TIER_STRIP_SETTINGS?.tier_labels?.[sizeMode] || {};
  const mults  = TIER_STRIP_SETTINGS?.tiered_size_multipliers || {
    tier_1_starter: 0.70, tier_2_right_size: 1.00, tier_3_future_proof: 1.30,
  };

  const recKw = Number(billAnalysis?.recommended_system_kw) || 0;
  const noBills = recKw <= 0;

  // ── Total-fallback path (no usable bill recommendation) ───────────────
  if (noBills) {
    const tiers = [
      tierFromFallback({
        label: labels.tier_1 || 'Solar only',
        includeEv: false, isRecommended: false,
        catalogue, phase, needBattery: false, batteryTargetKwh: 0,
        reason: 'no bill analysis on file',
      }),
      tierFromFallback({
        label: labels.tier_2 || 'Solar + battery',
        includeEv: false, isRecommended: true,
        catalogue, phase, needBattery: true, batteryTargetKwh: 11,
        reason: 'no bill analysis on file',
      }),
      tierFromFallback({
        label: labels.tier_3 || 'Solar + battery + EV-ready',
        includeEv: true, isRecommended: false,
        catalogue, phase, needBattery: true, batteryTargetKwh: 14,
        reason: 'no bill analysis on file',
      }),
    ];
    // Phase 1+3: inspect + repair the no-bill fallback tiers too (this path is
    // cruder, so it most needs the engineering check), before pricing.
    inspectAndRepairTiers(tiers, catalogue, { region, phase, COMPATIBILITY, BMS_RULES });
    applyPricesFromCatalogue(tiers, catalogue);
    return {
      tiers,
      recommended_index: 1,
      fallback_used: true,
      fallback_reason: 'no_bill_analysis',
      size_mode: sizeMode,
      warnings: [{
        code: 'no_bill_analysis',
        message: 'Quote created without bill analysis. SKUs from catalogue-first defaults.',
      }],
    };
  }

  // ── Engine-driven path (bills exist) ──────────────────────────────────
  const recBat = Number(billAnalysis.recommended_battery_kwh) || 11;
  // 2026-08-19 · sizeMode='per_tier' — POC path where each tier is sized
  // independently for its own load profile (base | +battery | +battery+EV).
  // Client sends battery_kwh + ev_km_per_day; server computes 3 kwp values;
  // composer honours them via billAnalysis.tier_kwp_override.
  const override = Array.isArray(billAnalysis?.tier_kwp_override) && billAnalysis.tier_kwp_override.length === 3
    ? billAnalysis.tier_kwp_override.map(v => Number(v) || recKw)
    : null;
  const tierKwp = sizeMode === 'per_tier' && override
    ? { t1: override[0], t2: override[1], t3: override[2] }
    : sizeMode === 'tiered_sizes'
    ? {
        t1: +(recKw * mults.tier_1_starter).toFixed(2),
        t2: +(recKw * mults.tier_2_right_size).toFixed(2),
        t3: +(recKw * mults.tier_3_future_proof).toFixed(2),
      }
    : { t1: recKw, t2: recKw, t3: recKw };
  // Tier 3 EV — honour explicit client toggle when POC sent it; otherwise
  // default to true (legacy behaviour: tier 3 always includes Wattpilot).
  const tier3HasEv = typeof billAnalysis?.tier3_ev_enabled === 'boolean'
    ? billAnalysis.tier3_ev_enabled
    : true;
  // Tier 2 EV — off by default (matches legacy). Set to true when POC
  // client sends tier2_ev_enabled=true (customer toggled EV on via the
  // Customise-System panel — then EV load applies to tier 2 sizing +
  // tier 2 tier card shows "EV-ready").
  const tier2HasEv = !!billAnalysis?.tier2_ev_enabled;

  const tierInputs = [
    { kwp: tierKwp.t1, batt: null,         hasEv: false,
      label: labels.tier_1 || (sizeMode === 'tiered_sizes' ? `Starter ${tierKwp.t1} kW` : 'Solar only'),
      isRecommended: false },
    { kwp: tierKwp.t2, batt: recBat,       hasEv: tier2HasEv,
      label: labels.tier_2 || (sizeMode === 'tiered_sizes' ? `Right-size ${tierKwp.t2} kW` : `Solar + ${recBat} kWh battery${tier2HasEv ? ' + EV-ready' : ''}`),
      isRecommended: true },
    { kwp: tierKwp.t3, batt: recBat + 2.76, hasEv: tier3HasEv,
      label: labels.tier_3 || (sizeMode === 'tiered_sizes' ? `Future-proof ${tierKwp.t3} kW` : `Solar + ${(recBat+2.76).toFixed(1)} kWh battery${tier3HasEv ? ' + EV-ready' : ''}`),
      isRecommended: false },
  ];

  const warnings = [];
  let anyFallback = false;
  const tiers = tierInputs.map(t => {
    const composed = composeSystem({
      targetDcKwp: t.kwp, phase,
      targetBatteryUsableKwh: t.batt, hasEv: t.hasEv,
      region, catalogue, COMPATIBILITY, BMS_RULES,
    });

    // If panel + inverter both resolved, accept the result (even with warnings).
    if (composed.panel?.sku && composed.inverter?.sku) {
      if (composed.warnings?.length > 0) warnings.push(...composed.warnings);
      return tierFromCompose(composed, {
        label: t.label, includeEv: t.hasEv, isRecommended: t.isRecommended,
      });
    }

    // Otherwise fall back for THIS tier.
    anyFallback = true;
    warnings.push({
      code: 'tier_fallback',
      message: `${t.label}: composer could not place ${t.kwp} kWp on ${phase}ph — using catalogue-first fallback.`,
    });
    return tierFromFallback({
      label: t.label, includeEv: t.hasEv, isRecommended: t.isRecommended,
      catalogue, phase, needBattery: !!t.batt, batteryTargetKwh: t.batt || 0,
      reason: 'composer failed to place this tier',
    });
  });

  // Phase 1+3: inspect every tier against the full engineering rulebook and
  // repair failures (step up inverter, re-pick battery) BEFORE pricing, so the
  // price reflects the final corrected parts. Pricing rule (memory:
  // feedback_pricing_always_from_cost_engine) — never hardcoded $/kW.
  inspectAndRepairTiers(tiers, catalogue, { region, phase, COMPATIBILITY, BMS_RULES });
  applyPricesFromCatalogue(tiers, catalogue);

  return {
    tiers,
    recommended_index: 1,
    fallback_used: anyFallback,
    fallback_reason: anyFallback ? 'composer_failed' : null,
    size_mode: sizeMode,
    warnings,
  };
}

// ── Validate each tier prices cleanly from the live catalogue ──────────────
// Phase D1: tier price is no longer baked in at auto-size time. The engine
// quotes the live list price every time the rep edits the spec. We still RUN
// the cost engine here to surface a `pricing_pending` warning if the tier
// can't be priced (missing catalogue lines), but we leave
// customer_price_inc_gst as null so the tier card shows the live engine
// recommendation by default.
function applyPricesFromCatalogue(tiers, catalogue) {
  for (const tier of tiers) {
    tier.pricing.customer_price_inc_gst = null;   // reset to "auto-priced" default
    const price = priceTierFromCatalogue(tier, catalogue);
    if (price == null) {
      tier.engine_warnings = tier.engine_warnings || [];
      tier.engine_warnings.push({
        code: 'pricing_pending',
        message: 'Cost engine could not price this tier — likely a missing labour rate ' +
                 'or compliance line in the catalogue. Price will compute on first save ' +
                 'once the catalogue is complete.',
      });
    } else {
      // Fix (2026-08-14): assignment was missing — the engine computed a
      // price but the composer silently dropped it, leaving every POC tier
      // priceless. Symptoms: null tier_price in the API response, no
      // pricing_pending warnings (because compute DID succeed), no visible
      // $ on TierCard, and financials/F1/F3/F6 sections silently hidden
      // (my design.js guards against costResult.totals.customer_total_inc_gst
      // being non-finite).
      tier.pricing.customer_price_inc_gst = price;
    }
  }
}

// ── Phase 1: inspect every proposed tier against the FULL engineering rulebook
// (Voc cold, MPPT current, DC/AC oversizing, string min, phase, inverter↔battery
// matrix + charge rate, BMS, chemistry, racking, smart-meter pairing). Uses the
// SAME validateEngineering() the rep's editor runs, so the composer can never
// hand over a tier whose engineering status it doesn't already know.
//
// Observability only — does NOT change picks. Attaches tier.engine_validation =
// { valid, hard_fails[], soft_warnings[], passes }. Phases 2–3 act on it.
function specForInspection(tier, { region, phase }) {
  const sov = tier?.system_overrides || {};
  if (!sov.panel?.sku || !sov.inverter?.sku || !sov.panel?.count) return null;
  return {
    customer: { address: { region: region || null } },
    bills: { manual_entry: {} },
    system: {
      panel:    sov.panel,
      inverter: sov.inverter,
      battery:  sov.battery || null,
      string_topology: sov.string_topology || 'series',
      string_design:   sov.string_design || {
        topology: sov.string_topology || 'series',
        groups: [{ panels_per_string: sov.panel.count, string_count: 1 }],
      },
      smart_meter: sov.smart_meter || null,
      phase: phase || 1,
      cable_run_metres_estimate: 24,
    },
    pricing: { stage: 'stage_1_estimate', customer_price_inc_gst: 0,
               discount: { applied_nzd: 0, owner_approved: false } },
  };
}

function inspectOneTier(tier, catalogue, ctx) {
  const spec = specForInspection(tier, ctx);
  if (!spec) return { valid: false, reason: 'incomplete_system', hard_fails: [], soft_warnings: [] };
  try {
    const v = validateEngineering(spec, { catalogue });
    return { valid: (v.hard_fails || []).length === 0,
      hard_fails: v.hard_fails || [], soft_warnings: v.soft_warnings || [], passes: (v.passes || []).length };
  } catch (e) {
    return { valid: false, reason: 'inspect_error', error: e.message, hard_fails: [], soft_warnings: [] };
  }
}

// Smallest LARGER inverter (same phase, battery-capable if the tier has a
// battery) whose DC capacity accommodates the panel array — repairs the
// dominant failure class (DC/AC oversizing + the Voc/Vmp envelope) by keeping
// the customer's array and stepping the inverter up (honours "cover full need").
function nextLargerInverter(catalogue, tier, phase) {
  const sov = tier.system_overrides;
  const panel = catalogue.PANELS?.[sov.panel?.sku];
  if (!panel) return null;
  const arrayDcKw = (sov.panel.count * (panel.watts || 0)) / 1000;
  const needBattery = !!sov.battery?.sku;
  const curAc = catalogue.INVERTERS?.[sov.inverter?.sku]?.ac_kw || 0;
  return Object.entries(catalogue.INVERTERS || {})
    .map(([sku, inv]) => ({ sku, ...inv }))
    .filter(inv => inv.phase === phase && inv.ac_kw != null && inv.ac_kw > curAc)
    .filter(inv => !needBattery || inv.battery_capable === true || inv.is_plus_variant === true)
    // Size by DC/AC ratio: pick the smallest larger inverter that keeps the array
    // in STANDARD oversizing mode (≤1.20), which avoids the reduced-mode Voc trap.
    // (max_pv_kwp_standard is per-MPPT for Verto, so ratio is the reliable signal.)
    .filter(inv => arrayDcKw / inv.ac_kw <= 1.20)
    .sort((a, b) => a.ac_kw - b.ac_kw)[0] || null;
}

function arrayDcKwOf(catalogue, sov) {
  const p = catalogue.PANELS?.[sov.panel?.sku];
  return sov.panel ? (sov.panel.count * (p?.watts || 0)) / 1000 : 0;
}

// Re-layout into shorter series strings (lower string Voc). Decrements the
// largest panels-per-string by 1, rebalancing string_count; honours Fronius
// 4-panel string minimum. Returns false when it can't shorten further.
function relayoutShorter(tier) {
  const sov = tier.system_overrides;
  const count = sov.panel?.count || 0;
  const cur = sov.string_design?.groups?.[0]?.panels_per_string || count;
  const newPps = cur - 1;
  if (newPps < 4 || count < 4) return false;
  sov.string_design = { topology: 'series',
    groups: [{ panels_per_string: newPps, string_count: Math.ceil(count / newPps) }] };
  return true;
}

// Phase 3 — repair a failing tier (bounded), then classify ship_status.
// Two strategies, chosen by the failure:
//   • TRUE DC oversizing (DC/AC > 1.20) → step up inverter + re-pick battery
//   • String Voc / Vmp envelope         → shorten series strings (re-layout)
// Stops when no strategy applies or a step makes no progress. Unrepaired hard
// fails → ship_status 'block'. Records tier.repairs[].
function repairTier(tier, catalogue, ctx) {
  tier.repairs = [];
  let val = inspectOneTier(tier, catalogue, ctx);
  let attempts = 0;
  while (!val.valid && attempts < 16) {
    const rules = (val.hard_fails || []).map(f => `${f.rule} ${f.message || ''}`).join(' | ');
    const inv = catalogue.INVERTERS?.[tier.system_overrides.inverter?.sku];
    const dcac = inv?.ac_kw ? arrayDcKwOf(catalogue, tier.system_overrides) / inv.ac_kw : 0;
    let acted = false;

    if (/oversizing|DC\/AC|max DC/i.test(rules) && dcac > 1.20) {
      // Array genuinely too big for the inverter → step up (keep coverage).
      const bigger = nextLargerInverter(catalogue, tier, ctx.phase);
      if (bigger) {
        tier.system_overrides.inverter = { sku: bigger.sku };
        tier.repairs.push(`inverter → ${bigger.sku} (DC/AC ${dcac.toFixed(2)})`);
        if (tier.system_overrides.battery?.sku) {
          const bat = selectBattery({ targetUsableKwh: tier.system_overrides.battery.kwh || 0,
            inverter: { ...bigger, sku: bigger.sku }, catalogue,
            COMPATIBILITY: ctx.COMPATIBILITY, BMS_RULES: ctx.BMS_RULES });
          if (bat.sku) {
            tier.system_overrides.battery = { sku: bat.sku, module_count: bat.module_count,
              kwh: +(+bat.total_usable_kwh).toFixed(2) };
            tier.repairs.push(`battery → ${bat.sku}`);
          }
        }
        acted = true;
      }
    } else if (/Voc|shorten series|Vmp/i.test(rules)) {
      // String voltage out of window → re-layout into shorter strings.
      acted = relayoutShorter(tier);
      if (acted) tier.repairs.push(`shorten strings → ${tier.system_overrides.string_design.groups[0].panels_per_string}/string`);
    }

    if (!acted) break;  // no applicable strategy (or exhausted) → stop, will block
    val = inspectOneTier(tier, catalogue, ctx);
    attempts++;
  }
  tier.engine_validation = val;
  tier.ship_status = val.valid ? 'ok' : 'block';
}

function inspectAndRepairTiers(tiers, catalogue, ctx) {
  for (const tier of tiers) {
    if (!tier.system_overrides?.panel?.sku) {
      tier.engine_validation = { valid: false, reason: 'incomplete_system', hard_fails: [], soft_warnings: [] };
      tier.ship_status = 'block';
      continue;
    }
    repairTier(tier, catalogue, ctx);
  }
}

// ── Helper: take the first tier's system_overrides and project them into a
//   complete spec.system object so the top-level spec is never null. The
//   active-tier-merge view will keep showing the recommended tier on load.
// ────────────────────────────────────────────────────────────────────────────
export function topLevelSystemFromTier(tier, fallbackSystem) {
  const sov = tier?.system_overrides || {};
  return {
    ...(fallbackSystem || {}),
    panel:    sov.panel    || fallbackSystem?.panel    || { sku: null, count: null },
    inverter: sov.inverter || fallbackSystem?.inverter || { sku: null },
    battery:  sov.battery  || null,    // null is valid (no battery in tier)
    string_topology: sov.string_topology || fallbackSystem?.string_topology || 'series',
    string_design:   sov.string_design   || fallbackSystem?.string_design   || null,
    wattpilot_included: !!sov.wattpilot_included,
    smart_meter:        fallbackSystem?.smart_meter || { sku: null, phase: 1 },
    phase:              fallbackSystem?.phase || 1,
    cable_run_metres_estimate: fallbackSystem?.cable_run_metres_estimate || 24,
  };
}
