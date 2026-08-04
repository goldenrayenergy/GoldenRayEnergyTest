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
//   server/routes/poc/bill.js  — POST /api/poc/bill/extract
//   server/routes/poc/roof.js  — POST /api/poc/roof/analyse
//                                 GET  /api/poc/aerial/tile?z=&x=&y=
//   (mounted from server/app.js behind ENABLE_POC=true)

import { useState, useRef, useEffect, useMemo } from 'react';
import { publicApi } from '../../services/api';
import {
  Upload, FileText, Loader2, CheckCircle, AlertTriangle, Sparkles, RefreshCw,
  MapPin, Home, Sun, LayoutGrid, ArrowLeft, Search, X,
} from 'lucide-react';

// ── stage labels ──
const STAGES = [
  { key: 'upload',   title: 'Your bill'  },
  { key: 'extract',  title: 'Confirm'    },
  { key: 'address',  title: 'Your home'  },      // Slice 2
  { key: 'material', title: 'Roof type'  },      // Slice 3
  { key: 'design',   title: 'Design'     },      // Slice 4
  { key: 'quote',    title: 'Your quote' },      // Slice 4
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
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [confirmedPlace, setConfirmedPlace] = useState(null); // { place_id, formattedAddress }
  const [material, setMaterial] = useState(null);              // 'metal' | 'tile' | 'unsure'

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
      const { data } = await publicApi.post('/poc/bill/extract', fd, {
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

  const analyseAddress = async () => {
    if (!confirmedPlace?.place_id) {
      setAnalysisError('Pick your address from the suggestions dropdown first — that gives us the exact coordinates Google Maps uses.');
      return;
    }
    setAnalysisError(null);
    setAnalysing(true);
    try {
      const { data } = await publicApi.post('/poc/roof/analyse', {
        place_id: confirmedPlace.place_id,
      });
      setAnalysis(data);
      setStage('address');
    } catch (e) {
      setAnalysisError(e.response?.data?.error || e.message || 'Roof analysis failed.');
    } finally {
      setAnalysing(false);
    }
  };

  const reset = () => {
    setBill(null);
    setAnalysis(null);
    setConfirmedPlace(null);
    setMaterial(null);
    setUploadError(null);
    setAnalysisError(null);
    setStage('upload');
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

      {/* Progress rail */}
      {stage !== 'upload' && <ProgressRail current={stage} />}

      {/* Main */}
      <main className="max-w-5xl mx-auto px-6 md:px-10 py-12 md:py-16">
        {stage === 'upload' && (
          <UploadStage
            uploading={uploading}
            uploadError={uploadError}
            onFile={handleFile}
          />
        )}
        {stage === 'extract' && bill && (
          <ExtractStage
            bill={bill}
            onReset={reset}
            onContinue={analyseAddress}
            analysing={analysing}
            analysisError={analysisError}
            confirmedPlace={confirmedPlace}
            onPlaceConfirmed={setConfirmedPlace}
          />
        )}
        {stage === 'address' && analysis && (
          <AddressStage
            analysis={analysis}
            onBack={() => setStage('extract')}
            onConfirm={() => setStage('material')}
          />
        )}
        {stage === 'material' && analysis && (
          <MaterialStage
            analysis={analysis}
            material={material}
            onPick={setMaterial}
            onBack={() => setStage('address')}
            onConfirm={() => alert(`Slice 4 not built yet — engine + 3-tier proposal will use material=${material}.`)}
          />
        )}
      </main>
    </div>
  );
}

// ── Progress rail ─────────────────────────────────────────────────────────────

function ProgressRail({ current }) {
  const idx = STAGES.findIndex(s => s.key === current);
  return (
    <div className="border-b border-[#E3D9C4] bg-[#FBF7F0] px-6 md:px-10 py-4">
      <div className="max-w-5xl mx-auto flex gap-1">
        {STAGES.map((s, i) => {
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

function UploadStage({ uploading, uploadError, onFile }) {
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
      </div>
    </div>
  );
}

// ── Stage 1: Extraction review ────────────────────────────────────────────────

function ExtractStage({ bill, onReset, onContinue, analysing, analysisError, confirmedPlace, onPlaceConfirmed }) {
  const method = bill.parse_method;
  const conf = Math.round((bill.ocr_confidence || 0) * 100);
  const hasErrors = (bill.parse_errors || []).length > 0;
  const hasWarnings = (bill.parse_warnings || []).length > 0;

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

      {/* File info */}
      <div className="mt-6 flex items-center gap-3 text-sm text-[#55504A]">
        <FileText className="w-4 h-4" />
        <span className="font-mono">{bill.file.name}</span>
        <span className="text-[#8F887E]">·</span>
        <span>{(bill.file.size_bytes / 1024).toFixed(0)} KB</span>
        <span className="text-[#8F887E]">·</span>
        <span>parse method: <code className="font-mono">{method}</code></span>
      </div>

      {/* Data grid */}
      <div className="mt-8 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
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
        className={`mt-8 flex items-start gap-4 p-6 rounded-2xl border ${
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
              ? 'Some fields missing — regex parser only, no AI fallback in POC. Continue if the important numbers look right.'
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
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Analysing your roof…</>
            : <><Sparkles className="w-4 h-4" /> Analyse my roof</>}
        </button>
      </div>
    </div>
  );
}

// ── Places Autocomplete widget ────────────────────────────────────────────
// Debounced input that hits /api/poc/places/autocomplete. When user picks a
// suggestion, we fetch details for the exact lat/lng and hand the parent
// a { place_id, formattedAddress, latitude, longitude }. sessionToken is
// generated once per widget mount and reused across all autocomplete calls
// + the details fetch — Google bills that as one search session (cheaper).
function PlacesAutocomplete({ initial, confirmedPlace, onConfirm }) {
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
        const { data } = await publicApi.get('/poc/places/autocomplete', {
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
      const { data } = await publicApi.get('/poc/places/details', {
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

// ── Stage 2: Address confirm on LINZ aerial + Google Solar geometry ──────────

function AddressStage({ analysis, onBack, onConfirm }) {
  const { aerial, roof, imagery, formattedAddress, coords, solar_source, used_quality, geocode_quality } = analysis;
  const isMock = solar_source === 'mock';

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
        Same satellite imagery Google Maps shows for this address. Google Solar analysed the roof separately.
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
        {/* Aerial */}
        <div>
          <GoogleAerial aerial={aerial} coords={coords} />
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

          {/* Per-plane detail */}
          {Array.isArray(roof.segments) && roof.segments.length > 0 && (
            <details className="mt-4 border border-[#E3D9C4] rounded-xl overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 bg-[#F4EEE1] text-sm font-semibold">
                Per-plane detail ({roof.segments.length} planes)
              </summary>
              <div className="p-3 space-y-2">
                {roof.segments.map((s, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 text-xs font-mono tabular-nums px-2 py-1 bg-[#FBF7F0] rounded">
                    <div><span className="text-[#8F887E]">#{i + 1}</span></div>
                    <div>{s.pitchDegrees?.toFixed(1) || '—'}° pitch</div>
                    <div>{s.azimuthDegrees?.toFixed(0) || '—'}° az</div>
                    <div>{s.stats?.areaMeters2?.toFixed(1) || '—'} m²</div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex-1" />
        <button className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm">
          No, wrong address
        </button>
        <button
          onClick={onConfirm}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20"
        >
          <CheckCircle className="w-4 h-4" /> Yes, that&apos;s my house
        </button>
      </div>
    </div>
  );
}

// Google Static Maps satellite — same imagery Google Maps shows when the
// customer searches their address. Server proxies the image so the API key
// stays hidden. Marker is baked into the URL server-side, so the pin is
// pixel-perfect on the geocoded coord (Google composes it).
function GoogleAerial({ aerial, coords }) {
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

function MaterialStage({ analysis, material, onPick, onBack, onConfirm }) {
  const { coords, formattedAddress } = analysis;
  const [svError, setSvError] = useState(null);

  const svUrl = `/api/poc/aerial/streetview?lat=${coords.latitude}&lng=${coords.longitude}&size=640x480&pitch=15`;

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

      {/* Actions */}
      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex-1" />
        <button
          onClick={onConfirm}
          disabled={!material}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
          title={!material ? 'Pick a roof material first' : ''}
        >
          <Sparkles className="w-4 h-4" />
          Design my system
        </button>
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
