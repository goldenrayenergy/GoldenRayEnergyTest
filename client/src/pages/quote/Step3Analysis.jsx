// Step3Analysis — merged 5-step flow, roof-analysis step (B1.4, 2026-08-20).
//
// Fires POST /api/roof/analyse on mount using the confirmed address from
// Step 2. Shows the polished EnergyFlowOverlay (already built in POC) during
// the wait — customer sees the isometric 2.5D scene + 4 time-of-day modes +
// prominent status card while the server does Google-Solar → LiDAR → OSM.
//
// On success: overlay transitions to green "Roof analysis ready!" state with
// pulsing "See my system →" CTA. Click → advance to Step 4.
//
// On failure: I1 fallback surfaces a site-survey booking CTA in the overlay's
// error state. Customer isn't stranded — they can still be captured as a lead
// via the site-survey path.

import { useEffect, useState, useRef, useCallback } from 'react';
import { AlertTriangle, ChevronLeft } from 'lucide-react';
import { publicApi } from '../../services/api';
import { EnergyFlowOverlay, GoogleSolarReadCard } from '../poc/QuotePage.jsx';

/**
 * @param {object}   props
 * @param {object}   props.address       — { formattedAddress, latitude, longitude, place_id, pinAdjusted }
 * @param {object}   [props.analysis]    — if already run + returning to this step, skip re-firing
 * @param {function} props.onChange      — save analysis result to wizard state
 * @param {function} props.onContinue    — advance to Step 4
 * @param {function} props.onBack        — return to Step 2 (address)
 */
export default function Step3Analysis({ address, analysis, onChange, onContinue, onBack }) {
  const [analysing, setAnalysing]   = useState(false);
  const [error, setError]           = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [pending, setPending]       = useState(analysis || null);
  const [elapsedMs, setElapsedMs]   = useState(0);
  const firedRef = useRef(false);

  // Fire the analyse call once per address on mount. Skipped if `analysis`
  // was passed in (customer returning to this step after picking a tier —
  // don't re-run the expensive call).
  useEffect(() => {
    if (firedRef.current || pending) return;
    if (!address?.place_id) {
      setError('No address to analyse. Go back and pick one.');
      return;
    }
    firedRef.current = true;
    setAnalysing(true);
    setError(null);

    const start = Date.now();
    const iv = setInterval(() => setElapsedMs(Date.now() - start), 500);

    (async () => {
      try {
        const body = { place_id: address.place_id };
        if (address.pinAdjusted && Number.isFinite(address.latitude) && Number.isFinite(address.longitude)) {
          body.lat_override = address.latitude;
          body.lng_override = address.longitude;
        }
        // Retry once on 500/504/timeout — LiDAR path is cold-slow.
        let data;
        try {
          const res = await publicApi.post('/roof/analyse', body, { timeout: 90_000 });
          data = res.data;
        } catch (retryable) {
          const s = retryable?.response?.status;
          if (s === 500 || s === 504 || retryable?.code === 'ECONNABORTED' || !s) {
            console.warn(`[Step3Analysis] first attempt failed (${s || retryable?.code}), retrying once`);
            const res2 = await publicApi.post('/roof/analyse', body, { timeout: 90_000 });
            data = res2.data;
          } else {
            throw retryable;
          }
        }
        setPending(data);
        onChange(data);
      } catch (e) {
        // Fix (2026-08-27) — daily quote-limit 429 detection. Server
        // sends { error, quotes_used_today, max_per_day, reset_at_iso,
        // book_survey_url } when the customer's IP has already looked
        // at MAX_ADDRESSES_PER_DAY distinct addresses today. Show a
        // dedicated card (SiteSurveyFallback with rate-limit variant)
        // instead of the generic "analysis failed" copy.
        if (e.response?.status === 429) {
          const body = e.response.data || {};
          setError(body.error || 'You\'ve reached your daily quote limit.');
          setDiagnostics({
            source_pipeline:   'rate_limited',
            fallback_reason:   'daily_quote_limit',
            quotes_used_today: body.quotes_used_today,
            max_per_day:       body.max_per_day,
            reset_at_iso:      body.reset_at_iso,
            book_survey_url:   body.book_survey_url,
          });
          return;
        }
        const status = e.response?.status ? ` [HTTP ${e.response.status}]` : '';
        const bodyMsg = typeof e.response?.data === 'string'
          ? e.response.data.slice(0, 300)
          : (e.response?.data?.error || e.message || 'Roof analysis failed.');
        setError(`${bodyMsg}${status}`);
        // Round 4 (2026-08-26) — capture roof_analysis_diagnostics so the
        // fallback card can show which specific pipeline stage broke.
        // Distinguishes "no data at this coord" (both_pipelines_failed)
        // from "we had data but the algorithm rejected it" (LiDAR gate).
        const diag = e.response?.data?.roof_analysis_diagnostics || null;
        if (diag) setDiagnostics(diag);
      } finally {
        setAnalysing(false);
        clearInterval(iv);
      }
    })();

    return () => clearInterval(iv);
  }, [address, pending, onChange]);

  // Derive overlay status for EnergyFlowOverlay
  const status = analysing ? 'analysing'
               : error ? 'error'
               : pending ? 'complete'
               : null;

  const resultSummary = pending ? summarize(pending) : null;

  const handleSeeResults = useCallback(() => {
    // Advance to Step 4 (System)
    onContinue();
  }, [onContinue]);

  const handleOverlayClose = useCallback(() => {
    // 'complete' → advance to Step 4 (same as the CTA).
    // 'analysing' → dismiss overlay, analysis keeps running in the background.
    // 'error' path never opens the overlay (guarded on the `open` prop below),
    // so the customer isn't trapped in a modal with no working close — they
    // land straight on the in-page SiteSurveyFallback card, which has both
    // "Book a site survey" and "Try a different address" (→ onBack).
    if (status === 'complete') onContinue();
  }, [status, onContinue]);

  // Fix (2026-08-27) — state-aware heading + subtitle. The previous
  // static "Reading your roof…" copy stayed on screen even after
  // analysis failed, contradicting the yellow error card below and
  // making customers think analysis was still running. Copy now
  // matches the current status: analysing / complete / error.
  const headingCopy = status === 'error'
    ? { title: 'We couldn’t analyse this roof',
        subtitle: 'The auto-analyser came back empty for this address. See what to do below — a technician visit is often the fastest path to a firm quote.' }
    : status === 'complete'
    ? { title: 'Your roof analysis is ready',
        subtitle: 'We\'ve pulled roof geometry, sun-hours, and shading. Review below, then continue to see your quote.' }
    : { title: 'Reading your roof…',
        subtitle: 'We\'re pulling roof geometry, sun-hours, and shading from Google Solar or NZ LiDAR. Usually 5–30 seconds. Watch the animation while you wait.' };

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">
        Step 3 &middot; Roof analysis
      </div>
      <h2 className="font-serif text-3xl md:text-4xl mt-3 tracking-tight text-[#1A1614]">
        {headingCopy.title}
      </h2>
      <p className="mt-2 text-[#55504A] max-w-2xl">
        {headingCopy.subtitle}
      </p>

      {/* Body — under the celebration overlay. Once analysis is complete
          we surface the full Google Solar Read card + per-plane detail
          (same rich breakdown POC's AddressStage shows) so the customer
          can inspect the roof stats while the CTA pulses above them. */}
      {status === 'error' && (
        <div className="mt-8 rounded-2xl border border-[#E3D9C4] bg-white p-6 md:p-8">
          <SiteSurveyFallback error={error} diagnostics={diagnostics} address={address} onBack={onBack} />
        </div>
      )}

      {status === 'analysing' && (
        <div className="mt-8 rounded-2xl border border-[#E3D9C4] bg-white p-6 md:p-8 text-sm text-[#8F887E]">
          Analysing&nbsp;&hellip; The overlay above shows what your system will do &mdash; you can click any of the four times-of-day.
        </div>
      )}

      {status === 'complete' && pending && (
        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/60 p-4 text-sm text-emerald-900 flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-emerald-500 grid place-items-center flex-shrink-0 mt-0.5">
              <span className="text-white text-xs font-bold">&check;</span>
            </div>
            <div>
              <div className="font-bold">Roof analysis ready.</div>
              <div className="mt-0.5">Review the breakdown below, then click <strong>See my roof analysis &rarr;</strong> above to see your 3 tiered quotes.</div>
            </div>
          </div>
          {/* Full POC parity 2026-08-20 — the Google Solar Read card +
              per-plane detail collapsible pulled straight from POC's
              AddressStage. Same numbers, same UX. */}
          <div className="rounded-2xl border border-[#E3D9C4] bg-white p-6 md:p-8">
            <GoogleSolarReadCard analysis={pending} />
          </div>
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm text-[#55504A]"
        >
          <ChevronLeft className="w-4 h-4" /> Back to your address
        </button>
      </div>

      {/* EnergyFlowOverlay drives engagement during analyse + celebration
          on complete. NEVER opens on error — the celebration surface is the
          wrong control for a failure, and prior versions latched the overlay
          open with no working close on error (Bug 5, 2026-08-26). The
          SiteSurveyFallback in the page body (above) owns the error recovery
          UX with proper "Try a different address" + "Book a site survey" CTAs. */}
      <EnergyFlowOverlay
        open={!!status && status !== 'error'}
        onClose={handleOverlayClose}
        hasBattery
        hasEv
        status={status}
        elapsedMs={elapsedMs}
        resultSummary={resultSummary}
        errorMessage={error}
        onSeeResults={handleSeeResults}
      />
    </div>
  );
}

// ── I1 site-survey fallback ──────────────────────────────────────────────────
// When roof analysis fails (Google Solar + LiDAR + OSM all whiff, timeout,
// or 500), we don't lose the lead. Offer a site-survey booking instead.
function SiteSurveyFallback({ error, diagnostics, address, onBack }) {
  // Round 4-rework (2026-08-26). Tech-detail is now hidden from customer
  // by default and only rendered when `?debug=1` is in the URL — that
  // section is a QA affordance, not something a real customer should
  // see. Owner/admin can append `?debug=1` when reproducing an issue.
  const showTechnicalDetail = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('debug');
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 mt-0.5 text-amber-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-900">
            We couldn&apos;t analyse this roof automatically.
          </div>
          <div className="text-xs text-amber-800 mt-1">
            {friendlyDiagnostic(diagnostics)
              || 'This can happen for complex roofs, new-build addresses not yet in Google’s dataset, or if all three providers timed out. No problem — a technician can survey it in person and give you an exact quote.'}
          </div>
          {showTechnicalDetail && error && (
            <details className="mt-2">
              <summary className="text-xs text-amber-700 cursor-pointer">Technical detail (debug mode)</summary>
              <div className="mt-1 text-[11px] font-mono text-amber-900/80 bg-amber-100/40 rounded p-2 space-y-1">
                <div>{error.slice(0, 300)}</div>
                {diagnostics && (
                  <div className="pt-1 border-t border-amber-200/60">
                    <div>source_pipeline: {diagnostics.source_pipeline || 'n/a'}</div>
                    <div>fallback_reason: {diagnostics.fallback_reason || 'n/a'}</div>
                    {diagnostics.building_source && (
                      <div>building: {diagnostics.building_source} ({diagnostics.building_match_type}, {diagnostics.building_distance_m}m)</div>
                    )}
                    {diagnostics.building_candidates && (
                      <div>osm/linz candidates: {JSON.stringify(diagnostics.building_candidates)}</div>
                    )}
                    {diagnostics.lidar_error && <div>lidar_error: {diagnostics.lidar_error}</div>}
                  </div>
                )}
              </div>
            </details>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                // Round 4-rework (2026-08-26): route to /book-survey
                // (Cal.com booking page) instead of the legacy /get-quote
                // callback intent, which was looping the customer back
                // into the same failing quote flow. Address is passed as
                // ?notes= so the surveyor sees WHERE the failed analysis
                // was for — Cal.com's inline embed forwards `notes` into
                // the booking metadata.
                //
                // Round 4-rework followup (2026-08-26): ALSO clear the
                // sessionStorage wizard draft so that when the customer
                // returns later (Home → Get Quote → Start Quote) they
                // start from a clean slate instead of resuming the
                // failed-address analysis they just escaped. Key comes
                // from ResidentialWizard.jsx DRAFT_KEY constant.
                try {
                  window.sessionStorage?.removeItem('poc:quote:draft:v1');
                } catch { /* non-fatal — sessionStorage disabled/denied */ }
                const params = new URLSearchParams();
                if (address?.formattedAddress) {
                  params.set('notes', `Roof analysis failed for: ${address.formattedAddress}`);
                }
                const qs = params.toString();
                window.location.href = `/book-survey${qs ? '?' + qs : ''}`;
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition"
            >
              Book a site survey &rarr;
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-amber-300 text-amber-900 text-sm font-semibold hover:bg-amber-100 transition"
            >
              Try a different address
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Round 4 (2026-08-26) — translate roof_analysis_diagnostics into a
// customer-friendly sentence for the SiteSurveyFallback body. Falls back
// to the generic copy when the reason isn't one we can explain nicely.
function friendlyDiagnostic(d) {
  if (!d) return null;
  // Fix (2026-08-27) — rate-limit friendly copy.
  if (d.fallback_reason === 'daily_quote_limit') {
    return `You've explored ${d.quotes_used_today || d.max_per_day || 3} different addresses today. Come back tomorrow for more, or book a site survey now to talk to a real person about your best option.`;
  }
  if (d.fallback_reason === 'both_pipelines_failed') {
    if (d.building_source == null && d.building_candidates
        && (d.building_candidates.osm || 0) + (d.building_candidates.linz || 0) === 0) {
      return 'We couldn’t find your building in our reference maps (OSM/LINZ have no polygon for this address yet — common for new subdivisions). A technician site survey is the fastest path to an accurate quote.';
    }
    // Option B (2026-08-27) — rural / remote coverage gap. LINZ LiDAR
    // coverage exists for most NZ populated areas but has genuine gaps
    // in remote regions (e.g. Hira, Rai Valley, some Marlborough Sounds
    // + Fiordland). Google Solar also lacks imagery here. Nothing to
    // analyse online — book a site survey.
    if (/\d+\s*points?\s*above/i.test(d.lidar_error || '')
        || /RANSAC detected no roof planes/i.test(d.lidar_error || '')) {
      return 'This address is outside our automatic-analysis coverage — public roof-imagery data for this area isn’t detailed enough. A technician site visit is the accurate path to a quote here, and often faster than we can do online for rural properties.';
    }
    return 'Both roof-analysis providers came back empty for this coord. Try refining the address, or book a technician survey.';
  }
  if (d.fallback_reason === 'lidar_failed_reverted_to_stale_google') {
    return 'The LiDAR fallback couldn’t detect roof planes for this address. We’re showing Google’s older imagery result — book a site survey to confirm on the current roof.';
  }
  return null;
}

// ── Result summary shown in overlay's completion card ──────────────────────
function summarize(analysis) {
  const segs = Array.isArray(analysis?.roof?.segments) ? analysis.roof.segments : [];
  const nSegs = segs.length;
  const areaM2 = Number(analysis?.roof?.usable_roof_area_m2)
              || Number(analysis?.roof?.roof_area_m2)
              || segs.reduce((a, s) => a + (Number(s?.stats?.areaMeters2) || 0), 0);
  const source = analysis?.solar_source || analysis?.roof?.source;
  const pieces = [];
  if (nSegs > 0)  pieces.push(`${nSegs} roof plane${nSegs === 1 ? '' : 's'}`);
  if (areaM2 > 0) pieces.push(`${Math.round(areaM2)} m²`);
  if (source)     pieces.push(source.toString().toUpperCase());
  return pieces.length ? pieces.join(' · ') : 'Roof analysis ready';
}
