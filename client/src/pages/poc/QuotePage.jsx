// POC — new public quote flow.
//
// Route: /poc/quote (unlinked from any other page — reachable by direct URL only).
// Not shared with /get-quote — this is a standalone spike to validate the new UX:
//   Slice 1: bill upload → regex extract → display extracted fields  ← WE ARE HERE
//   Slice 2: address confirm on LINZ aerial + Google Solar geometry
//   Slice 3: Streetview + roof material picker
//   Slice 4: engine → three-tier proposal with panels drawn on roof
//
// Server-side counterpart: server/routes/poc/bill.js
//                          (mounted from server/app.js behind ENABLE_POC=true)

import { useState, useRef } from 'react';
import { publicApi } from '../../services/api';
import {
  Upload, FileText, Loader2, CheckCircle, AlertTriangle, Sparkles, RefreshCw,
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

export default function QuotePage() {
  const [stage, setStage] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [bill, setBill] = useState(null);

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

  const reset = () => {
    setBill(null);
    setUploadError(null);
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
          <ExtractStage bill={bill} onReset={reset} onContinue={() => alert('Slice 2 not built yet — that\'s the LINZ aerial + Google Solar step. Coming next.')} />
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

function ExtractStage({ bill, onReset, onContinue }) {
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

      {/* Actions */}
      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex flex-wrap items-center gap-3">
        <button onClick={onReset} className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm">
          <RefreshCw className="w-4 h-4" /> Try another bill
        </button>
        <div className="flex-1" />
        <button
          onClick={onContinue}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20"
        >
          <Sparkles className="w-4 h-4" />
          Looks right — continue to map (Slice 2)
        </button>
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
