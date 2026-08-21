// Step1Usage — the merged 5-step flow's first screen (B1.2, 2026-08-20).
//
// Three tabs, one screen, no wizard-step transition between them:
//   [I have bills]       — PDF upload → /api/bills/extract → parsed kWh
//                          + extracted address (feeds Step 2 pre-populate).
//   [I know my spend]    — monthly-$ slider, derives annual kWh.
//   [I know my usage]    — annual-kWh direct input.
//
// Estimate warning banner (I6) shows on spend + kWh tabs — ±30% accuracy
// with a nudge to upload a bill for exact quotes. Bias sizing DOWN on these
// paths (handled server-side once /api/quote/submit-with-design gets called).
//
// Contact info is NOT collected here — that's Step 5 (F1 contact-late).

import { useState, useRef, useCallback } from 'react';
import {
  Upload, FileText, Loader2, CheckCircle, AlertTriangle, ChevronLeft,
  DollarSign, Zap, Info,
} from 'lucide-react';
import { publicApi } from '../../services/api';
import { BillDetailCard } from '../poc/QuotePage.jsx';

const TABS = [
  { key: 'bills', label: 'I have a bill',        icon: FileText,   accuracy: 'Most accurate' },
  { key: 'spend', label: 'I know my $/month',    icon: DollarSign, accuracy: '±30% accuracy' },
  { key: 'kwh',   label: 'I know my kWh/year',   icon: Zap,        accuracy: '±20% accuracy' },
];

// NZ residential kWh/spend heuristic: ~32c/kWh incl. daily fixed. Reverse-
// engineered from typical retailer plans. Used only as a default slider seed.
const NZ_ROUGH_RATE_PER_KWH = 0.32;

/**
 * Step1Usage — main screen container. Fully controlled by parent (ResidentialWizard).
 *
 * @param {object}   props
 * @param {object}   props.usage        — { tab, bill, monthlySpend, annualKwh, extractedAddress }
 * @param {function} props.onChange     — replace usage state
 * @param {function} props.onContinue   — advance to Step 2 (parent handles it)
 * @param {function} props.onBack       — return to GetQuotePage intent picker
 */
export default function Step1Usage({ usage, onChange, onContinue, onBack }) {
  const setTab = useCallback((tab) => onChange({ ...usage, tab }), [usage, onChange]);
  const setBill = useCallback((bill) => {
    const kwhPerYear = bill?.kwh_total && bill?.days_in_period
      ? Math.round((bill.kwh_total / bill.days_in_period) * 365)
      : null;
    onChange({
      ...usage,
      bill,
      annualKwh: kwhPerYear,
      extractedAddress: bill?.service_address || null,
      extractedPostcode: bill?.service_postcode || null,
    });
  }, [usage, onChange]);
  const setSpend = useCallback((monthlySpend) => onChange({
    ...usage,
    monthlySpend,
    // Live-derive annual kWh so downstream steps don't need to recompute.
    annualKwh: Math.round((monthlySpend * 12) / NZ_ROUGH_RATE_PER_KWH),
  }), [usage, onChange]);
  const setKwh = useCallback((annualKwh) => onChange({ ...usage, annualKwh }), [usage, onChange]);

  const isValid =
    (usage.tab === 'bills' && usage.bill && usage.annualKwh > 0) ||
    (usage.tab === 'spend' && (usage.monthlySpend || 0) >= 50) ||
    (usage.tab === 'kwh'   && (usage.annualKwh || 0) >= 500);

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">
        Step 1 &middot; Your usage
      </div>
      <h2 className="font-serif text-3xl md:text-4xl mt-3 tracking-tight text-[#1A1614]">
        How much power do you use?
      </h2>
      <p className="mt-2 text-[#55504A] max-w-2xl">
        Pick the input you have handy. Bills give us the exact numbers; slider estimates work when you don&apos;t have one nearby.
      </p>

      {/* Tab picker */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TABS.map((t) => {
          const active = usage.tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={`text-left rounded-xl border-2 p-4 transition ${
                active
                  ? 'border-[#D9531E] bg-[#FFF7F0] shadow-md shadow-orange-500/10'
                  : 'border-[#E3D9C4] bg-white hover:border-[#C4A57A] hover:bg-[#FBF7F0]'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${
                  active ? 'bg-[#D9531E] text-white' : 'bg-[#F4EEE1] text-[#8F887E]'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className={`text-[10px] uppercase tracking-wider font-bold ${
                  active ? 'text-[#D9531E]' : 'text-[#8F887E]'
                }`}>
                  {t.accuracy}
                </div>
              </div>
              <div className={`mt-2 text-sm font-semibold ${active ? 'text-[#1A1614]' : 'text-[#55504A]'}`}>
                {t.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="mt-6 rounded-2xl border border-[#E3D9C4] bg-white p-6 md:p-8">
        {usage.tab === 'bills' && (
          <BillsTab bill={usage.bill} onBill={setBill} />
        )}
        {usage.tab === 'spend' && (
          <SpendTab monthlySpend={usage.monthlySpend} onChange={setSpend} />
        )}
        {usage.tab === 'kwh' && (
          <KwhTab annualKwh={usage.annualKwh} onChange={setKwh} />
        )}
      </div>

      {/* I6 estimate warning — spend + kWh tabs only */}
      {(usage.tab === 'spend' || usage.tab === 'kwh') && <EstimateWarning />}

      {/* Actions */}
      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm text-[#55504A]"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onContinue}
          disabled={!isValid}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next: Your house &rarr;
        </button>
      </div>
    </div>
  );
}

// ── Tab: bill upload → /api/bills/extract ────────────────────────────────
function BillsTab({ bill, onBill }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const uploadFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Please upload a PDF bill. Photos and screenshots aren’t supported yet.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('bill', file);
      const { data } = await publicApi.post('/bills/extract', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      });
      onBill(data);
    } catch (e) {
      setUploadError(e.response?.data?.error || e.message || 'Bill parse failed.');
    } finally {
      setUploading(false);
    }
  };

  if (bill) {
    return (
      <div>
        {/* Header row — parse success chip + Change-file button */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-100 grid place-items-center flex-shrink-0">
            <CheckCircle className="w-5 h-5 text-emerald-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[#1A1614]">
              Bill parsed &mdash; {bill.retailer || 'unknown retailer'}
            </div>
            <div className="text-xs text-[#8F887E] mt-0.5">
              Everything looks right? Continue to design your system.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onBill(null)}
            className="text-xs text-[#D9531E] font-semibold hover:underline whitespace-nowrap"
          >
            Change file
          </button>
        </div>

        {/* Full POC parity 2026-08-20 — the same 16-field bill detail
            grid + tariff panel + confidence banner + parser diagnostics
            that POC's ExtractStage shows. Reused from BillDetailCard. */}
        <BillDetailCard bill={bill} />

        {bill.service_address && (
          <div className="mt-4 flex items-start gap-2 text-xs text-[#5C8B4A] bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              Address extracted from your bill &mdash; you&apos;ll confirm it on the next step.
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => uploadFile(e.target.files?.[0])}
      />
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (uploading) return;
          uploadFile(e.dataTransfer.files?.[0]);
        }}
        className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition
          ${dragOver ? 'border-[#D9531E] bg-[#FFF7F0]' : 'border-[#E3D9C4] hover:border-[#D9531E] hover:bg-[#FBF7F0]'}
          ${uploading ? 'opacity-70 cursor-wait' : ''}
        `}
      >
        <div className="mx-auto w-12 h-12 rounded-full bg-[#F4EEE1] grid place-items-center">
          {uploading
            ? <Loader2 className="w-5 h-5 animate-spin text-[#D9531E]" />
            : <Upload className="w-5 h-5 text-[#D9531E]" />}
        </div>
        <div className="mt-3 font-semibold text-[#1A1614]">
          {uploading ? 'Reading your bill…' : 'Drop your latest power bill here'}
        </div>
        <div className="mt-1 text-sm text-[#8F887E]">
          {uploading ? 'Parsing kWh, tariff, and address…' : 'Or click to browse · PDF only'}
        </div>
      </div>
      {uploadError && (
        <div className="mt-4 flex items-start gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>{uploadError}</div>
        </div>
      )}
    </div>
  );
}

// ── Tab: monthly spend slider ────────────────────────────────────────────────
function SpendTab({ monthlySpend, onChange }) {
  const value = Number.isFinite(monthlySpend) ? monthlySpend : 250;
  const derivedAnnualKwh = Math.round((value * 12) / NZ_ROUGH_RATE_PER_KWH);

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#8F887E] font-semibold">
        Roughly how much do you spend on power each month?
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="font-serif text-4xl md:text-5xl text-[#1A1614]">
          ${value.toLocaleString('en-NZ')}
        </div>
        <div className="text-sm text-[#8F887E]">/ month</div>
      </div>
      <input
        type="range"
        min={50}
        max={800}
        step={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-4 w-full accent-[#D9531E]"
        aria-label="Monthly power spend"
      />
      <div className="flex justify-between text-xs text-[#8F887E] font-mono">
        <span>$50</span>
        <span>$800+</span>
      </div>
      <div className="mt-4 text-sm text-[#55504A]">
        Roughly <strong className="text-[#1A1614]">{derivedAnnualKwh.toLocaleString('en-NZ')} kWh/year</strong>
        {' '}(at NZ residential rate ~{Math.round(NZ_ROUGH_RATE_PER_KWH * 100)}c/kWh).
      </div>
    </div>
  );
}

// ── Tab: annual kWh direct input ─────────────────────────────────────────────
function KwhTab({ annualKwh, onChange }) {
  const value = Number.isFinite(annualKwh) && annualKwh > 0 ? annualKwh : 7500;
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#8F887E] font-semibold">
        How many kWh do you use per year?
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="font-serif text-4xl md:text-5xl text-[#1A1614]">
          {value.toLocaleString('en-NZ')}
        </div>
        <div className="text-sm text-[#8F887E]">kWh / year</div>
      </div>
      <input
        type="range"
        min={2000}
        max={30000}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-4 w-full accent-[#D9531E]"
        aria-label="Annual kWh usage"
      />
      <div className="flex justify-between text-xs text-[#8F887E] font-mono">
        <span>2,000</span>
        <span>30,000+</span>
      </div>
      <div className="mt-4 text-sm text-[#55504A]">
        Typical NZ 4-person home uses <strong>~7,500 kWh/yr</strong>. Large homes with heat-pumps + hot water hit 15,000+.
      </div>
    </div>
  );
}

// ── I6 warning: estimate-mode disclaimer ─────────────────────────────────────
function EstimateWarning() {
  return (
    <div className="mt-4 flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" />
      <div>
        <div className="font-semibold">Estimates are ±30% accurate.</div>
        <div className="mt-0.5 text-xs">
          For an exact quote, upload a bill in the <em>I have a bill</em> tab. We&apos;ll bias sizing slightly down on estimates so we don&apos;t over-quote.
        </div>
      </div>
    </div>
  );
}

// ── Tiny helper ──────────────────────────────────────────────────────────────
function Stat({ label, value, truncate = false }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#8F887E] font-semibold">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold text-[#1A1614] ${truncate ? 'truncate' : ''}`} title={truncate ? value : undefined}>
        {value}
      </div>
    </div>
  );
}
