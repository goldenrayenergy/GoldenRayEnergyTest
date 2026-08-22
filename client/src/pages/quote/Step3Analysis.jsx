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
        const status = e.response?.status ? ` [HTTP ${e.response.status}]` : '';
        const bodyMsg = typeof e.response?.data === 'string'
          ? e.response.data.slice(0, 300)
          : (e.response?.data?.error || e.message || 'Roof analysis failed.');
        setError(`${bodyMsg}${status}`);
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
    // Skip on 'complete' commits (advance to Step 4). Skip on 'analysing'
    // just dismisses the overlay but leaves analysis running. Skip on
    // 'error' → the site-survey I1 fallback stays on-screen as body.
    if (status === 'complete') onContinue();
    // else: leave overlay dismissable but analysis continues (rare path)
  }, [status, onContinue]);

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">
        Step 3 &middot; Roof analysis
      </div>
      <h2 className="font-serif text-3xl md:text-4xl mt-3 tracking-tight text-[#1A1614]">
        Reading your roof…
      </h2>
      <p className="mt-2 text-[#55504A] max-w-2xl">
        We&apos;re pulling roof geometry, sun-hours, and shading from Google Solar or NZ LiDAR. Usually 5&ndash;30&nbsp;seconds. Watch the animation while you wait.
      </p>

      {/* Body — under the celebration overlay. Once analysis is complete
          we surface the full Google Solar Read card + per-plane detail
          (same rich breakdown POC's AddressStage shows) so the customer
          can inspect the roof stats while the CTA pulses above them. */}
      {status === 'error' && (
        <div className="mt-8 rounded-2xl border border-[#E3D9C4] bg-white p-6 md:p-8">
          <SiteSurveyFallback error={error} address={address} onBack={onBack} />
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

      {/* The star of the show — EnergyFlowOverlay drives engagement */}
      <EnergyFlowOverlay
        open={!!status}
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
function SiteSurveyFallback({ error, address, onBack }) {
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 mt-0.5 text-amber-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-900">
            We couldn&apos;t analyse this roof automatically.
          </div>
          <div className="text-xs text-amber-800 mt-1">
            This can happen for complex roofs, new-build addresses not yet in Google&apos;s dataset, or if all three providers timed out. No problem &mdash; a technician can survey it in person and give you an exact quote.
          </div>
          {error && (
            <details className="mt-2">
              <summary className="text-xs text-amber-700 cursor-pointer">Technical detail</summary>
              <div className="mt-1 text-[11px] font-mono text-amber-900/80 bg-amber-100/40 rounded p-2">
                {error.slice(0, 300)}
              </div>
            </details>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                // Book a site survey — take the customer to the legacy
                // /get-quote wizard callback intent so a rep phones them.
                // Passes the confirmed address as a URL param so the rep sees
                // it in the CRM.
                const params = new URLSearchParams({
                  type: 'residential',
                  intent: 'callback',
                });
                if (address?.formattedAddress) {
                  params.set('address', address.formattedAddress);
                }
                window.location.href = `/get-quote?${params.toString()}`;
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
