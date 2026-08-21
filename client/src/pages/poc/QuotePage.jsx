// POC — new public quote flow.
//
// Route: /poc/quote (unlinked from any other page — reachable by direct URL only).
// Not shared with /get-quote — this is a standalone spike to validate the new UX:
//   Slice 1: bill upload → regex extract → display extracted fields
//   Slice 2: address confirm on LINZ aerial + Google Solar geometry  ← WE ARE HERE
//   Slice 3: Streetview + roof material picker
//   Slice 4: engine → three-tier proposal with panels drawn on roof
//
// Server-side counterpart:
//   server/routes/bills.js  — POST /api/bills/extract
//   server/routes/roof.js  — POST /api/roof/analyse
//                                 GET  /api/aerial/tile?z=&x=&y=
//   (mounted from server/app.js behind ENABLE_POC=true)

import { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { publicApi } from '../../services/api';
import {
  Upload, FileText, Loader2, CheckCircle, AlertTriangle, Sparkles, RefreshCw,
  MapPin, Home, Sun, LayoutGrid, ArrowLeft, Search, X,
  Zap, Battery, Award, Cpu, TrendingUp,
  TreePine, Car, Plane, Calendar, Phone, Mail, User,
  DollarSign, ChevronRight, Info,
} from 'lucide-react';

// Cesium 3D roof view — replaces the 2D GoogleAerial in AddressStage AND
// the 2D PanelOverlayHero in QuoteStage. Lazy so the 1.5 MB Cesium bundle
// only loads on this route, not the whole /poc namespace.
const Cesium3DView = lazy(() => import('./3d/Cesium3DView'));

// Shared with the sidebar Solar Quality Score card — same colour ramp so
// the "your roof rating" bar visually matches wherever we render it.
import { gradientCssStops } from './3d/panelColorScale';

// Leaflet — PreviewStage's draggable satellite map. Kept out of the top-level
// import so Cesium (heavier, later) doesn't hold Leaflet hostage in the same
// chunk. Icon-URL patch works around Leaflet's default marker resolution
// breaking under bundlers (Vite + Leaflet ships icon PNGs with relative
// paths that don't survive the build).
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon   from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
// eslint-disable-next-line no-underscore-dangle
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl:       markerIcon,
  shadowUrl:     markerShadow,
});

// ── stage labels ──
// Two parallel flows through the wizard:
//   BILL flow    — customer has (or drops) a bill; we parse it for real kWh
//                  + address + tariff, then confirm on the 3D roof view.
//   MANUAL flow  — customer wants to explore without uploading; they type
//                  an address + drag a consumption slider, we synthesise a
//                  bill and continue with an ESTIMATED quote (with an
//                  amber banner on QuoteStage pointing them at bill upload
//                  for exact pricing).
// Both flows share stages 3-7 (preview → address → material → design → quote),
// so the progress rail always shows 7 steps; only the second label differs.
// 'preview' (2026-08-18) is a lightweight aerial confirm BEFORE we spend
// LiDAR+PVGIS+Google-Solar compute — Google Static Maps satellite tile with
// a pin at the geocoded coord. Yes → runs analysis; No → back to address input.
const STAGES_BILL = [
  { key: 'upload',   title: 'Your bill'     },
  { key: 'extract',  title: 'Confirm bill'  },
  { key: 'preview',  title: 'Your house'    },
  { key: 'address',  title: 'Roof analysis' },
  { key: 'material', title: 'Roof type'     },
  { key: 'design',   title: 'Design'        },
  { key: 'quote',    title: 'Your quote'    },
];
const STAGES_MANUAL = [
  { key: 'upload',   title: 'Start'         },
  { key: 'manual',   title: 'Your address'  },
  { key: 'preview',  title: 'Your house'    },
  { key: 'address',  title: 'Roof analysis' },
  { key: 'material', title: 'Roof type'     },
  { key: 'design',   title: 'Design'        },
  { key: 'quote',    title: 'Your quote'    },
];

// Cheap RFC-4122 v4 UUID for the Places-Autocomplete session token — Google
// bills all autocomplete calls + the final Details call in the same session
// as one search event when they share this token, which is much cheaper
// than per-request pricing.
function uuidV4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default function QuotePage() {
  const [stage, setStage] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [bill, setBill] = useState(null);
  // Manual flow — user types address + drags a consumption slider instead
  // of uploading a bill. Slider default 7,500 kWh/yr = typical NZ 4-person
  // home (Stats NZ + EECA average). Range 2000-30000 covers small
  // apartments to very-high-use homes with EV + pool + spa.
  const [manualAnnualKwh, setManualAnnualKwh] = useState(7500);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  // Phase 3 (2026-08-19) — CTA-gated stage transition. Server response lands
  // in `pendingAnalysis`; the EnergyFlowOverlay shows a "complete" celebration
  // state and only commits (setAnalysis + setStage 'address') when customer
  // clicks "See my roof analysis" — or after an 8s fallback if they don't.
  const [pendingAnalysis, setPendingAnalysis] = useState(null);
  const [confirmedPlace, setConfirmedPlace] = useState(null); // { place_id, formattedAddress }
  const [material, setMaterial] = useState(null);              // 'metal' | 'tile' | 'unsure'
  const [designing, setDesigning] = useState(false);
  const [designError, setDesignError] = useState(null);
  const [design, setDesign] = useState(null);                  // three-tier composer output
  // Two-pass roof-fit-aware sizing (Fix C, 2026-08-19): Cesium reports
  // how many panels actually fit on the roof via its onPlacementReady
  // callback. When that number is LESS than any tier's target, we
  // recompose ONCE with roof_max_panels so the server caps the tier
  // sizing to fit reality. Guarded by roofFitAppliedRef so we don't
  // spin (recompose → new render → new callback → recompose loop).
  const [roofRenderedPanels, setRoofRenderedPanels] = useState(null);
  const roofFitAppliedRef = useRef(false);

  // Phase 2 (2026-08-19) — customer-adjustable battery + EV sliders.
  //   customBatteryKwh:  null = use engine's recommendation (default)
  //                      number = customer set via slider
  //   customEvKmPerDay:  null = legacy (tier 3 gets EV_DEFAULT_KM_PER_DAY)
  //                      0    = customer opted OUT of EV
  //                      >0   = customer set km/day
  // Both forwarded to /compose. Server re-sizes all 3 tiers accordingly.
  // Auto-reset on new analysis (different roof/customer) so slider
  // doesn't carry over between houses.
  const [customBatteryKwh, setCustomBatteryKwh] = useState(null);
  const [customEvKmPerDay, setCustomEvKmPerDay] = useState(null);

  // 2026-08-18 — customer picks which roof planes to include via the
  // PlanePickerCard on QuoteStage sidebar. Set<number> of segment indices.
  // Empty by default → all planes included. Consumed in TWO places:
  // composeDesign recomputes area-weighted yield from KEPT segments before
  // sizing, and QuoteStage filters the visual panel rendering. Always
  // reset when a new analysis arrives (different roof, indices don't
  // carry over).
  const [excludedSegments, setExcludedSegments] = useState(() => new Set());
  const toggleSegment = (idx) => {
    setExcludedSegments(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  // Debounced auto-recompose while ON the quote stage. When the customer
  // toggles a plane in the sidebar picker, we filter the 3D visuals
  // instantly (via QuoteStage's filteredSegments/filteredSolarPanels) but
  // we ALSO need the sizing engine to re-run so panel count + savings math
  // reflect the new kept-planes yield. 500ms debounce swallows rapid
  // clicks; skipFirstQuoteEnterRef prevents an immediate second call on
  // initial arrival (composeDesign just fired to bring us here).
  const skipFirstQuoteEnterRef = useRef(true);
  useEffect(() => {
    if (stage !== 'quote') {
      // Reset the guard whenever we're NOT on quote — next arrival is fresh.
      skipFirstQuoteEnterRef.current = true;
      return undefined;
    }
    if (skipFirstQuoteEnterRef.current) {
      skipFirstQuoteEnterRef.current = false;
      return undefined;
    }
    // Guard: don't recompose when every plane is excluded — the engine
    // would fall back to full-roof yield (since composeDesign only
    // recomputes when there's a valid non-empty subset), producing
    // financials that look normal while the 3D shows zero panels. The
    // red banner on PlanePickerCard tells the user to re-check something.
    const totalSegments = analysis?.roof?.segments?.length || 0;
    if (totalSegments > 0 && excludedSegments.size >= totalSegments) return undefined;
    const t = setTimeout(() => {
      composeDesign();
    }, 500);
    return () => clearTimeout(t);
    // composeDesign captures the latest excludedSegments via closure — safe
    // because it's redefined every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludedSegments, stage]);

  // Fix C · one-shot roof-fit recompose. Fires the FIRST time Cesium
  // reports rendered panel count AND that count is LESS than any tier's
  // target (i.e. roof physically can't fit the recommended sizing).
  // Guarded by roofFitAppliedRef so we don't loop when the second-pass
  // response comes back with matching numbers.
  useEffect(() => {
    if (stage !== 'quote') return undefined;
    if (roofFitAppliedRef.current) return undefined;
    if (!Number.isFinite(roofRenderedPanels) || roofRenderedPanels <= 0) return undefined;
    if (!design?.tiers) return undefined;
    const anyTierExceedsRoof = design.tiers.some(
      t => Number.isFinite(t?.panel?.count) && t.panel.count > roofRenderedPanels,
    );
    if (!anyTierExceedsRoof) return undefined;
    // Mark BEFORE firing so the callback firing again during recompose
    // (Cesium re-renders after new tier sizing) doesn't retrigger.
    roofFitAppliedRef.current = true;
    composeDesign();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roofRenderedPanels, design, stage]);

  // Phase 2 · debounced auto-recompose on Customise slider/toggle changes.
  // 800 ms after the last drag/toggle → composeDesign() with new params.
  // Reuses the plane-toggle skipFirstQuoteEnterRef guard so we don't
  // fire on initial mount. Different from the roof-fit useEffect above
  // (that's ONE-SHOT; this is EVERY change).
  const skipFirstCustomiseRef = useRef(true);
  useEffect(() => {
    if (stage !== 'quote') {
      skipFirstCustomiseRef.current = true;
      return undefined;
    }
    if (skipFirstCustomiseRef.current) {
      skipFirstCustomiseRef.current = false;
      return undefined;
    }
    const t = setTimeout(() => {
      composeDesign();
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customBatteryKwh, customEvKmPerDay, stage]);

  // (Removed the ?e2eSeed=1 dev-only shortcut — the E2E puppeteer test now
  // does the FULL flow starting from real bill upload, so this shortcut isn't
  // needed and having it would be misleading about what actually gets tested.)

  const handleFile = async (file) => {
    if (!file) return;
    setUploadError(null);
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('POC only accepts PDF bills. Try a Mercury / Genesis / Contact / Meridian PDF.');
      return;
    }

    setUploading(true);
    const fd = new FormData();
    fd.append('bill', file);
    try {
      const { data } = await publicApi.post('/bills/extract', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setBill(data);
      setStage('extract');
    } catch (e) {
      setUploadError(e.response?.data?.error || e.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const analyseAddress = async (pinOverride) => {
    if (!confirmedPlace?.place_id) {
      setAnalysisError('Pick your address from the suggestions dropdown first — that gives us the exact coordinates Google Maps uses.');
      return;
    }
    setAnalysisError(null);
    setAnalysing(true);
    try {
      // Body includes lat_override/lng_override only when the customer
      // actually moved the pin on PreviewStage. Server ignores overrides
      // that match the geocoded coord anyway, but skipping them keeps the
      // log cleaner + doesn't lie about pin drags that didn't happen.
      const body = { place_id: confirmedPlace.place_id };
      if (pinOverride
          && Number.isFinite(pinOverride.lat) && Number.isFinite(pinOverride.lng)
          && (pinOverride.lat !== confirmedPlace.latitude || pinOverride.lng !== confirmedPlace.longitude)) {
        body.lat_override = pinOverride.lat;
        body.lng_override = pinOverride.lng;
      }
      // Retry once on 500/504/timeout — OSM Overpass is intermittently
      // slow (10-20s), which can cascade to a Vite proxy timeout. Second
      // attempt is usually fast because caches are warm.
      let data;
      try {
        const res = await publicApi.post('/roof/analyse', body, { timeout: 60_000 });
        data = res.data;
      } catch (retryable) {
        const s = retryable?.response?.status;
        if (s === 500 || s === 504 || retryable?.code === 'ECONNABORTED' || !s) {
          console.warn(`[analyseAddress] first attempt failed (${s || retryable?.code}), retrying once`);
          const res2 = await publicApi.post('/roof/analyse', body, { timeout: 60_000 });
          data = res2.data;
        } else {
          throw retryable;
        }
      }
      // Phase 3 CTA-gate — parking the data in pendingAnalysis instead of
      // committing to setAnalysis + setStage('address') keeps the overlay in
      // PreviewStage alive so the completion celebration + CTA can render.
      // commitPendingAnalysis (below) does the real commit on CTA click or
      // 8s fallback.
      setPendingAnalysis(data);
    } catch (e) {
      // Response body might be JSON with .error, or plain text (HTML error page,
      // Express default handler, etc.) — surface whichever is more useful.
      const status = e.response?.status ? ` [HTTP ${e.response.status}]` : '';
      const body = e.response?.data;
      let bodyMsg = '';
      if (typeof body === 'string') bodyMsg = body.slice(0, 500);
      else if (body?.error) bodyMsg = body.error;
      else if (body) bodyMsg = JSON.stringify(body).slice(0, 500);
      setAnalysisError(`${bodyMsg || e.message || 'Roof analysis failed.'}${status}`);
    } finally {
      setAnalysing(false);
    }
  };

  // Phase 3 (2026-08-19) — commit the pending analysis and advance to
  // AddressStage. Called by the "See my roof analysis" CTA on the completion
  // celebration overlay, or by the 8s auto-fallback timer if the customer
  // doesn't click. Idempotent: no-op if no pending analysis.
  const commitPendingAnalysis = () => {
    if (!pendingAnalysis) return;
    setAnalysis(pendingAnalysis);
    setPendingAnalysis(null);
    setExcludedSegments(new Set());   // new roof, fresh selection
    setRoofRenderedPanels(null);
    roofFitAppliedRef.current = false;
    setCustomBatteryKwh(null);
    setCustomEvKmPerDay(null);
    setStage('address');
  };

  const composeDesign = async () => {
    if (!bill?.kwh_total || !bill?.days_in_period) {
      setDesignError('Missing kWh usage or bill period from the extract. Try a different bill.');
      return;
    }
    // Annualise: extrapolate from the one bill's period to a full year.
    const annualKwh = Math.round((bill.kwh_total / bill.days_in_period) * 365);
    setDesignError(null);
    setDesigning(true);
    try {
      // Week-7 Phase 1: forward Google Solar's per-address yield so the
      // sizing engine uses the actual roof-derived kWh/kWp instead of the
      // Auckland regional-average default. Null-safe — server falls back
      // to regional yield when this is missing (LiDAR path today; PVGIS
      // will fill it in Phase 2).
      // Phase 2 (2026-08-14): forward tariff context so the server can call
      // runThreeScenarios for real payback + 25-yr savings + F6 scenarios.
      // Bill flow: derive annual_spend + variable rate + daily fixed from
      // the parsed bill (GST gross-up × 1.15 where the parser gave us the
      // ex-GST line items). Manual flow: send null → server falls back to
      // NZ residential defaults and marks tariff_source='default' in the
      // response so the UI can show a "estimated tariff" note.
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
      // 2026-08-18 — recompute area-weighted yield from KEPT segments only,
      // so if the customer excluded S-facing / shaded / wrong-unit planes
      // on AddressStage, the sizing math reflects it. Falls back to the
      // full-roof yield when we can't recompute (no per-segment yields on
      // this address's payload, or user kept everything).
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

      if (excludedSegments.size > 0) {
        console.log(
          `[composeDesign] excluded=${JSON.stringify([...excludedSegments])} ` +
          `kept=${keptSegments.length}/${analysis?.roof?.segments?.length ?? 0} ` +
          `yield: ${analysis?.roof?.system_yield?.kwh_per_kwp_per_year ?? 'null'} → ` +
          `${effectiveYield ?? 'null'} kWh/kWp (${filteredYield != null ? 'recomputed from kept segs' : 'fell back — no per-seg yield data'})`,
        );
      }

      // Fix C (2026-08-19) — forward roof-fit constraint on second-pass
      // compose calls. First-pass sends null (server sizes to usage without
      // roof cap); Cesium then renders and reports actual max via the
      // onPlacementChange callback; QuotePage's roof-fit useEffect fires
      // this function again with roofRenderedPanels set → server caps
      // tier kwp so all 3 tiers show honest panel counts.
      const recommendedPanelWatts = design?.tiers?.[design?.recommended_index]?.panel?.watts
        || 595;   // Phono 595W default
      const { data } = await publicApi.post('/design/compose', {
        annual_kwh: annualKwh,
        postcode:   bill.service_postcode || null,
        system_yield_kwh_per_kwp_per_year: effectiveYield,
        system_yield_source:               effectiveYieldSource,
        // V3 (2026-08-18): forward per-address monthly kWh/kWp when PVGIS
        // produced it (LiDAR-fallback path only). Google-Solar-path
        // addresses omit this; server falls back to Auckland MONTHLY_YIELD_PCT.
        // We DON'T re-derive monthly per kept segments — client doesn't have
        // per-segment monthly data; the seasonal SHAPE is dominated by
        // latitude anyway, not by which planes are included.
        system_yield_monthly_kwh_per_kwp:
          analysis?.roof?.system_yield?.monthly_kwh_per_kwp || null,
        bill_context: billContext,
        // Roof-fit-aware sizing (Fix C):
        roof_max_panels: Number.isFinite(roofRenderedPanels) && roofRenderedPanels > 0
          ? roofRenderedPanels
          : null,
        panel_watts:     recommendedPanelWatts,
        // Phase 2 · Customer-adjustable battery + EV (from Customise
        // panel sliders). null = server uses engine defaults.
        battery_kwh:     Number.isFinite(customBatteryKwh) ? customBatteryKwh : null,
        ev_km_per_day:   Number.isFinite(customEvKmPerDay) ? customEvKmPerDay : null,
      });
      setDesign({ ...data, derived_annual_kwh: annualKwh });
      setStage('quote');
    } catch (e) {
      setDesignError(e.response?.data?.error || e.message || 'Design compose failed.');
    } finally {
      setDesigning(false);
    }
  };

  const reset = () => {
    setBill(null);
    setAnalysis(null);
    setConfirmedPlace(null);
    setMaterial(null);
    setDesign(null);
    setUploadError(null);
    setAnalysisError(null);
    setDesignError(null);
    setManualAnnualKwh(7500);
    setExcludedSegments(new Set());
    setRoofRenderedPanels(null);
    roofFitAppliedRef.current = false;
    setCustomBatteryKwh(null);
    setCustomEvKmPerDay(null);
    setStage('upload');
  };

  // Manual-flow entry — user picked "Explore without a bill" on the
  // landing page. Just advances to the manual stage; the actual analyse
  // call happens after they pick an address + set consumption.
  const startManualFlow = () => {
    setUploadError(null);
    setStage('manual');
  };

  // Manual-flow submit — user has typed an address (setConfirmedPlace via
  // PlacesAutocomplete) and dragged the consumption slider. Synthesise a
  // bill object so downstream stages (composeDesign, QuoteStage) work with
  // the SAME shape as the bill-parsed path, then advance to the aerial
  // preview stage. Analysis fires from PreviewStage after the customer
  // confirms we found the right house.
  const submitManualEntry = async () => {
    if (!confirmedPlace?.place_id) {
      setAnalysisError('Please pick your address from the suggestions dropdown first.');
      return;
    }
    // _manual_entry flag drives the QuoteStage banner ("estimated quote,
    // upload bill for exact pricing"). All other fields mirror what the
    // bill parser would have produced for the same address + usage.
    setBill({
      kwh_total:        manualAnnualKwh,
      days_in_period:   365,
      service_address:  confirmedPlace.formattedAddress || null,
      service_postcode: null,   // manual entry has no postcode → server falls back to regional yield
      retailer:         null,
      plan_name:        null,
      _manual_entry:    true,
    });
    // 2026-08-18 — no longer runs analysis directly. Advances to the aerial
    // 'preview' stage so the customer can confirm we found the right house
    // BEFORE we spend ~15s on LiDAR+PVGIS+Google-Solar. PreviewStage's Yes
    // button calls analyseAddress() from there.
    setAnalysisError(null);
    setStage('preview');
  };

  return (
    <div className="min-h-screen bg-[#FBF7F0] text-[#1A1614]">
      {/* POC banner */}
      <div className="bg-amber-100/70 border-b border-amber-300/40 py-2 px-4 text-center text-xs text-amber-900">
        <strong>POC / spike</strong> — new quote flow, not linked from anywhere. Bills stay on the server only long enough to parse; no DB writes.
      </div>

      {/* Topbar */}
      <header className="border-b border-[#E3D9C4] px-6 md:px-10 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg" style={{ background: 'radial-gradient(circle at 30% 30%, #F4A83B, #D9531E 55%, #B84418)' }} />
          <div className="font-serif text-lg tracking-tight">
            Golden<span className="text-[#D9531E]">Ray</span>
          </div>
        </div>
        <div className="text-xs text-[#8F887E] font-mono">/poc/quote</div>
      </header>

      {/* Progress rail — labels swap based on whether we're in bill or
          manual flow so the customer sees the correct step names. Both
          flows have the same 6-step length; only the second step differs. */}
      {stage !== 'upload' && (
        <ProgressRail
          current={stage}
          stages={stage === 'manual' || bill?._manual_entry ? STAGES_MANUAL : STAGES_BILL}
        />
      )}

      {/* Main */}
      <main className="max-w-5xl mx-auto px-6 md:px-10 py-12 md:py-16">
        {stage === 'upload' && (
          <UploadStage
            uploading={uploading}
            uploadError={uploadError}
            onFile={handleFile}
            onExplore={startManualFlow}
          />
        )}
        {stage === 'manual' && (
          <ManualStage
            confirmedPlace={confirmedPlace}
            onPlaceConfirmed={setConfirmedPlace}
            annualKwh={manualAnnualKwh}
            onKwhChange={setManualAnnualKwh}
            onContinue={submitManualEntry}
            onBack={() => setStage('upload')}
            analysing={analysing}
            analysisError={analysisError}
          />
        )}
        {stage === 'extract' && bill && (
          <ExtractStage
            bill={bill}
            onReset={reset}
            onContinue={() => setStage('preview')}
            analysing={false}
            analysisError={null}
            confirmedPlace={confirmedPlace}
            onPlaceConfirmed={setConfirmedPlace}
          />
        )}
        {stage === 'preview' && confirmedPlace && (
          <PreviewStage
            place={confirmedPlace}
            analysing={analysing}
            analysisError={analysisError}
            pendingAnalysis={pendingAnalysis}
            onSeeResults={commitPendingAnalysis}
            onConfirm={analyseAddress}
            onBack={() => {
              setAnalysisError(null);
              setPendingAnalysis(null);
              setStage(bill?._manual_entry ? 'manual' : 'extract');
            }}
          />
        )}
        {stage === 'address' && analysis && (
          <AddressStage
            analysis={analysis}
            onBack={() => setStage('preview')}
            onConfirm={() => setStage('material')}
          />
        )}
        {stage === 'material' && analysis && (
          <MaterialStage
            analysis={analysis}
            material={material}
            onPick={setMaterial}
            onBack={() => setStage('address')}
            onConfirm={composeDesign}
            designing={designing}
            designError={designError}
          />
        )}
        {stage === 'quote' && analysis && design && (
          <QuoteStage
            analysis={analysis}
            design={design}
            material={material}
            bill={bill}
            excludedSegments={excludedSegments}
            onToggleSegment={toggleSegment}
            designing={designing}
            customBatteryKwh={customBatteryKwh}
            customEvKmPerDay={customEvKmPerDay}
            setCustomBatteryKwh={setCustomBatteryKwh}
            setCustomEvKmPerDay={setCustomEvKmPerDay}
            onBack={() => setStage('material')}
            onReset={reset}
            onRoofPlacementChange={(placement) => {
              // Track Cesium's actual rendered panel count so composeDesign
              // can send it as roof_max_panels on the next call (Fix C).
              // Only update when the number actually changes to avoid
              // re-triggering the roof-fit useEffect on identical reports.
              const n = Number(placement?.totalRendered);
              if (Number.isFinite(n) && n > 0 && n !== roofRenderedPanels) {
                setRoofRenderedPanels(n);
              }
            }}
          />
        )}
        {/* NB: QuoteStage passes roof.segments down to PanelOverlayHero so
            panel rectangles can be rotated to their segment's azimuth. */}
      </main>
    </div>
  );
}

// ── Progress rail ─────────────────────────────────────────────────────────────

function ProgressRail({ current, stages = STAGES_BILL }) {
  const idx = stages.findIndex(s => s.key === current);
  return (
    <div className="border-b border-[#E3D9C4] bg-[#FBF7F0] px-6 md:px-10 py-4">
      <div className="max-w-5xl mx-auto flex gap-1">
        {stages.map((s, i) => {
          const isDone = i < idx;
          const isActive = i === idx;
          return (
            <div key={s.key} className={`flex-1 ${isActive || isDone ? 'opacity-100' : 'opacity-40'}`}>
              <div className="h-[3px] bg-[#EBE2CE] rounded overflow-hidden mb-2">
                <div className="h-full bg-[#D9531E] rounded transition-all" style={{ width: isDone ? '100%' : isActive ? '60%' : '0' }} />
              </div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[#8F887E]">Step {i + 1}</div>
              <div className="text-sm hidden md:block">{s.title}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stage 0: Upload ───────────────────────────────────────────────────────────

function UploadStage({ uploading, uploadError, onFile, onExplore }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div className="grid md:grid-cols-[1.15fr,1fr] gap-16 items-center">
      <div>
        <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">Solar quote in 90 seconds</div>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.05] tracking-tight mt-4">
          Your roof. Your bill. Your quote.<br />
          <span className="text-[#8F887E]">No sales call required.</span>
        </h1>
        <p className="mt-5 text-lg text-[#55504A] max-w-md">
          Upload one power bill. We'll design a system on your actual roof and price it three ways — no forms, no waiting, no chasing.
        </p>
        <div className="mt-8 flex flex-wrap gap-6 text-sm text-[#8F887E]">
          <span>&#10003; No login</span>
          <span>&#10003; Bill deleted after parse</span>
          <span>&#10003; No DB writes (POC)</span>
        </div>
      </div>

      <div>
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`
            cursor-pointer rounded-3xl border-2 border-dashed p-10 text-center transition
            ${dragging ? 'border-[#D9531E] bg-[#EBE2CE]' : 'border-[#E3D9C4] bg-[#F4EEE1] hover:bg-[#EBE2CE] hover:border-[#D9531E]'}
            ${uploading ? 'opacity-70 cursor-wait' : ''}
          `}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
            disabled={uploading}
          />
          <div
            className="mx-auto w-16 h-16 rounded-2xl grid place-items-center mb-5 shadow-lg"
            style={{ background: 'radial-gradient(circle at 30% 30%, #F4A83B, #D9531E 60%)', boxShadow: '0 8px 24px rgba(217, 83, 30, 0.3)' }}
          >
            {uploading
              ? <Loader2 className="w-8 h-8 text-white animate-spin" />
              : <Upload className="w-8 h-8 text-white" />}
          </div>
          <h3 className="font-semibold text-[#1A1614]">
            {uploading ? 'Reading your bill…' : 'Drop your latest power bill here'}
          </h3>
          <p className="text-sm text-[#55504A] mt-1">
            {uploading ? 'Regex parser matching your retailer…' : 'Or click to browse · PDF only for POC'}
          </p>
          <div className="mt-5 flex justify-center gap-4 text-xs text-[#8F887E]">
            <span>&#10003; Mercury</span>
            <span>&#10003; Genesis</span>
            <span>&#10003; Contact</span>
            <span>&#10003; Meridian</span>
            <span>&#10003; +14</span>
          </div>
        </div>

        {uploadError && (
          <div className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>{uploadError}</div>
          </div>
        )}

        {/* ── Secondary path: manual entry ────────────────────────────────
             Customers without a bill handy (recently moved, casual browsing,
             privacy-cautious) can still see solar potential + a rough quote.
             Rejoins the main pipeline after they pick an address + set an
             estimated consumption; a banner on the QuoteStage nudges them
             back to bill upload for exact pricing. */}
        <div className="mt-6 flex items-center gap-3">
          <div className="flex-1 border-t border-[#E3D9C4]" />
          <div className="text-[10px] uppercase tracking-widest text-[#8F887E]">Or</div>
          <div className="flex-1 border-t border-[#E3D9C4]" />
        </div>
        <button
          type="button"
          onClick={onExplore}
          disabled={uploading}
          className="mt-4 w-full rounded-2xl border border-[#E3D9C4] bg-white hover:bg-[#F4EEE1] hover:border-[#D9531E] disabled:opacity-60 disabled:cursor-not-allowed p-5 text-left transition group"
        >
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-[#F4EEE1] group-hover:bg-white grid place-items-center flex-shrink-0 transition">
              <MapPin className="w-5 h-5 text-[#D9531E]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[#1A1614]">Just exploring? Enter your address</div>
              <div className="text-sm text-[#55504A] mt-0.5 leading-snug">
                See solar potential on your roof without uploading a bill. We&apos;ll estimate your usage &mdash; you can add a bill later for exact pricing.
              </div>
            </div>
            <div className="text-[#D9531E] text-xl leading-none pt-1 group-hover:translate-x-0.5 transition-transform">&rarr;</div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Stage 1a: Manual entry (skip-bill flow) ──────────────────────────────────
//
// Alternate to the bill-upload path. Two inputs on one screen:
//   1. Address via Google Places Autocomplete (reused from ExtractStage)
//   2. Annual power usage via slider (default 7,500 kWh — NZ typical
//      4-person home per Stats NZ + EECA; range 2000-30000 covers
//      apartments through EV+pool households).
//
// On submit, the parent synthesises a bill object matching the parser's
// shape (kwh_total + days_in_period + service_address + _manual_entry
// flag) and hands off to the shared /roof/analyse pipeline. Everything
// downstream — roof analysis, tier composition, 3D view — is unchanged.
function ManualStage({
  confirmedPlace, onPlaceConfirmed,
  annualKwh, onKwhChange,
  onContinue, onBack,
  analysing, analysisError,
}) {
  // Human-readable household bucket for the current slider value, so the
  // customer has something to sanity-check against. Bands from EECA's
  // typical-home usage data.
  const householdHint = (kwh) => {
    if (kwh < 4000)  return 'Small home · 1-2 people · low usage';
    if (kwh < 7000)  return 'Medium home · 2-3 people';
    if (kwh < 10000) return 'Typical NZ home · 3-4 people';
    if (kwh < 15000) return 'Large home · 4-5 people, or with hot-water cylinder';
    if (kwh < 20000) return 'Very large home · 5+ people, spa or pool';
    return 'Very high usage · EV, pool, or small commercial';
  };

  return (
    <div className="max-w-2xl">
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">Step 2 &middot; Your home</div>
      <h1 className="font-serif text-3xl md:text-4xl leading-tight tracking-tight mt-3">
        Tell us where you live &amp; roughly how much power you use.
      </h1>
      <p className="mt-3 text-[#55504A]">
        Two quick things and we&apos;ll design a system on your actual roof. You can upload a real
        bill later for exact pricing &mdash; this path is for a fast preview.
      </p>

      <div className="mt-10 space-y-10">
        {/* Address */}
        <div>
          <label className="text-[10px] uppercase tracking-widest text-[#8F887E] font-semibold">
            Your address
          </label>
          <div className="mt-2">
            <PlacesAutocomplete confirmedPlace={confirmedPlace} onConfirm={onPlaceConfirmed} />
          </div>
        </div>

        {/* Consumption slider */}
        <div>
          <label className="text-[10px] uppercase tracking-widest text-[#8F887E] font-semibold">
            Your annual power use
          </label>
          <div className="mt-3 flex items-baseline gap-3">
            <div className="text-4xl font-serif font-bold text-[#1A1614]">
              {annualKwh.toLocaleString('en-NZ')}
            </div>
            <div className="text-lg text-[#8F887E]">kWh / year</div>
          </div>
          <input
            type="range"
            min="2000" max="30000" step="500"
            value={annualKwh}
            onChange={(e) => onKwhChange(Number(e.target.value))}
            className="w-full mt-4 accent-[#D9531E] cursor-pointer"
          />
          <div className="flex justify-between text-[10px] font-mono text-[#8F887E] uppercase tracking-wide">
            <span>2,000</span>
            <span>30,000</span>
          </div>
          <div className="mt-3 text-sm text-[#55504A]">
            {householdHint(annualKwh)}
          </div>
          <div className="mt-1 text-xs text-[#8F887E]">
            Typical NZ 4-person home uses about 7,500 kWh/yr. Any recent power bill shows your exact number.
          </div>
        </div>
      </div>

      {analysisError && (
        <div className="mt-6 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>{analysisError}</div>
        </div>
      )}

      <div className="mt-10 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={analysing}
          className="text-sm text-[#55504A] hover:text-[#1A1614] disabled:opacity-50"
        >
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          Back
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onContinue}
          disabled={!confirmedPlace || analysing}
          className="rounded-xl bg-[#D9531E] hover:bg-[#B84418] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 transition inline-flex items-center gap-2"
        >
          {analysing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading&hellip;
            </>
          ) : (
            <>
              Continue to house preview
              <span aria-hidden="true">&rarr;</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Stage 1: Extraction review ────────────────────────────────────────────────

// Extracted 2026-08-20 (Phase B1 parity) — the bill-detail card that
// appears after a successful parse. Rendered by both POC's ExtractStage
// AND the merged /get-quote residential wizard's Step 1 BillsTab so the
// customer sees the same rich breakdown regardless of entry path.
//
// Renders: file metadata line + 16-field DataCard grid + tariff-components
// panel (when present) + confidence banner + parser-diagnostics collapsible.
// Does NOT render address confirmation — that's Step 2 in the merged flow.
export function BillDetailCard({ bill }) {
  const method = bill.parse_method;
  const conf = Math.round((bill.ocr_confidence || 0) * 100);
  const hasErrors   = (bill.parse_errors   || []).length > 0;
  const hasWarnings = (bill.parse_warnings || []).length > 0;

  return (
    <>
      {/* File info */}
      <div className="flex items-center gap-3 text-sm text-[#55504A]">
        <FileText className="w-4 h-4" />
        <span className="font-mono">{bill.file?.name}</span>
        <span className="text-[#8F887E]">·</span>
        <span>{((bill.file?.size_bytes || 0) / 1024).toFixed(0)} KB</span>
        <span className="text-[#8F887E]">·</span>
        <span>parse method: <code className="font-mono">{method}</code></span>
      </div>

      {/* Data grid */}
      <div className="mt-6 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <DataCard label="Retailer" value={bill.retailer} />
        <DataCard label="Plan" value={bill.plan_name} />
        <DataCard label="Account holder" value={bill.account_holder} note="regex often misses this" />
        <DataCard label="Service address" value={bill.service_address} />
        <DataCard label="Postcode" value={bill.service_postcode} mono />
        <DataCard label="ICP number" value={bill.icp_number} mono />
        <DataCard label="Period" value={bill.period_start && bill.period_end ? `${bill.period_start} → ${bill.period_end}` : null} />
        <DataCard label="Days" value={bill.days_in_period} mono />
        <DataCard label="Total kWh (bill period)" value={bill.kwh_total} mono large suffix="kWh" />
        <DataCard label="Peak kWh" value={bill.kwh_peak} mono />
        <DataCard label="Off-peak kWh" value={bill.kwh_off_peak} mono />
        <DataCard label="Exported kWh" value={bill.kwh_exported} mono />
        <DataCard label="Fixed charge" value={bill.fixed_charge_nzd} mono money />
        <DataCard label="Variable charge" value={bill.variable_charge_nzd} mono money />
        <DataCard label="Export credit" value={bill.export_credit_nzd} mono money />
        <DataCard label="Total incl. GST" value={bill.total_nzd} mono money large />
      </div>

      {/* Tariff components */}
      {Array.isArray(bill.tariff_components) && bill.tariff_components.length > 0 && (
        <div className="mt-6 p-4 bg-[#F4EEE1] border border-[#E3D9C4] rounded-xl">
          <div className="text-xs uppercase tracking-wider text-[#8F887E] font-semibold mb-3">Tariff components</div>
          <div className="grid gap-2 text-sm">
            {bill.tariff_components.map((t, i) => (
              <div key={i} className="flex items-center justify-between font-mono">
                <span>{t.label || t.name || 'component'}</span>
                <span className="text-[#55504A]">
                  {typeof t.rate === 'number' ? `${t.rate.toFixed(2)} c/kWh` : (t.rate || '—')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confidence banner */}
      <div
        className={`mt-6 flex items-start gap-4 p-6 rounded-2xl border ${
          conf >= 70
            ? 'bg-green-50/60 border-green-200'
            : conf >= 40
            ? 'bg-amber-50/60 border-amber-200'
            : 'bg-red-50/60 border-red-200'
        }`}
      >
        {conf >= 70
          ? <CheckCircle className="w-6 h-6 text-green-700 flex-shrink-0 mt-0.5" />
          : <AlertTriangle className={`w-6 h-6 flex-shrink-0 mt-0.5 ${conf >= 40 ? 'text-amber-700' : 'text-red-700'}`} />}
        <div>
          <div className={`text-xs uppercase tracking-wider font-semibold ${conf >= 70 ? 'text-green-800' : conf >= 40 ? 'text-amber-800' : 'text-red-800'}`}>
            Confidence: {conf}%
          </div>
          <p className="text-sm text-[#1A1614] mt-1">
            {conf >= 70
              ? 'All the key fields came through cleanly. You can continue.'
              : conf >= 40
              ? 'Some fields missing. Continue if the important numbers look right, or try a clearer bill.'
              : 'Parser struggled with this bill. Check the raw data below — may be an unfamiliar format.'}
          </p>
        </div>
      </div>

      {/* Errors + warnings */}
      {(hasErrors || hasWarnings) && (
        <details className="mt-4 p-4 bg-[#F4EEE1] border border-[#E3D9C4] rounded-xl text-sm">
          <summary className="cursor-pointer font-semibold text-[#55504A]">
            Parser diagnostics ({(bill.parse_errors?.length || 0) + (bill.parse_warnings?.length || 0)})
          </summary>
          <div className="mt-3 space-y-2">
            {(bill.parse_errors || []).map((e, i) => (
              <div key={`e${i}`} className="flex gap-2 text-red-800">
                <span className="font-mono text-xs bg-red-100 px-1.5 py-0.5 rounded">{e.field}</span>
                <span>{e.reason || e.code}</span>
              </div>
            ))}
            {(bill.parse_warnings || []).map((w, i) => (
              <div key={`w${i}`} className="flex gap-2 text-amber-800">
                <span className="font-mono text-xs bg-amber-100 px-1.5 py-0.5 rounded">{w.field || w.code}</span>
                <span>{w.reason || w.message}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function ExtractStage({ bill, onReset, onContinue, analysing, analysisError, confirmedPlace, onPlaceConfirmed }) {
  const method = bill.parse_method;
  const conf = Math.round((bill.ocr_confidence || 0) * 100);
  const hasErrors = (bill.parse_errors || []).length > 0;
  const hasWarnings = (bill.parse_warnings || []).length > 0;
  // Preserve unused-var-lint-friendly touch so the surrounding logic
  // (button-disable + banner text on original ExtractStage) still has these.
  void method; void conf; void hasWarnings;

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">
        Step 1 &middot; {hasErrors ? 'Parsing had issues' : 'Confirmed'}
      </div>
      <h2 className="font-serif text-3xl md:text-4xl mt-3 tracking-tight">
        {hasErrors ? "Couldn't fully read this bill." : "Here's what we read off your bill."}
      </h2>
      <p className="mt-2 text-[#55504A] max-w-2xl">
        {hasErrors
          ? 'The regex parser hit a snag. See details below — you can try another bill or continue with what we got.'
          : 'Everything looks right? We\'ll use these numbers to design your system.'}
      </p>

      {/* Bill detail card — extracted 2026-08-20 for reuse in the merged
          /get-quote residential wizard's Step 1. Same rendering in both. */}
      <div className="mt-6">
        <BillDetailCard bill={bill} />
      </div>

      {/* Tariff components, confidence banner, parser diagnostics — MOVED
          into BillDetailCard above (2026-08-20 refactor). Rendered there once
          for both POC's ExtractStage and merged flow's Step 1. */}

      {/* Address confirmation via Places Autocomplete — bill address is a
          starting hint, but user picks the actual property from Google's
          verified list so we get the correct rooftop coords. */}
      <div className="mt-10 p-6 bg-[#F4EEE1] border border-[#E3D9C4] rounded-2xl">
        <div className="text-[10px] uppercase tracking-wider text-[#D9531E] font-bold mb-1">Confirm your address</div>
        <h3 className="font-serif text-2xl mt-1 mb-2">Pick your property from Google&apos;s list.</h3>
        <p className="text-sm text-[#55504A] mb-4">
          Bill parsers sometimes garble addresses — search below and pick the exact house. This is the same address search Google Maps uses, so what we analyse will be what you see on Google Maps.
        </p>
        <PlacesAutocomplete
          initial={bill.service_address || ''}
          confirmedPlace={confirmedPlace}
          onConfirm={onPlaceConfirmed}
        />
      </div>

      {/* Analysis error */}
      {analysisError && (
        <div className="mt-6 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Roof analysis failed</div>
            <div className="mt-1">{analysisError}</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex flex-wrap items-center gap-3">
        <button onClick={onReset} disabled={analysing} className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm disabled:opacity-50">
          <RefreshCw className="w-4 h-4" /> Try another bill
        </button>
        <div className="flex-1" />
        <button
          onClick={onContinue}
          disabled={analysing || !confirmedPlace?.place_id}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
          title={!confirmedPlace?.place_id ? 'Pick your address from the Google suggestions above first' : ''}
        >
          {analysing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading&hellip;</>
            : <><Sparkles className="w-4 h-4" /> Continue to house preview</>}
        </button>
      </div>
    </div>
  );
}

// ── Places Autocomplete widget ────────────────────────────────────────────
// Debounced input that hits /api/places/autocomplete. When user picks a
// suggestion, we fetch details for the exact lat/lng and hand the parent
// a { place_id, formattedAddress, latitude, longitude }. sessionToken is
// generated once per widget mount and reused across all autocomplete calls
// + the details fetch — Google bills that as one search session (cheaper).
// Exported 2026-08-20 so the merged /get-quote residential wizard can reuse
// the same Google-Places-backed input (Phase B1 ticket B1.3). No behavior
// change from POC's usage. Phase E will re-parent this out of the POC tree
// into client/src/components/quote/.
export function PlacesAutocomplete({ initial, confirmedPlace, onConfirm }) {
  const [query, setQuery] = useState(initial || '');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const sessionToken = useMemo(() => uuidV4(), []);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // Debounce autocomplete requests — 250 ms after last keystroke.
  useEffect(() => {
    if (confirmedPlace) return;                       // already picked → don't re-search
    const q = query.trim();
    if (q.length < 3) { setSuggestions([]); setError(null); return; }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      setError(null);
      try {
        const { data } = await publicApi.get('/places/autocomplete', {
          params: { input: q, sessionToken },
          signal: abortRef.current.signal,
        });
        setSuggestions(data.suggestions || []);
        setOpen(true);
        setHighlight(-1);
      } catch (e) {
        if (e.name !== 'CanceledError' && e.name !== 'AbortError') {
          setError(e.response?.data?.error || e.message || 'Autocomplete failed.');
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, sessionToken, confirmedPlace]);

  const pick = async (s) => {
    setOpen(false);
    setLoading(true);
    setError(null);
    try {
      const { data } = await publicApi.get('/places/details', {
        params: { placeId: s.place_id, sessionToken },
      });
      onConfirm({
        place_id: data.place_id,
        formattedAddress: data.formattedAddress,
        latitude: data.latitude,
        longitude: data.longitude,
      });
      setQuery(data.formattedAddress || s.text || '');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to fetch place details.');
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    onConfirm(null);
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKey = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); pick(suggestions[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="relative">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 bg-white transition
        ${confirmedPlace ? 'border-green-500 bg-green-50/40' : 'border-[#E3D9C4] focus-within:border-[#D9531E]'}
      `}>
        {confirmedPlace
          ? <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          : <Search className="w-5 h-5 text-[#8F887E] flex-shrink-0" />}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { onConfirm(null); setQuery(e.target.value); }}
          onFocus={() => suggestions.length && !confirmedPlace && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          placeholder="Start typing your address…"
          className="flex-1 bg-transparent outline-none text-[#1A1614] placeholder:text-[#8F887E]"
          autoComplete="off"
        />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-[#8F887E]" />}
        {(query || confirmedPlace) && !loading && (
          <button type="button" onClick={clear} className="text-[#8F887E] hover:text-[#1A1614]" aria-label="clear">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && !confirmedPlace && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border border-[#E3D9C4] rounded-xl shadow-xl overflow-hidden max-h-80 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li
              key={s.place_id}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-4 py-3 cursor-pointer border-b border-[#F4EEE1] last:border-b-0
                ${highlight === i ? 'bg-[#F4EEE1]' : 'hover:bg-[#FBF7F0]'}
              `}
            >
              <div className="text-sm font-medium text-[#1A1614]">{s.main_text || s.text}</div>
              {s.secondary_text && (
                <div className="text-xs text-[#8F887E] mt-0.5">{s.secondary_text}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="mt-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {confirmedPlace && (
        <div className="mt-3 text-xs text-green-800 flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5" />
          <span>
            Address confirmed &middot; Place ID <code className="font-mono">{confirmedPlace.place_id?.slice(0, 20)}…</code>
            {confirmedPlace.latitude && confirmedPlace.longitude && (
              <> &middot; <span className="font-mono">{confirmedPlace.latitude.toFixed(6)}, {confirmedPlace.longitude.toFixed(6)}</span></>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Stage 3: Aerial preview — confirm the house BEFORE analysis runs ────────
// Cheap Google Static Maps satellite tile with a pin at the geocoded coord.
// Yes → fires analyseAddress (~15s LiDAR+PVGIS+Google-Solar); No → back to
// whichever address-input stage we came from so the customer can re-pick.
// If autocomplete grabbed the neighbour's house or the bill OCR extracted a
// stale address, we catch it here BEFORE spending the compute.

// Exported 2026-08-20 for reuse by the merged /get-quote residential wizard.
// See [[project-quote-flow-integration-plan]] Phase B1 ticket B1.3.
export function PreviewStage({ place, analysing, analysisError, pendingAnalysis, onSeeResults, onConfirm, onBack }) {
  const { latitude: initLat, longitude: initLng, formattedAddress } = place;

  // Energy-flow overlay engages the customer through the 5-15s roof-analysis
  // wait, then celebrates completion with a CTA. Auto-opens when `analysing`
  // goes true; stays open through the "complete" state so customer sees the
  // "See my roof analysis" button; auto-commits after 8s if they don't click.
  // Setting `poc:energyFlowSeen` prevents QuoteStage from re-auto-opening.
  const [flowSkipped, setFlowSkipped] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (analysing) {
      try { window.localStorage?.setItem('poc:energyFlowSeen', '1'); } catch { /* private mode */ }
      const start = Date.now();
      setElapsedMs(0);
      const iv = setInterval(() => setElapsedMs(Date.now() - start), 500);
      return () => clearInterval(iv);
    }
    // Not analysing → reset only if nothing pending (else keep for display)
    if (!pendingAnalysis && !analysisError) setFlowSkipped(false);
    return undefined;
  }, [analysing, pendingAnalysis, analysisError]);

  // Derive the overlay's status. 'analysing' | 'complete' | 'error' | null.
  const status = analysing ? 'analysing'
               : analysisError ? 'error'
               : pendingAnalysis ? 'complete'
               : null;

  // Extract a one-line summary from the pending analysis for the completion
  // card. Falls back to a generic string if the shape is different than
  // expected.
  const resultSummary = pendingAnalysis ? (() => {
    const segs = pendingAnalysis?.roof?.segments;
    const nSegs = Array.isArray(segs) ? segs.length : 0;
    const areaM2 = Number(pendingAnalysis?.roof?.usable_roof_area_m2)
                 || Number(pendingAnalysis?.roof?.roof_area_m2)
                 || (Array.isArray(segs) ? segs.reduce((a, s) => a + (Number(s?.stats?.areaMeters2) || 0), 0) : 0);
    const source = pendingAnalysis?.solar_source || pendingAnalysis?.roof?.source;
    const pieces = [];
    if (nSegs > 0) pieces.push(`${nSegs} roof plane${nSegs === 1 ? '' : 's'}`);
    if (areaM2 > 0) pieces.push(`${Math.round(areaM2)} m²`);
    if (source) pieces.push(source.toString().toUpperCase());
    return pieces.length ? pieces.join(' · ') : 'Roof analysis ready';
  })() : null;

  // 8s auto-fallback — if customer hasn't clicked "See my results", commit
  // and advance automatically so they don't get stuck on the celebration.
  useEffect(() => {
    if (status !== 'complete') return undefined;
    const t = setTimeout(() => {
      if (typeof onSeeResults === 'function') onSeeResults();
    }, 8000);
    return () => clearTimeout(t);
  }, [status, onSeeResults]);

  // Overlay stays visible while any status is active OR customer hasn't
  // dismissed it. Dismissal on 'complete' triggers the same commit as the
  // CTA — so skipping mid-celebration still advances the flow.
  const flowOpen = !!status && !flowSkipped;
  const closeOrCommit = () => {
    if (status === 'complete' && typeof onSeeResults === 'function') {
      onSeeResults();
    } else {
      setFlowSkipped(true);
    }
  };

  // Current pin position. Initialised from geocoded coord; updates on drag
  // (marker dragend + map click). Yes button passes this back up so the
  // /analyse call uses THIS coord, not the geocoded one, when it differs.
  const [pin, setPin] = useState({ lat: initLat, lng: initLng });
  const dragged = pin.lat !== initLat || pin.lng !== initLng;

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  // One-time init: create the Leaflet map + Esri satellite tile layer +
  // draggable marker. StrictMode double-fires the effect in dev — the
  // container-already-initialised check keeps that from throwing.
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [initLat, initLng],
      zoom: 20,               // max Esri imagery zoom that still stays sharp
      maxZoom: 21,
      zoomControl: true,
      attributionControl: true,
    });

    // Esri World Imagery — free, no API key. Attribution is legally required.
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
        maxZoom: 21,
        maxNativeZoom: 19,    // Esri caps native tiles at 19; leaflet upsamples above that
      },
    ).addTo(map);

    const marker = L.marker([initLat, initLng], { draggable: true, autoPan: true })
      .addTo(map)
      .bindTooltip('Drag me onto your house', { permanent: false, direction: 'top', offset: [0, -35] });

    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng();
      setPin({ lat, lng });
    });

    // Click-to-move: user clicks anywhere on the map, marker snaps there.
    // Faster than dragging when the pin is far from the actual house.
    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      setPin({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);    // initLat/initLng only used on mount; re-entering the stage remounts anyway

  const resetPin = () => {
    if (markerRef.current && mapRef.current) {
      markerRef.current.setLatLng([initLat, initLng]);
      mapRef.current.setView([initLat, initLng], mapRef.current.getZoom());
    }
    setPin({ lat: initLat, lng: initLng });
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">
        Step 3 &middot; Select your house
      </div>
      <h2 className="font-serif text-3xl md:text-4xl mt-3 tracking-tight">
        Drag the pin onto your roof.
      </h2>
      <p className="mt-2 text-[#55504A] max-w-2xl">
        We&apos;ve placed the pin where Google Maps geocoded your address. It might
        be slightly off &mdash; drag it (or click) onto the actual building we should
        analyse. Once you confirm, we&apos;ll analyse the roof planes, sunshine, and
        shading (takes about 15 seconds).
      </p>

      <div className="mt-8 grid lg:grid-cols-[1.4fr,1fr] gap-8 items-start">
        {/* Leaflet map — draggable marker + click-to-move + Esri satellite */}
        <div>
          <div
            ref={mapContainerRef}
            className="rounded-2xl overflow-hidden shadow-2xl border border-[#E3D9C4] bg-[#F4EEE1]"
            style={{ aspectRatio: '4 / 3', maxHeight: '60vh', minHeight: 360 }}
          />
          <div className="mt-3 flex items-center gap-3 text-sm">
            <MapPin className={`w-4 h-4 ${dragged ? 'text-[#5C8B4A]' : 'text-[#D9531E]'}`} />
            <span className="font-mono text-xs md:text-sm text-[#55504A] flex-1 truncate">{formattedAddress}</span>
            <span className="text-xs text-[#8F887E] font-mono">
              {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}
            </span>
            {dragged && (
              <button
                onClick={resetPin}
                className="text-xs text-[#D9531E] hover:underline font-semibold"
                type="button"
              >
                Reset
              </button>
            )}
          </div>
          {dragged && (
            <div className="mt-2 text-xs text-[#5C8B4A] flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" /> You moved the pin &mdash; analysis will use your position, not the geocoded one.
            </div>
          )}
        </div>

        {/* Guidance panel */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#E3D9C4] bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-[#8F887E] font-semibold mb-2">Place the pin on</div>
            <ul className="text-sm text-[#1A1614] space-y-2">
              <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 mt-0.5 text-[#5C8B4A] flex-shrink-0" /> Your actual house roof &mdash; not the road, not next door, not a shed</li>
              <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 mt-0.5 text-[#5C8B4A] flex-shrink-0" /> If you&apos;re in a townhouse or duplex, pick your unit&apos;s roof</li>
              <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 mt-0.5 text-[#5C8B4A] flex-shrink-0" /> Rural properties: the pin often lands at the mailbox &mdash; drag it to the house</li>
            </ul>
            <div className="mt-3 pt-3 border-t border-[#F0E6D0] text-xs text-[#55504A]">
              Tip &mdash; you can also <strong>click anywhere on the map</strong> and the pin will snap there.
              Zoom in with the +/&minus; controls or your scroll wheel.
            </div>
          </div>
        </div>
      </div>

      {analysisError && (
        <div className="mt-6 flex items-start gap-3 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-900 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>
            <div className="font-semibold">Roof analysis failed</div>
            <div className="mt-1">{analysisError}</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex flex-wrap items-center gap-3">
        <button
          onClick={onBack}
          disabled={analysing}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm disabled:opacity-50"
        >
          <X className="w-4 h-4" /> No, wrong address
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onConfirm(pin)}
          disabled={analysing}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {analysing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Analysing your roof&hellip;</>
            : <><CheckCircle className="w-4 h-4" /> Confirm this is my house</>}
        </button>
      </div>

      {/* Loading-time engagement + post-completion CTA (Phase 3, 2026-08-19).
          Overlay is now a THREE-state UI: analysing (prominent status card +
          elapsed timer + cycling step-text), complete (green success + big
          "See my roof analysis" CTA + 8s auto-fallback), error (red retry).
          Skipping on 'complete' triggers the same commit as the CTA, so the
          customer never gets stranded on the celebration screen. */}
      <EnergyFlowOverlay
        open={flowOpen}
        onClose={closeOrCommit}
        hasBattery
        hasEv
        status={status}
        elapsedMs={elapsedMs}
        resultSummary={resultSummary}
        errorMessage={analysisError}
        onSeeResults={onSeeResults}
      />
    </div>
  );
}

// ── Stage 4: Address confirm on LINZ aerial + Google Solar geometry ─────────

function AddressStage({ analysis, onBack, onConfirm }) {
  const { aerial, roof, imagery, formattedAddress, coords, solar_source, used_quality, geocode_quality } = analysis;
  const isMock = solar_source === 'mock';
  // 2026-08-18 (iteration 3) — per-plane exclusion picker MOVED to the
  // QuoteStage sidebar (PlanePickerCard). Address stage is back to being
  // pure "analysis review": customer sees what we found, confirms it looks
  // right, and does the actual plane picking on the 3D view where they
  // can SEE which plane is which. Compass helper still lives here for the
  // per-plane detail table below.
  const segments = Array.isArray(roof.segments) ? roof.segments : [];
  const compass = (az) => {
    if (!Number.isFinite(az)) return '—';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  };

  // Warn when Google Solar's aerial is >4 years old — LINZ may show newer
  // construction that Solar API hasn't seen yet, so counts can disagree.
  const imgYear = imagery.date ? parseInt(imagery.date.slice(0, 4), 10) : null;
  const isStale = imgYear && (new Date().getFullYear() - imgYear) >= 4;

  // Colour + advice for geocoding quality — same tiers Google uses.
  const geoTierMap = {
    ROOFTOP:            { cls: 'text-green-800 bg-green-50 border-green-200',   note: 'Pin should be exactly on the property.' },
    RANGE_INTERPOLATED: { cls: 'text-amber-800 bg-amber-50 border-amber-200',   note: 'Interpolated between two known addresses on the street — pin may be off by a house or two.' },
    GEOMETRIC_CENTER:   { cls: 'text-amber-800 bg-amber-50 border-amber-200',   note: 'Google centred on the street/block midpoint — pin is likely on the road, not the roof.' },
    APPROXIMATE:        { cls: 'text-red-800 bg-red-50 border-red-200',         note: 'Google could only place the pin in the general area (suburb-level). This address may not exist in Google\'s database.' },
  };
  const geoTier = geoTierMap[geocode_quality] || { cls: 'text-slate-800 bg-slate-50 border-slate-200', note: '' };

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">Step 2 &middot; Is this your house?</div>
      <h2 className="font-serif text-3xl md:text-4xl mt-3 tracking-tight">
        We pulled this from your bill.
      </h2>
      <p className="mt-2 text-[#55504A] max-w-2xl">
        3D view of your property from Google's Photorealistic 3D Tiles &mdash; drag to rotate,
        scroll to zoom. Google Solar analysed the roof separately (stats on the right).
      </p>

      {/* Diagnostic banner: geocode quality + imagery-freshness warning */}
      <div className={`mt-4 grid gap-2 ${isStale ? 'md:grid-cols-2' : ''}`}>
        <div className={`px-4 py-3 rounded-xl border text-sm ${geoTier.cls}`}>
          <div className="text-[10px] uppercase tracking-wider font-bold">Geocoding: {geocode_quality || 'unknown'}</div>
          {geoTier.note && <div className="mt-1">{geoTier.note}</div>}
        </div>
        {isStale && (
          <div className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900">
            <div className="text-[10px] uppercase tracking-wider font-bold">Aerial mismatch possible</div>
            <div className="mt-1">Google Solar's imagery is from {imagery.date} — the roof geometry it found may not match today's LINZ aerial if the property was redeveloped.</div>
          </div>
        )}
      </div>

      <div className="mt-8 grid lg:grid-cols-[1.35fr,1fr] gap-8 items-start">
        {/* 3D house view — swap-in of the old 2D GoogleAerial.
            Uses OSM/LINZ-authoritative centre when available, falls back to
            Google's geocoded coord otherwise (same precedence as the panels
            hero in QuoteStage). */}
        <div>
          <Suspense fallback={<div className="h-[60vh] max-h-[560px] rounded-2xl bg-[#F4EEE1] border border-[#E3D9C4] grid place-items-center text-sm text-[#55504A]"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
            <Cesium3DView
              coords={roof?.authoritative_center || roof?.google_center || coords}
              showPanels={false}
              height="60vh"
            />
          </Suspense>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <MapPin className="w-4 h-4 text-[#D9531E]" />
            <span className="font-mono text-xs md:text-sm text-[#55504A] flex-1">{formattedAddress}</span>
            <span className="text-xs text-[#8F887E] font-mono">
              {coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}
            </span>
          </div>
          {isMock && (
            <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
              &#9432; solar_source=mock (no GOOGLE_SOLAR_API_KEY set — using canned Auckland CBD response)
            </div>
          )}
        </div>

        {/* Roof stats */}
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-wider text-[#8F887E] font-semibold mb-1">Google Solar read</div>
          <RoofStat icon={<Home className="w-4 h-4" />} label="Roof planes" value={roof.segments?.length || 0} />
          <RoofStat icon={<LayoutGrid className="w-4 h-4" />} label="Usable roof area" value={roof.max_array_area_m2} suffix="m²" />
          <RoofStat icon={<LayoutGrid className="w-4 h-4" />} label="Max panels (Google's estimate)" value={roof.max_array_panels_count} />
          <RoofStat icon={<Sun className="w-4 h-4" />} label="Max sunshine" value={roof.max_sunshine_hours_per_year} suffix="hrs/yr" />
          <RoofStat icon={<Sun className="w-4 h-4" />} label="CO₂ offset factor" value={roof.carbon_offset_factor_kg_per_kwh} suffix="kg/kWh" precision={4} />
          <RoofStat icon={<MapPin className="w-4 h-4" />} label="Imagery quality" value={imagery.quality} />
          <RoofStat icon={<MapPin className="w-4 h-4" />} label="Imagery date" value={imagery.date} />
          {used_quality && used_quality !== imagery.quality && (
            <div className="text-xs text-[#8F887E]">Solar API cascaded to {used_quality} tier for this address.</div>
          )}

          {/* Per-plane detail — read-only summary. The interactive picker
              (include/exclude per plane) lives on the QuoteStage sidebar
              where customers can see the actual 3D roof + panel placement
              while they toggle. Here it's info-only so the customer knows
              what we found before they commit compute to a full design. */}
          {segments.length > 0 && (
            <details className="mt-4 border border-[#E3D9C4] rounded-xl overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 bg-[#F4EEE1] text-sm font-semibold flex items-center gap-2">
                <LayoutGrid className="w-4 h-4" />
                Per-plane detail ({segments.length} planes)
                <span className="ml-auto text-xs font-normal text-[#55504A]">
                  You&apos;ll pick which to keep on the next 3D view.
                </span>
              </summary>
              <div className="p-3 space-y-1.5">
                {segments.map((s, i) => {
                  const az = s.azimuthDegrees;
                  const yieldK = Number.isFinite(s._yieldKwhPerKwpPerYear)
                    ? Math.round(s._yieldKwhPerKwpPerYear)
                    : null;
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-[32px,1fr,1fr,1fr,auto] gap-2 items-center text-xs font-mono tabular-nums px-2 py-2 rounded bg-[#FBF7F0]"
                    >
                      <span className="text-[#8F887E]">#{i + 1}</span>
                      <span>{s.pitchDegrees?.toFixed(1) || '—'}&deg; pitch</span>
                      <span>{Number.isFinite(az) ? `${Math.round(az)}° ${compass(az)}` : '—'}</span>
                      <span>{s.stats?.areaMeters2?.toFixed(1) || '—'} m&sup2;</span>
                      <span className="text-[#55504A]">
                        {yieldK != null ? `${yieldK} kWh/kWp` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Actions — house identity was confirmed at the 'preview' stage, so
          the primary CTA here is just "continue" (not "yes, that's my house"
          again). Back returns to the aerial preview in case the roof read
          looks off and the customer wants to re-check the pin. Plane
          include/exclude picking happens on the next 3D view. */}
      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to house preview
        </button>
        <div className="flex-1" />
        <button
          onClick={onConfirm}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20"
        >
          <CheckCircle className="w-4 h-4" /> Roof looks right &mdash; continue
        </button>
      </div>
    </div>
  );
}

// Extracted 2026-08-20 (Phase B1 parity) — the "Google Solar Read" stats
// card + per-plane detail table + geocoding / imagery-freshness diagnostic
// banners from AddressStage. Rendered by the merged /get-quote residential
// wizard's Step 3 so the customer sees the same rich analysis breakdown
// (roof planes count, usable area, max panels, sunshine, CO₂ offset,
// imagery quality/date, per-plane pitch/azimuth/area) as POC's AddressStage.
//
// Depends only on `analysis` prop shape returned by /api/roof/analyse.
// Renders NO navigation buttons — parent owns those.
export function GoogleSolarReadCard({ analysis }) {
  if (!analysis) return null;
  const { roof = {}, imagery = {}, geocode_quality } = analysis;
  const segments = Array.isArray(roof.segments) ? roof.segments : [];
  const compass = (az) => {
    if (!Number.isFinite(az)) return '—';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  };
  const imgYear = imagery.date ? parseInt(imagery.date.slice(0, 4), 10) : null;
  const isStale = imgYear && (new Date().getFullYear() - imgYear) >= 4;
  const geoTierMap = {
    ROOFTOP:            { cls: 'text-green-800 bg-green-50 border-green-200',   note: 'Pin should be exactly on the property.' },
    RANGE_INTERPOLATED: { cls: 'text-amber-800 bg-amber-50 border-amber-200',   note: 'Interpolated between two known addresses on the street — pin may be off by a house or two.' },
    GEOMETRIC_CENTER:   { cls: 'text-amber-800 bg-amber-50 border-amber-200',   note: 'Google centred on the street/block midpoint — pin is likely on the road, not the roof.' },
    APPROXIMATE:        { cls: 'text-red-800 bg-red-50 border-red-200',         note: "Google could only place the pin in the general area (suburb-level). This address may not exist in Google's database." },
  };
  const geoTier = geoTierMap[geocode_quality] || { cls: 'text-slate-800 bg-slate-50 border-slate-200', note: '' };

  return (
    <div>
      {/* Diagnostic banners — geocode quality + imagery freshness */}
      <div className={`grid gap-2 ${isStale ? 'md:grid-cols-2' : ''}`}>
        <div className={`px-4 py-3 rounded-xl border text-sm ${geoTier.cls}`}>
          <div className="text-[10px] uppercase tracking-wider font-bold">Geocoding: {geocode_quality || 'unknown'}</div>
          {geoTier.note && <div className="mt-1">{geoTier.note}</div>}
        </div>
        {isStale && (
          <div className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900">
            <div className="text-[10px] uppercase tracking-wider font-bold">Aerial mismatch possible</div>
            <div className="mt-1">Google Solar&apos;s imagery is from {imagery.date} &mdash; the roof geometry it found may not match today&apos;s aerial if the property was redeveloped.</div>
          </div>
        )}
      </div>

      {/* Roof stats grid */}
      <div className="mt-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-[#8F887E] font-semibold mb-1">Google Solar read</div>
        <RoofStat icon={<Home className="w-4 h-4" />}       label="Roof planes"                    value={roof.segments?.length || 0} />
        <RoofStat icon={<LayoutGrid className="w-4 h-4" />} label="Usable roof area"               value={roof.max_array_area_m2}        suffix="m²" />
        <RoofStat icon={<LayoutGrid className="w-4 h-4" />} label="Max panels (Google's estimate)" value={roof.max_array_panels_count} />
        <RoofStat icon={<Sun className="w-4 h-4" />}        label="Max sunshine"                    value={roof.max_sunshine_hours_per_year} suffix="hrs/yr" />
        <RoofStat icon={<Sun className="w-4 h-4" />}        label="CO₂ offset factor"               value={roof.carbon_offset_factor_kg_per_kwh} suffix="kg/kWh" precision={4} />
        <RoofStat icon={<MapPin className="w-4 h-4" />}     label="Imagery quality"                 value={imagery.quality} />
        <RoofStat icon={<MapPin className="w-4 h-4" />}     label="Imagery date"                    value={imagery.date} />
      </div>

      {/* Per-plane detail — read-only summary, collapsible */}
      {segments.length > 0 && (
        <details className="mt-4 border border-[#E3D9C4] rounded-xl overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 bg-[#F4EEE1] text-sm font-semibold flex items-center gap-2 flex-wrap">
            <LayoutGrid className="w-4 h-4" />
            Per-plane detail ({segments.length} plane{segments.length === 1 ? '' : 's'})
            <span className="ml-auto text-xs font-normal text-[#55504A]">
              You&apos;ll pick which to keep on the next 3D view.
            </span>
          </summary>
          <div className="p-3 space-y-1.5">
            {segments.map((s, i) => {
              const az = s.azimuthDegrees;
              const yieldK = Number.isFinite(s._yieldKwhPerKwpPerYear)
                ? Math.round(s._yieldKwhPerKwpPerYear)
                : null;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[32px,1fr,1fr,1fr,auto] gap-2 items-center text-xs font-mono tabular-nums px-2 py-2 rounded bg-[#FBF7F0]"
                >
                  <span className="text-[#8F887E]">#{i + 1}</span>
                  <span>{s.pitchDegrees?.toFixed(1) || '—'}&deg; pitch</span>
                  <span>{Number.isFinite(az) ? `${Math.round(az)}° ${compass(az)}` : '—'}</span>
                  <span>{s.stats?.areaMeters2?.toFixed(1) || '—'} m&sup2;</span>
                  <span className="text-[#55504A]">
                    {yieldK != null ? `${yieldK} kWh/kWp` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

// Google Static Maps satellite — same imagery Google Maps shows when the
// customer searches their address. Server proxies the image so the API key
// stays hidden. Marker is baked into the URL server-side, so the pin is
// pixel-perfect on the geocoded coord (Google composes it).
// DEAD CODE (kept as fallback reference) — replaced by Cesium3DView in
// AddressStage. Delete once 3D flow is validated in staging.
function GoogleAerial({ aerial, coords }) {  // eslint-disable-line no-unused-vars
  const [err, setErr] = useState(null);
  const [w, h] = (aerial.size || '640x480').split('x').map(Number);

  return (
    <div
      className="relative rounded-2xl overflow-hidden shadow-2xl border border-[#E3D9C4] bg-[#8FA184]"
      style={{ aspectRatio: `${w} / ${h}`, maxHeight: '68vh' }}
    >
      {err ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-800 bg-red-50">
          <div>
            <div className="font-semibold mb-2">Couldn't load Google Maps satellite image</div>
            <div className="font-mono text-xs">{err}</div>
            <div className="mt-3 text-xs text-red-700">
              Most common cause: <code>Maps Static API</code> not enabled in Google Cloud Console for your key.
              Enable it at console.cloud.google.com → APIs & Services → Library.
            </div>
          </div>
        </div>
      ) : (
        <img
          src={aerial.url}
          alt="Aerial view of the property"
          className="absolute inset-0 w-full h-full object-cover"
          onError={async () => {
            // Try to fetch the URL to grab the JSON error body Google returned.
            try {
              const r = await fetch(aerial.url);
              if (!r.ok) {
                const body = await r.text();
                setErr(body.slice(0, 400));
              } else {
                setErr('image failed to render (unexpected — server returned OK)');
              }
            } catch (e) {
              setErr(`fetch threw: ${e.message}`);
            }
          }}
          draggable={false}
        />
      )}

      {/* Attribution */}
      <div className="absolute bottom-2 right-2 text-[10px] font-mono bg-black/50 text-white px-2 py-0.5 rounded pointer-events-none">
        Google Maps · z{aerial.zoom}
      </div>
    </div>
  );
}

// ── Stage 3: Roof material picker (Streetview visual aid + 3-card) ──────────

const MATERIAL_OPTIONS = [
  {
    id: 'metal',
    title: 'Metal roof',
    sub: 'Corrugated iron, Colorsteel, tray decking',
    swatch: 'repeating-linear-gradient(90deg, #4B5A66 0 4px, #6B7A85 4px 8px)',
  },
  {
    id: 'tile',
    title: 'Tile roof',
    sub: 'Concrete, clay, terracotta tiles',
    swatch: 'repeating-linear-gradient(45deg, #B8574A 0 6px, #A34738 6px 12px)',
  },
  {
    id: 'unsure',
    title: "I'm not sure",
    sub: "We'll confirm at the site survey — quote covers both",
    swatch: 'linear-gradient(135deg, #EBE2CE, #DDCFAE)',
  },
];

function MaterialStage({ analysis, material, onPick, onBack, onConfirm, designing, designError }) {
  const { coords, formattedAddress } = analysis;
  const [svError, setSvError] = useState(null);

  const svUrl = `/api/aerial/streetview?lat=${coords.latitude}&lng=${coords.longitude}&size=640x480&pitch=15`;

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">Step 3 &middot; Roof material</div>
      <h2 className="font-serif text-3xl md:text-4xl mt-3 tracking-tight">
        What&apos;s your roof made of?
      </h2>
      <p className="mt-2 text-[#55504A] max-w-2xl">
        Here&apos;s a street-level view of your house — corrugated ridges usually mean metal, curved rows mean tile.
        This affects mounting hardware, not panel choice.
      </p>

      <div className="mt-8 grid lg:grid-cols-2 gap-8 items-start">
        {/* Streetview */}
        <div>
          <div
            className="relative rounded-2xl overflow-hidden shadow-2xl border border-[#E3D9C4] bg-[#B5C4A5]"
            style={{ aspectRatio: '640 / 480' }}
          >
            {svError ? (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-800 bg-red-50">
                <div>
                  <div className="font-semibold mb-2">Streetview unavailable for this address</div>
                  <div className="font-mono text-xs mb-3">{svError}</div>
                  <div className="text-xs text-red-700">
                    Either no Streetview coverage here (rural / new subdivision) OR "Street View Static API" isn&apos;t enabled in Google Cloud Console for your key.
                  </div>
                </div>
              </div>
            ) : (
              <img
                src={svUrl}
                alt="Streetview of the property"
                className="absolute inset-0 w-full h-full object-cover"
                onError={async () => {
                  try {
                    const r = await fetch(svUrl);
                    if (!r.ok) {
                      const body = await r.text();
                      setSvError(body.slice(0, 300));
                    } else {
                      setSvError('image did not render (unexpected)');
                    }
                  } catch (e) {
                    setSvError(`fetch threw: ${e.message}`);
                  }
                }}
                draggable={false}
              />
            )}
            <div className="absolute bottom-2 right-2 text-[10px] font-mono bg-black/50 text-white px-2 py-0.5 rounded pointer-events-none">
              Google Streetview
            </div>
          </div>
          <div className="mt-3 text-xs text-[#8F887E] font-mono">{formattedAddress}</div>
        </div>

        {/* Picker */}
        <div>
          <h3 className="font-serif text-lg mb-3">Pick one:</h3>
          <div className="space-y-3">
            {MATERIAL_OPTIONS.map(opt => {
              const isSel = material === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => onPick(opt.id)}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition
                    ${isSel
                      ? 'border-[#D9531E] bg-[#D9531E]/5'
                      : 'border-[#E3D9C4] bg-white hover:border-[#8F887E] hover:bg-[#F4EEE1]'}
                  `}
                >
                  <div
                    className="w-14 h-14 rounded-xl flex-shrink-0"
                    style={{ background: opt.swatch, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.05)' }}
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-[#1A1614]">{opt.title}</div>
                    <div className="text-xs text-[#55504A] mt-0.5">{opt.sub}</div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 grid place-items-center
                      ${isSel ? 'border-[#D9531E]' : 'border-[#E3D9C4]'}
                    `}
                  >
                    {isSel && <div className="w-2.5 h-2.5 rounded-full bg-[#D9531E]" />}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-[#8F887E]">
            Roof material changes mounting hardware price by ~5-8%. If you pick &quot;not sure&quot; we&apos;ll quote assuming metal and adjust after the site survey.
          </p>
        </div>
      </div>

      {designError && (
        <div className="mt-6 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Design compose failed</div>
            <div className="mt-1">{designError}</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex flex-wrap items-center gap-3">
        <button onClick={onBack} disabled={designing} className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm disabled:opacity-50">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex-1" />
        <button
          onClick={onConfirm}
          disabled={!material || designing}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
          title={!material ? 'Pick a roof material first' : ''}
        >
          {designing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Designing your system…</>
            : <><Sparkles className="w-4 h-4" /> Design my system</>}
        </button>
      </div>
    </div>
  );
}

// ── Stage 4: Design + 3-tier quote with panel overlay ──────────────────────
// 2026-08-18 (iteration 4) — immersive layout. 3D dominates the viewport,
// info accessed on demand via right-edge FAB rail → slide-in drawers.
// Persistent bottom StatusStrip carries the one-glance summary + primary
// CTA. Reduces single-page scroll fatigue and puts the 3D "wow" front
// and centre. Sub-components below (Drawer/FabButton/StatusStrip) are
// used only here; kept local so all of QuoteStage's UI lives together.

// Reusable right-side drawer. Backdrop click + ESC close. Body scroll
// locked while open (adds .overflow-hidden to document.body). Content
// area scrolls internally so tall drawer bodies don't push the layout.
// Energy-flow animation overlay (Phase 3, 2026-08-19). Full-screen modal
// showing how solar energy flows from panels → house / battery / grid /
// EV over the course of a day. Auto-plays once on first QuoteStage
// landing via localStorage flag; replay button afterwards. Adapts to
// customer's system: shows battery flow line only when they have a
// battery, EV flow only when they toggled it on.
//
// SVG-driven, marching-ants stroke-dashoffset animation for the pulses.
// No external library — hand-drawn paths + CSS keyframes. Keeps bundle
// small and colours stay in our palette.
// ── EnergyFlowOverlay (rebuilt 2026-08-19) ────────────────────────────────
// Two mount points:
//   1. During PreviewStage `analysing` → engages customer through the 5-15s
//      roof-analysis wait (replaces staring at a spinner).
//   2. Post-analysis on QuoteStage → replay button in CustomiseSystemCard.
//
// Stylised 2.5D scene: front-elevation home with panels on the roof, battery
// cabinet + inverter + EV charger + grid pylon; sun/moon in sky. Four
// time-of-day modes (Sunny / Cloudy / Evening / Night) change sky gradient,
// celestial body, panel intensity, window glow, and which flows animate.
//
// Design plan: warm cream + GoldenRay orange brand, terracotta roof, cream
// walls, warm windows (glow at night), cyan LED for battery charging, green
// for self-use, red for grid import, purple for EV.

// Per-mode config: sky palette, active flows, celestial body, and tagline.
// Flow keys map into the FLOW_DEFS anchor table below.
const FLOW_MODES = {
  sunny: {
    label: 'Sunny day',
    sky: ['#DFF0FA', '#B7D9F0', '#F5F9FF'],
    celestial: 'sun',
    cloud: false,
    stars: false,
    windowsGlow: false,
    panelBrightness: 1,
    activeFlows: ['sunToPanels', 'panelsToInverter', 'inverterToHouse', 'inverterToBattery', 'inverterToGrid', 'inverterToEv'],
    tagline: 'Panels producing more than you need — battery charging, extra sold to the grid.',
  },
  cloudy: {
    label: 'Cloudy',
    sky: ['#B4BFC9', '#DBE1E7', '#EEF2F5'],
    celestial: 'sun',
    cloud: true,
    stars: false,
    windowsGlow: false,
    panelBrightness: 0.55,
    activeFlows: ['sunToPanels', 'panelsToInverter', 'inverterToHouse'],
    tagline: 'Reduced production — panels still cover the essentials.',
  },
  evening: {
    label: 'Evening',
    sky: ['#FDBA74', '#C084FC', '#4C1D95'],
    celestial: 'sunset',
    cloud: false,
    stars: false,
    windowsGlow: true,
    panelBrightness: 0.2,
    activeFlows: ['batteryToInverter', 'inverterToHouse', 'inverterToEv'],
    tagline: 'Battery powering the house — you skip peak-rate grid draw.',
  },
  night: {
    label: 'Night',
    sky: ['#1E293B', '#0F172A', '#020617'],
    celestial: 'moon',
    cloud: false,
    stars: true,
    windowsGlow: true,
    panelBrightness: 0,
    activeFlows: ['gridToInverter', 'inverterToHouse', 'inverterToEv'],
    tagline: 'Battery drained — grid takes over on cheap overnight rates.',
  },
};

// Flow anchor points in the 800×500 scene. Paths use quadratic Bézier curves
// (via SVG Q command) so parallel flows visually separate. `label` shows in
// the legend; `color` is the pulse colour.
const FLOW_DEFS = {
  sunToPanels:      { from: [660, 90],  ctl: [510, 155], to: [230, 232], color: '#FCD34D', label: 'sunlight' },
  panelsToInverter: { from: [230, 232], ctl: [320, 320], to: [396, 342], color: '#F59E0B', label: 'DC power' },
  inverterToHouse:  { from: [396, 342], ctl: [340, 320], to: [255, 355], color: '#22C55E', label: 'powering home' },
  inverterToBattery:{ from: [396, 342], ctl: [408, 342], to: [420, 342], color: '#22D3EE', label: 'charging battery' },
  batteryToInverter:{ from: [420, 342], ctl: [408, 342], to: [396, 342], color: '#10B981', label: 'battery discharging' },
  inverterToGrid:   { from: [396, 342], ctl: [560, 260], to: [712, 220], color: '#F97316', label: 'excess to grid' },
  gridToInverter:   { from: [712, 220], ctl: [560, 260], to: [396, 342], color: '#EF4444', label: 'from grid' },
  inverterToEv:     { from: [396, 342], ctl: [470, 400], to: [548, 372], color: '#A78BFA', label: 'charging EV' },
};

// Cycled during 'analysing' status so the customer sees which stage the
// server is in, even if the response is slow. Rotates every 2.5s.
const ANALYSING_STEPS = [
  'Reading LIDAR roof geometry',
  'Checking sun-hours + shading',
  'Sizing your ideal system',
];

// Exported 2026-08-20 for reuse by the merged /get-quote residential wizard
// (Phase B1 ticket B1.4). Same component POC uses — the wizard mounts it to
// provide the loading engagement + celebration during roof analysis.
export function EnergyFlowOverlay({
  open,
  onClose,
  hasBattery = true,
  hasEv = true,
  status = null,           // 'analysing' | 'complete' | 'error' | null
  elapsedMs = 0,
  resultSummary = null,
  errorMessage = null,
  onSeeResults = null,
}) {
  const [mode, setMode] = useState('sunny');
  const [epoch, setEpoch] = useState(0);
  const [flashOn, setFlashOn] = useState(false);
  const prevStatusRef = useRef(status);

  // Gold sky-flash celebration when status transitions analysing → complete.
  useEffect(() => {
    if (prevStatusRef.current === 'analysing' && status === 'complete') {
      setFlashOn(true);
      const t = setTimeout(() => setFlashOn(false), 1100);
      prevStatusRef.current = status;
      return () => clearTimeout(t);
    }
    prevStatusRef.current = status;
    return undefined;
  }, [status]);

  // Escape + body-overflow lock while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  // Re-seed mode + epoch each time the overlay opens so replay always
  // starts from Sunny with fresh animations.
  useEffect(() => {
    if (open) {
      setMode('sunny');
      setEpoch((e) => e + 1);
    }
  }, [open]);

  if (!open) return null;

  const cfg = FLOW_MODES[mode];
  // Filter flows by (a) mode's activeFlows set, (b) hasBattery / hasEv gates.
  const flowKeys = cfg.activeFlows.filter((k) => {
    if (!hasBattery && (k === 'inverterToBattery' || k === 'batteryToInverter')) return false;
    if (!hasEv && k === 'inverterToEv') return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 overflow-y-auto">
      {/* z-[9999] — Leaflet's marker/tooltip panes use z-index up to 700, so the
          overlay MUST sit above them or the map bleeds through during the
          PreviewStage loading-engagement mount. Caught by E2E on 2026-08-19. */}
      {/* Celebration flash — fires once on analysing → complete transition */}
      {flashOn && (
        <div
          data-flash="gold"
          className="pointer-events-none absolute inset-0 z-[10] bg-gradient-to-b from-yellow-300/50 via-amber-400/25 to-transparent"
          style={{ animation: 'skyFlash 1s ease-out forwards' }}
        />
      )}
      {/* Shared keyframes for all overlay animations */}
      <style>{`
        @keyframes skyFlash    { 0% { opacity: 0.85 } 100% { opacity: 0 } }
        @keyframes analysingBar { 0% { transform: translateX(-100%) } 100% { transform: translateX(100%) } }
        @keyframes completePulse { 0%, 100% { box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3) } 50% { box-shadow: 0 10px 40px rgba(16, 185, 129, 0.6) } }
        @keyframes ctaPulse      { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.04) } }
      `}</style>
      {/* Close (X) */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="w-full max-w-5xl">
        {/* Header */}
        <div className="text-center mb-3 md:mb-4">
          <div className="text-[10px] md:text-[11px] uppercase tracking-[0.2em] text-[#F4A83B] font-bold">
            How your system works
          </div>
          <div className="text-xl md:text-3xl font-serif font-bold text-white mt-1">
            Follow the energy through your day
          </div>
          {status === 'analysing' && (
            <div
              data-status="analysing"
              className="mt-3 mx-auto max-w-md rounded-2xl bg-amber-500/15 border-2 border-amber-400/50 px-5 py-3 shadow-xl backdrop-blur-sm"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-amber-300 flex-shrink-0" />
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm md:text-base font-bold text-amber-50 tabular-nums">
                    Analysing your roof · {Math.floor((elapsedMs || 0) / 1000)}s
                  </div>
                  <div className="text-xs md:text-sm text-amber-100/85 mt-0.5 truncate">
                    {ANALYSING_STEPS[Math.floor((elapsedMs || 0) / 2500) % ANALYSING_STEPS.length]}&hellip;
                  </div>
                </div>
              </div>
              <div className="mt-2 h-1 bg-amber-900/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full"
                  style={{ animation: 'analysingBar 2.5s ease-in-out infinite' }}
                />
              </div>
            </div>
          )}
          {status === 'complete' && (
            <div
              data-status="complete"
              className="mt-3 mx-auto max-w-md rounded-2xl bg-emerald-500/20 border-2 border-emerald-400/60 px-5 py-3 shadow-2xl shadow-emerald-500/30"
              role="status"
              aria-live="polite"
              style={{ animation: 'completePulse 1.4s ease-in-out infinite' }}
            >
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-emerald-300 flex-shrink-0" />
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm md:text-base font-bold text-emerald-50">
                    Roof analysis ready!
                  </div>
                  <div className="text-xs md:text-sm text-emerald-100/90 mt-0.5">
                    {resultSummary || 'Your results are waiting'}
                  </div>
                </div>
              </div>
            </div>
          )}
          {status === 'error' && (
            <div
              data-status="error"
              className="mt-3 mx-auto max-w-md rounded-2xl bg-red-500/20 border-2 border-red-400/60 px-5 py-3 shadow-xl"
              role="alert"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-red-300 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm md:text-base font-bold text-red-50">
                    We couldn&apos;t analyse this roof
                  </div>
                  <div className="text-xs md:text-sm text-red-100/85 mt-0.5">
                    {errorMessage ? errorMessage.slice(0, 140) : 'Try a different pin or address'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mode tabs */}
        <div className="flex justify-center gap-1.5 md:gap-2 mb-3">
          {Object.entries(FLOW_MODES).map(([key, m]) => {
            const active = mode === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setMode(key); setEpoch((e) => e + 1); }}
                className={`px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-semibold transition border ${
                  active
                    ? 'bg-[#D9531E] border-[#D9531E] text-white shadow-lg shadow-orange-500/30'
                    : 'bg-white/8 border-white/15 text-white/75 hover:bg-white/15 hover:text-white'
                }`}
                aria-pressed={active}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Scene */}
        <div className="relative w-full aspect-[8/5] rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
          <svg
            key={`${mode}-${epoch}`}
            viewBox="0 0 800 500"
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor={cfg.sky[0]} />
                <stop offset="60%" stopColor={cfg.sky[1]} />
                <stop offset="100%" stopColor={cfg.sky[2]} />
              </linearGradient>
              <linearGradient id="ground-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={mode === 'night' ? '#1B2C1F' : '#7FB98A'} />
                <stop offset="100%" stopColor={mode === 'night' ? '#0F1A14' : '#4A8259'} />
              </linearGradient>
              <radialGradient id="sun-glow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%"  stopColor="#FFF7B2" stopOpacity="0.9" />
                <stop offset="60%" stopColor="#F59E0B" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="moon-glow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%"  stopColor="#F1F5FB" stopOpacity="0.75" />
                <stop offset="100%" stopColor="#F1F5FB" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="roof-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor="#C2410C" />
                <stop offset="100%" stopColor="#7C2D12" />
              </linearGradient>
              <linearGradient id="wall-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FEF3E2" />
                <stop offset="100%" stopColor="#F5E6C8" />
              </linearGradient>
              <linearGradient id="pylon-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={mode === 'night' ? '#94A3B8' : '#64748B'} />
                <stop offset="100%" stopColor={mode === 'night' ? '#475569' : '#334155'} />
              </linearGradient>
              <linearGradient id="panel-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor="#3B5A85" />
                <stop offset="100%" stopColor="#0F2540" />
              </linearGradient>
            </defs>

            {/* Sky */}
            <rect x="0" y="0" width="800" height="320" fill="url(#sky-grad)" />

            {/* Stars (night only) — scattered small crosses */}
            {cfg.stars && [
              [80, 60], [140, 105], [210, 45], [290, 80], [360, 130],
              [470, 55], [540, 100], [610, 45], [720, 130], [770, 70],
              [50, 150], [180, 165], [340, 190], [510, 175], [640, 200],
            ].map(([sx, sy], i) => (
              <g key={`star-${i}`} opacity={0.85}>
                <circle cx={sx} cy={sy} r={i % 3 === 0 ? 1.8 : 1.2} fill="#F8FAFC" />
                {i % 4 === 0 && (
                  <>
                    <line x1={sx - 4} y1={sy} x2={sx + 4} y2={sy} stroke="#F8FAFC" strokeWidth="0.5" opacity="0.6" />
                    <line x1={sx} y1={sy - 4} x2={sx} y2={sy + 4} stroke="#F8FAFC" strokeWidth="0.5" opacity="0.6" />
                  </>
                )}
              </g>
            ))}

            {/* Sun / Sunset / Moon */}
            {cfg.celestial === 'sun' && (
              <g>
                <circle cx="660" cy="90" r="70" fill="url(#sun-glow)" />
                {/* Rays */}
                {Array.from({ length: 12 }).map((_, i) => {
                  const a = (i / 12) * Math.PI * 2;
                  const x1 = 660 + Math.cos(a) * 44;
                  const y1 = 90  + Math.sin(a) * 44;
                  const x2 = 660 + Math.cos(a) * 58;
                  const y2 = 90  + Math.sin(a) * 58;
                  return (
                    <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke="#FCD34D" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
                  );
                })}
                <circle cx="660" cy="90" r="36" fill="#FCD34D" />
                <circle cx="660" cy="90" r="36" fill="none" stroke="#F59E0B" strokeWidth="2" />
              </g>
            )}
            {cfg.celestial === 'sunset' && (
              <g>
                <circle cx="640" cy="140" r="80" fill="url(#sun-glow)" opacity="0.7" />
                <circle cx="640" cy="140" r="34" fill="#F97316" />
                <circle cx="640" cy="140" r="34" fill="none" stroke="#EA580C" strokeWidth="2" />
              </g>
            )}
            {cfg.celestial === 'moon' && (
              <g>
                <circle cx="660" cy="90" r="60" fill="url(#moon-glow)" />
                <circle cx="660" cy="90" r="30" fill="#E2E8F0" />
                {/* Craters */}
                <circle cx="650" cy="82" r="4" fill="#94A3B8" opacity="0.6" />
                <circle cx="670" cy="97" r="3" fill="#94A3B8" opacity="0.6" />
                <circle cx="656" cy="100" r="2" fill="#94A3B8" opacity="0.5" />
              </g>
            )}

            {/* Cloud (cloudy mode) — layered soft ellipses */}
            {cfg.cloud && (
              <g opacity="0.9">
                <ellipse cx="500" cy="120" rx="70" ry="22" fill="#F8FAFC" />
                <ellipse cx="450" cy="130" rx="50" ry="20" fill="#F1F5F9" />
                <ellipse cx="560" cy="130" rx="55" ry="20" fill="#F1F5F9" />
                <ellipse cx="510" cy="140" rx="80" ry="15" fill="#E2E8F0" />
              </g>
            )}

            {/* Ground / lawn */}
            <rect x="0" y="310" width="800" height="190" fill="url(#ground-grad)" />
            {/* Grass tufts */}
            {Array.from({ length: 40 }).map((_, i) => {
              const x = 10 + i * 20;
              return (
                <line key={`grass-${i}`} x1={x} y1="318" x2={x} y2="313"
                  stroke={mode === 'night' ? '#2F4A34' : '#4A8259'} strokeWidth="1.2" opacity="0.7" />
              );
            })}

            {/* Grid pylon (back layer) */}
            <g opacity={mode === 'night' ? 0.85 : 0.9}>
              {/* Tower silhouette — trapezoidal lattice */}
              <path
                d="M 700 160 L 725 160 L 735 410 L 690 410 Z"
                fill="none" stroke="url(#pylon-grad)" strokeWidth="2.5"
              />
              {/* Lattice crosses */}
              {[0.15, 0.3, 0.45, 0.6, 0.75].map((t, i) => {
                const y = 160 + t * 250;
                const w = 25 + t * 20;
                const cx = 712.5 + t * 0;
                return (
                  <g key={`lat-${i}`} stroke="url(#pylon-grad)" strokeWidth="1.5">
                    <line x1={cx - w / 2} y1={y - 12} x2={cx + w / 2} y2={y + 12} />
                    <line x1={cx - w / 2} y1={y + 12} x2={cx + w / 2} y2={y - 12} />
                    <line x1={cx - w / 2} y1={y - 12} x2={cx + w / 2} y2={y - 12} />
                    <line x1={cx - w / 2} y1={y + 12} x2={cx + w / 2} y2={y + 12} />
                  </g>
                );
              })}
              {/* Cross-arms */}
              <line x1="670" y1="180" x2="755" y2="180" stroke="url(#pylon-grad)" strokeWidth="2.5" />
              <line x1="678" y1="205" x2="747" y2="205" stroke="url(#pylon-grad)" strokeWidth="2.5" />
              {/* Wire dots */}
              <circle cx="670" cy="180" r="2" fill="#334155" />
              <circle cx="755" cy="180" r="2" fill="#334155" />
              <circle cx="678" cy="205" r="2" fill="#334155" />
              <circle cx="747" cy="205" r="2" fill="#334155" />
            </g>

            {/* House */}
            <g>
              {/* Chimney */}
              <rect x="200" y="170" width="18" height="55" fill="#78350F" />
              <rect x="196" y="168" width="26" height="6" fill="#57200A" />
              {/* Roof — gable with slight overhang */}
              <path
                d="M 120 258 L 250 165 L 380 258 L 370 268 L 250 178 L 130 268 Z"
                fill="url(#roof-grad)"
              />
              {/* Roof face (front-facing slope) — where panels sit */}
              <path
                d="M 130 268 L 250 178 L 260 200 L 148 288 Z"
                fill="#7C2D12" opacity="0.7"
              />
              {/* Walls */}
              <rect x="140" y="260" width="220" height="150" fill="url(#wall-grad)" />
              <rect x="140" y="260" width="220" height="150" fill="none" stroke="#C4A57A" strokeWidth="1.5" />
              {/* Door */}
              <rect x="235" y="335" width="42" height="75" fill="#7C4A1E" />
              <rect x="235" y="335" width="42" height="75" fill="none" stroke="#4A2C10" strokeWidth="1.5" />
              <circle cx="270" cy="375" r="1.8" fill="#FCD34D" />
              {/* Windows — glow at night/evening */}
              <rect x="160" y="290" width="55" height="40"
                fill={cfg.windowsGlow ? '#FDE68A' : '#93C5FD'}
                stroke="#78350F" strokeWidth="1.5" />
              <line x1="187.5" y1="290" x2="187.5" y2="330" stroke="#78350F" strokeWidth="1" />
              <line x1="160" y1="310" x2="215" y2="310" stroke="#78350F" strokeWidth="1" />
              <rect x="295" y="290" width="55" height="40"
                fill={cfg.windowsGlow ? '#FDE68A' : '#93C5FD'}
                stroke="#78350F" strokeWidth="1.5" />
              <line x1="322.5" y1="290" x2="322.5" y2="330" stroke="#78350F" strokeWidth="1" />
              <line x1="295" y1="310" x2="350" y2="310" stroke="#78350F" strokeWidth="1" />
              {/* Front lawn edge */}
              <line x1="140" y1="410" x2="360" y2="410" stroke="#4A2C10" strokeWidth="1.5" />
            </g>

            {/* Panels on the LEFT roof slope (front-facing to viewer).
                Roof slope runs from left-eave (130, 268) up to apex (250, 178).
                Parametrise the slope by t = 0 (eave) → 1 (apex). The panel
                array is a rotated grid whose axes track (a) along the slope
                and (b) across the ridge (perpendicular). Each cell is a
                parallelogram whose vertices are computed so it sits FLUSH
                on the roof face — no overlap, no wall spillover. */}
            <g opacity={0.4 + 0.6 * cfg.panelBrightness}>
              {(() => {
                // Left roof slope: eave (E) → apex (A)
                const Ex = 130, Ey = 268;
                const Ax = 250, Ay = 178;
                // Unit vector along the slope (from E to A)
                const sx = (Ax - Ex);   // 120
                const sy = (Ay - Ey);   // -90
                const sLen = Math.hypot(sx, sy);   // 150
                const ux = sx / sLen;   // 0.8
                const uy = sy / sLen;   // -0.6
                // Perpendicular (into the roof depth — toward the ridge)
                // Rotate 90° clockwise: (uy, -ux) points down-right into ridge
                const px = uy;          // -0.6
                const py = -ux;         // -0.8
                // Panel array: 2 rows × 4 cols on the slope
                const rows = 2;
                const cols = 4;
                // Cell size along-slope × perp
                const cellA = 26;       // along-slope length (px)
                const cellP = 18;       // perp length (px)
                const gap = 2;
                // Array starts at margin from eave, centred perpendicularly
                const marginA = 12;     // from eave up the slope
                const perpBase = 4;     // offset from roof edge toward ridge
                const panels = [];
                for (let r = 0; r < rows; r++) {
                  for (let c = 0; c < cols; c++) {
                    const aStart = marginA + c * (cellA + gap);      // along-slope offset for top-left corner
                    const pStart = perpBase + r * (cellP + gap);      // perp offset (row 0 = closest to roof edge)
                    // Four corners of the parallelogram (top-left, top-right, bottom-right, bottom-left)
                    const p1x = Ex + ux * aStart + px * pStart;
                    const p1y = Ey + uy * aStart + py * pStart;
                    const p2x = Ex + ux * (aStart + cellA) + px * pStart;
                    const p2y = Ey + uy * (aStart + cellA) + py * pStart;
                    const p3x = Ex + ux * (aStart + cellA) + px * (pStart + cellP);
                    const p3y = Ey + uy * (aStart + cellA) + py * (pStart + cellP);
                    const p4x = Ex + ux * aStart + px * (pStart + cellP);
                    const p4y = Ey + uy * aStart + py * (pStart + cellP);
                    panels.push({ p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y });
                  }
                }
                return panels.map((p, i) => (
                  <g key={`panel-${i}`}>
                    <path
                      d={`M ${p.p1x.toFixed(1)} ${p.p1y.toFixed(1)} L ${p.p2x.toFixed(1)} ${p.p2y.toFixed(1)} L ${p.p3x.toFixed(1)} ${p.p3y.toFixed(1)} L ${p.p4x.toFixed(1)} ${p.p4y.toFixed(1)} Z`}
                      fill="url(#panel-grad)"
                      stroke="#0B1E36"
                      strokeWidth="0.8"
                    />
                    {/* Vertical cell divider (mid along-slope) */}
                    <line
                      x1={((p.p1x + p.p2x) / 2).toFixed(1)} y1={((p.p1y + p.p2y) / 2).toFixed(1)}
                      x2={((p.p4x + p.p3x) / 2).toFixed(1)} y2={((p.p4y + p.p3y) / 2).toFixed(1)}
                      stroke="#4B6584" strokeWidth="0.5" opacity="0.7"
                    />
                    {/* Horizontal cell divider (mid perp) */}
                    <line
                      x1={((p.p1x + p.p4x) / 2).toFixed(1)} y1={((p.p1y + p.p4y) / 2).toFixed(1)}
                      x2={((p.p2x + p.p3x) / 2).toFixed(1)} y2={((p.p2y + p.p3y) / 2).toFixed(1)}
                      stroke="#4B6584" strokeWidth="0.5" opacity="0.7"
                    />
                    {/* Glossy sheen — visible only on sunny day */}
                    {cfg.panelBrightness > 0.5 && (
                      <path
                        d={`M ${p.p1x.toFixed(1)} ${p.p1y.toFixed(1)} L ${((p.p1x + p.p2x) / 2).toFixed(1)} ${((p.p1y + p.p2y) / 2).toFixed(1)} L ${(((p.p1x + p.p2x) / 2 + (p.p4x - p.p1x) * 0.3)).toFixed(1)} ${(((p.p1y + p.p2y) / 2 + (p.p4y - p.p1y) * 0.3)).toFixed(1)} L ${(p.p1x + (p.p4x - p.p1x) * 0.3).toFixed(1)} ${(p.p1y + (p.p4y - p.p1y) * 0.3).toFixed(1)} Z`}
                        fill="#93C5FD"
                        opacity="0.3"
                      />
                    )}
                  </g>
                ));
              })()}
            </g>

            {/* Inverter — mounted on house exterior right side */}
            <g>
              <rect x="380" y="325" width="34" height="42" rx="3" fill="#4B5563" stroke="#1F2937" strokeWidth="1.2" />
              <rect x="384" y="330" width="26" height="6" rx="1" fill="#1F2937" />
              <circle cx="390" cy="345" r="2" fill="#22C55E">
                <animate attributeName="opacity" values="0.4;1;0.4" dur="1.8s" repeatCount="indefinite" />
              </circle>
              <circle cx="398" cy="345" r="1.5" fill="#F59E0B" opacity="0.8" />
              <text x="397" y="360" textAnchor="middle" fontSize="6" fill="#F3F4F6" fontFamily="sans-serif" fontWeight="700">INV</text>
            </g>

            {/* Battery cabinet — right of inverter (only when hasBattery) */}
            {hasBattery && (
              <g>
                <rect x="418" y="308" width="46" height="98" rx="4" fill="#374151" stroke="#111827" strokeWidth="1.5" />
                <rect x="422" y="313" width="38" height="30" fill="#4B5563" stroke="#1F2937" strokeWidth="1" />
                <rect x="422" y="347" width="38" height="30" fill="#4B5563" stroke="#1F2937" strokeWidth="1" />
                {/* LED — cyan when charging, teal when discharging, dim otherwise */}
                <circle cx="441" cy="317" r="2.5"
                  fill={flowKeys.includes('inverterToBattery') ? '#22D3EE'
                        : flowKeys.includes('batteryToInverter') ? '#10B981'
                        : '#374151'}>
                  {(flowKeys.includes('inverterToBattery') || flowKeys.includes('batteryToInverter')) && (
                    <animate attributeName="opacity" values="0.4;1;0.4" dur="1.4s" repeatCount="indefinite" />
                  )}
                </circle>
                <text x="441" y="397" textAnchor="middle" fontSize="6.5" fill="#F3F4F6" fontFamily="sans-serif" fontWeight="700">BATTERY</text>
              </g>
            )}

            {/* EV charger + car (only when hasEv) */}
            {hasEv && (
              <g>
                {/* Charger pedestal */}
                <rect x="536" y="320" width="18" height="90" rx="3" fill="#1F2937" stroke="#0F172A" strokeWidth="1.2" />
                <rect x="538" y="326" width="14" height="14" rx="1.5" fill="#D9531E" />
                <circle cx="545" cy="333" r="2" fill="#FDE68A">
                  {flowKeys.includes('inverterToEv') && (
                    <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" repeatCount="indefinite" />
                  )}
                </circle>
                {/* Cable curving down to car */}
                <path
                  d="M 545 340 Q 550 380 590 388"
                  stroke="#111827" strokeWidth="2" fill="none" strokeLinecap="round"
                />
                {/* Car silhouette */}
                <path
                  d="M 570 405 L 580 385 L 615 380 L 640 370 L 680 372 L 700 385 L 705 405 Z"
                  fill={mode === 'night' ? '#334155' : '#475569'}
                  stroke="#1F2937"
                  strokeWidth="1.2"
                />
                {/* Windows */}
                <path
                  d="M 590 385 L 613 384 L 638 375 L 668 376 L 692 386 L 688 392 L 594 392 Z"
                  fill={mode === 'night' ? '#FDE68A' : '#93C5FD'}
                  opacity="0.7"
                />
                {/* Wheels */}
                <circle cx="595" cy="408" r="7" fill="#0F172A" />
                <circle cx="595" cy="408" r="3" fill="#475569" />
                <circle cx="680" cy="408" r="7" fill="#0F172A" />
                <circle cx="680" cy="408" r="3" fill="#475569" />
                {/* Headlights at night */}
                {mode === 'night' && (
                  <>
                    <circle cx="706" cy="390" r="3" fill="#FEF3C7" opacity="0.9" />
                    <circle cx="706" cy="390" r="8" fill="#FEF3C7" opacity="0.25" />
                  </>
                )}
              </g>
            )}

            {/* Flow lines — curved Bézier paths with marching-ants pulse */}
            {flowKeys.map((key, i) => {
              const f = FLOW_DEFS[key];
              if (!f) return null;
              const [x1, y1] = f.from;
              const [cx, cy] = f.ctl;
              const [x2, y2] = f.to;
              const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
              return (
                <g key={key}>
                  {/* Faint base path */}
                  <path d={d} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
                  {/* Animated pulse */}
                  <path
                    d={d}
                    fill="none"
                    stroke={f.color}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray="10 14"
                    style={{
                      animation: `flowMarch 1.1s linear ${i * 0.15}s infinite`,
                    }}
                  />
                </g>
              );
            })}

            <style>{`
              @keyframes flowMarch {
                from { stroke-dashoffset: 24; }
                to   { stroke-dashoffset: 0;  }
              }
            `}</style>
          </svg>
        </div>

        {/* Tagline */}
        <div className="mt-3 text-center text-sm md:text-base text-white/85 italic px-4">
          &ldquo;{cfg.tagline}&rdquo;
        </div>

        {/* Legend + controls */}
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-white/85">
            {flowKeys.map((k) => {
              const f = FLOW_DEFS[k];
              return (
                <div key={k} className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: f.color }} />
                  <span>{f.label}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEpoch((e) => e + 1)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs md:text-sm font-semibold transition"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Replay
            </button>
            {status === 'complete' ? (
              <button
                type="button"
                onClick={() => (onSeeResults ? onSeeResults() : onClose())}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm md:text-base font-bold transition shadow-lg shadow-emerald-500/40"
                style={{ animation: 'ctaPulse 1.4s ease-in-out infinite' }}
                data-cta="see-results"
              >
                <CheckCircle className="w-4 h-4" /> See my roof analysis &rarr;
              </button>
            ) : status === 'error' ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#D9531E] hover:bg-[#B84418] text-white text-xs md:text-sm font-semibold transition"
              >
                Back to map
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#D9531E] hover:bg-[#B84418] text-white text-xs md:text-sm font-semibold transition"
              >
                {status === 'analysing' ? 'Skip' : 'Got it'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Drawer({ open, onClose, title, subtitle, children, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — clickable to close. Opacity transitions in on open. */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer panel — slides in from right */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full bg-[#FBF7F0] border-l border-[#E3D9C4] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: wide ? 'min(720px, 92vw)' : 'min(520px, 92vw)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <header className="flex-shrink-0 flex items-start justify-between px-6 py-4 border-b border-[#E3D9C4] bg-[#FBF7F0] sticky top-0">
          <div>
            <div id="drawer-title" className="font-serif text-xl text-[#1A1614] tracking-tight">{title}</div>
            {subtitle && <div className="text-xs text-[#8B8377] mt-0.5">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mt-1 -mr-1 rounded-full hover:bg-[#F4EEE1] text-[#55504A] transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {children}
        </div>
      </aside>
    </>
  );
}

// Floating action button — icon + label pill. Sits on top of the 3D.
// `active` bumps the border colour so the user knows which drawer is
// currently open. `primary` styles the Book button in orange so it
// visually dominates the rail — that's the desired next action.
function FabButton({ icon: Icon, label, onClick, active, primary }) {
  const base = 'group flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full shadow-lg backdrop-blur-sm border font-semibold text-sm transition text-left';
  const style = primary
    ? 'bg-[#D9531E] text-white border-[#B84418] hover:bg-[#B84418] shadow-orange-500/30'
    : active
    ? 'bg-white text-[#1A1614] border-[#D9531E] ring-2 ring-[#D9531E]/20'
    : 'bg-white/95 text-[#1A1614] border-[#E3D9C4] hover:bg-white hover:border-[#D9531E]/40';
  return (
    <button type="button" onClick={onClick} className={`${base} ${style}`}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}

// Persistent horizontal strip beneath the 3D view. One glance answers
// "how good is my roof / how many planes / when do I break even / how
// much do I save / can I book yet?". Each chip is quiet but scannable.
// The Planes chip is CLICKABLE — opens the plane-picker drawer without
// hunting through the FAB rail. Same for Book: primary orange, right-
// anchored so it's always where the eye lands last.
function StatusStrip({ design, roof, excluded, segments, recommendedTier, onOpenQuality, onOpenNumbers, onOpenPlanes, onOpenSavings, onOpenImpact, onOpenDetails, onOpenBook, bookCtaLabel = 'Book site visit' }) {
  const fin = design?.financials?.expected;
  const payback = Number.isFinite(fin?.payback_yrs) ? fin.payback_yrs.toFixed(1) : null;
  const cum25 = Number.isFinite(fin?.cum_25yr_savings) ? Math.round(fin.cum_25yr_savings) : null;

  // Score calc — same formula as SolarQualityScoreCard so the number
  // matches. Silently omits if data isn't there.
  const sysYield = roof?.system_yield;
  const yieldK = sysYield?.kwh_per_kwp_per_year;
  const panelW = recommendedTier?.panel?.watts;
  let score = null;
  if (Number.isFinite(yieldK) && Number.isFinite(panelW)) {
    const perPanel = yieldK * (panelW / 1000);
    score = Math.max(0, Math.min(100, Math.round(((perPanel - 300) / (900 - 300)) * 100)));
  }

  const keptCount = (segments?.length || 0) - excluded.size;
  const totalCount = segments?.length || 0;

  // 2026-08-18 — every chip is now clickable. Score/Payback → open the
  // Numbers drawer (SolarQualityScoreCard + HeadlineNumbersCard + F2 hero
  // all live there), Save-25yr → Savings drawer (25-yr chart), Planes →
  // Plane picker. Chevron on every chip signals "there's more if you tap."
  const chipBase = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F4EEE1] hover:bg-[#EBE2CE] transition group cursor-pointer';

  return (
    <div className="flex flex-wrap items-center gap-2 md:gap-3 px-4 py-3 rounded-2xl border border-[#E3D9C4] bg-white shadow-sm">
      {/* Score chip → Quality drawer (its own destination, distinct from
          Payback which routes to Numbers) */}
      {score !== null && (
        <button type="button" onClick={onOpenQuality} className={chipBase}>
          <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Score</div>
          <div className="font-serif font-bold text-lg text-[#1A1614] tabular-nums leading-none">{score}</div>
          <div className="text-[10px] text-[#8B8377]">/100</div>
          <ChevronRight className="w-3 h-3 text-[#8B8377] group-hover:text-[#D9531E] transition" />
        </button>
      )}
      {/* Planes chip → Plane picker */}
      {totalCount > 0 && (
        <button type="button" onClick={onOpenPlanes} className={chipBase}>
          <LayoutGrid className="w-3.5 h-3.5 text-[#8B8377]" />
          <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Planes</div>
          <div className="font-serif font-bold text-sm text-[#1A1614] tabular-nums">
            {keptCount}<span className="text-[#8B8377] font-normal">/{totalCount}</span>
          </div>
          <ChevronRight className="w-3 h-3 text-[#8B8377] group-hover:text-[#D9531E] transition" />
        </button>
      )}
      {/* Payback → Numbers drawer */}
      {payback && (
        <button type="button" onClick={onOpenNumbers} className={chipBase}>
          <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Payback</div>
          <div className="font-serif font-bold text-lg text-[#D9531E] tabular-nums leading-none">{payback}</div>
          <div className="text-[10px] text-[#8B8377]">yr</div>
          <ChevronRight className="w-3 h-3 text-[#8B8377] group-hover:text-[#D9531E] transition" />
        </button>
      )}
      {/* 25-yr savings → Savings drawer */}
      {cum25 && (
        <button type="button" onClick={onOpenSavings} className={chipBase}>
          <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Save 25yr</div>
          <div className="font-serif font-bold text-lg text-[#1A1614] tabular-nums leading-none">
            ${cum25 >= 1000 ? `${(cum25 / 1000).toFixed(0)}k` : cum25.toLocaleString('en-NZ')}
          </div>
          <ChevronRight className="w-3 h-3 text-[#8B8377] group-hover:text-[#D9531E] transition" />
        </button>
      )}
      {/* Impact chip → Impact drawer */}
      {onOpenImpact && (
        <button type="button" onClick={onOpenImpact} className={chipBase}>
          <TreePine className="w-3.5 h-3.5 text-[#5C8B4A]" />
          <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Impact</div>
          <ChevronRight className="w-3 h-3 text-[#8B8377] group-hover:text-[#D9531E] transition" />
        </button>
      )}
      {/* Details chip → Details drawer */}
      {onOpenDetails && (
        <button type="button" onClick={onOpenDetails} className={chipBase}>
          <Cpu className="w-3.5 h-3.5 text-[#8B8377]" />
          <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Details</div>
          <ChevronRight className="w-3 h-3 text-[#8B8377] group-hover:text-[#D9531E] transition" />
        </button>
      )}
      <div className="flex-1" />
      {/* Book CTA — primary, right-anchored. Label overridable via
          bookCtaLabel prop so the merged /get-quote wizard can show
          "Get this quote →" while POC keeps "Book site visit". */}
      <button
        type="button"
        onClick={onOpenBook}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#D9531E] text-white font-semibold text-sm hover:bg-[#B84418] transition shadow-lg shadow-orange-500/25"
      >
        <Calendar className="w-4 h-4" />
        {bookCtaLabel}
      </button>
    </div>
  );
}

// Customise System card (Phase 2, 2026-08-19) — battery slider + EV
// toggle + km/day input. Sliders drive server recompose (debounced in
// QuotePage's useEffect on customBatteryKwh/customEvKmPerDay). Live
// updates: as customer drags, all 3 tier cards + 3D re-render with
// new sizings.
//
// Controlled component:
//   customBatteryKwh: null   → show engine recommendation as slider default
//                     number → show customer's pick
//   customEvKmPerDay: null   → EV toggle ON, km input shows 40 (legacy)
//                     0      → EV toggle OFF
//                     >0     → EV toggle ON with customer's km
// Bounds from server's battery_bounds (min/max/step from live catalogue).
function CustomiseSystemCard({
  batteryBounds,
  recommendedBatteryKwh,
  customBatteryKwh,
  customEvKmPerDay,
  onBatteryChange,
  onEvChange,
  designing,
  onShowEnergyFlow,
}) {
  // Effective values for display (falls back to recommendation defaults)
  const effectiveBattery = Number.isFinite(customBatteryKwh)
    ? customBatteryKwh
    : (Number.isFinite(recommendedBatteryKwh) ? recommendedBatteryKwh : 0);
  const evOn = customEvKmPerDay !== 0;   // null (legacy) OR >0 = ON; 0 = OFF
  const effectiveEvKm = evOn
    ? (Number.isFinite(customEvKmPerDay) && customEvKmPerDay > 0 ? customEvKmPerDay : 40)
    : 0;

  // Battery slider bounds — server sends min 0 but BYD HVM (our
  // primary residential battery) needs MIN 4 modules (11.04 kWh) for
  // the BMS to work. Sliding below that silently snaps up to 11.04 in
  // the composed system → confusing "I set 3 kWh but got 11 kWh". So
  // slider starts at the SMALLEST viable pack size (~11 kWh) with a
  // dedicated "None (Solar only)" option for the zero case (which
  // routes to Tier 1's config).
  const rawMin  = Number(batteryBounds?.min_kwh)  || 0;
  const maxKwh  = Number(batteryBounds?.max_kwh)  || 22.08;
  const stepKwh = Number(batteryBounds?.step_kwh) || 2.76;
  // Real smallest configured battery = 4 modules × 2.76 = 11.04 kWh (BYD HVM BMS floor)
  const minViableKwh = Math.max(rawMin, 4 * stepKwh);
  const minKwh  = minViableKwh;

  const handleBatterySlider = (e) => {
    const v = Number(e.target.value);
    onBatteryChange(v);
  };
  const handleEvToggle = () => {
    // Toggle logic: if currently on (null or >0) → OFF (0); if OFF → ON (default km)
    if (evOn) onEvChange(0);
    else onEvChange(40);
  };
  const handleEvKmInput = (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v >= 0) onEvChange(v > 0 ? v : 0);
  };
  const handleResetToRecommended = () => {
    onBatteryChange(null);
    onEvChange(null);
  };

  const hasCustomised = Number.isFinite(customBatteryKwh) || customEvKmPerDay !== null;

  return (
    <div className="mt-4 rounded-2xl border border-[#E3D9C4] bg-white p-4 md:p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">
            Customise your system
          </div>
          <div className="text-sm text-[#1A1614] mt-0.5">
            Adjust battery + EV to see all 3 tier options restack live.
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {designing && (
            <span className="inline-flex items-center gap-1.5 text-xs text-[#8B8377] font-mono">
              <Loader2 className="w-3 h-3 animate-spin" /> updating&hellip;
            </span>
          )}
          {hasCustomised && !designing && (
            <button
              type="button"
              onClick={handleResetToRecommended}
              className="text-xs text-[#D9531E] hover:underline font-semibold"
            >
              Reset to recommended
            </button>
          )}
          {typeof onShowEnergyFlow === 'function' && (
            <button
              type="button"
              onClick={onShowEnergyFlow}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-[#F4EEE1] hover:bg-[#EBE2CE] text-[#55504A] font-semibold transition"
            >
              <span aria-hidden="true">&#9654;</span> See energy flow
            </button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Battery slider */}
        <div>
          <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
            <label className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono font-semibold">
              Battery size
            </label>
            {/* No-battery checkbox — explicit way to opt out of battery
                without hunting through tier cards. When checked, we
                send batteryKwh=0 which routes to Tier 1's config
                (Solar only). */}
            <label className="inline-flex items-center gap-2 text-xs text-[#55504A] cursor-pointer">
              <input
                type="checkbox"
                checked={customBatteryKwh === 0}
                onChange={(e) => onBatteryChange(e.target.checked ? 0 : (Number.isFinite(recommendedBatteryKwh) ? recommendedBatteryKwh : minKwh))}
                className="w-3.5 h-3.5 accent-[#D9531E] cursor-pointer"
              />
              No battery (Solar only)
            </label>
          </div>
          <div className={`transition-opacity ${customBatteryKwh === 0 ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="flex items-baseline gap-1 mb-2">
              <div className="font-serif font-bold text-2xl text-[#1A1614] tabular-nums leading-none">
                {customBatteryKwh === 0 ? '—' : effectiveBattery.toFixed(1)}
              </div>
              <span className="text-sm text-[#8B8377]">kWh</span>
            </div>
            <input
              type="range"
              min={minKwh}
              max={maxKwh}
              step={stepKwh}
              value={effectiveBattery}
              onChange={handleBatterySlider}
              disabled={customBatteryKwh === 0}
              className="w-full accent-[#D9531E] cursor-pointer disabled:cursor-not-allowed"
              aria-label="Battery size in kWh"
            />
            <div className="flex justify-between mt-1 text-[10px] font-mono text-[#8B8377] tabular-nums">
              <span>{minKwh.toFixed(2)} kWh</span>
              <span>{Number.isFinite(recommendedBatteryKwh) ? `${recommendedBatteryKwh} recommended` : ''}</span>
              <span>{maxKwh.toFixed(2)} kWh</span>
            </div>
          </div>
          <div className="mt-2 text-[10px] font-mono text-[#8B8377]">
            {customBatteryKwh === 0
              ? 'No battery — grid-only backup, sizing = Tier 1 config'
              : `Slider steps by ${stepKwh} kWh (BYD HVM module size); min ${minKwh.toFixed(2)} kWh = 4-module BMS floor`}
          </div>
        </div>

        {/* EV toggle + km/day input — proper toggle switch (small
            pill with sliding thumb) instead of the previous big button.
            Toggle affects tier 2 + tier 3 sizing when ON. */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono font-semibold">
              EV charger
            </label>
            <button
              type="button"
              role="switch"
              aria-checked={evOn}
              onClick={handleEvToggle}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#D9531E] focus:ring-offset-2 focus:ring-offset-white ${
                evOn ? 'bg-[#D9531E]' : 'bg-[#D9CFB8]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 mt-0.5 ${
                  evOn ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="font-serif font-bold text-2xl text-[#1A1614] tabular-nums leading-none">
              {evOn ? `${effectiveEvKm}` : '—'}
            </div>
            <div className="text-sm text-[#8B8377]">km / day</div>
            {evOn && (
              <input
                type="number"
                min="0"
                max="200"
                step="5"
                value={effectiveEvKm}
                onChange={handleEvKmInput}
                className="ml-auto w-20 px-2 py-1 border border-[#E3D9C4] rounded font-mono text-sm tabular-nums text-right focus:outline-none focus:border-[#D9531E]"
                aria-label="EV daily distance in km"
              />
            )}
          </div>
          <div className="mt-2 text-[10px] font-mono text-[#8B8377]">
            {evOn
              ? `~${Math.round(effectiveEvKm * 0.20 * 365).toLocaleString('en-NZ')} kWh/yr added — applies to Tier 2 + Tier 3`
              : 'EV off — Tiers 2 & 3 sized without EV load'}
          </div>
        </div>
      </div>
    </div>
  );
}

// Horizontal strip beneath the 3D showing the top-line roof read + panel
// spec so customer sees WHY the design is what it is without opening a
// drawer. Iteration 6. Compact, four cells: planes / usable area /
// sunshine / per-panel kWh. Hides gracefully when data missing.
function RoofAtAGlanceStrip({ roof, recommendedTier }) {
  if (!roof) return null;
  const planes    = roof?.segments?.length;
  const area      = roof?.max_array_area_m2;
  const sunHours  = roof?.max_sunshine_hours_per_year;
  const panelW    = recommendedTier?.panel?.watts;
  const yieldK    = roof?.system_yield?.kwh_per_kwp_per_year;
  const perPanel  = Number.isFinite(yieldK) && Number.isFinite(panelW)
    ? Math.round(yieldK * (panelW / 1000))
    : null;
  const panelCount = recommendedTier?.panel?.count;
  const totalKwp   = recommendedTier?.panel?.total_kwp;

  const cells = [
    { icon: Home,       label: 'Roof planes',  value: Number.isFinite(planes)   ? planes                                          : null, suffix: '' },
    { icon: LayoutGrid, label: 'Usable area',  value: Number.isFinite(area)     ? Math.round(area)                                : null, suffix: 'm²' },
    { icon: Sun,        label: 'Sunshine',     value: Number.isFinite(sunHours) ? Math.round(sunHours).toLocaleString('en-NZ')    : null, suffix: 'hrs/yr' },
    { icon: Zap,        label: 'Per panel',    value: perPanel != null          ? perPanel                                        : null, suffix: 'kWh/yr' },
    { icon: LayoutGrid, label: 'System',       value: (Number.isFinite(panelCount) && Number.isFinite(totalKwp)) ? `${panelCount} × ${panelW}W`  : null, suffix: `= ${totalKwp} kWp` },
  ].filter(c => c.value !== null);

  if (cells.length === 0) return null;

  return (
    <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 px-4 py-3 rounded-xl border border-[#E3D9C4] bg-[#FBF7F0]">
      {cells.map(({ icon: Icon, label, value, suffix }, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <Icon className="w-4 h-4 text-[#D9531E] flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono truncate">{label}</div>
            <div className="text-sm font-semibold text-[#1A1614] tabular-nums truncate">
              {value}{suffix ? <span className="ml-1 text-xs text-[#8B8377] font-normal">{suffix}</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Exported 2026-08-20 (Phase B1 ticket B1.5 full-parity rewrite). The merged
// /get-quote residential wizard renders this stage inside its Step4System with
// state hooks (excludedSegments, sliders, roof-fit) lifted up. Two new opt-in
// props (`onBookOverride`, `onTierChosenOverride`) let the wizard intercept
// the "Book site visit" flow and route it to its own Step 5 contact form
// instead of POC's inline lead drawer.
export function QuoteStage({ analysis, design, material, bill, excludedSegments, onToggleSegment, designing, onBack, onReset, onRoofPlacementChange, customBatteryKwh, customEvKmPerDay, setCustomBatteryKwh, setCustomEvKmPerDay, onBookOverride, bookCtaLabel, stickyCommitBar = false }) {
  const { aerial, coords, roof, formattedAddress } = analysis;
  const { tiers, recommended_index, derived_annual_kwh, bill_analysis, region,
          fallback_used, fallback_reason, warnings } = design;

  // 2026-08-18 — customer's per-plane picks from AddressStage flow through.
  // Filter both the segments array (LiDAR path uses this for panel-grid
  // synthesis) AND Google Solar's solar_panels[] (Google path — each panel
  // carries the segmentIndex it belongs to). Empty excluded set → all
  // segments/panels pass through unchanged.
  const excluded = excludedSegments || new Set();
  const allSegments = roof.segments || [];
  const filteredSegments = excluded.size > 0
    ? allSegments.filter((_, i) => !excluded.has(i))
    : allSegments;
  const allSolarPanels = roof.solar_panels || [];
  const filteredSolarPanels = excluded.size > 0
    ? allSolarPanels.filter(p => !excluded.has(p?.segmentIndex))
    : allSolarPanels;

  const solarPanels = filteredSolarPanels;
  const panelCfg = roof.panel_config;

  // Immersive layout — which drawer is open (null = none). Single string
  // state so opening one automatically closes any other.
  const [openDrawer, setOpenDrawer] = useState(null);
  const closeDrawer = () => setOpenDrawer(null);

  // Tier comparison 3D (2026-08-19) — customer can click any tier card
  // to preview its panel layout on the 3D. Defaults to the engine's
  // recommendation; reset whenever a new recommendation arrives.
  // Financials in the StatusStrip stay tied to the recommended tier
  // (server only computed those for one tier); this state controls
  // ONLY the 3D visualization + tier-card highlight.
  const [viewingTierIdx, setViewingTierIdx] = useState(recommended_index);
  useEffect(() => { setViewingTierIdx(recommended_index); }, [recommended_index]);

  // Phase 3 · Energy-flow animation (2026-08-19). Auto-plays ONCE on
  // first landing (localStorage flag), replay via button anytime.
  // Adapts to recommended tier's config (shows battery flow only when
  // the customer has a battery; EV flow only when Wattpilot included).
  const [energyFlowOpen, setEnergyFlowOpen] = useState(false);
  useEffect(() => {
    // Auto-play once per browser (guarded by localStorage). Fires ~1s
    // after arriving so the 3D has time to paint first — animation
    // lands after the customer sees their roof, not during load.
    if (typeof window === 'undefined') return undefined;
    if (window.localStorage?.getItem('poc:energyFlowSeen')) return undefined;
    const t = setTimeout(() => {
      setEnergyFlowOpen(true);
      try { window.localStorage.setItem('poc:energyFlowSeen', '1'); } catch { /* private mode */ }
    }, 1200);
    return () => clearTimeout(t);
  }, []);
  const viewingTier = tiers[viewingTierIdx] || tiers[recommended_index];
  const recommended = tiers[recommended_index];
  const isPreviewingNonRecommended = viewingTierIdx !== recommended_index;

  return (
    <div>
      {/* Slim header — the identity + address, nothing else. Keeps the
          eye moving down to the 3D fast. */}
      <div className="mb-4">
        <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">Step 4 &middot; Your quote</div>
        <h2 className="font-serif text-3xl md:text-4xl mt-2 tracking-tight">
          Designed for {formattedAddress?.split(',')[0]}.
        </h2>
        <p className="mt-1 text-sm text-[#55504A]">
          Sized for <strong>{derived_annual_kwh.toLocaleString('en-NZ')} kWh/yr</strong>
          &nbsp;&middot;&nbsp; {recommended?.panel?.count || '—'} panels &middot; {recommended?.panel?.total_kwp || '—'} kWp
        </p>
      </div>

      {/* Manual-flow banner (kept — critical warning about estimation) */}
      {bill?._manual_entry && (
        <div className="mb-4 flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-amber-900">
            <strong>Estimated quote</strong> &mdash; based on typed {bill.kwh_total?.toLocaleString('en-NZ')} kWh/yr.
            Upload a recent bill for exact tariff-based pricing.
          </div>
          <button
            type="button"
            onClick={onReset}
            className="text-xs bg-amber-800 hover:bg-amber-900 text-white font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
          >
            Upload bill
          </button>
        </div>
      )}

      {/* Exclusion banner (kept — confirms selections carried through) */}
      {excluded.size > 0 && (
        <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-green-50 border border-green-300 text-sm">
          <CheckCircle className="w-4 h-4 text-green-700 flex-shrink-0" />
          <div className="flex-1 text-green-900">
            Panels placed on your <strong>{filteredSegments.length}</strong> selected plane{filteredSegments.length === 1 ? '' : 's'}
            &nbsp;&middot;&nbsp; {excluded.size} excluded
          </div>
          <button
            type="button"
            onClick={() => setOpenDrawer('planes')}
            className="text-xs text-green-900 hover:underline font-semibold"
          >
            Edit selection
          </button>
        </div>
      )}

      {/* Roof-cap + 10-kW-cap warnings MOVED near tier cards (below) on
          2026-08-20 per customer feedback. Rationale: the disclaimer is
          most relevant WHERE the customer sees the sized system — i.e.
          next to the 3 tier cards — not at the top before they've even
          scanned the numbers. See tier grid section for the new location. */}

      {/* Persistent status strip — TOP of page. Every chip clickable:
          Score → Quality (its own drawer), Payback → Numbers,
          Save-25yr → Savings, Planes → picker, Book → survey form.
          Score and Payback used to route to the same drawer — now
          each has its own destination. */}
      <StatusStrip
        design={design}
        roof={roof}
        excluded={excluded}
        segments={allSegments}
        recommendedTier={recommended}
        onOpenQuality={() => setOpenDrawer('quality')}
        onOpenNumbers={() => setOpenDrawer('numbers')}
        onOpenPlanes={() => setOpenDrawer('planes')}
        onOpenSavings={() => setOpenDrawer('savings')}
        onOpenImpact={() => setOpenDrawer('impact')}
        onOpenDetails={() => setOpenDrawer('details')}
        onOpenBook={() => (typeof onBookOverride === 'function' ? onBookOverride({ tier: viewingTier, recommendedTier: recommended }) : setOpenDrawer('book'))}
        bookCtaLabel={bookCtaLabel}
      />

      {/* Tier-preview badge — appears when user is comparing a
          non-recommended tier via a tier-card click. Provides a
          persistent reminder that the 3D shows Tier X while the
          numbers in the StatusStrip stay tied to the recommendation.
          "Reset to recommended" button flips back with one click. */}
      {isPreviewingNonRecommended && (
        <div className="mt-4 flex items-start gap-3 px-4 py-2.5 rounded-xl bg-[#D9531E]/[0.08] border border-[#D9531E]/25 text-sm">
          <Award className="w-4 h-4 text-[#D9531E] flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-[#1A1614]">
            Previewing <strong>{viewingTier?.name || `Tier ${viewingTierIdx + 1}`}</strong> on the 3D
            <span className="text-[#8B8377]"> &middot; recommended is {recommended?.name || `Tier ${recommended_index + 1}`}. Numbers below still reflect the recommendation.</span>
          </div>
          <button
            type="button"
            onClick={() => setViewingTierIdx(recommended_index)}
            className="text-xs text-[#D9531E] hover:text-[#B84418] font-semibold whitespace-nowrap self-center"
          >
            Reset to recommended
          </button>
        </div>
      )}

      {/* ── Immersive 3D hero — 3D FIRST so the visual wow lands
          before the customer's eye jumps to numbers or tiers. The
          `recommendedTier` prop actually receives the currently
          VIEWED tier (viewingTier) so click-to-compare works. When
          viewingTierIdx === recommended_index (default) they're the
          same object; only differs when user's actively comparing. */}
      <div className={isPreviewingNonRecommended ? 'mt-3' : 'mt-4'}>
        <Cesium3DPanelHero
          coords={roof.authoritative_center || roof.google_center || coords}
          segments={filteredSegments}
          solarPanels={filteredSolarPanels}
          building={roof.building}
          panelTargetCount={viewingTier?.panel?.count || 0}
          recommendedTier={viewingTier}
          onPlacementChange={onRoofPlacementChange}
          /* Tier UX Fix D (2026-08-20): 3D scene reflects the selected tier.
             Solar-only tier hides ground hardware; Solar+Battery shows the
             battery box; Solar+Battery+EV additionally shows the EV pedestal
             and car. Reads viewingTier so it updates immediately on tier
             click, without waiting for a compose round-trip. */
          showBattery={!!(viewingTier?.battery && (viewingTier.battery.usable_kwh > 0 || viewingTier.battery.count > 0))}
          showEv={!!viewingTier?.wattpilot_included}
        />
      </div>

      {/* Roof-at-a-glance strip — visible summary of the roof analysis +
          panel spec so customer doesn't have to open a drawer to see the
          numbers we ran on. Iteration 6 (2026-08-18): was previously
          only in the Quality drawer. */}
      <RoofAtAGlanceStrip roof={roof} recommendedTier={recommended} />

      {/* Customise System (Phase 2, 2026-08-19) — customer drags battery
          slider + toggles EV to see all 3 tiers restack live. Server
          re-runs sizing math with new loads and re-renders 3D. */}
      <CustomiseSystemCard
        batteryBounds={design.battery_bounds}
        recommendedBatteryKwh={design.bill_analysis?.recommended_battery_kwh}
        customBatteryKwh={customBatteryKwh}
        customEvKmPerDay={customEvKmPerDay}
        onBatteryChange={setCustomBatteryKwh}
        onEvChange={setCustomEvKmPerDay}
        designing={designing}
        onShowEnergyFlow={() => setEnergyFlowOpen(true)}
      />

      {/* 3-tier recommendation row — MOVED to below 3D (iteration 6).
          Customer sees the 3D visual first, then the tier options to
          achieve it. Tier cards are CLICKABLE (iteration 8) — click
          to preview that tier's panel layout on the 3D above.
          Recommended tier gets the orange badge; currently-viewing
          tier gets an amber ring border. */}

      {/* Engineering disclaimer — MOVED here 2026-08-20 from top of page
          per customer feedback. Rationale: warnings are most relevant next
          to the sized-system cards, not above the 3D. Two variants (roof-
          capped, 10-kW-cap) plus a supplemental line noting engineering
          assessment can unlock a larger system in some cases. */}
      {design?.bill_analysis?._sizing_diagnostics?.any_roof_capped && (
        <div className="mt-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border-2 border-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-amber-900">
            <strong>Roof size is the limit.</strong>
            &nbsp;Your usage suggests we could fit <strong>{design.bill_analysis._sizing_diagnostics.raw_kw_tier3?.toFixed(1)} kWp</strong> of panels but your roof physically only holds around <strong>{design.bill_analysis._sizing_diagnostics.roof_max_panels || '—'} panels</strong> across the viable planes. All 3 tiers are capped to this maximum, which is why they may show similar panel counts.
            <div className="mt-1.5 text-[13px] text-amber-800/90 italic">
              This is an automated recommendation based on the current 3D design. A site-survey engineering assessment can sometimes unlock more panels (using non-standard mounting, ground arrays, or additional roof faces we couldn&apos;t see from satellite).
            </div>
          </div>
        </div>
      )}
      {design?.bill_analysis?._sizing_diagnostics?.any_cap_exceeded && !design?.bill_analysis?._sizing_diagnostics?.any_roof_capped && (
        <div className="mt-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border-2 border-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-amber-900">
            <strong>Your usage exceeds standard residential (10 kW).</strong>
            &nbsp;All tiers capped at 10 kW. A larger commercial-grade system may need 3-phase supply confirmation.
            <div className="mt-1.5 text-[13px] text-amber-800/90 italic">
              An engineering assessment can confirm your supply and unlock a larger system if compatible.
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid md:grid-cols-3 gap-4">
        {tiers.map((t, i) => (
          <TierCard
            key={i}
            tier={t}
            isRecommended={i === recommended_index}
            isViewing={i === viewingTierIdx}
            onClick={() => setViewingTierIdx(i)}
            recommendedPanelCount={tiers[recommended_index]?.panel?.count}
          />
        ))}
      </div>

      {/* F2 BillShrinkHero — full-width year-1 money moment. Was cramped
          at 520px in a drawer; here it has room. Iteration 6: taller
          bars, springier animation, "SAVED" badge, glow, NZ comparison
          chips. */}
      <div className="mt-6">
        <BillShrinkHero design={design} />
      </div>

      {/* Interactive year-1→25 journey explorer. Complement to F2:
          F2 answers "year 1 savings" viscerally; this answers "and over
          the long haul?" interactively. Customer drags year slider,
          watches cumulative savings + payback marker respond. */}
      <div className="mt-6">
        <SavingsJourneyExplorer design={design} />
      </div>

      {/* Building / shift / fallback banners — moved BELOW status strip,
          collapsed into a slim advisory row so they don't fight the 3D. */}
      {(!roof.building || roof.google_vs_building_shift_m > 30 || fallback_used) && (
        <div className="mt-3 space-y-2">
          {!roof.building && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div>We couldn&apos;t find your building in OSM or LINZ &mdash; panels are approximate, centred on the Google pin. Site survey will confirm.</div>
            </div>
          )}
          {roof.google_vs_building_shift_m > 30 && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div>Google Solar analysed a building <strong>{roof.google_vs_building_shift_m}m</strong> from your polygon &mdash; panel positions may drift.</div>
            </div>
          )}
          {fallback_used && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div><strong>Engine used fallback SKUs.</strong> Reason: {fallback_reason}. Rep will confirm on site visit.</div>
            </div>
          )}
        </div>
      )}

      {/* Actions — back + start again at bottom. Book CTA lives in the
          StatusStrip so it's always visible with the summary. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button onClick={onReset} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm">
          <RefreshCw className="w-4 h-4" /> Start again
        </button>
      </div>

      {/* ── Drawers — content stays mounted (via CSS translate) so heavy
          components don't re-mount and re-tween on every open. Each
          drawer scrolls internally.
          Iteration 5 (2026-08-18): Tiers drawer removed (cards live on
          main page). F2 + Quality Score moved OUT of Numbers drawer —
          F2 to main page (full width), Score to its own Quality drawer.
          Numbers drawer is now scoped to just the headline payback
          card — Score chip and Payback chip route to distinct places. */}
      <Drawer open={openDrawer === 'numbers'} onClose={closeDrawer} title="Your numbers" subtitle="Payback + before/after bill">
        <HeadlineNumbersCard design={design} bill={bill} />
      </Drawer>

      <Drawer open={openDrawer === 'quality'} onClose={closeDrawer} title="Roof quality" subtitle="How your roof ranks on the NZ solar spectrum">
        <SolarQualityScoreCard roof={roof} recommendedTier={recommended} />
        {/* Supporting roof stats — same numbers shown on AddressStage
            'Google Solar read' panel, surfaced here so the customer can
            reason about WHY their roof scored what it did. */}
        <div className="rounded-2xl border border-[#E3D9C4] bg-white overflow-hidden">
          <div className="px-4 py-3 bg-[#D9531E]/[0.08] border-b border-[#E3D9C4]">
            <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">Roof read</div>
            <div className="text-sm text-[#1A1614] mt-0.5">What the analyser found on your roof.</div>
          </div>
          <div className="p-4 space-y-3">
            <RoofStat icon={<Home className="w-4 h-4" />} label="Roof planes" value={roof.segments?.length || 0} />
            <RoofStat icon={<LayoutGrid className="w-4 h-4" />} label="Usable roof area" value={roof.max_array_area_m2} suffix="m²" />
            <RoofStat icon={<Sun className="w-4 h-4" />} label="Max sunshine" value={roof.max_sunshine_hours_per_year} suffix="hrs/yr" />
            <RoofStat icon={<Sun className="w-4 h-4" />} label="CO₂ offset factor" value={roof.carbon_offset_factor_kg_per_kwh} suffix="kg/kWh" precision={4} />
            <RoofStat icon={<MapPin className="w-4 h-4" />} label="Imagery quality" value={roof.imagery_quality || (analysis.imagery && analysis.imagery.quality)} />
            <RoofStat icon={<MapPin className="w-4 h-4" />} label="Imagery date" value={roof.imagery_date || (analysis.imagery && analysis.imagery.date)} />
          </div>
        </div>
      </Drawer>

      <Drawer open={openDrawer === 'savings'} onClose={closeDrawer} title="Savings deep dive" subtitle="Seasonal shape, 25-yr trajectory, 3 scenarios" wide>
        <SeasonalGenerationChart design={design} />
        <TwentyFiveYearSavingsChart design={design} />
        <ThreeScenarioTable design={design} />
      </Drawer>

      <Drawer open={openDrawer === 'impact'} onClose={closeDrawer} title="Environmental impact" subtitle="What your system offsets each year">
        <EnvironmentalImpactSection design={design} />
      </Drawer>

      <Drawer open={openDrawer === 'book'} onClose={closeDrawer} title="Book your site visit" subtitle="Free · installer confirms design + firm price" wide>
        <BookSiteSurveyCTA bill={bill} analysis={analysis} design={design} />
      </Drawer>

      <Drawer open={openDrawer === 'planes'} onClose={closeDrawer} title="Which roof planes?" subtitle="Uncheck any plane — 3D and financials update">
        <PlanePickerCard
          segments={allSegments}
          excludedSegments={excluded}
          onToggleSegment={onToggleSegment}
          designing={designing}
        />
      </Drawer>

      <Drawer open={openDrawer === 'details'} onClose={closeDrawer} title="Under the hood" subtitle="Panel sizing rationale + roof analysis" wide>
        <WhyThisManyPanelsPanel bill={bill} design={design} recommendedTier={recommended} />
        <RoofAnalysisPanel analysis={analysis} recommendedTier={recommended} />
        <details className="border border-[#E3D9C4] rounded-xl overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 bg-[#F4EEE1] text-sm font-semibold">
            Engine diagnostics ({warnings.length} warnings &middot; region {region} &middot; material {material})
          </summary>
          <div className="p-4 text-xs font-mono space-y-2 bg-[#FBF7F0]">
            <div>Derived annual usage: <strong>{derived_annual_kwh.toLocaleString('en-NZ')} kWh</strong></div>
            <div>Engine recommended system size: <strong>{bill_analysis.recommended_system_kw} kWp</strong></div>
            <div>Engine recommended battery: <strong>{bill_analysis.recommended_battery_kwh} kWh</strong></div>
            <div>Google Solar reported {solarPanels.length} possible panel positions in {panelCfg ? `${panelCfg.capacity_w}W (${panelCfg.width_m}×${panelCfg.height_m}m)` : 'default'} panels</div>
            {warnings.length > 0 && (
              <ul className="pl-4 list-disc space-y-1">
                {warnings.map((w, i) => (
                  <li key={i}>[{w.code}] {w.message}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </Drawer>

      {/* Energy-flow animation overlay (Phase 3, 2026-08-19) — auto-plays
          once via localStorage on first landing; user can replay from the
          Customise panel's button or via the "See energy flow" trigger. */}
      <EnergyFlowOverlay
        open={energyFlowOpen}
        onClose={() => setEnergyFlowOpen(false)}
        hasBattery={!!recommended?.battery?.usable_kwh}
        hasEv={!!recommended?.wattpilot_included}
      />

      {/* Sticky commit bar (2026-08-21, Phase B4 followup). Only shown when
          the caller opts in (merged /get-quote wizard, not POC standalone
          where the top-right chip button + Book drawer still owns the flow).
          Solves discoverability: Step 4 is a long-scroll page and the
          top-right "Get this quote" button was easy to miss. This is a
          checkout-style summary + primary CTA pinned to the viewport bottom
          so the customer always sees WHAT they've picked + HOW to commit.
          Spacer above (h-24) prevents content from being hidden by the bar. */}
      {stickyCommitBar && (
        <>
          <div className="h-24" aria-hidden="true" />
          <div className="fixed left-0 right-0 bottom-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E3D9C4] shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-[#8B8377] font-mono">Your choice</div>
                <div className="mt-0.5 flex items-baseline flex-wrap gap-x-3 gap-y-0.5">
                  <div className="font-serif text-base sm:text-lg font-bold text-[#1A1614] truncate">
                    {viewingTier?.label || viewingTier?.name || `Tier ${viewingTierIdx + 1}`}
                    {viewingTierIdx === recommended_index && (
                      <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-[#D9531E] font-bold">Recommended</span>
                    )}
                  </div>
                  <div className="text-xs text-[#55504A]">
                    {viewingTier?.panel?.count || '—'} panels
                    {viewingTier?.system_size_kwp ? ` · ${viewingTier.system_size_kwp} kWp` : ''}
                    {viewingTier?.battery?.usable_kwh > 0 ? ` · ${viewingTier.battery.usable_kwh} kWh battery` : ''}
                    {viewingTier?.wattpilot_included ? ' · EV charger' : ''}
                  </div>
                </div>
                {viewingTier?.pricing?.total_incl_gst && (
                  <div className="mt-0.5 text-sm font-bold text-[#1A1614]">
                    ${Math.round(viewingTier.pricing.total_incl_gst).toLocaleString('en-NZ')}
                    <span className="ml-1.5 text-[10px] font-normal text-[#8B8377]">incl. GST · installed</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => (typeof onBookOverride === 'function' ? onBookOverride({ tier: viewingTier, recommendedTier: recommended }) : setOpenDrawer('book'))}
                className="flex-shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white font-bold text-sm hover:bg-[#B84418] transition shadow-lg shadow-orange-500/25"
              >
                {bookCtaLabel || 'Book site visit'} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Aerial hero with the customer's building outline (from OSM/LINZ) + Google's
// suggested-panel positions drawn on top.
// Math: Static Maps at (centerLat, centerLng, zoom) has known m/px. Each
// lat/lng point (polygon vertex OR panel centre) converts to a metres-offset
// from image centre, then to a pixel position for SVG placement.
// Even-odd raycast: is (lng, lat) inside the given [[lng, lat], ...] ring?
function pointInRing(lng, lat, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Idealized panel-grid layout (Plan D) ──────────────────────────────────
// Computes a clean rectangular panel array on a roof segment for MARKETING
// visualization. Ignores Google's individual panel positions (which are
// engineering-realistic but visually irregular) and instead lays out panels
// in a perfect grid aligned to the segment's azimuth.
//
// This matches how Palmetto / Solar Scout / Tesla show panels to customers:
// idealized layout for the preliminary quote; rep confirms the real design
// at site survey (banner already present in the UI).
//
// Approach:
//   - Take segment.center (lat, lng), azimuth (compass bearing of down-slope),
//     and area (m²) as inputs
//   - Determine cols/rows to fit up to `targetCount` panels, packed at 80%
//     efficiency to account for edge setbacks + real-world obstructions
//   - Position each panel's centre on a rotated (u, v) grid where:
//       u axis  = along the ridge (perpendicular to down-slope)
//       v axis  = down-slope direction (rows stack from top to bottom of roof)
//   - Convert (u, v) offsets back to lat/lng around the segment centre
//   - All panels flagged LANDSCAPE (long side across the ridge) — standard
//     residential install pattern
//
// Panel rectangles are then drawn by PanelOverlayHero with SVG rotation
// equal to the segment's azimuth, so the visual matches the roof plane.
function computeIdealPanelGrid(segment, panelWm, panelHm, targetCount) {
  if (!segment?.center?.latitude) return [];
  const centerLat = segment.center.latitude;
  const centerLng = segment.center.longitude;
  const azimuth   = segment.azimuthDegrees ?? 0;
  const areaM2    = segment.stats?.areaMeters2 || 100;

  const GAP = 0.02;                        // 20mm inter-panel gap
  const longWithGap  = panelWm + GAP;
  const shortWithGap = panelHm + GAP;

  // Max panels that fit on this face — real installs achieve ~70-80% of
  // theoretical due to setbacks + obstructions + service walkways.
  const usableArea = areaM2 * 0.80;
  const maxPanels = Math.max(0, Math.floor(usableArea / (longWithGap * shortWithGap)));
  const count = Math.min(targetCount, maxPanels);
  if (count === 0) return [];

  // Grid shape — prefer wider than tall (roofs are typically wider along
  // the ridge). Aspect ratio 1.6 is arbitrary but looks right.
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.6)));
  const rows = Math.max(1, Math.ceil(count / cols));

  // Local axes in world coordinates.
  // Azimuth = compass bearing of down-slope (0=N, 90=E, 180=S, 270=W).
  // Down-slope world vector = (sin(az), cos(az)) with +x=east, +y=north.
  // u axis (along ridge) = down-slope rotated 90° CCW = (-cos(az), sin(az))
  // v axis (down-slope)  = (sin(az), cos(az))
  const azRad = azimuth * Math.PI / 180;
  const cosA = Math.cos(azRad);
  const sinA = Math.sin(azRad);
  const uAxisX = -cosA, uAxisY =  sinA;
  const vAxisX =  sinA, vAxisY =  cosA;

  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const positions = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (positions.length >= count) break;
      // Centre grid on segment centre. Rows go from top (r=0, up-slope) to
      // bottom (r=rows-1, down-slope), so v decreases as r increases.
      const u = (c - (cols - 1) / 2) * longWithGap;
      const v = ((rows - 1) / 2 - r) * shortWithGap;
      const dxM = u * uAxisX + v * vAxisX;
      const dyM = u * uAxisY + v * vAxisY;
      positions.push({
        center: {
          latitude:  centerLat + dyM / 111320,
          longitude: centerLng + dxM / (111320 * cosLat),
        },
        orientation:      'LANDSCAPE',
        yearlyEnergyDcKwh: 500,   // placeholder — real yield will come from rep-refined design
        _synthetic:       true,
        _sourceSegment:   segment,  // carry the segment so rendering can use its azimuth
      });
      if (positions.length >= count) break;
    }
    if (positions.length >= count) break;
  }
  return positions;
}

// ── Cesium3DPanelHero: wraps Cesium3DView with a caption strip + placement
//    breakdown card that appears once the multi-segment pipeline has run.
// Exported 2026-08-20 for reuse by the merged /get-quote residential wizard
// (Phase B1 ticket B1.5). Cesium 3D hero showing the customer's roof + panels.
export function Cesium3DPanelHero({ coords, segments, solarPanels, panelTargetCount, recommendedTier, building, onPlacementChange, showBattery = false, showEv = false }) {
  const [placement, setPlacement] = useState(null);   // { totalRendered, perSegment, skippedSegments }
  // Fan out placement to both our own state (for the panel-breakdown UI
  // below) AND the parent's callback (used by QuoteStage for two-pass
  // roof-fit sizing). Guards against re-firing when nothing changed —
  // rendered count landing before render triggers a state update, but
  // subsequent same-count updates should not.
  const handlePlacementReady = (p) => {
    setPlacement(p);
    if (typeof onPlacementChange === 'function') onPlacementChange(p);
  };

  return (
    <div>
      <Suspense fallback={<div className="h-[60vh] max-h-[560px] rounded-2xl bg-[#F4EEE1] border border-[#E3D9C4] grid place-items-center text-sm text-[#55504A]"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
        <Cesium3DView
          coords={coords}
          segments={segments}
          solarPanels={solarPanels}
          building={building}
          showPanels={true}
          panelTargetCount={panelTargetCount}
          // Real STC watts of the composer's picked panel (e.g. Phono 595W)
          // so the heatmap's per-panel yield reflects the actual product,
          // not panelGrid's fallback area-based estimate.
          panelWatts={recommendedTier?.panel?.watts || null}
          // Real physical dimensions of the picked panel (mm → m, oriented
          // long/short by magnitude so it doesn't matter which axis the
          // catalogue calls length vs width). Threaded into
          // computePanelGridOnSegment so the 3D box entities render at
          // true panel footprint (e.g. Phono 595W = 1.879×1.045 m instead
          // of the 1.65×0.99 legacy fallback). Null when catalogue row
          // lacks dims — panelGrid falls back to its own defaults.
          panelLongM={
            recommendedTier?.panel?.length_mm && recommendedTier?.panel?.width_mm
              ? Math.max(recommendedTier.panel.length_mm, recommendedTier.panel.width_mm) / 1000
              : null
          }
          panelShortM={
            recommendedTier?.panel?.length_mm && recommendedTier?.panel?.width_mm
              ? Math.min(recommendedTier.panel.length_mm, recommendedTier.panel.width_mm) / 1000
              : null
          }
          maxSegments={3}
          height="60vh"
          onPlacementReady={handlePlacementReady}
          showBattery={showBattery}
          showEv={showEv}
        />
      </Suspense>

      {/* Stale-imagery banner — appears when the Cesium 3D Tiles mesh
          under the panel array looks essentially flat while the roof-
          detection data (Google Solar / LiDAR) says the roof is tilted.
          Signal is a near-zero altitude VARIANCE across the panel grid
          vs. the variance a real pitched roof would produce.
          Panels are still rendered at the sampled mesh position for
          visibility; the banner explains why the aerial may not match. */}
      {placement?.staleMeshDetected && (
        <div className="mt-3 flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">3D aerial may pre-date current construction</div>
            <div className="mt-0.5">Google&apos;s 3D imagery for this address looks flat where our roof-detection data (2024 LiDAR / Google Solar) says a pitched roof exists. Panels are rendered on the visible surface for now — real-world position may differ. Site survey will confirm final placement.</div>
          </div>
        </div>
      )}

      {/* Caption strip below the 3D view — key numbers the customer wants
          to see at a glance. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 rounded-xl bg-[#F4EEE1] border border-[#E3D9C4] text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#8F887E]">System</div>
          <div className="font-serif text-lg text-[#1A1614]">{recommendedTier?.panel?.total_kwp || '—'} kWp</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#8F887E]">Panels rendered</div>
          <div className="font-serif text-lg text-[#1A1614]">
            {placement?.totalRendered ?? '—'}
            {placement && panelTargetCount && placement.totalRendered !== panelTargetCount && (
              <span className="text-xs text-amber-700 ml-1">(target {panelTargetCount})</span>
            )}
          </div>
        </div>
        <div className="flex-1" />
        <div className="text-xs text-[#8F887E] italic">
          Drag to rotate &middot; scroll to zoom &middot; right-drag to tilt
        </div>
      </div>

      {/* Per-segment breakdown — shows customer WHICH roof faces got how
          many panels + why we skipped some. Only appears after the pipeline
          runs (onPlacementReady fired). */}
      {placement?.perSegment?.length > 0 && (
        <div className="mt-3 p-4 rounded-xl bg-white border border-[#E3D9C4]">
          <div className="text-[10px] uppercase tracking-wider text-[#D9531E] font-bold mb-2">
            Panels across {placement.perSegment.length} roof face{placement.perSegment.length > 1 ? 's' : ''}
          </div>
          <div className="space-y-1.5 font-mono text-xs">
            {placement.perSegment.map((s, i) => (
              <div key={i} className="flex items-center gap-3 flex-wrap">
                <span className="inline-block w-8 text-[#D9531E] font-bold">{s.orientation}</span>
                <span className="text-[#1A1614] font-semibold w-16">{s.panels} panels</span>
                <span className="text-[#8F887E]">
                  {s.areaM2?.toFixed(0)} m² &middot; pitch {s.pitchDeg?.toFixed(0)}° &middot; azimuth {s.azimuthDeg?.toFixed(0)}°
                </span>
                {s.needsTiltFrames && (
                  <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-semibold">
                    tilt frames
                  </span>
                )}
              </div>
            ))}
            {placement.skippedSegments > 0 && (
              <div className="mt-2 pt-2 border-t border-[#F4EEE1] text-[#8F887E]">
                <span className="inline-block w-8">—</span>
                <span>
                  {placement.skippedSegments} other roof face{placement.skippedSegments > 1 ? 's were' : ' was'} skipped
                  {' '}(too small, wrong pitch, or south-facing &mdash; poor yield in NZ)
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── WhyThisManyPanelsPanel: derivation showing HOW we arrived at the panel
//    count. Makes the number feel earned, not arbitrary.
// ── Solar-quality score card ─────────────────────────────────────────────
// One-glance answer to "is my roof any good?". Replaces the on-panel
// heatmap tint (which coloured every panel identically on single-face
// roofs, was visually inconsistent with real panels, and got poor UX
// feedback).
//
// Computation is decoupled from Cesium — renders as soon as analyse +
// compose land, doesn't wait for the 3D pipeline. Inputs:
//   - roof.system_yield.kwh_per_kwp_per_year  (per-address yield attached
//                                              by the analyse route; Google
//                                              sunshine for Google-Solar
//                                              path, PVGIS for LiDAR path)
//   - recommendedTier.panel.watts             (STC watts of the composer's
//                                              picked panel model)
//
// Score = per-panel-kWh mapped onto the same NZ 300-900 anchor the
// (removed) 3D heatmap used, then rescaled to 0-100 for readability.
// Silently returns null when we lack real per-address data — better to
// show nothing than a misleading regional-fallback score.
function SolarQualityScoreCard({ roof, recommendedTier }) {
  const panelWatts     = recommendedTier?.panel?.watts;
  const sysYield       = roof?.system_yield;
  const yieldKwhPerKwp = sysYield?.kwh_per_kwp_per_year;

  if (!Number.isFinite(yieldKwhPerKwp) || !Number.isFinite(panelWatts)) {
    return null;
  }

  const perPanelKwh = Math.round(yieldKwhPerKwp * (panelWatts / 1000));
  const SCALE_MIN = 300;   // typical NZ S-facing worst-case per-panel yield
  const SCALE_MAX = 900;   // ideal N-facing modern-panel ceiling
  const rawPct = ((perPanelKwh - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  const score = Math.max(0, Math.min(100, Math.round(rawPct)));
  const markerPct = Math.max(0, Math.min(100, rawPct));

  // Rating bands + tone. Kept in sync with the gradient stops so a
  // "very good" score visually sits in the warm-orange zone of the bar.
  const rating =
      score >= 80 ? { label: 'Excellent',     pill: 'bg-orange-100 text-orange-800' }
    : score >= 60 ? { label: 'Very good',     pill: 'bg-amber-100 text-amber-800'   }
    : score >= 40 ? { label: 'Good',          pill: 'bg-yellow-100 text-yellow-800' }
    :               { label: 'Below average', pill: 'bg-sky-100 text-sky-800'       };

  const sourceLabel =
      sysYield.source === 'google_sunshine_quantiles' ? "Google Solar's per-address sunshine analysis"
    : sysYield.source === 'pvgis'                     ? 'PVGIS satellite irradiance data'
    :                                                    'regional yield average';

  return (
    <div className="rounded-2xl border border-[#E3D9C4] bg-[#F4EEE1] overflow-hidden">
      <div className="px-4 py-3 bg-[#D9531E]/[0.08] border-b border-[#E3D9C4]">
        <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">
          Solar quality score
        </div>
        <div className="text-sm text-[#1A1614] mt-0.5">
          How your roof ranks on the NZ solar spectrum.
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-baseline gap-2">
          <div className="text-5xl font-serif font-bold text-[#1A1614] leading-none">{score}</div>
          <div className="text-xl text-[#8B8377] font-mono">/ 100</div>
          <div className={`ml-auto text-xs px-2.5 py-1 rounded-full font-semibold ${rating.pill}`}>
            {rating.label}
          </div>
        </div>

        {/* Mini gradient bar with black marker at the customer's position.
            overflow-visible so the marker (which extends above the bar)
            isn't clipped. */}
        <div
          className="relative mt-4 h-2 rounded"
          style={{ background: `linear-gradient(to right, ${gradientCssStops()})` }}
        >
          <div
            className="absolute -top-1 w-1 h-4 bg-[#1A1614] rounded-sm shadow"
            style={{ left: `calc(${markerPct.toFixed(1)}% - 2px)` }}
            title={`Your roof: ~${perPanelKwh} kWh/panel/yr`}
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] font-mono text-[#8B8377] uppercase tracking-wide">
          <span>Below avg</span>
          <span>Excellent</span>
        </div>

        <div className="mt-4 text-xs text-[#55504A] leading-relaxed">
          Each panel on your roof will produce approximately{' '}
          <span className="font-semibold text-[#1A1614]">{perPanelKwh} kWh</span>{' '}
          per year.
        </div>
        <div className="mt-1 text-[10px] text-[#8B8377]">
          Based on {sourceLabel}
        </div>
      </div>
    </div>
  );
}

// ── F1 · HeadlineNumbersCard ──────────────────────────────────────────────
// Sidebar companion to SolarQualityScoreCard. Answers the customer's ONE
// financial question in one glance: "when do I break even, and how much
// do I save?". All numbers come from runThreeScenarios in the server
// response (design.financials.expected). Silently omitted when the server
// couldn't compute financials (missing tariff, catalogue mismatch, etc.).
//
// Displays the EXPECTED scenario only — Conservative/Optimistic live in
// the full-width F6 table below. Keeps this card scannable.
function HeadlineNumbersCard({ design, bill }) {
  const fin = design?.financials?.expected;
  if (!fin) return null;

  const isEstimatedTariff = design?.financials?.tariff_source === 'default';
  const isEstimatedUsage  = !!bill?._manual_entry;

  return (
    <div className="rounded-2xl border border-[#E3D9C4] bg-white overflow-hidden shadow-sm">
      <div className="px-4 py-3 bg-[#D9531E]/[0.08] border-b border-[#E3D9C4]">
        <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">
          Your numbers
        </div>
        <div className="text-sm text-[#1A1614] mt-0.5">
          Break-even + lifetime savings on this system.
        </div>
      </div>
      <div className="p-4 space-y-4">
        {/* Payback — the headline metric */}
        {Number.isFinite(fin.payback_yrs) && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#8B8377] font-mono">
              Payback in
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-4xl font-serif font-bold text-[#D9531E] leading-none">
                {fin.payback_yrs.toFixed(1)}
              </div>
              <div className="text-lg text-[#8B8377]">years</div>
            </div>
          </div>
        )}
        {/* 25-year cumulative savings */}
        {Number.isFinite(fin.cum_25yr_savings) && (
          <div className="pt-3 border-t border-[#F4EEE1]">
            <div className="text-[10px] uppercase tracking-wide text-[#8B8377] font-mono">
              Save over 25 years
            </div>
            <div className="text-2xl font-serif font-bold text-[#1A1614] mt-0.5">
              ${Math.round(fin.cum_25yr_savings).toLocaleString('en-NZ')}
            </div>
          </div>
        )}
        {/* Year-1 old-vs-new bill delta */}
        {Number.isFinite(fin.yr1_old_bill) && Number.isFinite(fin.yr1_new_bill) && (
          <div className="pt-3 border-t border-[#F4EEE1] grid grid-cols-2 gap-3 text-xs font-mono">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#8B8377]">Now / yr</div>
              <div className="text-sm text-[#8B8377] line-through mt-0.5">
                ${Math.round(fin.yr1_old_bill).toLocaleString('en-NZ')}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#8B8377]">After solar</div>
              <div className="text-sm text-emerald-700 font-semibold mt-0.5">
                ${Math.round(fin.yr1_new_bill).toLocaleString('en-NZ')}
              </div>
            </div>
          </div>
        )}
        {/* Estimation notes — honest about which inputs were guessed */}
        {(isEstimatedTariff || isEstimatedUsage) && (
          <div className="pt-3 border-t border-[#F4EEE1] text-[10px] text-[#8B8377] leading-snug">
            {isEstimatedUsage && (
              <div>· Based on estimated <strong>{bill.kwh_total?.toLocaleString('en-NZ')} kWh/yr</strong> usage (upload bill for exact).</div>
            )}
            {isEstimatedTariff && !isEstimatedUsage && (
              <div>· Based on typical NZ residential tariff (upload bill for your exact rate).</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── PlanePickerCard · roof-plane include/exclude picker (QuoteStage sidebar) ─
// Sits below HeadlineNumbersCard. Each row is a plane the analyser found;
// customer unchecks to remove panels from that face + recompute yield.
// - Live 3D update (via filteredSegments/filteredSolarPanels in QuoteStage)
// - Auto-recompose design 500ms after last toggle (debounced in QuotePage)
// - "Updating design…" spinner during recompose so the shift in headline
//   numbers doesn't feel jarring.
// Compact by design — sidebar is already dense with score + numbers.
function PlanePickerCard({ segments, excludedSegments, onToggleSegment, designing }) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const excluded = excludedSegments || new Set();
  const keptCount = segments.length - excluded.size;
  const totalArea = segments.reduce((a, s) => a + (Number(s?.stats?.areaMeters2) || 0), 0);
  const keptArea = segments.reduce((a, s, i) => a + (excluded.has(i) ? 0 : Number(s?.stats?.areaMeters2) || 0), 0);
  const allExcluded = keptCount === 0;
  const compass = (az) => {
    if (!Number.isFinite(az)) return '—';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  };

  return (
    <div className="rounded-2xl border border-[#E3D9C4] bg-white overflow-hidden">
      <div className="px-4 py-3 bg-[#D9531E]/[0.08] border-b border-[#E3D9C4] flex items-center gap-2">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">
            Roof planes
          </div>
          <div className="text-sm text-[#1A1614] mt-0.5">
            Uncheck any plane you don&apos;t want panels on.
          </div>
        </div>
        {designing && (
          <div className="text-[10px] text-[#8B8377] flex items-center gap-1.5 font-mono">
            <Loader2 className="w-3 h-3 animate-spin" />
            updating&hellip;
          </div>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        {segments.map((s, i) => {
          const isExcluded = excluded.has(i);
          const az = s.azimuthDegrees;
          const areaM2 = Number(s?.stats?.areaMeters2) || 0;
          const yieldK = Number.isFinite(s._yieldKwhPerKwpPerYear)
            ? Math.round(s._yieldKwhPerKwpPerYear)
            : null;
          return (
            <label
              key={i}
              className={`flex items-center gap-2.5 text-xs px-2 py-2 rounded cursor-pointer transition ${
                isExcluded
                  ? 'bg-[#F4EEE1] opacity-55'
                  : 'bg-[#FBF7F0] hover:bg-[#F4EEE1]'
              }`}
            >
              <input
                type="checkbox"
                checked={!isExcluded}
                onChange={() => onToggleSegment && onToggleSegment(i)}
                className="w-4 h-4 accent-[#D9531E] cursor-pointer flex-shrink-0"
              />
              <span className={`font-mono text-[#8F887E] w-6 flex-shrink-0 ${isExcluded ? 'line-through' : ''}`}>
                #{i + 1}
              </span>
              <span className={`font-semibold text-[#1A1614] w-8 flex-shrink-0 ${isExcluded ? 'line-through' : ''}`}>
                {compass(az)}
              </span>
              <span className={`text-[#55504A] font-mono tabular-nums flex-1 ${isExcluded ? 'line-through' : ''}`}>
                {areaM2 > 0 ? `${areaM2.toFixed(0)} m²` : '—'}
              </span>
              {yieldK != null && (
                <span className={`text-[10px] text-[#8B8377] font-mono tabular-nums flex-shrink-0 ${isExcluded ? 'line-through' : ''}`}>
                  {yieldK}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-[#E3D9C4] bg-[#FBF7F0] text-[11px] text-[#55504A] flex items-center gap-2">
        <LayoutGrid className="w-3.5 h-3.5 text-[#8F887E]" />
        <span>
          <span className="font-semibold text-[#1A1614]">{keptCount}</span>
          <span className="text-[#8B8377]"> of {segments.length} planes kept</span>
          {totalArea > 0 && (
            <span className="text-[#8B8377]"> &middot; {keptArea.toFixed(0)}/{totalArea.toFixed(0)} m²</span>
          )}
        </span>
      </div>
      {allExcluded && (
        <div className="px-4 py-3 border-t border-[#E3D9C4] bg-red-50 text-[11px] text-red-800 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <div>
            Every plane is excluded &mdash; re-check at least one so we have somewhere to put panels.
            The design won&apos;t update until you do.
          </div>
        </div>
      )}
    </div>
  );
}

// ── SavingsJourneyExplorer · interactive year 1→25 slider ─────────────
// Slot below F2 BillShrinkHero. Customer drags a year slider from 1→25;
// the big cumulative-savings number ticks up, an area chart fills in
// left→right, and a "PAID OFF" marker fires when cum_savings crosses
// system cost. Turns the abstract 25-year projection into something the
// customer can PLAY with, which is stickier than a static chart.
// Falls back gracefully if cashflow data isn't available.
function SavingsJourneyExplorer({ design }) {
  const cashflow = design?.financials?.cashflow;
  const systemCost = Number(design?.tiers?.[design?.recommended_index]?.price_inc_gst);

  const data = Array.isArray(cashflow) ? cashflow.slice(0, 25) : [];
  const [year, setYear] = useState(25);

  if (data.length === 0) return null;

  const cumAtYear = (y) => {
    const idx = Math.max(0, Math.min(data.length - 1, y - 1));
    return Number(data[idx]?.cum_savings) || 0;
  };
  const maxCum = Math.max(...data.map(d => Number(d.cum_savings) || 0));
  const currentCum = cumAtYear(year);
  const paybackYear = data.findIndex(d => Number(d.cum_savings) >= (Number.isFinite(systemCost) ? systemCost : Infinity)) + 1;
  const hasPayback = paybackYear > 0;
  const passedPayback = hasPayback && year >= paybackYear;

  // SVG geometry — full width responsive, fixed viewbox.
  const W = 600;
  const H = 120;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 8;
  const PAD_B = 20;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const x = (i) => PAD_L + (i / (data.length - 1)) * chartW;
  const y = (v) => PAD_T + (1 - v / (maxCum || 1)) * chartH;

  // Build the area path — line from y-baseline at year 1 → curve to
  // cum_savings at each year up to the slider's `year` → drop back to
  // baseline at year `year`. This gives the "filling in" effect.
  const shownYears = Math.max(1, year);
  const areaPoints = data.slice(0, shownYears).map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(Number(d.cum_savings) || 0).toFixed(1)}`
  ).join(' ');
  const areaPath = `${areaPoints} L ${x(shownYears - 1).toFixed(1)} ${(H - PAD_B).toFixed(1)} L ${x(0).toFixed(1)} ${(H - PAD_B).toFixed(1)} Z`;

  const money = (v) => `$${Math.round(v).toLocaleString('en-NZ')}`;

  return (
    <div className="rounded-2xl border-2 border-[#E3D9C4] bg-white overflow-hidden shadow-lg">
      <div className="px-6 py-4 border-b border-[#E3D9C4]/60 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#5C8B4A] to-[#3F6B32] flex items-center justify-center flex-shrink-0 shadow-md">
          <TrendingUp className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#5C8B4A] font-bold">
            Your journey
          </div>
          <div className="text-xl md:text-2xl font-serif text-[#1A1614] leading-tight">
            Watch your savings grow &mdash; drag to any year.
          </div>
        </div>
      </div>

      <div className="p-6 md:p-8 grid md:grid-cols-[1.4fr,1fr] gap-6 md:gap-10 items-center">
        {/* Chart + slider */}
        <div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32 md:h-40" preserveAspectRatio="none">
            {/* Faint full-25yr baseline trace (grey) so user sees full potential */}
            <path
              d={data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(Number(d.cum_savings) || 0).toFixed(1)}`).join(' ')}
              fill="none"
              stroke="#D9CFB8"
              strokeWidth="1.5"
              strokeDasharray="2,3"
            />
            {/* Filled area up to current year */}
            <path d={areaPath} fill="url(#journeyFill)" opacity="0.9" />
            {/* Line on top */}
            <path
              d={data.slice(0, shownYears).map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(Number(d.cum_savings) || 0).toFixed(1)}`).join(' ')}
              fill="none"
              stroke="#D9531E"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Endpoint dot at current year */}
            <circle cx={x(shownYears - 1)} cy={y(currentCum)} r="5" fill="#D9531E" stroke="white" strokeWidth="2" />
            {/* Payback marker (if reached at this year) */}
            {hasPayback && (
              <g>
                <line
                  x1={x(paybackYear - 1)}
                  x2={x(paybackYear - 1)}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke={passedPayback ? '#5C8B4A' : '#B0A498'}
                  strokeWidth="1"
                  strokeDasharray="3,3"
                  opacity="0.6"
                />
              </g>
            )}
            {/* X axis labels — every 5 years */}
            {[1, 5, 10, 15, 20, 25].filter(v => v <= data.length).map(v => (
              <text
                key={v}
                x={x(v - 1)}
                y={H - 4}
                fontSize="10"
                fill="#8B8377"
                textAnchor="middle"
                fontFamily="ui-monospace, monospace"
              >
                yr {v}
              </text>
            ))}
            <defs>
              <linearGradient id="journeyFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#D9531E" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#D9531E" stopOpacity="0.05" />
              </linearGradient>
            </defs>
          </svg>

          {/* Year slider */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono font-semibold">
                Drag to explore
              </span>
              <span className="text-xs text-[#55504A] font-mono">
                year 1 &rarr; 25
              </span>
            </div>
            <input
              type="range"
              min="1"
              max={data.length}
              step="1"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full accent-[#D9531E] cursor-pointer"
              aria-label="Select year"
            />
          </div>
        </div>

        {/* Big current-year callout */}
        <div className="md:border-l md:border-[#E3D9C4] md:pl-8 space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono font-semibold">
              After
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <div className="text-5xl font-serif font-bold text-[#1A1614] tabular-nums leading-none">
                {year}
              </div>
              <div className="text-xl text-[#8B8377]">year{year === 1 ? '' : 's'}</div>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono font-semibold">
              You&apos;ll have saved
            </div>
            <div className="relative mt-1">
              <div
                aria-hidden="true"
                className="absolute inset-0 -m-3 rounded-full opacity-60 blur-xl pointer-events-none"
                style={{ background: 'radial-gradient(circle, rgba(217,83,30,0.5) 0%, rgba(217,83,30,0) 70%)' }}
              />
              <div className="relative text-4xl md:text-5xl font-serif font-bold text-[#D9531E] tabular-nums leading-none transition-all">
                {money(currentCum)}
              </div>
            </div>
          </div>

          {hasPayback && (
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              passedPayback
                ? 'bg-[#5C8B4A] text-white shadow'
                : 'bg-[#F4EEE1] text-[#55504A]'
            }`}>
              <CheckCircle className="w-3.5 h-3.5" />
              {passedPayback
                ? `Panels paid off in year ${paybackYear}`
                : `Panels pay off in year ${paybackYear}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── F3 · TwentyFiveYearSavingsChart ───────────────────────────────────────
// Full-width SVG line chart showing cumulative savings over 25 years, with
// a marker at the payback crossover (year where cumulative savings first
// meet the system cost). Uses the expected-scenario cashflow from
// runThreeScenarios — same data the PDF proposal generator's cashFlow
// page uses, just rendered inline for the POC.
//
// No chart library — SVG hand-drawn to keep bundle small and styling
// under our full control (matches the cream/orange palette).
function TwentyFiveYearSavingsChart({ design }) {
  const cashflow = design?.financials?.cashflow;
  const systemCost = Number(design?.tiers?.[design?.recommended_index]?.price_inc_gst);
  if (!Array.isArray(cashflow) || cashflow.length === 0) return null;

  const data = cashflow.slice(0, 25);
  const maxCum = Math.max(...data.map(d => Number(d.cum_savings) || 0), Number.isFinite(systemCost) ? systemCost : 0);
  if (maxCum <= 0) return null;

  const W = 800, H = 260, PAD_L = 70, PAD_R = 30, PAD_T = 20, PAD_B = 40;
  const x = (i) => PAD_L + (i / (data.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v) => PAD_T + (1 - v / maxCum) * (H - PAD_T - PAD_B);

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(Number(d.cum_savings) || 0).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${x(data.length - 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;

  // Payback crossover — first year cum_savings crosses system cost.
  const paybackIdx = Number.isFinite(systemCost)
    ? data.findIndex(d => Number(d.cum_savings) >= systemCost)
    : -1;

  return (
    <div className="rounded-2xl border border-[#E3D9C4] bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E3D9C4] bg-[#FBF7F0]">
        <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">25-year savings trajectory</div>
        <div className="text-sm text-[#1A1614] mt-0.5">Cumulative savings vs staying on the grid.</div>
      </div>
      <div className="p-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="savingsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#D9531E" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#D9531E" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Grid + Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map(t => {
            const yPos = PAD_T + (1 - t) * (H - PAD_T - PAD_B);
            const val = t * maxCum;
            return (
              <g key={t}>
                <line x1={PAD_L} y1={yPos} x2={W - PAD_R} y2={yPos} stroke="#E3D9C4" strokeDasharray="2 4" />
                <text x={PAD_L - 8} y={yPos + 3} fontSize="10" fill="#8B8377" textAnchor="end" fontFamily="ui-monospace, SFMono-Regular, monospace">
                  ${Math.round(val / 1000)}k
                </text>
              </g>
            );
          })}
          {/* System cost horizontal line (payback threshold) */}
          {Number.isFinite(systemCost) && systemCost > 0 && systemCost <= maxCum && (
            <g>
              <line x1={PAD_L} y1={y(systemCost)} x2={W - PAD_R} y2={y(systemCost)} stroke="#1A1614" strokeDasharray="4 3" opacity="0.35" />
              <text x={W - PAD_R + 4} y={y(systemCost) + 3} fontSize="9" fill="#55504A" fontFamily="ui-monospace, SFMono-Regular, monospace">
                system cost
              </text>
            </g>
          )}
          {/* X-axis labels */}
          {[0, 4, 9, 14, 19, 24].map(i => (
            <text key={i} x={x(i)} y={H - 15} fontSize="10" fill="#8B8377" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, monospace">
              Yr {i + 1}
            </text>
          ))}
          {/* Area + line */}
          <path d={areaPath} fill="url(#savingsGradient)" />
          <path d={linePath} fill="none" stroke="#D9531E" strokeWidth="2.5" />
          {/* Payback crossover marker */}
          {paybackIdx >= 0 && (
            <g>
              <line
                x1={x(paybackIdx)} y1={PAD_T}
                x2={x(paybackIdx)} y2={H - PAD_B}
                stroke="#1A1614" strokeDasharray="4 3" opacity="0.4"
              />
              <circle cx={x(paybackIdx)} cy={y(Number(data[paybackIdx].cum_savings))} r="5" fill="#1A1614" />
              <rect
                x={Math.min(x(paybackIdx) + 8, W - 110)} y={y(Number(data[paybackIdx].cum_savings)) - 22}
                width="100" height="18" rx="3" fill="#1A1614"
              />
              <text
                x={Math.min(x(paybackIdx) + 12, W - 106)}
                y={y(Number(data[paybackIdx].cum_savings)) - 9}
                fontSize="10" fill="#FFFFFF" fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                Payback · yr {paybackIdx + 1}
              </text>
            </g>
          )}
          {/* Endpoint label */}
          <text x={x(data.length - 1) - 6} y={y(Number(data[data.length - 1].cum_savings)) - 10}
            fontSize="12" fill="#D9531E" fontWeight="700" textAnchor="end" fontFamily="ui-monospace, SFMono-Regular, monospace"
          >
            ${Math.round(Number(data[data.length - 1].cum_savings) / 1000)}k
          </text>
        </svg>
      </div>
    </div>
  );
}

// ── V3 · SeasonalGenerationChart ──────────────────────────────────────────
// Monthly kWh bar chart Jan→Dec. Answers "will solar work in winter?" —
// the NZ climate has a real winter dip (June generates ~3× less than
// January in the southern hemisphere) but is never zero, so the visual
// story is: "winter is lower but not off; summer is when you make the
// most of it".
//
// Data source: server picks PER-ADDRESS PVGIS monthly (LiDAR path) or
// Auckland MONTHLY_YIELD_PCT × yr1 generation (Google Solar fallback).
// ── F2 · BillShrinkHero ────────────────────────────────────────────────
// The money moment. Two vertical bars — left is the customer's CURRENT
// annual power bill (from the parsed bill or estimated tariff), right
// starts at the same height and animates DOWN to the after-solar bill
// over ~1.5s the first time it scrolls into view. Dollar amount inside
// each bar eases from old → new in sync with the bar's shrink.
//
// Re-animates when `design` changes (e.g. customer toggles a roof plane
// on PlanePickerCard, financials recompute) — the effect deps hook on
// oldBill/newBill/savingsYr, so any shift re-tweens.
//
// IntersectionObserver-gated: no CPU spent on the RAF loop until the
// user actually scrolls the card into view. That way the WOW lands when
// they're looking, not while the page is still initialising off-screen.
//
// Silently omits if the server couldn't compute financials (same guard
// pattern as F1/F3/F6 → tariff missing, catalogue mismatch, etc.).
function BillShrinkHero({ design }) {
  const fin = design?.financials?.expected;
  const oldBill    = Number(fin?.yr1_old_bill);
  const newBill    = Number(fin?.yr1_new_bill);
  const cum25      = Number(fin?.cum_25yr_savings);
  const savingsYr  = Number.isFinite(oldBill) && Number.isFinite(newBill)
    ? Math.max(0, oldBill - newBill)
    : NaN;

  const ref = useRef(null);
  const rafRef = useRef(null);
  const [inView, setInView] = useState(false);
  const [display, setDisplay] = useState({ old: 0, neu: 0, sav: 0 });

  // Trigger the animation only when the hero enters the viewport. Fires
  // once — after `inView` is true we don't re-observe (avoids repeat
  // fires on scroll bounce).
  useEffect(() => {
    if (inView || !ref.current) return undefined;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold: 0.35 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [inView]);

  // Tween the display numbers whenever data changes AND the hero is in
  // view. Starts from the CURRENT displayed values so a mid-tween data
  // change morphs smoothly instead of snapping back to zero.
  useEffect(() => {
    if (!inView) return undefined;
    if (!Number.isFinite(oldBill) || !Number.isFinite(newBill)) return undefined;
    const start = { ...display };
    const target = { old: oldBill, neu: newBill, sav: Number.isFinite(savingsYr) ? savingsYr : 0 };
    const t0 = performance.now();
    const dur = 1500;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      // ease-out cubic — snappy start, gentle settle
      const e = 1 - Math.pow(1 - t, 3);
      setDisplay({
        old: start.old + (target.old - start.old) * e,
        neu: start.neu + (target.neu - start.neu) * e,
        sav: start.sav + (target.sav - start.sav) * e,
      });
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // Intentionally NOT depending on `display` — we snapshot at effect
    // start, otherwise we'd retrigger on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, oldBill, newBill, savingsYr]);

  if (!Number.isFinite(oldBill) || !Number.isFinite(newBill) || oldBill <= 0) return null;

  // Bar geometry — right bar animates from 100% down to (newBill/oldBill).
  // Before inView triggers, both bars sit full so the user doesn't see a
  // pre-animated state. Once inView flips true, right bar transitions.
  const targetPct = Math.max(0.05, newBill / oldBill);           // floor at 5% so tiny values are still visible
  const rightPct  = inView ? targetPct : 1;
  const savedPct  = Math.max(0, Math.min(1, 1 - targetPct));
  const savedFraction = Math.round(savedPct * 100);
  const money = (v) => `$${Math.round(v).toLocaleString('en-NZ')}`;

  // Iteration 6 — taller bars (h-72 md:h-96), spring easing on the
  // shrink so it "settles" like it's landing, glow behind the savings
  // number, pulsing SAVED badge that appears after the tween completes.
  // Background gets a warm gradient so this section reads as the money
  // hero (vs plain white cards elsewhere).
  const springEase = 'cubic-bezier(0.34, 1.20, 0.64, 1)';  // slight back-ease for that "settle" feel

  return (
    <div
      ref={ref}
      className="relative rounded-2xl border-2 border-[#E3D9C4] overflow-hidden shadow-lg"
      style={{
        background: 'radial-gradient(ellipse at top right, rgba(217, 83, 30, 0.08) 0%, rgba(217, 83, 30, 0) 55%), linear-gradient(to bottom, #FFFFFF, #FBF7F0)',
      }}
    >
      {/* Decorative subtle sun glow top-right */}
      <div
        aria-hidden="true"
        className="absolute -top-16 -right-16 w-64 h-64 rounded-full opacity-40 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(244,168,59,0.35) 0%, rgba(244,168,59,0) 70%)' }}
      />

      <div className="relative px-6 py-4 border-b border-[#E3D9C4]/60 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#F4A83B] to-[#D9531E] flex items-center justify-center flex-shrink-0 shadow-md">
          <TrendingUp className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">
            The money moment
          </div>
          <div className="text-xl md:text-2xl font-serif text-[#1A1614] leading-tight">
            Your power bill, before &amp; after solar.
          </div>
        </div>
      </div>

      <div className="relative p-6 md:p-10 grid md:grid-cols-[1fr,auto,1fr,auto] gap-6 md:gap-10 items-end">
        {/* Left bar — current bill (static, fills to 100%) */}
        <div className="flex flex-col items-center">
          <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono mb-2 font-semibold">
            Now / year
          </div>
          <div className="relative w-full max-w-[160px] h-72 md:h-96 bg-[#F4EEE1] rounded-xl overflow-hidden border-2 border-[#E3D9C4] shadow-inner">
            <div
              className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#6B645C] via-[#8B8377] to-[#A69B8E]"
              style={{ height: '100%' }}
            />
            <div className="absolute inset-x-0 top-3 text-center text-white font-serif font-bold text-2xl md:text-3xl tabular-nums drop-shadow-md">
              {money(display.old)}
            </div>
          </div>
        </div>

        {/* Arrow — pulsing on desktop */}
        <div className="hidden md:flex items-center justify-center h-72 md:h-96">
          <div
            className="text-5xl text-[#D9531E] font-serif animate-pulse"
            style={{ animationDuration: '2.5s' }}
            aria-hidden="true"
          >&rarr;</div>
        </div>

        {/* Right bar — after solar. Height transitions from 100% → targetPct
            when inView flips. Spring easing for the settle. */}
        <div className="flex flex-col items-center">
          <div className="text-[10px] uppercase tracking-wider text-[#5C8B4A] font-mono mb-2 font-bold">
            With solar
          </div>
          <div className="relative w-full max-w-[160px] h-72 md:h-96 bg-[#F4EEE1] rounded-xl overflow-hidden border-2 border-[#E3D9C4] shadow-inner">
            {/* Savings "ghost" — sits above the shrunk bar, warmer orange
                so the delta reads as MONEY saved. Diagonal-stripe pattern
                gives it a "recovered value" texture. */}
            <div
              className="absolute inset-x-0 top-0"
              style={{
                height: `${(savedPct * 100).toFixed(1)}%`,
                background: 'repeating-linear-gradient(-45deg, rgba(217, 83, 30, 0.15) 0, rgba(217, 83, 30, 0.15) 8px, rgba(217, 83, 30, 0.28) 8px, rgba(217, 83, 30, 0.28) 16px)',
                borderBottom: '2px dashed rgba(217, 83, 30, 0.55)',
                transition: `height 1800ms ${springEase}`,
              }}
            />
            <div
              className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#3F6B32] via-[#5C8B4A] to-[#7BA663]"
              style={{
                height: `${(rightPct * 100).toFixed(1)}%`,
                transition: `height 1800ms ${springEase}`,
              }}
            />
            <div className="absolute inset-x-0 bottom-3 text-center text-white font-serif font-bold text-2xl md:text-3xl tabular-nums drop-shadow-md">
              {money(display.neu)}
            </div>
            {/* "SAVED" pulsing badge — appears after animation lands */}
            {inView && savedPct > 0.05 && (
              <div
                className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-[#D9531E] text-white text-[10px] uppercase tracking-widest font-bold shadow-lg opacity-0"
                style={{
                  top: `${Math.max(2, savedPct * 50 - 3).toFixed(1)}%`,
                  transform: 'translate(-50%, -50%)',
                  animation: 'billShrinkBadge 400ms cubic-bezier(0.34, 1.56, 0.64, 1) 1600ms forwards, billShrinkPulse 2s ease-in-out 2000ms infinite',
                  transition: `top 1800ms ${springEase}`,
                }}
              >
                <CheckCircle className="w-3 h-3" />
                Saved {savedFraction}%
              </div>
            )}
          </div>
        </div>

        {/* Right callout — big savings number with glow + cumulative */}
        <div className="md:pl-6 md:border-l md:border-[#E3D9C4] md:h-72 lg:h-96 flex flex-col justify-center relative">
          <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono font-semibold">
            You save every year
          </div>
          <div className="relative mt-2">
            {/* Golden glow behind the number */}
            <div
              aria-hidden="true"
              className="absolute inset-0 -m-4 rounded-full opacity-70 blur-2xl pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(244,168,59,0.6) 0%, rgba(244,168,59,0) 70%)' }}
            />
            <div className="relative text-5xl md:text-6xl font-serif font-bold text-[#D9531E] tabular-nums leading-none">
              {money(display.sav)}
            </div>
          </div>
          {Number.isFinite(cum25) && cum25 > 0 && (
            <div className="mt-6 pt-4 border-t border-[#E3D9C4]/70">
              <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono font-semibold">
                Over 25 years
              </div>
              <div className="text-3xl font-serif text-[#1A1614] mt-1 tabular-nums font-bold">
                {money(cum25)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Comparison chips — makes the abstract dollar amount tangible.
          NZ-familiar anchors (petrol tank $120, TransTasman flight $450,
          weekly grocery shop $300, weekend getaway $500). Chips fade
          + slide in one-by-one starting 1200ms after inView (right AFTER
          the bar animation lands). Only shows anchors where at least 1
          whole unit is affordable — no "0.4 flights". Iteration 6b. */}
      {inView && savingsYr >= 100 && (
        <div className="relative px-6 md:px-10 pb-6 md:pb-8">
          <div className="pt-5 border-t border-[#E3D9C4]/60">
            <div className="text-[10px] uppercase tracking-widest text-[#8B8377] font-mono font-semibold mb-3">
              That&apos;s equivalent to &mdash; each year
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { unit: 120, singular: 'tank of petrol',       plural: 'tanks of petrol',       icon: Zap,      delayMs: 0    },
                { unit: 450, singular: 'return flight to Sydney', plural: 'return flights to Sydney', icon: Plane, delayMs: 120  },
                { unit: 300, singular: 'week of groceries',    plural: 'weeks of groceries',    icon: Home,     delayMs: 240  },
                { unit: 500, singular: 'weekend getaway',      plural: 'weekend getaways',      icon: Calendar, delayMs: 360  },
              ]
                .map(a => ({ ...a, count: Math.floor(savingsYr / a.unit) }))
                .filter(a => a.count >= 1)
                .map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <div
                      key={i}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white border border-[#E3D9C4] shadow-sm opacity-0"
                      style={{
                        animation: `billShrinkChip 500ms cubic-bezier(0.34, 1.56, 0.64, 1) ${1200 + a.delayMs}ms forwards`,
                      }}
                    >
                      <Icon className="w-3.5 h-3.5 text-[#D9531E] flex-shrink-0" />
                      <span className="font-serif font-bold text-[#1A1614] text-base tabular-nums">{a.count}</span>
                      <span className="text-sm text-[#55504A]">{a.count === 1 ? a.singular : a.plural}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Keyframes for badge pop-in + gentle pulse + chip stagger. Scoped
          via unique animation names. */}
      <style>{`
        @keyframes billShrinkBadge {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
          70%  { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes billShrinkPulse {
          0%,100% { box-shadow: 0 4px 14px rgba(217, 83, 30, 0.35); }
          50%     { box-shadow: 0 6px 22px rgba(217, 83, 30, 0.6); }
        }
        @keyframes billShrinkChip {
          0%   { opacity: 0; transform: translateY(8px) scale(0.92); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

// design.financials.monthly_source tells us which; we surface a small
// note beneath the chart so the customer knows.
//
// Bar tint scales blue (winter, cool) → orange (summer, warm) so the
// season story is visible even at a glance. No chart library — SVG
// hand-drawn to match F3.
function SeasonalGenerationChart({ design }) {
  const months = design?.financials?.monthly_generation_kwh;
  const source = design?.financials?.monthly_source;
  if (!Array.isArray(months) || months.length !== 12) return null;

  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const maxKwh = Math.max(...months);
  if (maxKwh <= 0) return null;

  const W = 800, H = 260, PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 40;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const barWidth = chartW / months.length * 0.72;
  const barGap   = chartW / months.length - barWidth;

  // Highs and lows for the sub-labels below the chart.
  let highIdx = 0, lowIdx = 0;
  months.forEach((v, i) => { if (v > months[highIdx]) highIdx = i; if (v < months[lowIdx]) lowIdx = i; });
  const total = months.reduce((s, v) => s + v, 0);

  // Bar tint: blue (min) → cream (mid) → orange (max), lerped by month value.
  const barColor = (v) => {
    const t = maxKwh > 0 ? v / maxKwh : 0;
    if (t < 0.5) {
      const localT = t / 0.5;
      const r = Math.round(30  + (230 - 30)  * localT);
      const g = Math.round(90  + (220 - 90)  * localT);
      const b = Math.round(156 + (195 - 156) * localT);
      return `rgb(${r},${g},${b})`;
    }
    const localT = (t - 0.5) / 0.5;
    const r = Math.round(230 + (217 - 230) * localT);
    const g = Math.round(220 + (83  - 220) * localT);
    const b = Math.round(195 + (30  - 195) * localT);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div className="rounded-2xl border border-[#E3D9C4] bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E3D9C4] bg-[#FBF7F0]">
        <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">Monthly generation</div>
        <div className="text-sm text-[#1A1614] mt-0.5">
          Expected kWh each month across a year &mdash; winter dip, summer peak.
        </div>
      </div>
      <div className="p-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Y-axis grid + labels */}
          {[0, 0.5, 1].map(t => {
            const y = PAD_T + (1 - t) * chartH;
            return (
              <g key={t}>
                <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#E3D9C4" strokeDasharray="2 4" />
                <text x={PAD_L - 8} y={y + 3} fontSize="10" fill="#8B8377" textAnchor="end" fontFamily="ui-monospace, SFMono-Regular, monospace">
                  {Math.round(t * maxKwh)}
                </text>
              </g>
            );
          })}
          {/* Bars */}
          {months.map((v, i) => {
            const x = PAD_L + i * (chartW / months.length) + barGap / 2;
            const h = (v / maxKwh) * chartH;
            const y = PAD_T + chartH - h;
            return (
              <g key={i}>
                <rect x={x} y={y} width={barWidth} height={h} fill={barColor(v)} rx="2">
                  <title>{`${MONTH_LABELS[i]}: ${v.toLocaleString('en-NZ')} kWh`}</title>
                </rect>
                {/* X-axis label */}
                <text x={x + barWidth / 2} y={H - 15} fontSize="10" fill="#8B8377" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, monospace">
                  {MONTH_LABELS[i]}
                </text>
              </g>
            );
          })}
          {/* Y-axis title (kWh) */}
          <text x={PAD_L - 8} y={PAD_T - 6} fontSize="9" fill="#8B8377" textAnchor="end" fontFamily="ui-monospace, SFMono-Regular, monospace">kWh</text>
        </svg>

        <div className="mt-4 grid md:grid-cols-3 gap-2 text-xs">
          <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-orange-800 font-mono">Sunniest month</div>
            <div className="font-mono text-orange-950 mt-0.5">
              {MONTH_LABELS[highIdx]} &middot; <strong>{months[highIdx].toLocaleString('en-NZ')} kWh</strong>
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-700 font-mono">Winter low</div>
            <div className="font-mono text-slate-900 mt-0.5">
              {MONTH_LABELS[lowIdx]} &middot; <strong>{months[lowIdx].toLocaleString('en-NZ')} kWh</strong>
            </div>
          </div>
          <div className="bg-[#F4EEE1] border border-[#E3D9C4] rounded-lg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[#8B8377] font-mono">Annual total</div>
            <div className="font-mono text-[#1A1614] mt-0.5">
              <strong>{total.toLocaleString('en-NZ')} kWh</strong>/yr
            </div>
          </div>
        </div>

        <div className="mt-3 text-[10px] text-[#8B8377] leading-snug">
          {source === 'pvgis_per_address'
            ? 'Monthly shape derived from PVGIS satellite irradiance for your exact address.'
            : 'Monthly shape based on Auckland regional average (per-address PVGIS data not available for this roof).'}
        </div>
      </div>
    </div>
  );
}

// ── F6 · ThreeScenarioTable ───────────────────────────────────────────────
// Side-by-side Conservative / Expected / Optimistic. Matches the user's
// hard rule that every proposal shows three-scenario financials — extended
// here to the POC so exploratory customers see the range, not just a
// single point estimate that reads as over-promise.
function ThreeScenarioTable({ design }) {
  const scenarios = design?.financials?.scenarios_summary;
  if (!Array.isArray(scenarios) || scenarios.length !== 3) return null;

  const toneOf = (key) =>
    key === 'conservative' ? 'bg-slate-50 border-slate-200 text-slate-900'
    : key === 'expected'    ? 'bg-orange-50 border-orange-300 text-orange-950 ring-2 ring-orange-300/40'
    :                         'bg-emerald-50 border-emerald-200 text-emerald-950';

  return (
    <div className="rounded-2xl border border-[#E3D9C4] bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E3D9C4] bg-[#FBF7F0]">
        <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">Three scenarios</div>
        <div className="text-sm text-[#1A1614] mt-0.5">Conservative &middot; Expected &middot; Optimistic &mdash; the range, not a single guess.</div>
      </div>
      <div className="p-5 grid md:grid-cols-3 gap-3">
        {scenarios.map((s) => (
          <div key={s.key} className={`rounded-xl border p-4 ${toneOf(s.key)}`}>
            <div className="text-[10px] uppercase tracking-widest font-bold opacity-70">
              {s.label}
              {s.key === 'expected' && <span className="ml-1.5 opacity-90">· headline</span>}
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <div className="text-2xl font-serif font-bold">
                {Number.isFinite(s.payback_yrs) ? s.payback_yrs.toFixed(1) : '—'}
              </div>
              <div className="text-sm opacity-70">yr payback</div>
            </div>
            <div className="mt-1.5 text-sm font-mono">
              Yr 1: <strong>${Math.round(Number(s.yr1_savings) || 0).toLocaleString('en-NZ')}</strong> saved
            </div>
            <div className="mt-3 text-[11px] leading-snug opacity-75">
              {s.description}
            </div>
            <div className="mt-2 text-[10px] opacity-60 font-mono">
              Energy inflation {s.energy_inflation_pct}% · panel wear {s.panel_degradation_pct}%/yr
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 pb-4 text-[10px] text-[#8B8377] leading-snug">
        The headline numbers on this page use the <strong>Expected</strong> scenario. Conservative and Optimistic show the same math with different assumptions about energy prices, panel ageing, and buyback rate.
      </div>
    </div>
  );
}

// ── E1 · EnvironmentalImpactSection ───────────────────────────────────────
// Full-width card showing lifetime CO2 avoided + three tangible equivalents
// (trees, cars, flights). Green palette to signal environmental theme
// without competing with the orange brand accent used for financial cards.
// All numbers server-computed from expected-scenario cashflow × NZ grid
// emission factor (0.115 kg CO2/kWh, MfE 2023).
function EnvironmentalImpactSection({ design }) {
  const env = design?.financials?.environmental;
  if (!env) return null;
  return (
    <div className="rounded-2xl overflow-hidden border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50/60">
      <div className="px-5 py-4 border-b border-emerald-200 bg-emerald-100/60">
        <div className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Your environmental impact</div>
        <div className="text-sm text-emerald-950 mt-0.5">Beyond the money &mdash; clean generation displacing grid electricity.</div>
      </div>
      <div className="p-5 md:p-6">
        {/* Headline number: lifetime CO2 in tonnes */}
        <div className="text-center mb-6">
          <div className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">
            CO<sub>2</sub> avoided over 25 years
          </div>
          <div className="mt-2 flex items-baseline justify-center gap-2">
            <div className="text-5xl md:text-6xl font-serif font-bold text-emerald-950 leading-none">
              {env.lifetime_co2_tonnes}
            </div>
            <div className="text-2xl text-emerald-800">tonnes</div>
          </div>
          <div className="text-sm text-emerald-800 mt-2 font-mono">
            {Math.round(env.lifetime_kwh).toLocaleString('en-NZ')} kWh of clean generation
          </div>
        </div>

        {/* Three tangible equivalents */}
        <div className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold mb-3">Equivalent to</div>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white/70 rounded-xl border border-emerald-200/60 p-3 text-center">
            <TreePine className="w-6 h-6 text-emerald-700 mx-auto" strokeWidth={1.5} />
            <div className="text-2xl font-serif font-bold text-emerald-950 mt-2">
              {env.equiv_trees.toLocaleString('en-NZ')}
            </div>
            <div className="text-[11px] text-emerald-800 mt-1 leading-snug">
              trees absorbing CO<sub>2</sub> for a year
            </div>
          </div>
          <div className="bg-white/70 rounded-xl border border-emerald-200/60 p-3 text-center">
            <Car className="w-6 h-6 text-emerald-700 mx-auto" strokeWidth={1.5} />
            <div className="text-2xl font-serif font-bold text-emerald-950 mt-2">
              {env.equiv_cars}
            </div>
            <div className="text-[11px] text-emerald-800 mt-1 leading-snug">
              cars off the road for a year
            </div>
          </div>
          <div className="bg-white/70 rounded-xl border border-emerald-200/60 p-3 text-center">
            <Plane className="w-6 h-6 text-emerald-700 mx-auto" strokeWidth={1.5} />
            <div className="text-2xl font-serif font-bold text-emerald-950 mt-2">
              {env.equiv_flights}
            </div>
            <div className="text-[11px] text-emerald-800 mt-1 leading-snug">
              AKL&harr;LON return flights
            </div>
          </div>
        </div>
        <div className="mt-4 text-[10px] text-emerald-800/70 leading-snug">
          Based on NZ grid emission factor 0.115 kg CO<sub>2</sub>/kWh (MfE 2023). Equivalents use EPA
          tree absorption, MoT NZ passenger-car average, and myclimate.org flight estimates.
        </div>
      </div>
    </div>
  );
}

// ── C1 · BookSiteSurveyCTA ────────────────────────────────────────────────
// Primary conversion CTA. Simple form (name / phone / email / preferred
// visit time) with a POST to /api/quote/legacy-submit. Success flips into a thank-you
// state so the customer feels confirmed.
//
// POC scope: no real lead-management integration yet — server logs the
// submission. Future: wire into PM Tool via phase_6_6_wizard_to_pm plumbing.
function BookSiteSurveyCTA({ bill, analysis, design }) {
  const [name,          setName]          = useState('');
  const [email,         setEmail]         = useState('');
  const [phone,         setPhone]         = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [submitted,     setSubmitted]     = useState(false);
  const [submitError,   setSubmitError]   = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Bundle the customer's quote context so the rep has everything they
      // need on first contact — no chasing missing info.
      const payload = {
        contact: { name, email, phone, preferred_time: preferredTime || null },
        quote_context: {
          formatted_address:    analysis?.formattedAddress || null,
          place_id:             analysis?.coords ? `${analysis.coords.latitude},${analysis.coords.longitude}` : null,
          annual_kwh:           design?.derived_annual_kwh || null,
          recommended_tier:     design?.tiers?.[design?.recommended_index]?.label || null,
          recommended_price:    design?.tiers?.[design?.recommended_index]?.price_inc_gst || null,
          payback_yrs:          design?.financials?.expected?.payback_yrs || null,
          savings_25yr:         design?.financials?.expected?.cum_25yr_savings || null,
          from_manual_entry:    !!bill?._manual_entry,
        },
      };
      await publicApi.post('/quote/legacy-submit', payload);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err?.response?.data?.error || err?.message || 'Submission failed. Please try again or email us directly.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-2xl bg-emerald-50 border border-emerald-300 p-6 md:p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500 grid place-items-center shadow-lg">
          <CheckCircle className="w-8 h-8 text-white" />
        </div>
        <h3 className="mt-4 font-serif text-2xl text-emerald-950">Thanks &mdash; we&apos;ll be in touch within 24 hours.</h3>
        <p className="mt-2 text-sm text-emerald-800 max-w-md mx-auto">
          One of our installers will contact {name || 'you'} to confirm your site survey.
          {email && <> A copy has been sent to <strong>{email}</strong>.</>} No commitment yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#D9531E] to-[#B84418] overflow-hidden shadow-xl shadow-orange-500/20">
      <div className="p-6 md:p-8 text-white">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-orange-100" />
          <div className="text-[10px] uppercase tracking-widest text-orange-100/90 font-bold">Ready to install?</div>
        </div>
        <h3 className="mt-2 font-serif text-3xl md:text-4xl leading-tight">Book your free site survey.</h3>
        <p className="mt-3 text-sm md:text-base text-orange-50 max-w-xl leading-relaxed">
          One of our installers will visit your roof, confirm placement + panel count, and give you a firm price.
          No obligation, no deposit &mdash; cancel any time.
        </p>

        <form onSubmit={onSubmit} className="mt-6 grid gap-3 md:grid-cols-2">
          <label className="relative md:col-span-1">
            <User className="w-4 h-4 absolute left-3 top-3.5 text-[#8B8377] pointer-events-none" />
            <input type="text" required placeholder="Your name" value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-white/95 rounded-lg pl-10 pr-3 py-3 text-[#1A1614] placeholder:text-[#8B8377] outline-none focus:ring-2 focus:ring-orange-200 transition"
              disabled={submitting}
            />
          </label>
          <label className="relative md:col-span-1">
            <Phone className="w-4 h-4 absolute left-3 top-3.5 text-[#8B8377] pointer-events-none" />
            <input type="tel" required placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)}
              className="w-full bg-white/95 rounded-lg pl-10 pr-3 py-3 text-[#1A1614] placeholder:text-[#8B8377] outline-none focus:ring-2 focus:ring-orange-200 transition"
              disabled={submitting}
            />
          </label>
          <label className="relative md:col-span-2">
            <Mail className="w-4 h-4 absolute left-3 top-3.5 text-[#8B8377] pointer-events-none" />
            <input type="email" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-white/95 rounded-lg pl-10 pr-3 py-3 text-[#1A1614] placeholder:text-[#8B8377] outline-none focus:ring-2 focus:ring-orange-200 transition"
              disabled={submitting}
            />
          </label>
          <label className="relative md:col-span-2">
            <Calendar className="w-4 h-4 absolute left-3 top-3.5 text-[#8B8377] pointer-events-none" />
            <select value={preferredTime} onChange={e => setPreferredTime(e.target.value)}
              className="w-full bg-white/95 rounded-lg pl-10 pr-3 py-3 text-[#1A1614] outline-none focus:ring-2 focus:ring-orange-200 transition appearance-none"
              disabled={submitting}
            >
              <option value="">Preferred visit time (optional)</option>
              <option value="weekday_morning">Weekday morning</option>
              <option value="weekday_afternoon">Weekday afternoon</option>
              <option value="weekend">Weekend</option>
            </select>
          </label>

          {submitError && (
            <div className="md:col-span-2 bg-red-100 border border-red-300 text-red-900 rounded-lg px-3 py-2 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="md:col-span-2 mt-1 rounded-lg bg-white text-[#B84418] font-bold px-6 py-3.5 hover:bg-orange-50 transition disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-lg"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending&hellip;
              </>
            ) : (
              <>
                Book my site survey
                <span aria-hidden="true">&rarr;</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-4 text-[11px] text-orange-100/75 leading-snug">
          By submitting, you agree we can contact you about your solar install. We won&apos;t spam you or share your details.
        </div>
      </div>
    </div>
  );
}

function WhyThisManyPanelsPanel({ bill, design, recommendedTier }) {
  const annualKwh   = design?.derived_annual_kwh || 0;
  const targetKw    = design?.bill_analysis?.recommended_system_kw || 0;
  const panelCount  = recommendedTier?.panel?.count || 0;
  const panelWatts  = recommendedTier?.panel?.watts || 400;
  const actualKw    = recommendedTier?.panel?.total_kwp || (panelCount * panelWatts / 1000);
  // Regional yield the engine used to convert kWh → kW. Auckland ~1350, further
  // south ~1150. We back-calculate from annualKwh ÷ targetKw so the shown
  // number matches whatever the engine actually did.
  const yieldPerKwp = targetKw > 0 ? Math.round(annualKwh / targetKw) : null;
  const projectedGeneration = yieldPerKwp ? Math.round(actualKw * yieldPerKwp) : null;
  const coverage = annualKwh > 0 && projectedGeneration
    ? Math.round((projectedGeneration / annualKwh) * 100)
    : null;

  return (
    <div className="rounded-2xl border border-[#E3D9C4] bg-[#F4EEE1] overflow-hidden">
      <div className="px-4 py-3 bg-[#D9531E]/[0.08] border-b border-[#E3D9C4]">
        <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">Why {panelCount} panels?</div>
        <div className="text-sm text-[#1A1614] mt-0.5">Sized for your actual usage &mdash; not a guess.</div>
      </div>
      <div className="p-4 text-sm space-y-2 font-mono">
        <DerivRow label="Your annual usage"  value={`${annualKwh.toLocaleString('en-NZ')} kWh`} sub={`from bill: ${bill?.kwh_total || '—'} kWh / ${bill?.days_in_period || '—'} days`} />
        {yieldPerKwp && (
          <DerivRow label={`NZ yield`}      value={`${yieldPerKwp.toLocaleString('en-NZ')} kWh per kWp`} sub={design?.region ? `region: ${design.region}` : 'annual sun × system efficiency'} />
        )}
        <DerivRow label="Target system size" value={`${targetKw} kWp`}                            sub={`${annualKwh.toLocaleString('en-NZ')} ÷ ${yieldPerKwp || '?'}`} />
        <DerivRow label="Panel wattage"      value={`${panelWatts} W`}                            sub={recommendedTier?.panel?.name || 'panel model'} />
        <DerivRow label="Panels needed"      value={`${panelCount} panels`}                       sub={`${targetKw} kWp ÷ ${(panelWatts/1000).toFixed(2)} kWp = ${panelCount}`} highlight />

        {projectedGeneration != null && (
          <div className="mt-3 pt-3 border-t border-[#E3D9C4] text-xs text-[#1A1614]">
            <div className="flex justify-between">
              <span>Projected generation</span>
              <span className="font-semibold tabular-nums">{projectedGeneration.toLocaleString('en-NZ')} kWh/yr</span>
            </div>
            {coverage != null && (
              <div className={`flex justify-between mt-1 ${coverage >= 100 ? 'text-green-800' : 'text-amber-800'}`}>
                <span>Bill coverage</span>
                <span className="font-semibold tabular-nums">{coverage}% {coverage >= 100 ? '· export credits on sunny days' : '· grid tops up'}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// A single line of the derivation, with label, value, and small "how we got it" caption.
function DerivRow({ label, value, sub, highlight }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${highlight ? 'pt-2 mt-1 border-t border-[#E3D9C4]' : ''}`}>
      <div className="flex-1">
        <div className={`text-xs ${highlight ? 'text-[#D9531E] font-bold' : 'text-[#55504A]'}`}>{label}</div>
        {sub && <div className="text-[10px] text-[#8F887E] mt-0.5 font-normal not-italic">{sub}</div>}
      </div>
      <div className={`text-right tabular-nums ${highlight ? 'text-[#D9531E] font-bold text-base' : 'text-[#1A1614]'}`}>{value}</div>
    </div>
  );
}

// ── RoofAnalysisPanel: what Google Solar + our pipeline learned about the
//    roof. Everything a curious customer might want to see about their own
//    house.
function RoofAnalysisPanel({ analysis, recommendedTier }) {
  const { roof, imagery } = analysis;
  const segments = roof?.segments || [];

  // Classify segments the way selectViableSegments does — but only for
  // display (the actual filtering happens inside Cesium3DView). Keep in
  // sync with the filters in panelGrid.js selectViableSegments().
  const classified = segments.map(s => {
    const az    = Number(s?.azimuthDegrees) || 0;
    const pitch = Number(s?.pitchDegrees) || 0;
    const area  = Number(s?.stats?.areaMeters2) || 0;
    const azNorm = ((az % 360) + 360) % 360;
    const distFromNorth = Math.min(azNorm, 360 - azNorm);
    let orientation, reason = null, note = null;
    if (distFromNorth <= 45) orientation = 'N';
    else if (distFromNorth <= 135) orientation = azNorm < 180 ? 'E' : 'W';
    else orientation = 'S';

    if (area < 10)                reason = 'too small (<10 m²)';
    else if (pitch > 55)          reason = 'too steep (>55°)';
    else if (orientation === 'S') reason = 'south-facing (35% of N yield in NZ)';
    // Low-pitch is NOT a skip reason — it's a NOTE about tilt frames.
    else if (pitch < 10)          note   = 'tilt frames needed (low pitch)';
    return { area, pitch, azNorm, orientation, skipped: !!reason, reason, note };
  }).sort((a, b) => b.area - a.area);

  const viableCount = classified.filter(c => !c.skipped).length;

  return (
    <details open className="rounded-2xl border border-[#E3D9C4] bg-white overflow-hidden">
      <summary className="cursor-pointer px-4 py-3 bg-[#F4EEE1] border-b border-[#E3D9C4] flex items-center gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">What we learned about your roof</div>
          <div className="text-sm text-[#1A1614] mt-0.5">Google Solar + Cesium 3D Tiles</div>
        </div>
      </summary>

      <div className="p-4 space-y-2 text-sm">
        {/* Headline roof stats */}
        <div className="grid grid-cols-2 gap-2">
          <RoofStat icon={<Home className="w-4 h-4" />}      label="Roof faces found"   value={segments.length} />
          <RoofStat icon={<LayoutGrid className="w-4 h-4" />} label="Viable for solar"  value={viableCount} />
          <RoofStat icon={<LayoutGrid className="w-4 h-4" />} label="Total usable area" value={roof?.max_array_area_m2} suffix="m²" />
          <RoofStat icon={<Sun className="w-4 h-4" />}       label="Sunshine"           value={roof?.max_sunshine_hours_per_year} suffix="hrs/yr" />
          <RoofStat icon={<Sun className="w-4 h-4" />}       label="CO₂ offset"         value={roof?.carbon_offset_factor_kg_per_kwh} suffix="kg/kWh" precision={3} />
          <RoofStat icon={<MapPin className="w-4 h-4" />}    label="Imagery"            value={imagery?.date || '—'} />
        </div>

        {/* Per-segment table with skip reasons */}
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-[#8F887E] font-semibold mb-2">All roof faces</div>
          <div className="space-y-1 font-mono text-xs">
            {classified.map((c, i) => (
              <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded ${
                c.skipped ? 'bg-[#FBF7F0] text-[#8F887E]'
                          : c.note ? 'bg-amber-50 text-[#1A1614]'
                                   : 'bg-green-50 text-[#1A1614]'
              }`}>
                <span className={`inline-block w-6 font-bold ${c.skipped ? 'text-[#8F887E]' : 'text-[#D9531E]'}`}>{c.orientation}</span>
                <span className="w-16">{c.area.toFixed(0)} m²</span>
                <span className="w-14">pitch {c.pitch.toFixed(0)}°</span>
                <span className="flex-1 text-right italic">
                  {c.skipped ? `skipped · ${c.reason}`
                             : c.note ? `used · ${c.note}`
                                      : 'used'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-3 text-[11px] text-[#8F887E] leading-relaxed">
          Solar strings need at least 3 panels per MPPT input to work with an inverter, so tiny
          faces get skipped &mdash; those panels go on a bigger face instead. Rep confirms the
          final layout at the site visit.
        </p>
      </div>
    </details>
  );
}

// DEAD CODE (kept as fallback reference) — replaced by Cesium3DPanelHero in
// QuoteStage. Delete once 3D flow is validated in staging.
function PanelOverlayHero({ aerial, coords, building, panels, segments = [], panelConfig, tiers, recommendedIndex }) {  // eslint-disable-line no-unused-vars
  const [imgErr, setImgErr] = useState(null);
  // Use the tighter zoom + no-marker URL from the server (for the quote screen
  // we want the roof filling the frame, no orange pin obscuring panels).
  const imgUrl = aerial.tight_url || aerial.url;
  const zoom   = aerial.tight_zoom || aerial.zoom;
  const [imgW, imgH] = (aerial.size || '640x480').split('x').map(Number);

  // metersPerPixel at (centerLat, zoom) — Web Mercator.
  // Formula: earth_circumference / 2^zoom / tile_size_px. The pre-computed
  // constant 156543.03392 already IS earth_circumference / tile_size (=
  // 40075016.686 / 256), so dividing by 256 again gives m per 1/256-pixel.
  const mpp = 156543.03392 * Math.cos(coords.latitude * Math.PI / 180) / (2 ** zoom);

  // Panel physical dims (fall back to a typical 400W panel if Google didn't say)
  const panelWm = panelConfig?.width_m  || 1.65;
  const panelHm = panelConfig?.height_m || 0.99;

  // ── Panel selection (Plan D — idealized rectangular grid) ──────────────
  // Instead of using Google's messy real-world positions, we compute a
  // clean rectangular array on the LARGEST roof segment (by area) and
  // render THAT for the marketing visual.
  //
  // Why:
  //   Google's solarPanels[] are engineering-realistic (with gaps for
  //   chimneys, edge setbacks, service walkways) so they don't render as
  //   the neat rows customers expect from a marketing quote. The rep still
  //   designs the real layout at site survey — the customer-facing visual
  //   is a preliminary idealized rendering.
  //
  // Google's raw positions ARE still filtered to inside the building
  // polygon and passed to the engine for kWh estimation. Only the visual
  // uses our idealized grid.

  // Google's positions still used behind the scenes for kWh sum reporting
  // (bottom caption). Filter to inside the building polygon to keep the
  // energy summary honest (only panels on the customer's building count).
  const outerRing = building?.polygon?.[0];
  const panelsOnBuilding = outerRing
    ? panels.filter(p => p.center && pointInRing(p.center.longitude, p.center.latitude, outerRing))
    : panels;
  const totalOnBuilding = panelsOnBuilding.length;
  const filteredOut = panels.length - totalOnBuilding;

  // Recommended tier's panel count.
  const tierCounts = tiers.map(t => t.panel?.count || 0);
  const maxCount = Math.max(...tierCounts, 0);
  const requestedCount = tiers[recommendedIndex]?.panel?.count || maxCount;

  // Pick the largest segment ON the customer's building — that's where we
  // lay out. Google returns segments for a whole area; we prefer segments
  // whose centre falls inside our building polygon.
  const segmentsOnBuilding = outerRing
    ? segments.filter(s => s?.center && pointInRing(s.center.longitude, s.center.latitude, outerRing))
    : segments;
  const largestSegment = [...(segmentsOnBuilding.length ? segmentsOnBuilding : segments)]
    .sort((a, b) => (b?.stats?.groundAreaMeters2 || b?.stats?.areaMeters2 || 0)
                  - (a?.stats?.groundAreaMeters2 || a?.stats?.areaMeters2 || 0))[0];

  // Anchor the grid on the CUSTOMER'S BUILDING CENTROID (from OSM/LINZ) —
  // NOT the segment's centre. Google's segments can span an entire
  // townhouse block; centring the array on the segment often places it in
  // the wrong unit. The building centroid is guaranteed to be at the
  // customer's actual property.
  const gridCenter = building?.centroid || largestSegment?.center;
  const gridAzimuth = largestSegment?.azimuthDegrees ?? 0;

  // Compute the idealized panel grid.
  const shown = gridCenter
    ? computeIdealPanelGrid(
        { center: gridCenter, azimuthDegrees: gridAzimuth, stats: largestSegment?.stats },
        panelWm, panelHm, requestedCount,
      )
    : [];

  // Warning flag if the segment can't fit the recommended count
  const insufficientOnPrimary = shown.length < requestedCount;

  // Total achievable capacity (Google's own count for the whole building)
  const googleMaxPanels = panelsOnBuilding.length;

  return (
    <div
      className="relative rounded-3xl overflow-hidden shadow-2xl border border-[#E3D9C4] bg-[#8FA184]"
      style={{ aspectRatio: `${imgW} / ${imgH}` }}
    >
      {imgErr ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-800 bg-red-50">
          <div>Aerial image failed to load: {imgErr}</div>
        </div>
      ) : (
        <>
          <img
            src={imgUrl}
            alt="Property aerial"
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImgErr('unable to fetch Static Maps image')}
            draggable={false}
          />
          {/* Panel + building overlay. Both share the same lat/lng-to-pixel
              math anchored on `coords` (the authoritative centre). */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${imgW} ${imgH}`}
            preserveAspectRatio="none"
          >
            {/* Building outline drawing removed by request — the polygon is
                still used behind the scenes to filter panels to the customer's
                building only (see panelsOnBuilding above). */}

            {/* Google's suggested panel positions.
                Panel dimensions (Google convention):
                  panelWidthMeters  = LONG side (~1.65m for a 400W module)
                  panelHeightMeters = SHORT side (~0.99m)
                LANDSCAPE = long side runs along the roof ridge (perpendicular to slope).
                PORTRAIT  = long side runs up/down the slope.
                We rotate each panel by its segment's azimuth so the rendered
                rectangle visually aligns with the actual roof plane in the aerial.
             */}
            {shown.map((p, i) => {
              if (!p.center) return null;
              const dLat = p.center.latitude  - coords.latitude;
              const dLng = p.center.longitude - coords.longitude;
              const dxM  = dLng * 111320 * Math.cos(coords.latitude * Math.PI / 180);
              const dyM  = dLat * 111320;
              const cx = imgW / 2 + dxM / mpp;
              const cy = imgH / 2 - dyM / mpp;
              // Long side vs short side (fixed — was inverted before).
              const isPortrait = p.orientation === 'PORTRAIT';
              const longPx  = panelWm / mpp;   // ~1.65 m
              const shortPx = panelHm / mpp;   // ~0.99 m
              const wPx = isPortrait ? shortPx : longPx;
              const hPx = isPortrait ? longPx  : shortPx;
              // Roof-plane rotation. Idealized panels carry their source
              // segment on `_sourceSegment`; Google's raw positions look up
              // by `segmentIndex`.
              const seg = p._sourceSegment || segments[p.segmentIndex];
              const azimuth = seg?.azimuthDegrees ?? 0;
              return (
                <g key={i} transform={`translate(${cx.toFixed(2)}, ${cy.toFixed(2)}) rotate(${azimuth.toFixed(1)})`}>
                  <rect
                    x={-wPx / 2}
                    y={-hPx / 2}
                    width={wPx}
                    height={hPx}
                    fill="#1F3A5C"
                    fillOpacity="0.85"
                    stroke="#0E1A2A"
                    strokeWidth="0.4"
                  />
                  {/* Bus bar hint along the panel's long axis */}
                  <line
                    x1={-wPx / 2}
                    y1={0}
                    x2={wPx / 2}
                    y2={0}
                    stroke="#7BA1D0"
                    strokeWidth="0.3"
                    opacity="0.7"
                  />
                </g>
              );
            })}
          </svg>
        </>
      )}
      {/* Caption strip */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 rounded-xl bg-black/70 backdrop-blur text-white text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">System</div>
          <div className="font-serif text-lg">{tiers[recommendedIndex]?.panel?.total_kwp || '—'} kWp</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">Panels</div>
          <div className="font-serif text-lg">{shown.length}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">Roof face used</div>
          <div className="text-xs font-mono">
            {largestSegment ? `${Math.round(largestSegment.stats?.areaMeters2 || 0)} m² · ${Math.round(largestSegment.azimuthDegrees || 0)}° azimuth` : '—'}
          </div>
        </div>
      </div>

      {/* Warning if the primary roof segment can't hold the recommended count */}
      {insufficientOnPrimary && (
        <div className="absolute top-3 left-3 right-3 px-4 py-2 rounded-xl bg-amber-500/90 text-white text-xs">
          Only {shown.length} panels fit on your largest roof face; recommended tier is {requestedCount}. Rep will design across multiple roof faces at site survey.
        </div>
      )}
    </div>
  );
}

// Client-side tier-card label — reflects ACTUAL composed system, not
// the server's pre-composition label (which uses slider target values
// that may not match the installed battery due to product minimums
// like BYD HVM's 4-module BMS floor at 11.04 kWh).
function deriveTierLabel(tier) {
  if (!tier) return '';
  const hasBattery = tier.battery?.usable_kwh > 0;
  const hasEv = !!tier.wattpilot_included;
  if (!hasBattery && !hasEv) return 'Solar only';
  const parts = ['Solar'];
  if (hasBattery) parts.push(`+ ${Number(tier.battery.usable_kwh).toFixed(1)} kWh battery`);
  if (hasEv) parts.push('+ EV-ready');
  return parts.join(' ');
}

// Exported 2026-08-20 for reuse by the merged /get-quote residential wizard
// (Phase B1 ticket B1.5). Individual tier card — click callback lets the
// merged flow use it as a "choose this tier" trigger to advance to Step 5.
export function TierCard({ tier, isRecommended, isViewing, onClick, recommendedPanelCount = null }) {
  // Card can now be clicked to preview that tier's panel layout in the
  // 3D above (iteration 8). Visual states are independent:
  //   isRecommended: engine's pick — orange border + top badge
  //   isViewing:     currently selected + rendered in 3D — inner amber ring
  //                  (badge relabelled 'SELECTED' 2026-08-20 per customer
  //                   feedback — 'Viewing in 3D' was descriptive, 'Selected'
  //                   is decisive.)
  //   Both true on default = card gets both the orange border AND the
  //   amber ring (double-highlighted).
  const isClickable = typeof onClick === 'function';
  const panelCount = tier.panel?.count;
  // E: per-tier panel delta vs recommended, for at-a-glance comparison.
  // Only shown on non-recommended tiers when we know the reference count
  // and the delta is non-zero. On roof-capped houses all tiers show the
  // same count → delta = 0 → no badge (cleaner, and the roof-cap warning
  // above already explains why).
  const panelDelta = Number.isFinite(recommendedPanelCount) && Number.isFinite(panelCount)
    ? panelCount - recommendedPanelCount
    : null;
  const showDelta = !isRecommended && panelDelta !== null && panelDelta !== 0;

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`relative rounded-2xl p-6 flex flex-col gap-4 transition
        ${isRecommended
          ? 'bg-gradient-to-b from-[#D9531E]/[0.08] to-[#F4EEE1] border-2 border-[#D9531E] shadow-xl shadow-orange-500/10'
          : 'bg-[#F4EEE1] border border-[#E3D9C4]'
        }
        ${isViewing && !isRecommended ? 'ring-4 ring-[#F4A83B] ring-offset-2 ring-offset-[#FBF7F0] shadow-xl shadow-amber-500/25 scale-[1.02]' : ''}
        ${isViewing && isRecommended ? 'ring-4 ring-[#F4A83B]' : ''}
        ${isClickable ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[#D9531E] focus:ring-offset-2 focus:ring-offset-[#FBF7F0]' : ''}
      `}
    >
      {isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#D9531E] text-white text-[10px] uppercase tracking-wider font-bold">
          <Award className="w-3 h-3 inline mr-1" /> Recommended
        </div>
      )}
      {isViewing && !isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#F4A83B] text-[#1A1614] text-[10px] uppercase tracking-wider font-bold shadow-md ring-2 ring-white">
          &check; Selected
        </div>
      )}
      {/* Display label — override server label to reflect ACTUAL installed
          battery, not the client's slider target. E.g. slider=2.76 kWh
          might get composed as 11.04 kWh due to BYD HVM's 4-module BMS
          minimum; label needs to match reality or customer's confused. */}
      <div className="font-serif text-2xl">{deriveTierLabel(tier)}</div>

      {/* C: prominent panel count — moved from SpecRow into a headline
          row above price so it's the second thing a customer reads. */}
      {panelCount != null && (
        <div className="flex items-baseline gap-3">
          <div className="font-serif text-3xl font-bold text-[#1A1614] tabular-nums">
            {panelCount}
            <span className="ml-1 text-sm text-[#8F887E] font-normal font-body">panels</span>
          </div>
          {tier.panel?.total_kwp && (
            <div className="text-sm text-[#8F887E]">
              {tier.panel.total_kwp} kWp
            </div>
          )}
          {showDelta && (
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
              panelDelta > 0
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-700'
            }`}>
              {panelDelta > 0 ? `+${panelDelta}` : panelDelta} vs recommended
            </div>
          )}
        </div>
      )}

      <div className="font-serif text-3xl">
        {tier.price_inc_gst != null
          ? '$' + Math.round(tier.price_inc_gst).toLocaleString('en-NZ')
          : <span className="text-[#8F887E] text-lg">Price pending</span>}
        {tier.price_inc_gst != null && <span className="text-xs text-[#8F887E] font-body ml-2">GST incl.</span>}
      </div>

      <div className="space-y-2 pt-3 border-t border-[#E3D9C4] text-sm">
        <SpecRow icon={<Zap className="w-4 h-4" />} label="Panels" value={
          tier.panel ? `${tier.panel.count} × ${tier.panel.watts}W = ${tier.panel.total_kwp} kWp` : '—'
        } />
        <SpecRow icon={<Cpu className="w-4 h-4" />} label="Inverter" value={
          tier.inverter ? `${tier.inverter.name} (${tier.inverter.ac_kw} kW)` : '—'
        } />
        <SpecRow icon={<Battery className="w-4 h-4" />} label="Battery" value={
          tier.battery ? `${tier.battery.name} (${tier.battery.usable_kwh} kWh)` : 'none'
        } />
        <SpecRow icon={<Sparkles className="w-4 h-4" />} label="EV charger" value={tier.wattpilot_included ? 'Wattpilot ready' : 'not included'} />
      </div>

      {tier.engine_warnings?.length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200 space-y-1">
          {tier.engine_warnings.map((w, i) => (
            <div key={i}>{w.message}</div>
          ))}
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); /* future: open Choose flow */ }}
        className={`mt-auto py-2.5 rounded-full font-semibold text-sm transition
          ${isRecommended
            ? 'bg-[#D9531E] text-white hover:bg-[#B84418]'
            : 'bg-white border border-[#E3D9C4] text-[#1A1614] hover:bg-white/70'
          }`}
      >
        Choose {tier.label.split(' ').slice(0, 2).join(' ')}
      </button>
    </div>
  );
}

function SpecRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <div className="text-[#D9531E] mt-0.5">{icon}</div>
      <div className="flex-1 flex justify-between gap-2">
        <span className="text-[#55504A]">{label}</span>
        <span className="text-[#1A1614] font-medium text-right">{value}</span>
      </div>
    </div>
  );
}

function RoofStat({ icon, label, value, suffix, precision }) {
  const isEmpty = value == null || value === '';
  let display = '—';
  if (!isEmpty) {
    if (typeof value === 'number') {
      display = precision != null
        ? value.toFixed(precision)
        : value.toLocaleString('en-NZ', { maximumFractionDigits: 1 });
    } else {
      display = String(value);
    }
  }
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-[#F4EEE1] border border-[#E3D9C4] rounded-xl">
      <div className="text-[#D9531E]">{icon}</div>
      <div className="text-sm text-[#55504A] flex-1">{label}</div>
      <div className={`font-mono tabular-nums text-sm ${isEmpty ? 'text-[#8F887E]' : 'text-[#1A1614] font-semibold'}`}>
        {display}
        {!isEmpty && suffix && <span className="ml-1 text-xs text-[#8F887E] font-normal">{suffix}</span>}
      </div>
    </div>
  );
}

function DataCard({ label, value, mono, money, large, suffix, note }) {
  const isMissing = value == null || value === '' || (typeof value === 'number' && Number.isNaN(value));
  const fmt = (v) => {
    if (isMissing) return '—';
    if (money) return '$' + Number(v).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (typeof v === 'number') return v.toLocaleString('en-NZ');
    return String(v);
  };
  return (
    <div className="bg-[#F4EEE1] border border-[#E3D9C4] rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[#8F887E] font-semibold">{label}</div>
      <div
        className={`mt-1 ${large ? 'text-2xl font-serif' : 'text-base'} ${mono ? 'font-mono tabular-nums tracking-tight' : ''} ${isMissing ? 'text-[#8F887E]' : 'text-[#1A1614]'}`}
      >
        {fmt(value)}
        {!isMissing && suffix && <span className="ml-1 text-xs text-[#8F887E] font-normal">{suffix}</span>}
      </div>
      {isMissing && note && (
        <div className="mt-1 text-[10px] text-[#8F887E] italic">{note}</div>
      )}
    </div>
  );
}
