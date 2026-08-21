// POC — design compose route.
//
// Calls the existing threeTierComposer (same engine PM staff use) with
// inputs derived from the bill + roof analysis. Returns Good/Better/Best
// tiers with real SKUs + real cost-engine prices from the live catalogue.
//
// Kept in the POC folder so bugs here can't affect the authenticated PM
// route at /api/pm/proposal-engine/compose-three-tiers.

import { Router } from 'express';
import { supabaseAdmin } from '../../config/supabase.js';
import { loadCatalogueFromDb } from '../../services/pm/proposalEngine/catalogue/dbLoader.js';
import { composeThreeTiers }   from '../../services/pm/proposalEngine/threeTierComposer.js';
import { runThreeScenarios, MONTHLY_YIELD_PCT }   from '../../services/pm/proposalEngine/financialModel.js';
import { REGIONS, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS }
  from '../../services/pm/proposalEngine/data/engineeringRules.js';

// Typical NZ residential defaults for the MANUAL-flow (no-bill) path — we
// can't compute exact old-bill trajectory without the customer's actual
// tariff, so we anchor to Auckland Vector's most-common residential rates.
// Used only when the client didn't send bill_context (which happens for
// every manual-entry customer). The FINANCIAL_DEFAULTS module holds
// buyback + inflation constants; these two are the residential retail
// rates that vary by household so they live here per-flow.
const DEFAULT_VARIABLE_RATE_INCL_GST = 0.31;   // $/kWh — Contact residential typical
const DEFAULT_DAILY_FIXED_INCL_GST   = 2.20;   // $/day — Vector residential typical

// Battery + EV addon constants for panel-count sizing (2026-08-19).
// Previously the sizing formula only considered baseline annual kWh — meaning
// batteries silently lost ~8% per cycle to round-trip inefficiency, and EV
// loads were entirely absent. Tier-3 with EV would show the same panel count
// as tier-1 (both sized to base usage only). Now we ADD both loads to
// `annualKwh` before dividing by yield, so higher tiers correctly grow the
// array to cover their additional loads.
const BATTERY_CYCLES_PER_YEAR = 300;   // ~5-6 cycles/week (weather-averaged)
const BATTERY_RTE             = 0.92;  // Round-trip efficiency (already in nz-retailer-rates.json)
const EV_KWH_PER_KM           = 0.20;  // Mid-range NZ EV (Tesla ~0.18, Leaf ~0.15, e-Niro ~0.22)
const EV_DEFAULT_KM_PER_DAY   = 40;    // Kept for legacy; individual customers can override
const MAX_RESIDENTIAL_KW      = 10;    // Cap kept per user decision — surface warning banner when exceeded

const router = Router();

// Derive recommended_system_kw from annualKwh + optional battery/EV loads.
// Precedence for yield (highest to lowest):
//   1. Per-address yield (Google sunshineQuantiles for Google-Solar path;
//      PVGIS-derived for LiDAR path). Passed in explicitly.
//   2. Regional yield (engineeringRules.REGIONS[postcode].yield_kwh_per_kwp_per_year).
//   3. NZ-mid fallback (1300) — last-resort when neither is available.
//
// Options (2026-08-19):
//   batteryKwh   — battery bank capacity in kWh. Extra load ≈ batteryKwh
//                  × BATTERY_CYCLES_PER_YEAR × (1 − BATTERY_RTE).
//   evKmPerDay   — EV daily driving distance in km. Extra load ≈ km
//                  × EV_KWH_PER_KM × 365.
// Both default 0 (no addon) so callers not aware of the new options still
// get identical behaviour to the pre-2026-08-19 formula.
//
// Returns a diagnostic object (was a single number) so callers can surface
// the cap-exceeded warning + audit the effective annual kWh used.
function recommendSizeKw(annualKwh, regionData, perAddressYieldKwhPerKwp, options = {}) {
  const { batteryKwh = 0, evKmPerDay = 0, roofCapKw = null } = options;
  const yieldKwhPerKwp = Number(perAddressYieldKwhPerKwp)
    || regionData?.yield_kwh_per_kwp_per_year
    || 1300;

  // Additional loads
  const batteryAnnualLoss = Number(batteryKwh) > 0
    ? Number(batteryKwh) * BATTERY_CYCLES_PER_YEAR * (1 - BATTERY_RTE)
    : 0;
  const evAnnualKwh = Number(evKmPerDay) > 0
    ? Number(evKmPerDay) * EV_KWH_PER_KM * 365
    : 0;
  const effectiveAnnualKwh = Number(annualKwh) + batteryAnnualLoss + evAnnualKwh;

  // Cover ~95% of effective consumption (export tariffs too low to justify oversizing)
  const rawKw = (effectiveAnnualKwh * 0.95) / yieldKwhPerKwp;

  // Two caps applied (whichever is lower wins):
  //   1. MAX_RESIDENTIAL_KW = 10 (business/regulatory — residential 3-phase)
  //   2. roofCapKw = physical roof capacity (client passes after first render
  //      once Cesium knows exactly how many panels fit — two-pass flow)
  const residentialCap = MAX_RESIDENTIAL_KW;
  const roofCap        = Number.isFinite(roofCapKw) && roofCapKw > 0 ? roofCapKw : Infinity;
  const cappedKw       = Math.min(rawKw, residentialCap, roofCap);

  // Snap-to-standard REMOVED for tighter tier differentiation. Composer/
  // panelSelector still handles panel-count integerisation via ceil(kw/watts).
  // 2026-08-19b — do NOT round to 2 dp when the roof cap is active:
  // a 5.355 kWp cap → 5.36 rounded → panelSelector's ceil(5.36/0.595) = 10
  // panels → exceeds the 9-panel physical fit → 3D vs tier-card mismatch.
  // Round DOWN to 4 dp instead so ceil() stays within roof capacity.
  const recommendedKw = Math.floor(cappedKw * 10000) / 10000;

  return {
    recommendedKw,
    effectiveAnnualKwh: Math.round(effectiveAnnualKwh),
    batteryAnnualLoss:  Math.round(batteryAnnualLoss),
    evAnnualKwh:        Math.round(evAnnualKwh),
    wasCapExceeded:     rawKw > residentialCap,     // residential (10 kW) cap hit
    wasRoofCapped:      rawKw > roofCap,             // physical roof cap hit
    rawKw:              Number(rawKw.toFixed(2)),
    yieldKwhPerKwpUsed: yieldKwhPerKwp,
    roofCapKwUsed:      Number.isFinite(roofCap) ? Number(roofCap.toFixed(2)) : null,
  };
}

// Battery sizing — mirrors billAnalysisService: enough for the typical
// evening peak (~35% of daily load), capped at 13.5 kWh single tower.
function recommendBatteryKwh(annualKwh) {
  const daily = annualKwh / 365;
  const evening = daily * 0.35;
  return Math.min(Math.max(Math.round(evening * 2) / 2, 5), 13.5); // 0.5-step, 5-13.5
}

// Guess NZ region from postcode. Falls back to Auckland.
// NZ postcodes: 0xxx (Northland/Auckland north), 1xxx (Auckland),
// 2xxx (South Auckland/Waikato), 3xxx (Waikato/BoP), 4xxx (lower NI),
// 5xxx (Wellington), 6xxx (Nelson/Marlborough), 7xxx (Canterbury),
// 8xxx (Otago), 9xxx (Southland).
function regionFromPostcode(pc) {
  const n = parseInt(String(pc || '').slice(0, 4), 10);
  if (!Number.isFinite(n)) return 'auckland_vector';
  if (n >= 8000 && n <= 8999) return 'christchurch_orion';
  if (n >= 6000 && n <= 6999) return 'wellington_wellington_electricity';
  if (n >= 5000 && n <= 5999) return 'wellington_wellington_electricity';
  return 'auckland_vector';
}

// ── POST /api/poc/design/compose ──────────────────────────────────────────
router.post('/compose', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const {
      annual_kwh,
      postcode,
      phase = 1,
      // Week-7: caller (QuotePage) forwards
      // roof.system_yield.kwh_per_kwp_per_year + .source from analyse.
      // When present, overrides the regional-yield default in sizing.
      system_yield_kwh_per_kwp_per_year = null,
      // 'google_sunshine_quantiles' (Phase 1) | 'pvgis' (Phase 2) | null
      system_yield_source = null,
      // Phase 2 (2026-08-14) — tariff context for runThreeScenarios.
      // Client sends what it has from the bill parser; anything null falls
      // back to NZ residential defaults. Manual-flow customers omit this
      // entirely — server uses defaults + slider-derived annual_kwh, and
      // the response's `financials.tariff_source` reports 'default'.
      bill_context = null,   // { annual_spend?, variable_rate_incl_gst?, daily_fixed_incl_gst?, buyback_rate? }
      // V3 (2026-08-18) — PVGIS per-address monthly kWh/kWp (Jan→Dec array).
      // Client forwards `roof.system_yield.monthly_kwh_per_kwp` when the
      // roof analysis went through PVGIS (LiDAR path). Google Solar path
      // omits it; server falls back to the Auckland MONTHLY_YIELD_PCT
      // shape so the chart still renders.
      system_yield_monthly_kwh_per_kwp = null,
      // 2026-08-19 · customer-adjustable battery + EV, per-tier sizing.
      // battery_kwh: bank capacity in kWh (client slider). When null, we
      //   use the engine's recommendation for tier 2/3.
      // ev_km_per_day: daily EV distance in km (client input). When null
      //   OR 0, EV load is excluded from tier sizing; when >0, applied
      //   to tier 3 (and any tier flagged as EV-enabled).
      battery_kwh          = null,
      ev_km_per_day        = null,
      // 2026-08-19 · roof-fit-aware sizing. Client passes actual max
      // panels rendered by Cesium after first draw (via onPlacementReady
      // callback). Server caps each tier's kwp to what physically fits.
      // Also panel_watts so the cap correctly converts to kwp for THIS
      // customer's panel model (Phono 595W = 5.95 kW per 10 panels).
      // Both optional; null = no roof cap applied (first-pass behaviour).
      roof_max_panels      = null,
      panel_watts          = null,
    } = req.body || {};
    if (typeof annual_kwh !== 'number' || annual_kwh <= 0) {
      return res.status(400).json({
        error: 'annual_kwh (positive number, kWh over 12 months) required in body.',
      });
    }

    // Region → REGIONS lookup (used by composer for regional irradiance +
    // network + labour rates when the catalogue's compliance sheet needs it).
    const regionKey = regionFromPostcode(postcode);
    const regionData = REGIONS[regionKey] || REGIONS.auckland_vector;

    // Yield actually used for sizing — audit trail so the UI can show
    // customers "based on Google's per-address roof analysis" vs
    // "based on PVGIS satellite data" vs "based on Auckland regional average".
    // Sources (in preference order):
    //   'per_address_google_sunshine' — from Google Solar's sunshineQuantiles
    //   'per_address_pvgis'            — from PVGIS PVcalc (LiDAR-path fallback)
    //   'regional_default'             — engineeringRules.REGIONS[postcode]
    //   'nz_mid_fallback'              — 1300 hardcoded (last resort)
    let yield_source;
    if (Number(system_yield_kwh_per_kwp_per_year) > 0) {
      if (system_yield_source === 'pvgis')                        yield_source = 'per_address_pvgis';
      else if (system_yield_source === 'google_sunshine_quantiles') yield_source = 'per_address_google_sunshine';
      else                                                          yield_source = 'per_address_unknown_source';
    } else if (regionData?.yield_kwh_per_kwp_per_year) {
      yield_source = 'regional_default';
    } else {
      yield_source = 'nz_mid_fallback';
    }
    const yield_kwh_per_kwp_per_year_used = Number(system_yield_kwh_per_kwp_per_year)
      || regionData?.yield_kwh_per_kwp_per_year
      || 1300;

    // 2026-08-19 · Per-tier sizing accounts for battery losses + EV load.
    //   Tier 1: no battery, no EV     → base sizing (customer usage only)
    //   Tier 2: battery, no EV        → base + battery cycling losses
    //   Tier 3: battery + EV          → base + battery losses + EV annual load
    // battery_kwh from client (slider) overrides engine's recommendation.
    // ev_km_per_day from client input; 0 = explicit "no EV", null/undefined
    // = legacy behaviour (tier 3 still gets Wattpilot + EV_DEFAULT_KM_PER_DAY
    // load added to its sizing, matching the pre-2026-08-19 tier 3 spec).
    const recommendedBatteryKwh = recommendBatteryKwh(annual_kwh);
    const useBatteryKwh = Number.isFinite(battery_kwh) && battery_kwh >= 0
      ? Number(battery_kwh)
      : recommendedBatteryKwh;

    // EV opt-in logic — three states:
    //   null / undefined  → client didn't ask (legacy) → tier 3 = EV-ready
    //                        with EV_DEFAULT_KM_PER_DAY load
    //   0                  → client explicitly disabled → tier 3 no EV
    //   > 0                → client specified km/day  → tier 3 EV with that load
    const evClientDidNotAsk = ev_km_per_day === null || ev_km_per_day === undefined;
    const tier3EvEnabled = evClientDidNotAsk
      ? true
      : Number(ev_km_per_day) > 0;
    const tier3EvKmPerDay = tier3EvEnabled
      ? (Number(ev_km_per_day) > 0 ? Number(ev_km_per_day) : EV_DEFAULT_KM_PER_DAY)
      : 0;

    // Derive roof cap in kWp from client-supplied max panels + panel watts.
    // 595W is the platform default (Phono) when client omits panel_watts —
    // it's the ORDER OF MAGNITUDE that matters here; a wrong-model wattage
    // shifts cap by <10%, well within the 25% packing/setback fudge.
    const effectivePanelWatts = Number.isFinite(panel_watts) && panel_watts > 0 ? Number(panel_watts) : 595;
    const roofCapKw = Number.isFinite(roof_max_panels) && roof_max_panels > 0
      ? Number(roof_max_panels) * effectivePanelWatts / 1000
      : null;

    const commonSizingOptions = { roofCapKw };
    // 2026-08-19b — EV toggle now applies to BOTH tier 2 and tier 3
    // when user opts in. Tier 1 stays bare (solar only, no battery,
    // no EV). Legacy behavior (client didn't send ev_km_per_day) still
    // gives tier 3 alone the EV; only user-driven toggle propagates
    // to tier 2 as well.
    const userExplicitlySetEv = !evClientDidNotAsk;
    const tier2EvKmPerDay = userExplicitlySetEv ? tier3EvKmPerDay : 0;

    const tier1Sizing = recommendSizeKw(annual_kwh, regionData, system_yield_kwh_per_kwp_per_year, { ...commonSizingOptions, batteryKwh: 0, evKmPerDay: 0 });
    const tier2Sizing = recommendSizeKw(annual_kwh, regionData, system_yield_kwh_per_kwp_per_year, { ...commonSizingOptions, batteryKwh: useBatteryKwh, evKmPerDay: tier2EvKmPerDay });
    const tier3Sizing = recommendSizeKw(annual_kwh, regionData, system_yield_kwh_per_kwp_per_year, { ...commonSizingOptions, batteryKwh: useBatteryKwh, evKmPerDay: tier3EvKmPerDay });

    const anyCapExceeded  = tier1Sizing.wasCapExceeded || tier2Sizing.wasCapExceeded || tier3Sizing.wasCapExceeded;
    const anyRoofCapped   = tier1Sizing.wasRoofCapped  || tier2Sizing.wasRoofCapped  || tier3Sizing.wasRoofCapped;

    // Legacy field for code paths that read `recommended_system_kw` directly
    // (financial calcs, downstream utilities). Populate from tier 2 since
    // that's the "recommended" tier in the tri-fold display.
    const billAnalysis = {
      annual_kwh,
      recommended_system_kw:  tier2Sizing.recommendedKw,
      recommended_battery_kwh: useBatteryKwh,
      // NEW: per-tier kwp override for composer's `per_tier` sizeMode
      tier_kwp_override:       [tier1Sizing.recommendedKw, tier2Sizing.recommendedKw, tier3Sizing.recommendedKw],
      // NEW: EV toggle propagation — composer needs to know if tier 3
      // should include Wattpilot SKU regardless of default `hasEv` rule.
      tier3_ev_enabled:        tier3EvEnabled,
      // 2026-08-19b — EV can now also apply to tier 2 when user
      // explicitly toggles it on. Legacy calls (client didn't send
      // ev_km_per_day) keep tier 2 EV-free (matches historical).
      tier2_ev_enabled:        userExplicitlySetEv && tier3EvEnabled,
      region: regionKey,
      yield_kwh_per_kwp_per_year_used,
      yield_source,
      // Diagnostics — surfaced in response so UI can show effective-usage
      // audit trail + cap-exceeded warning.
      _sizing_diagnostics: {
        battery_kwh_used:    useBatteryKwh,
        ev_km_per_day_used:  tier3EvKmPerDay,
        tier1_effective_kwh: tier1Sizing.effectiveAnnualKwh,
        tier2_effective_kwh: tier2Sizing.effectiveAnnualKwh,
        tier3_effective_kwh: tier3Sizing.effectiveAnnualKwh,
        battery_annual_loss: tier2Sizing.batteryAnnualLoss,
        ev_annual_kwh:       tier3Sizing.evAnnualKwh,
        any_cap_exceeded:    anyCapExceeded,
        any_roof_capped:     anyRoofCapped,
        roof_cap_kw:         roofCapKw,
        roof_max_panels:     Number.isFinite(roof_max_panels) ? Number(roof_max_panels) : null,
        raw_kw_tier1:        tier1Sizing.rawKw,
        raw_kw_tier2:        tier2Sizing.rawKw,
        raw_kw_tier3:        tier3Sizing.rawKw,
      },
    };

    // Load the live catalogue.
    const catalogue = await loadCatalogueFromDb(supabaseAdmin);

    // Run the composer. sizeMode='per_tier' (2026-08-19) tells it to honour
    // billAnalysis.tier_kwp_override — each tier gets its own kwp sized for
    // its load profile (base / +battery losses / +battery losses+EV load).
    // Previously 'same_size' forced t1=t2=t3=recKw which meant all 3 tiers
    // always showed the same panel count — misleading in the 3-tier UI.
    const out = composeThreeTiers({
      billAnalysis,
      phase: Number(phase) || 1,
      region: regionData,
      sizeMode: 'per_tier',
      catalogue,
      COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS,
    });

    // Battery slider bounds — surfaced so the client's Customise-System
    // panel can render a slider with the correct min/max/step from the
    // live catalogue instead of hardcoding values.
    // BYD HVM (the primary residential battery product) is stackable in
    // 2.76 kWh modules; that's the natural step. Max is the largest
    // usable_kwh in the catalogue's battery table.
    const batteryProducts = Object.values(catalogue?.BATTERIES || {})
      .map(row => ({
        sku:        row.sku,
        name:       row.name,
        usable_kwh: Number(row.usable_kwh || row.capacity_kwh || 0),
      }))
      .filter(b => Number.isFinite(b.usable_kwh) && b.usable_kwh > 0)
      .sort((a, b) => a.usable_kwh - b.usable_kwh);
    const maxBatteryKwh = batteryProducts.length > 0
      ? batteryProducts[batteryProducts.length - 1].usable_kwh
      : 22.08;   // fallback: 8 × BYD HVM modules
    const battery_bounds = {
      min_kwh:  0,
      max_kwh:  maxBatteryKwh,
      step_kwh: 2.76,             // BYD HVM module size
      products: batteryProducts,
    };

    // Catalogue stores products keyed by SKU already: catalogue.PANELS,
    // catalogue.INVERTERS, catalogue.BATTERIES are objects like
    // { 'PHN-PNL-475-QSR': {...row} }. Direct lookup below.

    // Trim the tiers down to what the POC UI needs — the full composer output
    // is ~50 fields per tier and includes rep-facing diagnostics we don't
    // want customers seeing.
    const tiers = (out.tiers || []).map(t => {
      const sov = t.system_overrides || {};
      const panelRow    = sov.panel?.sku    ? (catalogue.PANELS      || {})[sov.panel.sku]    : null;
      const inverterRow = sov.inverter?.sku ? (catalogue.INVERTERS   || {})[sov.inverter.sku] : null;
      const batteryRow  = sov.battery?.sku  ? (catalogue.BATTERIES   || {})[sov.battery.sku]  : null;
      const panelWatts  = panelRow?.watts ?? sov.panel?.watts_per_panel ?? null;
      const panelCount  = sov.panel?.count ?? null;
      return {
        label:            t.label,
        is_recommended:   !!t.is_recommended,
        panel: panelCount ? {
          sku:   sov.panel.sku,
          name:  panelRow?.name || sov.panel.name || sov.panel.sku,
          count: panelCount,
          watts: panelWatts,
          total_kwp: panelWatts ? +(panelCount * panelWatts / 1000).toFixed(2) : null,
          // Real physical dimensions from catalogue — threaded through to
          // Cesium3DView so panels render at true footprint size instead of
          // panelGrid's 1.65×0.99 fallback (POCed against Phono 595W which
          // is actually 1.879×1.045). Null when catalogue row lacks dims.
          length_mm: panelRow?.length_mm ?? null,
          width_mm:  panelRow?.width_mm  ?? null,
        } : null,
        inverter: sov.inverter?.sku ? {
          sku:   sov.inverter.sku,
          name:  inverterRow?.name || sov.inverter.name || sov.inverter.sku,
          ac_kw: inverterRow?.ac_kw ?? sov.inverter.ac_kw ?? null,
        } : null,
        battery: sov.battery?.sku ? {
          sku:  sov.battery.sku,
          name: batteryRow?.name || sov.battery.name || sov.battery.sku,
          usable_kwh: sov.battery.kwh ?? batteryRow?.usable_kwh ?? batteryRow?.capacity_kwh ?? null,
          module_count: sov.battery.module_count ?? null,
        } : null,
        wattpilot_included: !!sov.wattpilot_included,
        price_inc_gst:    t.pricing?.customer_price_inc_gst ?? null,
        engine_warnings:  t.engine_warnings || [],
      };
    });

    // ── Phase 2: financial deep-dive for the RECOMMENDED tier ──────────────
    //
    // Reuses the production PDF proposal engine's runThreeScenarios (which
    // internally calls runFinancialModel) to produce:
    //   - Payback years (inflation + degradation methodology)
    //   - Year-1 savings, ROI %, old vs new bill
    //   - 30-year cash flow with cumulative savings (drives the F3 line chart)
    //   - Conservative / Expected / Optimistic scenarios (F6 side-by-side table)
    //
    // Failures here MUST NOT break the POC — customers still get their tiers
    // + roof view without financials. We log the reason and continue with
    // `financials: null` so the UI falls back to hiding the F1/F3/F6 sections.
    let financials = null;
    let financialsDebug = null;   // Populated on failure to help diagnose from browser Network tab
    try {
      const recTier   = out.tiers?.[out.recommended_index];
      const sov       = recTier?.system_overrides;
      const panelSku  = sov?.panel?.sku;
      const invSku    = sov?.inverter?.sku;
      const panelCnt  = sov?.panel?.count;

      // Resolve tariff inputs. Bill flow → client sent bill_context with
      // actual retailer rates. Manual flow → client sent nothing; fall back
      // to NZ residential typicals + derive annual_spend from usage + rate.
      const ctx = bill_context || {};
      const variableRate = Number(ctx.variable_rate_incl_gst) || DEFAULT_VARIABLE_RATE_INCL_GST;
      const dailyFixed   = Number(ctx.daily_fixed_incl_gst)   || DEFAULT_DAILY_FIXED_INCL_GST;
      const buybackRate  = Number(ctx.buyback_rate)            || 0.09;
      const annualSpend  = Number(ctx.annual_spend)
                         || +(annual_kwh * variableRate + 365 * dailyFixed).toFixed(2);
      const tariffSource = ctx.annual_spend ? 'bill' : 'default';

      // Minimum viable spec — only the fields runFinancialModel + downstream
      // helpers actually read. String topology defaults to series (no
      // clipping loss) which is right for the vast majority of residential
      // installs and safe when the composer hasn't published its choice.
      const spec = {
        customer: { address: { region: regionKey } },
        system: {
          panel:    { sku: panelSku, count: panelCnt },
          inverter: { sku: invSku },
          battery:  sov?.battery?.sku
            ? { sku: sov.battery.sku, module_count: sov.battery.module_count || 1 }
            : null,
          string_topology: 'series',
          string_design:   { string_count: 1 },
        },
        bills: {
          manual_entry: {
            annual_kwh,
            annual_spend: annualSpend,
            variable_rate_per_kwh_incl_gst: variableRate,
            daily_fixed_charge_incl_gst:    dailyFixed,
            buyback_rate:                   buybackRate,
          },
        },
      };
      // runFinancialModel reads costResult.totals.customer_total_inc_gst
      // (line 167 of financialModel.js). Guard early when the composer
      // returned null pricing so the caught error is descriptive rather
      // than an obscure "reading undefined property".
      const installCost = Number(recTier?.pricing?.customer_price_inc_gst);
      if (!Number.isFinite(installCost) || installCost <= 0) {
        throw new Error(`Composer returned no tier price (customer_price_inc_gst=${recTier?.pricing?.customer_price_inc_gst}) — financials skipped`);
      }
      const costResult = {
        totals: { customer_total_inc_gst: installCost },
      };

      const scenarios = runThreeScenarios(spec, costResult);

      // Trim response for the POC UI. runThreeScenarios returns
      //   { summary, conservative, expected, optimistic, headline }
      // (direct scenario keys, not nested under `results`). Each scenario's
      // yearly[] carries `cumulative` which starts NEGATIVE (net-of-
      // install-cost) and crosses 0 at payback. For the "how much you save"
      // narrative we want CUMULATIVE SAVINGS (Σyearly savings) — which is
      // `cumulative + installCost`. Compute once here so the client's F3
      // chart + F1 card can read the same `cum_savings` field.
      const exp = scenarios.expected;
      const cashflow = (exp.yearly || []).map(row => ({
        year_n:         row.year_n,
        generation_kwh: row.generation_kwh,
        savings:        row.savings,
        old_bill:       row.old_bill,
        new_bill:       row.new_bill,
        cum_savings:    (Number(row.cumulative) || 0) + installCost,   // Σsavings from year 1
        net_cashflow:   row.net_cashflow,   // includes -installCost in yr 1
      }));

      // ── E1 · Environmental impact ─────────────────────────────────────
      // Grid CO2 factor: 0.115 kg CO2/kWh (MfE 2023 NZ grid average — mix
      // of ~85% renewable, ~15% fossil peakers). Equivalents chosen for
      // customer intuition:
      //   - 22 kg CO2/yr = ~1 mature tree's annual absorption (EPA)
      //   - 4,600 kg CO2/yr = NZ passenger car average (MoT 2023)
      //   - ~4,000 kg CO2 = AKL↔LON return flight economy (myclimate.org)
      const NZ_GRID_KG_CO2_PER_KWH   = 0.115;
      const TREE_KG_CO2_PER_YEAR     = 22;
      const CAR_KG_CO2_PER_YEAR      = 4600;
      const FLIGHT_KG_CO2_ROUND_TRIP = 4000;
      const lifetimeKwh = cashflow.reduce((s, r) => s + (Number(r.generation_kwh) || 0), 0);
      const lifetimeCo2Kg = lifetimeKwh * NZ_GRID_KG_CO2_PER_KWH;
      const annualCo2Kg = lifetimeCo2Kg / (cashflow.length || 1);
      const environmental = {
        lifetime_kwh:        Math.round(lifetimeKwh),
        lifetime_co2_kg:     Math.round(lifetimeCo2Kg),
        lifetime_co2_tonnes: +(lifetimeCo2Kg / 1000).toFixed(1),
        annual_co2_kg:       Math.round(annualCo2Kg),
        equiv_trees:         Math.round(annualCo2Kg / TREE_KG_CO2_PER_YEAR),
        equiv_cars:          +(annualCo2Kg / CAR_KG_CO2_PER_YEAR).toFixed(1),
        equiv_flights:       Math.round(lifetimeCo2Kg / FLIGHT_KG_CO2_ROUND_TRIP),
      };
      // V3 · monthly generation for the seasonal chart.
      // If we have PVGIS per-address monthly (LiDAR path) → use its SHAPE
      // (proportions) and scale to the expected-scenario yr1 generation so
      // the chart's annual sum matches the F1/F3 headline numbers exactly.
      // Otherwise fall back to the Auckland MONTHLY_YIELD_PCT shape.
      const yr1Gen = Number(exp.yr1.generation_kwh) || 0;
      const pvgisMonthly = Array.isArray(system_yield_monthly_kwh_per_kwp)
        && system_yield_monthly_kwh_per_kwp.length === 12
        && system_yield_monthly_kwh_per_kwp.every(v => Number.isFinite(v) && v >= 0)
          ? system_yield_monthly_kwh_per_kwp : null;
      const monthlySource = pvgisMonthly ? 'pvgis_per_address' : 'nz_regional_default';
      let monthlyProportions;
      if (pvgisMonthly) {
        const total = pvgisMonthly.reduce((s, v) => s + v, 0);
        monthlyProportions = total > 0 ? pvgisMonthly.map(v => v / total) : MONTHLY_YIELD_PCT;
      } else {
        monthlyProportions = MONTHLY_YIELD_PCT;
      }
      const monthlyGenerationKwh = monthlyProportions.map(p => Math.round(p * yr1Gen));

      financials = {
        tariff_source: tariffSource,  // 'bill' | 'default' — for the UI note
        monthly_source: monthlySource,   // 'pvgis_per_address' | 'nz_regional_default'
        monthly_generation_kwh: monthlyGenerationKwh,   // Jan→Dec, sums to yr1 generation
        expected: {
          yr1_generation:       exp.yr1.generation_kwh,
          yr1_self_consumption: exp.yr1.self_consumed_kwh,
          yr1_old_bill:         exp.yr1.old_bill,
          yr1_new_bill:         exp.yr1.new_bill,
          yr1_savings:          exp.yr1.savings,
          payback_yrs:          exp.payback_inflation_degradation_yrs,
          payback_discounted_yrs: exp.payback_discounted_yrs,
          roi_pct:              exp.total_roi_pct,
          cum_25yr_savings:     cashflow[24]?.cum_savings ?? null,
          cum_30yr_savings:     cashflow[29]?.cum_savings ?? null,
          install_cost:         installCost,
        },
        cashflow,   // 30-year rows for F3 chart
        scenarios_summary: scenarios.summary || [],   // 3 rows for F6 table
        environmental,   // E1 environmental impact card data
      };
    } catch (e) {
      // Non-fatal: POC continues without financials. Full stack in server
      // log so we can debug missing SKUs / catalogue mismatches without the
      // customer seeing anything except missing F1/F3/F6 sections.
      console.warn('[poc/design] runThreeScenarios failed:', e?.message || String(e));
      if (e?.stack) {
        console.warn('[poc/design]   stack (first 6 lines):');
        e.stack.split('\n').slice(0, 6).forEach(l => console.warn('    ' + l));
      }
      // Also log the inputs so we can reproduce the error in isolation
      // without needing the full client flow again. Same info goes into
      // financialsDebug for browser-network-tab visibility.
      const recTier = out.tiers?.[out.recommended_index];
      const inputs = {
        panel_sku:     recTier?.system_overrides?.panel?.sku    ?? null,
        panel_count:   recTier?.system_overrides?.panel?.count  ?? null,
        inverter_sku:  recTier?.system_overrides?.inverter?.sku ?? null,
        battery_sku:   recTier?.system_overrides?.battery?.sku  ?? null,
        tier_price:    recTier?.pricing?.customer_price_inc_gst ?? null,
        region:        regionKey,
        annual_kwh,
      };
      try {
        console.warn('[poc/design]   inputs:', JSON.stringify(inputs));
      } catch { /* logging is best-effort */ }
      financialsDebug = {
        error: e?.message || String(e),
        stack: (e?.stack || '').split('\n').slice(0, 4),
        inputs,
      };
    }

    return res.json({
      bill_analysis: billAnalysis,
      region: regionKey,
      recommended_index: out.recommended_index,
      fallback_used:     out.fallback_used,
      fallback_reason:   out.fallback_reason || null,
      warnings:          out.warnings || [],
      tiers,
      financials,   // null on failure — client renders without F1/F3/F6
      battery_bounds,             // NEW: min/max/step + product list for Customise slider
      _financials_debug: financialsDebug,   // dev-only diagnostic when financials is null
    });
  } catch (e) {
    console.error('[poc/design] compose failed:', e);
    return res.status(500).json({ error: e.message || 'Design compose failed.' });
  }
});

export default router;
