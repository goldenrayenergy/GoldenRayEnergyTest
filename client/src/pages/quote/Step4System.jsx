// Step4System — merged flow's tier presentation (B1.5-PARITY rewrite, 2026-08-20).
//
// FULL POC PARITY. Renders POC's QuoteStage directly so the merged /get-quote
// residential wizard shows exactly what /poc/quote shows: 3D Cesium + status
// strip (score / planes / payback / save 25yr / impact / details drawers) +
// RoofAtAGlanceStrip + Customise sliders (battery + EV) + energy flow replay
// + roof-fit warning banner + per-tier live re-price on slider changes.
//
// The composeDesign function + all state hooks are lifted from POC/QuotePage
// verbatim so behavior is byte-identical to what customers see on /poc/quote.
// Two overrides for the merged flow:
//   • QuoteStage's `onBookOverride` prop routes "Book site visit" → my Step 5
//     instead of opening POC's inline lead drawer.
//   • The bill state is synthesised from Step 1's usage for estimate/manual
//     paths (kwh_total + days_in_period + _manual_entry marker) so composeDesign
//     works uniformly for bill / spend / kWh input paths.
//
// Phase E consolidates this + POC/QuotePage's composeDesign into a shared hook.

import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertTriangle, ChevronLeft } from 'lucide-react';
import { publicApi } from '../../services/api';
import { QuoteStage } from '../poc/QuotePage.jsx';
import {
  TIER_SOLAR_ONLY,
  TIER_SOLAR_BATTERY,
  TIER_SOLAR_BATTERY_EV,
} from '../../lib/tierIndex';

/**
 * @param {object}   props
 * @param {object}   props.usage        — from Step 1: { tab, bill, monthlySpend, annualKwh }
 * @param {object}   props.address      — from Step 2
 * @param {object}   props.analysis     — from Step 3
 * @param {object}   [props.design]     — cached compose result if returning
 * @param {function} props.onDesignChange
 * @param {function} props.onTierChosen  — { tierId, tier } — advance to Step 5
 * @param {function} props.onBack
 */
export default function Step4System({
  usage, address, analysis,
  design, onDesignChange, onTierChosen, onBack,
}) {
  // ── Synthesize a bill-shaped object for composeDesign ──────────────────
  // If Step 1's bill flow ran, use the real bill. If spend/kWh sliders,
  // fake enough of a bill to satisfy composeDesign's contract. The
  // `_manual_entry: true` marker tells composeDesign to skip tariff
  // derivation from bill line-items (server falls back to NZ defaults).
  const bill = usage?.bill || {
    kwh_total:      usage?.annualKwh,
    days_in_period: 365,
    total_nzd:      usage?.monthlySpend ? usage.monthlySpend * 12 : null,
    service_postcode: null,
    _manual_entry:  true,
  };

  // ── State (lifted from POC/QuotePage.jsx verbatim, same semantics) ─────
  const [material, setMaterial]                 = useState('unsure');
  const [designing, setDesigning]               = useState(false);
  const [designError, setDesignError]           = useState(null);
  const [roofRenderedPanels, setRoofRenderedPanels] = useState(null);
  const roofFitAppliedRef                        = useRef(false);
  // PR-D-2 fix (2026-08-24): per-tier customisation state so sliding on
  // one tier's card doesn't restack the OTHER tier (Bug 11). Bug 1 fix
  // (2026-08-26): canonicalised on 0-indexed tier keys via TIER_INDEX
  // constants — previously reads mixed 0-indexed writes with human-numbered
  // (2/3) reads and dropped every tier-3 customisation into tier-2's slot.
  // Shape:
  //   { [TIER_SOLAR_BATTERY]: { battery_kwh: X, ev_km_per_day: Y, panels_target: N },
  //     [TIER_SOLAR_BATTERY_EV]: { ... } }
  // Only tiers with battery/EV render those sliders; the panels slider is
  // available for every tier. Any tier with no entry falls back to the
  // engine-recommended defaults on that tier.
  const [customByTier, setCustomByTier] = useState({});
  // Convenience getters/setters aligned with what QuoteStage +
  // CustomiseSystemCard already expect. viewingTierIdx flows in from
  // QuoteStage so the card reads/writes the currently-viewed tier.
  const getCustomBatteryKwh = useCallback(
    (tierIdx) => customByTier[tierIdx]?.battery_kwh ?? null,
    [customByTier],
  );
  const getCustomEvKmPerDay = useCallback(
    (tierIdx) => customByTier[tierIdx]?.ev_km_per_day ?? null,
    [customByTier],
  );
  const setCustomBatteryKwhForTier = useCallback((tierIdx, value) => {
    setCustomByTier(prev => ({ ...prev, [tierIdx]: { ...(prev[tierIdx] || {}), battery_kwh: value } }));
  }, []);
  const setCustomEvKmPerDayForTier = useCallback((tierIdx, value) => {
    setCustomByTier(prev => ({ ...prev, [tierIdx]: { ...(prev[tierIdx] || {}), ev_km_per_day: value } }));
  }, []);
  // PR-E fix (2026-08-24): panel-count per-tier state (Bug 4).
  const getCustomPanels = useCallback(
    (tierIdx) => customByTier[tierIdx]?.panels_target ?? null,
    [customByTier],
  );
  const setCustomPanelsForTier = useCallback((tierIdx, value) => {
    setCustomByTier(prev => ({ ...prev, [tierIdx]: { ...(prev[tierIdx] || {}), panels_target: value } }));
  }, []);
  const [excludedSegments, setExcludedSegments]  = useState(() => new Set());
  const toggleSegment = useCallback((idx) => {
    setExcludedSegments(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  // ── Refs to prevent double-compose on initial mount + on re-entry ──────
  const skipFirstMountRef = useRef(true);      // one-shot for initial compose
  const skipFirstChangeRef = useRef(true);     // debounce guards
  const skipFirstCustomiseRef = useRef(true);

  // ── composeDesign — copied from POC/QuotePage.jsx composeDesign ────────
  // Ref-passing for design so composeDesign can read the current tier
  // config for panel_watts without closing over stale state.
  const designRef = useRef(design);
  useEffect(() => { designRef.current = design; }, [design]);

  const composeDesign = useCallback(async () => {
    if (!bill?.kwh_total || !bill?.days_in_period) {
      setDesignError('Missing kWh usage. Try uploading a bill or setting the estimate slider.');
      return;
    }
    const annualKwh = Math.round((bill.kwh_total / bill.days_in_period) * 365);
    setDesignError(null);
    setDesigning(true);
    try {
      const billContext = bill._manual_entry ? null : (() => {
        const days = Number(bill.days_in_period) || 30;
        const annualSpend = Number(bill.total_nzd) > 0
          ? +((bill.total_nzd / days) * 365).toFixed(2)
          : null;
        const variableRate = Number(bill.variable_charge_nzd) > 0 && Number(bill.kwh_total) > 0
          ? +((bill.variable_charge_nzd * 1.15) / bill.kwh_total).toFixed(4)
          : null;
        const dailyFixed = Number(bill.fixed_charge_nzd) > 0
          ? +((bill.fixed_charge_nzd * 1.15) / days).toFixed(4)
          : null;
        return { annual_spend: annualSpend, variable_rate_incl_gst: variableRate, daily_fixed_incl_gst: dailyFixed, buyback_rate: null };
      })();

      // Recompute area-weighted yield from KEPT segments only (POC logic).
      const keptSegments = (analysis?.roof?.segments || []).filter((_, i) => !excludedSegments.has(i));
      let filteredYield = null;
      if (keptSegments.length > 0 && keptSegments.length !== (analysis?.roof?.segments?.length || 0)) {
        const withYield = keptSegments.filter(s => Number.isFinite(s._yieldKwhPerKwpPerYear) && Number(s?.stats?.areaMeters2) > 0);
        if (withYield.length > 0) {
          let areaSum = 0, weightedSum = 0;
          for (const s of withYield) {
            const a = Number(s.stats.areaMeters2);
            areaSum += a;
            weightedSum += a * s._yieldKwhPerKwpPerYear;
          }
          if (areaSum > 0) filteredYield = Math.round(weightedSum / areaSum);
        }
      }
      const effectiveYield = filteredYield != null
        ? filteredYield
        : (analysis?.roof?.system_yield?.kwh_per_kwp_per_year || null);
      const effectiveYieldSource = filteredYield != null
        ? `${analysis?.roof?.system_yield?.source || 'unknown'}+segment-filtered`
        : (analysis?.roof?.system_yield?.source || null);

      const recommendedPanelWatts = designRef.current?.tiers?.[designRef.current?.recommended_index]?.panel?.watts || 595;
      // Bug 1 fix (2026-08-26): reads canonicalised on 0-indexed TIER_*
      // constants, matching the 0-indexed viewingTierIdx used by the
      // Customise-card writes. Payload arrays are indexed [tier0, tier1,
      // tier2] with null slots meaning "engine default for that tier."
      const t2Battery = getCustomBatteryKwh(TIER_SOLAR_BATTERY);
      const t3Battery = getCustomBatteryKwh(TIER_SOLAR_BATTERY_EV);
      const t2Ev      = getCustomEvKmPerDay(TIER_SOLAR_BATTERY);
      const t3Ev      = getCustomEvKmPerDay(TIER_SOLAR_BATTERY_EV);
      const t1Panels  = getCustomPanels(TIER_SOLAR_ONLY);
      const t2Panels  = getCustomPanels(TIER_SOLAR_BATTERY);
      const t3Panels  = getCustomPanels(TIER_SOLAR_BATTERY_EV);
      const anyCustomBattery = t2Battery != null || t3Battery != null;
      const anyCustomEv      = t2Ev != null || t3Ev != null;
      const anyCustomPanels  = t1Panels != null || t2Panels != null || t3Panels != null;
      const { data } = await publicApi.post('/design/compose', {
        annual_kwh: annualKwh,
        postcode:   bill.service_postcode || null,
        system_yield_kwh_per_kwp_per_year: effectiveYield,
        system_yield_source:               effectiveYieldSource,
        system_yield_monthly_kwh_per_kwp:  analysis?.roof?.system_yield?.monthly_kwh_per_kwp || null,
        bill_context: billContext,
        roof_max_panels: Number.isFinite(roofRenderedPanels) && roofRenderedPanels > 0 ? roofRenderedPanels : null,
        panel_watts:     recommendedPanelWatts,
        battery_kwh:     null,
        ev_km_per_day:   null,
        battery_kwh_by_tier:    anyCustomBattery ? [null, t2Battery, t3Battery] : null,
        ev_km_per_day_by_tier:  anyCustomEv      ? [null, t2Ev,      t3Ev]      : null,
        // PR-E fix (2026-08-24): per-tier panel-count override (Bug 4).
        // Uses same idx convention as the other _by_tier arrays: [t1, t2, t3].
        // null slots keep engine defaults for that tier.
        panels_target_by_tier:  anyCustomPanels  ? [t1Panels, t2Panels, t3Panels] : null,
      });
      onDesignChange({ ...data, derived_annual_kwh: annualKwh });
    } catch (e) {
      setDesignError(e.response?.data?.error || e.message || 'Design compose failed.');
    } finally {
      setDesigning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill, analysis, excludedSegments, customByTier, roofRenderedPanels, onDesignChange, getCustomBatteryKwh, getCustomEvKmPerDay, getCustomPanels]);

  // ── Initial compose on mount (skipped if design already cached) ────────
  useEffect(() => {
    if (!skipFirstMountRef.current) return;
    if (design) { skipFirstMountRef.current = false; return; }
    if (!analysis || !bill) return;
    skipFirstMountRef.current = false;
    composeDesign();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, bill, design]);

  // ── Debounced re-compose on excluded-segments change (POC 500ms) ───────
  useEffect(() => {
    if (skipFirstChangeRef.current) { skipFirstChangeRef.current = false; return undefined; }
    const total = analysis?.roof?.segments?.length || 0;
    if (total > 0 && excludedSegments.size >= total) return undefined;
    const t = setTimeout(() => composeDesign(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludedSegments]);

  // ── Debounced re-compose on Customise slider changes (POC 800ms) ───────
  useEffect(() => {
    if (skipFirstCustomiseRef.current) { skipFirstCustomiseRef.current = false; return undefined; }
    const t = setTimeout(() => composeDesign(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customByTier]);

  // ── Fix C · one-shot roof-fit recompose ────────────────────────────────
  useEffect(() => {
    if (roofFitAppliedRef.current) return undefined;
    if (!Number.isFinite(roofRenderedPanels) || roofRenderedPanels <= 0) return undefined;
    if (!design?.tiers) return undefined;
    const anyTierExceedsRoof = design.tiers.some(
      t => Number.isFinite(t?.panel?.count) && t.panel.count > roofRenderedPanels,
    );
    if (!anyTierExceedsRoof) return undefined;
    roofFitAppliedRef.current = true;
    composeDesign();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roofRenderedPanels, design]);

  // Book-override hoisted into a wizard-Step-5 advance. QuoteStage passes
  // us the tier the customer is viewing when they click Book — we use that
  // as the chosen tier for Step 5.
  const handleBookOverride = useCallback(({ tier, recommendedTier }) => {
    const chosen = tier || recommendedTier;
    if (!chosen) return;
    // Try to derive a stable tier id from the tier object (POC uses index-based tiers).
    const tierId = chosen.id || chosen.key || chosen.name || chosen.label || 'chosen';
    onTierChosen({ tierId, tier: chosen });
  }, [onTierChosen]);

  // ── Early states (loading first compose, error, no design) ─────────────
  if (!analysis) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Missing roof analysis. Go back to Step 3.
      </div>
    );
  }
  if (designError && !design) {
    return (
      <div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-start gap-2 text-red-900">
            <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-bold">Couldn&apos;t design your system.</div>
              <div className="mt-1 text-sm">{designError}</div>
              <button
                type="button"
                onClick={() => { skipFirstMountRef.current = true; composeDesign(); }}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
        <div className="mt-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm text-[#55504A]"
          >
            <ChevronLeft className="w-4 h-4" /> Back to analysis
          </button>
        </div>
      </div>
    );
  }
  if (!design) {
    // First compose in flight — show a lightweight loader; QuoteStage takes
    // over as soon as design resolves.
    return (
      <div className="rounded-2xl border border-[#E3D9C4] bg-white p-12 text-center">
        <div className="w-8 h-8 mx-auto border-2 border-[#D9531E] border-t-transparent rounded-full animate-spin" />
        <div className="mt-4 text-sm text-[#55504A]">Sizing your system across 3 tiers…</div>
      </div>
    );
  }

  return (
    <QuoteStage
      analysis={analysis}
      design={design}
      material={material}
      bill={bill}
      excludedSegments={excludedSegments}
      onToggleSegment={toggleSegment}
      designing={designing}
      onBack={onBack}
      onReset={() => { /* not applicable in wizard — back handles it */ }}
      onRoofPlacementChange={setRoofRenderedPanels}
      /* PR-D-2 fix (2026-08-24): per-tier customisation state (Bug 11).
         QuoteStage's CustomiseSystemCard operates on `viewingTierIdx`,
         so we pass tier-aware getters + setters instead of two scalars.
         Bug 1 fix (2026-08-26): legacy scalar props canonicalised on
         TIER_SOLAR_BATTERY (0-indexed) so a stray consumer that still
         reads them gets tier-2's value (the previous default), not an
         orphan customByTier[2] read that was landing in tier-3's slot. */
      customBatteryKwh={getCustomBatteryKwh(TIER_SOLAR_BATTERY)}
      customEvKmPerDay={getCustomEvKmPerDay(TIER_SOLAR_BATTERY)}
      customByTier={customByTier}
      getCustomBatteryKwh={getCustomBatteryKwh}
      getCustomEvKmPerDay={getCustomEvKmPerDay}
      setCustomBatteryKwh={(v) => setCustomBatteryKwhForTier(TIER_SOLAR_BATTERY, v)}
      setCustomEvKmPerDay={(v) => setCustomEvKmPerDayForTier(TIER_SOLAR_BATTERY, v)}
      setCustomBatteryKwhForTier={setCustomBatteryKwhForTier}
      setCustomEvKmPerDayForTier={setCustomEvKmPerDayForTier}
      /* PR-E fix (2026-08-24): panel-count getters + setters (Bug 4). */
      getCustomPanels={getCustomPanels}
      setCustomPanelsForTier={setCustomPanelsForTier}
      onBookOverride={handleBookOverride}
      bookCtaLabel="Get this quote"
      stickyCommitBar
    />
  );
}
