import { useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { publicApi } from '../services/api';
import {
  Upload, FileText, Loader2, ArrowRight, CheckCircle, AlertTriangle, ChevronDown,
  TrendingUp, Battery, Zap, Sun, Shield, Info, ArrowLeft, Phone, X,
} from 'lucide-react';
import WebsiteFooter from '../components/website/WebsiteFooter';

const fmt$ = n => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });
const fmtSign = n => (n >= 0 ? '+' : '') + fmt$(n);

const REGIONS = [
  { value: '',             label: 'Auto-detect from postcode' },
  { value: 'auckland',     label: 'Auckland' },
  { value: 'waikato',      label: 'Waikato' },
  { value: 'wellington',   label: 'Wellington' },
  { value: 'manawatu',     label: 'Manawatū' },
  { value: 'canterbury',   label: 'Canterbury' },
  { value: 'otago',        label: 'Otago' },
  { value: 'southland',    label: 'Southland' },
  { value: 'bay_of_plenty',label: 'Bay of Plenty' },
  { value: 'northland',    label: 'Northland' },
  { value: 'hawkes_bay',   label: "Hawke's Bay" },
  { value: 'tasman',       label: 'Tasman/Marlborough/Nelson' },
  { value: 'westland',     label: 'West Coast' },
];

export default function BillAnalysisPage() {
  const [files, setFiles] = useState([]);
  const [region, setRegion] = useState('');
  const [postcode, setPostcode] = useState('');
  const [email, setEmail] = useState('');
  const [stage, setStage] = useState('upload');     // upload | analysing | results | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const onDrop = useCallback((dropped) => {
    const pdfs = Array.from(dropped).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    setFiles(prev => [...prev, ...pdfs].slice(0, 12));
  }, []);

  const removeFile = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (files.length === 0) return;
    setStage('analysing');
    setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      if (region)   fd.append('region', region);
      if (postcode) fd.append('postcode', postcode);
      if (email)    fd.append('email', email);
      const { data } = await publicApi.post('/bill-analysis', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setResult(data);
      setStage('results');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setStage('error');
    }
  };

  return (
    <div className="bg-white font-body">
      <Nav />

      {stage === 'upload' && <UploadView
        files={files} setFiles={setFiles} onDrop={onDrop} removeFile={removeFile}
        region={region} setRegion={setRegion}
        postcode={postcode} setPostcode={setPostcode}
        email={email} setEmail={setEmail}
        inputRef={inputRef}
        onSubmit={submit}
      />}

      {stage === 'analysing' && <AnalysingView fileCount={files.length} />}

      {stage === 'results' && result && <ResultsView result={result} />}

      {stage === 'error' && <ErrorView error={error} onRetry={() => setStage('upload')} />}

      <WebsiteFooter />
    </div>
  );
}

// ── Nav (matches solar-packages and shop pages) ───────────────────────────
function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-4 md:px-10 h-16 flex items-center justify-between backdrop-blur-md shadow-lg shadow-black/20"
      style={{ background: 'linear-gradient(90deg, rgba(11,15,26,0.96) 0%, rgba(17,23,42,0.96) 50%, rgba(11,15,26,0.96) 100%)' }}>
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-500" />
      <Link to="/" className="flex items-center gap-3">
        <div className="bg-white rounded-xl p-1.5 shadow-lg ring-2 ring-amber-300/40">
          <img src="/logo.jpg" alt="Goldenray Energy NZ" className="h-9 md:h-11 w-auto object-contain" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-extrabold font-display tracking-tight text-white">GOLDENRAY <span className="text-amber-400">NZ</span></div>
          <div className="text-[9px] text-amber-200 italic">Sustainable Future</div>
        </div>
      </Link>
      <div className="flex items-center gap-3">
        <Link to="/" className="hidden md:block text-xs font-semibold text-white/80 hover:text-amber-300 transition">Home</Link>
        <Link to="/solar-packages" className="hidden md:block text-xs font-semibold text-white/80 hover:text-amber-300 transition">Packages</Link>
        <Link to="/#calculator" className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold flex items-center gap-1">
          <Phone size={12} /> Free Quote
        </Link>
      </div>
    </nav>
  );
}

// ── Upload state ─────────────────────────────────────────────────────────
function UploadView({ files, onDrop, removeFile, region, setRegion, postcode, setPostcode, email, setEmail, inputRef, onSubmit }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="pt-24 md:pt-32 pb-16 px-6 md:px-10 bg-gradient-to-br from-amber-50 via-white to-emerald-50 min-h-screen">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold mb-4">
            <FileText size={11} /> 100% free · No card needed · Independent advice
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold font-display leading-tight mb-3">
            See what 25 years of <span className="text-gradient-warm">your power bills</span> cost.
          </h1>
          <p className="text-sm md:text-base text-gray-500 max-w-2xl mx-auto">
            Upload 6-12 months of bills. We'll show you the 25-year cost of doing nothing,
            switching retailer, or going solar — using your real numbers, not generic estimates.
          </p>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false);
            onDrop(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`bg-white rounded-2xl border-2 border-dashed transition cursor-pointer p-8 text-center
            ${dragOver ? 'border-amber-500 bg-amber-50' : 'border-gray-300 hover:border-amber-300'}`}
        >
          <Upload size={36} className="mx-auto text-amber-500 mb-3" />
          <div className="text-sm font-bold mb-1">Drop your power bill PDFs here</div>
          <div className="text-xs text-gray-500">Or click to browse · Up to 12 PDFs · Mercury, Genesis, Contact, Meridian, Powershop supported</div>
          <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple
            onChange={e => onDrop(e.target.files)}
            className="hidden" />
        </div>

        {/* Files list */}
        {files.length > 0 && (
          <div className="mt-4 bg-white rounded-xl border border-gray-100 divide-y divide-gray-100">
            {files.map((f, i) => (
              <div key={i} className="px-4 py-2 flex items-center gap-3">
                <FileText size={14} className="text-amber-500 flex-shrink-0" />
                <span className="text-xs flex-1 truncate">{f.name}</span>
                <span className="text-[10px] text-gray-400">{Math.round(f.size / 1024)} KB</span>
                <button onClick={() => removeFile(i)} className="text-gray-300 hover:text-red-500"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Optional metadata */}
        <div className="grid md:grid-cols-3 gap-3 mt-5">
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Postcode <span className="text-gray-300 font-normal">(optional)</span></label>
            <input value={postcode} onChange={e => setPostcode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="1010" inputMode="numeric"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-xs" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Region</label>
            <select value={region} onChange={e => setRegion(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-xs bg-white">
              {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Email <span className="text-gray-300 font-normal">(optional)</span></label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="for the PDF report"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-xs" />
          </div>
        </div>

        <button
          onClick={onSubmit}
          disabled={files.length === 0}
          className="mt-6 w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-extrabold text-base disabled:opacity-40 disabled:cursor-not-allowed hover:from-amber-400 hover:to-orange-400 transition flex items-center justify-center gap-2"
        >
          {files.length === 0 ? 'Drop bills above to start' : `Analyse my ${files.length} bill${files.length > 1 ? 's' : ''}`}
          {files.length > 0 && <ArrowRight size={16} />}
        </button>

        <p className="text-[10px] text-gray-400 text-center mt-4">
          Your bills are parsed once for the analysis and not stored permanently.
          Anonymous analyses auto-delete after 90 days.
        </p>
      </div>
    </div>
  );
}

// ── Analysing state ──────────────────────────────────────────────────────
function AnalysingView({ fileCount }) {
  return (
    <div className="pt-24 md:pt-40 pb-32 px-6 text-center min-h-screen">
      <Loader2 size={48} className="mx-auto animate-spin text-amber-500 mb-4" />
      <h2 className="text-2xl font-extrabold font-display mb-2">Analysing your bills…</h2>
      <p className="text-sm text-gray-500 max-w-md mx-auto">
        Reading {fileCount} bill{fileCount > 1 ? 's' : ''} · Calculating optimal solar size · Comparing 4 future scenarios over 25 years · Checking retailer switch options
      </p>
      <div className="text-[11px] text-gray-400 mt-4">This typically takes 5-15 seconds.</div>
    </div>
  );
}

// ── Error state ─────────────────────────────────────────────────────────
function ErrorView({ error, onRetry }) {
  return (
    <div className="pt-24 md:pt-40 pb-32 px-6 text-center min-h-screen">
      <AlertTriangle size={48} className="mx-auto text-red-500 mb-4" />
      <h2 className="text-2xl font-extrabold font-display mb-2">Something went wrong</h2>
      <p className="text-sm text-gray-600 max-w-md mx-auto mb-5">{error}</p>
      <button onClick={onRetry}
        className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm">
        Try again
      </button>
    </div>
  );
}

// ── Results state — the hero ────────────────────────────────────────────
function ResultsView({ result }) {
  const [tab, setTab] = useState('comparison');
  const [showQuote, setShowQuote] = useState(false);
  const a = result.analysis;
  const doNothing = a.scenarios.find(s => s.id === 'do-nothing');
  const switchRetailer = a.scenarios.find(s => s.id === 'switch-retailer');
  const solarOnly = a.scenarios.find(s => s.id === 'solar-only');
  const solarBattery = a.scenarios.find(s => s.id === 'solar-plus-battery');
  const best = [...a.scenarios].sort((x, y) => y.net_25yr - x.net_25yr)[0];

  return (
    <div className="pt-24 md:pt-28 pb-12">
      {/* HERO — the loss-aversion lever */}
      <section className="px-6 md:px-10 pb-10 bg-gradient-to-br from-red-50 via-amber-50 to-emerald-50">
        <div className="max-w-5xl mx-auto">
          <Link to="/bill-analysis" className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-semibold mb-3 hover:text-amber-700">
            <ArrowLeft size={11} /> Run another analysis
          </Link>
          <div className="text-center mb-6">
            <div className="text-[11px] font-extrabold tracking-widest text-red-700 mb-2">DOING NOTHING COSTS YOU</div>
            <h1 className="text-4xl md:text-6xl font-extrabold font-display leading-tight mb-2 text-red-700">{fmt$(doNothing.year_25_cost)}</h1>
            <div className="text-sm text-gray-500">over the next 25 years at current rates and 5% annual electricity inflation</div>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {switchRetailer && <ScenarioBadgeCard scenario={switchRetailer} accent="blue"   doNothingCost={doNothing.year_25_cost} />}
            {solarOnly      && <ScenarioBadgeCard scenario={solarOnly}      accent="amber"  doNothingCost={doNothing.year_25_cost} />}
            {solarBattery   && <ScenarioBadgeCard scenario={solarBattery}   accent="emerald" doNothingCost={doNothing.year_25_cost} bestPick={best.id === 'solar-plus-battery'} />}
          </div>
        </div>
      </section>

      {/* Your snapshot */}
      <section className="px-6 md:px-10 py-8 bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-xl font-extrabold font-display mb-4">Your energy snapshot</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SnapshotStat label="Annual usage"  value={`${a.aggregate.annual_kwh.toLocaleString()} kWh`} />
            <SnapshotStat label="Annual spend"  value={fmt$(a.aggregate.annual_spend_nzd)} />
            <SnapshotStat label="Effective rate" value={`${(a.aggregate.effective_rate_nzd * 100).toFixed(1)}c/kWh`} />
            <SnapshotStat label="Current retailer" value={a.aggregate.retailer || '—'} sub={a.aggregate.plan_name} />
          </div>
        </div>
      </section>

      {/* TAB: comparison / patterns / transparency */}
      <section className="px-6 md:px-10 py-8 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="flex gap-1 mb-4 border-b border-gray-200">
            <TabBtn label="Compare scenarios" active={tab === 'comparison'} onClick={() => setTab('comparison')} />
            <TabBtn label="Insights" active={tab === 'patterns'} onClick={() => setTab('patterns')} count={a.patterns.length} />
            <TabBtn label="How we calculated this" active={tab === 'transparency'} onClick={() => setTab('transparency')} />
          </div>

          {tab === 'comparison'   && <ComparisonTable scenarios={a.scenarios} switchAdvice={a.switch_advice} recommendation={a.recommendation} />}
          {tab === 'patterns'     && <PatternsList patterns={a.patterns} switchAdvice={a.switch_advice} />}
          {tab === 'transparency' && <TransparencyView t={a.transparency} />}
        </div>
      </section>

      {/* Recommendation + CTA */}
      <section className="px-6 md:px-10 py-12 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-[11px] font-extrabold tracking-widest text-amber-100 mb-2">RECOMMENDED FOR YOUR HOUSEHOLD</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display mb-2">
            {a.recommendation.recommended_system_kw} kW
            {a.recommendation.recommended_battery_kwh > 0 && ` + ${a.recommendation.recommended_battery_kwh} kWh battery`}
          </h2>
          <p className="text-sm text-amber-50 mb-1">
            Based on {a.aggregate.annual_kwh.toLocaleString()} kWh/year usage in {a.region}.
          </p>
          {best.upfront_cost > 0 && (
            <p className="text-sm text-amber-50 mb-5">
              25-year net gain: <span className="font-extrabold">{fmt$(best.net_25yr)}</span> · Payback {best.payback_years} yrs
            </p>
          )}
          <button onClick={() => setShowQuote(true)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-amber-600 font-extrabold text-sm hover:bg-amber-50 transition">
            Get a custom quote based on this analysis <ArrowRight size={14} />
          </button>
          <div className="mt-3">
            {a.recommendation.recommended_package_slug && (
              <Link to={`/solar-packages/${a.recommendation.recommended_package_slug}`}
                className="text-[12px] text-amber-100 underline hover:text-white">
                Or view the matching package →
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="px-6 md:px-10 py-6 bg-gray-50 border-t border-gray-200">
        <div className="max-w-4xl mx-auto text-[10px] text-gray-500 leading-relaxed">
          <strong>Disclaimer:</strong> {a.transparency.disclaimer}
        </div>
      </section>

      {showQuote && <PromoteToQuoteModal analysisId={result.id} recommendation={a.recommendation} onClose={() => setShowQuote(false)} />}
    </div>
  );
}

// ── Hero scenario badge cards (the 3 alternatives next to "do nothing") ──
function ScenarioBadgeCard({ scenario, accent, doNothingCost, bestPick }) {
  const colors = {
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    border: 'border-blue-200', accent: 'bg-blue-500' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200', accent: 'bg-amber-500' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', accent: 'bg-emerald-500' },
  }[accent];

  const saving = doNothingCost - scenario.year_25_cost;
  return (
    <div className={`relative bg-white rounded-2xl border-2 p-5 ${colors.border}`}>
      {bestPick && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-extrabold tracking-wide whitespace-nowrap shadow-md">
          BEST 25-YR NET
        </div>
      )}
      <div className={`text-[10px] font-extrabold tracking-widest ${colors.text} mb-1`}>OPTION</div>
      <div className="text-sm font-bold mb-2">{scenario.label}</div>
      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div>
          <div className="text-[9px] text-gray-400 uppercase">25-yr cost</div>
          <div className="font-extrabold">{fmt$(scenario.year_25_cost)}</div>
        </div>
        <div>
          <div className="text-[9px] text-gray-400 uppercase">vs do nothing</div>
          <div className={`font-extrabold ${saving > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{saving > 0 ? `save ${fmt$(saving)}` : '—'}</div>
        </div>
      </div>
      {scenario.upfront_cost > 0 && (
        <div className="text-[10px] text-gray-500">
          Upfront {fmt$(scenario.upfront_cost)} · Payback {scenario.payback_years} yrs
        </div>
      )}
      {scenario.upfront_cost === 0 && (
        <div className="text-[10px] text-emerald-600 font-semibold">No upfront cost</div>
      )}
    </div>
  );
}

// ── Snapshot stat tile ─────────────────────────────────────────────────
function SnapshotStat({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 text-center">
      <div className="text-[9px] text-gray-400 uppercase tracking-wide font-bold mb-1">{label}</div>
      <div className="text-base font-extrabold">{value}</div>
      {sub && <div className="text-[9px] text-gray-400 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function TabBtn({ label, active, onClick, count }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-xs font-semibold border-b-2 transition flex items-center gap-1.5
        ${active ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
      {label}
      {count != null && count > 0 && (
        <span className="text-[9px] bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">{count}</span>
      )}
    </button>
  );
}

// ── Comparison table ───────────────────────────────────────────────────
function ComparisonTable({ scenarios, switchAdvice, recommendation }) {
  const orderedIds = ['do-nothing', 'switch-retailer', 'solar-only', 'solar-plus-battery'];
  const ordered = orderedIds.map(id => scenarios.find(s => s.id === id)).filter(Boolean);
  const best = [...scenarios].sort((a, b) => b.net_25yr - a.net_25yr)[0];

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-400 uppercase">Option</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">Upfront</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">Year 1</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">Year 25</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">Payback</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">25-yr Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {ordered.map(s => (
            <tr key={s.id} className={best.id === s.id ? 'bg-emerald-50/40' : ''}>
              <td className="px-3 py-3">
                <div className="font-bold">{s.label}</div>
                {s.id === 'switch-retailer' && switchAdvice && (
                  <div className="text-[9px] text-blue-600 mt-0.5">Save {fmt$(switchAdvice.annualSaving)}/yr starting day one</div>
                )}
              </td>
              <td className="px-3 py-3 text-right">{s.upfront_cost === 0 ? '—' : fmt$(s.upfront_cost)}</td>
              <td className="px-3 py-3 text-right">
                <div className="font-semibold">{fmt$(s.year_1_cost)}</div>
                {s.year_1_cost_range && (
                  <div className="text-[9px] text-gray-400">{fmt$(s.year_1_cost_range.low)} – {fmt$(s.year_1_cost_range.high)}</div>
                )}
              </td>
              <td className="px-3 py-3 text-right font-semibold">{fmt$(s.year_25_cost)}</td>
              <td className="px-3 py-3 text-right">{s.payback_years === null ? <span className="text-red-500 font-semibold">never</span> : s.payback_years === 0 ? <span className="text-emerald-600 font-semibold">0 (free)</span> : `${s.payback_years} yrs`}</td>
              <td className={`px-3 py-3 text-right font-extrabold ${s.net_25yr > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {fmtSign(s.net_25yr)}
                {best.id === s.id && <span className="ml-1 text-[9px] bg-emerald-500 text-white px-1 py-0.5 rounded">BEST</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Patterns / behavioural insights ──────────────────────────────────────
function PatternsList({ patterns, switchAdvice }) {
  if (patterns.length === 0 && !switchAdvice) {
    return <div className="text-center py-8 text-sm text-gray-400">No specific patterns detected — your usage looks typical for an NZ household.</div>;
  }
  const sevColors = {
    info:     'bg-blue-50 text-blue-700 border-blue-200',
    warning:  'bg-amber-50 text-amber-700 border-amber-200',
    positive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return (
    <div className="space-y-3">
      {switchAdvice && (
        <div className="bg-white rounded-xl border-2 border-blue-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-blue-600" />
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-blue-700">Switch retailer (independent advice)</div>
          </div>
          <div className="text-sm font-bold mb-1">Switch to {switchAdvice.retailerName} {switchAdvice.planName}</div>
          <div className="text-xs text-gray-600">Save approximately <strong>{fmt$(switchAdvice.annualSaving)}/year</strong> based on your usage profile — before you do anything else. We don't earn commission from this; it's just what the numbers say.</div>
        </div>
      )}
      {patterns.map((p, i) => (
        <div key={i} className={`rounded-xl border p-4 ${sevColors[p.severity] || sevColors.info}`}>
          <div className="text-sm font-bold mb-1">{p.label}</div>
          <div className="text-xs mb-2">{p.details}</div>
          <div className="text-[11px] italic">{p.recommendation}</div>
        </div>
      ))}
    </div>
  );
}

// ── Transparency view ────────────────────────────────────────────────────
function TransparencyView({ t }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Info size={14} className="text-amber-500" />
          <div className="text-sm font-bold">Confidence in this analysis: <span className="text-amber-600 uppercase">{t.overall_confidence}</span></div>
        </div>
        <div className="text-xs text-gray-600 mb-3">{t.confidence_explanation}</div>
        <div className="text-[11px] text-gray-500">Data current as of {t.as_of} · Next refresh due {t.next_data_refresh_due}</div>
      </div>

      <CollapsibleSection title="Data sources" count={t.data_sources.length}>
        <ul className="space-y-2 text-xs">
          {t.data_sources.map((s, i) => (
            <li key={i} className="flex flex-col">
              <span className="font-semibold">{s.name}</span>
              <span className="text-gray-500">{s.source}</span>
              {s.value_used && <span className="text-amber-600 font-mono text-[10px]">value used: {s.value_used}</span>}
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Key assumptions" count={t.assumptions.length}>
        <ul className="space-y-2 text-xs">
          {t.assumptions.map((a, i) => (
            <li key={i}>
              <div className="font-semibold">{a.label} = <span className="font-mono">{typeof a.value === 'number' && a.value < 1 && a.value > 0 ? (a.value * 100).toFixed(1) + '%' : a.value}</span></div>
              <div className="text-gray-500">Basis: {a.basis}</div>
              {a.why_matters && <div className="text-amber-600 italic">Why it matters: {a.why_matters}</div>}
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Known limitations" count={t.limitations.length}>
        <ul className="space-y-3 text-xs">
          {t.limitations.map((l, i) => {
            const sev = { high: 'red', medium: 'amber', low: 'gray' }[l.severity] || 'gray';
            return (
              <li key={i} className={`p-3 rounded-lg bg-${sev}-50 border border-${sev}-200`}>
                <div className="font-semibold">[{l.severity}] {l.label}</div>
                <div className="text-gray-700 mt-1">{l.impact}</div>
                {l.mitigation && <div className="text-emerald-700 italic mt-1">→ {l.mitigation}</div>}
              </li>
            );
          })}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Methodology">
        <div className="text-xs text-gray-700">{t.methodology_summary}</div>
        <div className="text-xs text-gray-500 mt-2">Sensitivity basis: {t.sensitivity.basis}</div>
      </CollapsibleSection>
    </div>
  );
}

function CollapsibleSection({ title, count, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition">
        <div className="text-sm font-bold flex items-center gap-2">
          {title}
          {count != null && <span className="text-[9px] bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">{count}</span>}
        </div>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ── Promote-to-quote modal ──────────────────────────────────────────────
function PromoteToQuoteModal({ analysisId, recommendation, onClose }) {
  const nav = useNavigate();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', address: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!form.email && !form.phone) { setError('Email or phone required.'); return; }
    setBusy(true); setError('');
    try {
      await publicApi.post(`/bill-analysis/${analysisId}/promote-to-quote`, form);
      // Navigate to the matching package detail page (or homepage form)
      if (recommendation.recommended_package_slug) {
        nav(`/solar-packages/${recommendation.recommended_package_slug}?from=bill-analysis`);
      } else {
        nav('/#calculator');
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold font-display mb-1">Get your custom quote</h3>
        <p className="text-xs text-gray-500 mb-4">Just your contact details — we'll come back within one business day with a tailored proposal based on your bill analysis.</p>

        {error && <div className="px-3 py-2 mb-3 bg-red-50 border border-red-200 rounded text-xs text-red-600">{error}</div>}

        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
              placeholder="First name" className="px-3 py-2 rounded-lg border border-gray-200 text-xs" />
            <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
              placeholder="Last name" className="px-3 py-2 rounded-lg border border-gray-200 text-xs" />
          </div>
          <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="Email *" className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs" />
          <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="Phone (optional)" className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs" />
          <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            placeholder="Address (optional)" className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs" />
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-50">
            {busy ? 'Sending…' : 'Get my quote'}
          </button>
        </div>
      </div>
    </div>
  );
}
