// /get-quote — Option 6 Buyer path wizard.
//
// Phase 6.2 (this file): Steps 1 (intent picker) + 2 (branches per intent)
//   fully functional. Step 3 (projection) and Step 4 (contact form) are
//   functional placeholders — they show the layout + Next buttons but
//   don't yet call the scenario engine or submit to the backend.
//   Phase 6.3 wires those in.
//
// The wizard state lives entirely in this component. When the customer
// reaches Step 4 and submits, all three branches converge on a single
// canonical submission (handled in Phase 6.3) — same lead in CRM regardless
// of which intent they started with.

import { useState, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Upload, FileText, Zap, Phone, X, CheckCircle,
  Construction, Info,
} from 'lucide-react';
import WebsiteNav from '../components/website/WebsiteNav';
import WebsiteFooter from '../components/website/WebsiteFooter';

// ────────────────────────────────────────────────────────────────────────────

export default function GetQuotePage() {
  const [searchParams] = useSearchParams();
  const prefilledPackage = searchParams.get('package');

  const [step, setStep] = useState(1);
  const [intent, setIntent] = useState(null);                // 'bills' | 'estimate' | 'callback'

  // Door A (bills) state
  const [files, setFiles] = useState([]);
  const filesInputRef = useRef(null);

  // Door B (estimate) state
  const [estimate, setEstimate] = useState({
    monthly_spend: 250,
    retailer:      'mercury',
    postcode:      '',
    household:     '3-4',
    battery_interest: 'considering',
  });

  // ── Navigation ──
  function next() {
    if (step === 1) return setStep(2);
    if (step === 2) {
      // Callback branch skips Step 3 (no projection) → straight to Step 4
      if (intent === 'callback') return setStep(4);
      return setStep(3);
    }
    if (step === 3) return setStep(4);
    if (step === 4) return setStep(5);
  }

  function back() {
    if (step === 4 && intent === 'callback') return setStep(2);
    if (step === 4) return setStep(3);
    if (step === 3) return setStep(2);
    if (step === 2) return setStep(1);
  }

  function pickIntent(newIntent) {
    setIntent(newIntent);
    // Auto-advance — feels more responsive than requiring a Next click
    setTimeout(() => setStep(2), 200);
  }

  // ── File drop handlers ──
  const onDropFiles = useCallback((dropped) => {
    const pdfs = Array.from(dropped).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    setFiles(prev => [...prev, ...pdfs].slice(0, 12));
  }, []);
  const removeFile = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  // ── Step 2 readiness — controls whether Next is enabled ──
  const step2Ready = (() => {
    if (intent === 'bills')    return files.length > 0;
    if (intent === 'estimate') return estimate.monthly_spend >= 50;
    if (intent === 'callback') return true;   // no inputs needed
    return false;
  })();

  return (
    <div className="bg-gray-50 dark:bg-brand-dark font-body min-h-screen">
      <WebsiteNav />

      <main className="pt-12 pb-16 px-4 md:px-10">
        <div className="max-w-3xl mx-auto">

          {/* Prefilled package hint (when entering from a package detail page) */}
          {prefilledPackage && step === 1 && (
            <div className="mb-4 inline-block px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-semibold">
              Building on the <strong>{prefilledPackage.replace(/-/g, ' ')}</strong> package
            </div>
          )}

          {/* Progress bar */}
          <ProgressBar step={step} />

          {/* Step content */}
          {step === 1 && <Step1IntentPicker onPick={pickIntent} />}
          {step === 2 && (
            <Step2Container subtitle={subtitleForIntent(intent)} onBack={back} onNext={next} nextEnabled={step2Ready}>
              {intent === 'bills'    && <BillsBranch files={files} onDrop={onDropFiles} removeFile={removeFile} inputRef={filesInputRef} />}
              {intent === 'estimate' && <EstimateBranch estimate={estimate} setEstimate={setEstimate} />}
              {intent === 'callback' && <CallbackBranch onContinue={next} />}
            </Step2Container>
          )}
          {step === 3 && <Step3Placeholder onBack={back} onNext={next} />}
          {step === 4 && <Step4Placeholder onBack={back} onSubmit={next} intent={intent} />}
          {step === 5 && <Step5Confirmation />}

        </div>
      </main>

      <WebsiteFooter />
    </div>
  );
}

function subtitleForIntent(intent) {
  if (intent === 'bills')    return 'Upload your power bills below — drop up to 12.';
  if (intent === 'estimate') return 'A few quick questions about your power use.';
  if (intent === 'callback') return "We'll skip straight to your contact details.";
  return '';
}

// ════════════════════════════════════════════════════════════════════════════
// Progress bar — top of every step
// ════════════════════════════════════════════════════════════════════════════
function ProgressBar({ step }) {
  const labels = ['How can we help?', 'Your home', 'Your savings', 'Contact details'];
  return (
    <div className="mb-6">
      <div className="flex justify-between mb-2 text-[10px] font-bold tracking-widest uppercase">
        {labels.map((label, i) => {
          const stepNum = i + 1;
          const cls = stepNum === step  ? 'text-amber-700 dark:text-amber-300'
                    : stepNum < step    ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-gray-400 dark:text-gray-600';
          return (
            <span key={i} className={cls}>
              <span className="hidden sm:inline">{stepNum} · </span>{label}
            </span>
          );
        })}
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300"
             style={{ width: `${Math.min(100, (step / 4) * 100)}%` }} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 1 — Intent picker (the door selector)
// ════════════════════════════════════════════════════════════════════════════
function Step1IntentPicker({ onPick }) {
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP 1 OF 4</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-3 dark:text-gray-100">How can we help?</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Pick whichever fits your situation today.</p>
      </div>

      <div className="space-y-3">
        <IntentCard color="amber" accuracy="±2%" icon="📄"
          title="I have my power bills"
          desc="Upload 1-12 PDFs · Get your exact 25-year savings · Most accurate path"
          onClick={() => onPick('bills')} />
        <IntentCard color="blue" accuracy="±15%" icon="⚡"
          title="I don't have bills handy"
          desc="Answer 4 quick questions · Get an estimate · Refine later"
          onClick={() => onPick('estimate')} />
        <IntentCard color="emerald" accuracy="FAST" icon="📞"
          title="I just want a callback"
          desc="Skip the numbers · Sales rep will call within 24h"
          onClick={() => onPick('callback')} />
      </div>

      <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mt-6">
        All three paths produce one customer record. You can change your mind later.
      </p>
    </div>
  );
}

function IntentCard({ color, accuracy, icon, title, desc, onClick }) {
  const borderHover = {
    amber:   'hover:border-amber-400',
    blue:    'hover:border-blue-400',
    emerald: 'hover:border-emerald-400',
  }[color];
  const iconBg = {
    amber:   'bg-amber-100 text-amber-600',
    blue:    'bg-blue-100 text-blue-600',
    emerald: 'bg-emerald-100 text-emerald-600',
  }[color];
  const tagColor = {
    amber:   'text-amber-500',
    blue:    'text-blue-500',
    emerald: 'text-emerald-500',
  }[color];
  return (
    <button onClick={onClick}
      className={`w-full text-left p-5 rounded-2xl border-2 border-gray-200 dark:border-white/10 ${borderHover} transition flex items-center gap-4 bg-white dark:bg-brand-dark-1`}>
      <div className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center text-2xl flex-shrink-0`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-base dark:text-gray-100">{title}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{desc}</div>
      </div>
      <div className={`text-xs font-bold ${tagColor} flex-shrink-0`}>{accuracy}</div>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 2 — Shell that wraps the active branch
// ════════════════════════════════════════════════════════════════════════════
function Step2Container({ subtitle, onBack, onNext, nextEnabled, children }) {
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP 2 OF 4</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-2 dark:text-gray-100">Your home</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>

      {children}

      <div className="flex items-center justify-between mt-6 pt-5 border-t border-gray-100 dark:border-white/10">
        <button onClick={onBack} className="text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">← Back</button>
        <button
          onClick={onNext}
          disabled={!nextEnabled}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
          Next <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Branch: Bills upload ──
function BillsBranch({ files, onDrop, removeFile, inputRef }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); onDrop(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed transition cursor-pointer p-8 text-center
          ${dragOver ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/5' : 'border-gray-300 dark:border-white/15 hover:border-amber-300'}`}>
        <Upload size={36} className="mx-auto text-amber-500 mb-3" />
        <div className="text-sm font-bold mb-1 dark:text-gray-100">Drop 1-12 power bill PDFs here</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Or click to browse · Mercury, Pulse, Contact, Genesis supported · 5 MB max</div>
        <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple
          onChange={e => onDrop(e.target.files)} className="hidden" />
      </div>

      {files.length > 0 && (
        <>
          <div className="mt-4 px-4 py-3 rounded-xl bg-amber-50/50 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-500/20">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs font-bold text-gray-700 dark:text-gray-200">{files.length} of 12 bills uploaded</div>
              <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full
                ${files.length >= 12 ? 'bg-emerald-100 text-emerald-700'
                : files.length >= 6  ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-500'}`}>
                {files.length >= 12 ? '✓ Full seasonality' : files.length >= 6 ? 'Good coverage' : 'Basic estimate'}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/60 dark:bg-white/10 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all"
                style={{ width: `${Math.min(100, (files.length / 12) * 100)}%` }} />
            </div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5">
              {files.length >= 12
                ? 'Maximum accuracy — your projection will reflect summer + winter usage.'
                : `Add ${12 - files.length} more for a complete seasonal profile.`}
            </div>
          </div>

          <div className="mt-3 bg-white dark:bg-brand-dark border border-gray-100 dark:border-white/10 rounded-xl divide-y divide-gray-100 dark:divide-white/5">
            {files.map((f, i) => (
              <div key={i} className="px-4 py-2 flex items-center gap-3">
                <FileText size={14} className="text-amber-500 flex-shrink-0" />
                <span className="text-xs flex-1 truncate dark:text-gray-200">{f.name}</span>
                <span className="text-[10px] text-gray-400">{Math.round(f.size / 1024)} KB</span>
                <button onClick={() => removeFile(i)} className="text-gray-300 hover:text-red-500"><X size={12} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Branch: Estimate form ──
function EstimateBranch({ estimate, setEstimate }) {
  const update = (k, v) => setEstimate(s => ({ ...s, [k]: v }));
  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center justify-between mb-2">
          Monthly power bill
          <span className="text-amber-600 dark:text-amber-300 font-extrabold text-base font-mono">${estimate.monthly_spend}</span>
        </label>
        <input type="range" min="50" max="800" step="25" value={estimate.monthly_spend}
          onChange={e => update('monthly_spend', parseInt(e.target.value))}
          className="w-full accent-amber-500" />
        <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-mono"><span>$50</span><span>$800+</span></div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">Your retailer</label>
          <select value={estimate.retailer} onChange={e => update('retailer', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200">
            <option value="mercury">Mercury</option>
            <option value="genesis">Genesis</option>
            <option value="contact">Contact</option>
            <option value="meridian">Meridian</option>
            <option value="electric_kiwi">Electric Kiwi</option>
            <option value="powershop">Powershop</option>
            <option value="frank">Frank Energy</option>
            <option value="flick">Flick Electric</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">Postcode</label>
          <input type="text" inputMode="numeric" maxLength={4} placeholder="1010"
            value={estimate.postcode} onChange={e => update('postcode', e.target.value.replace(/\D/g, ''))}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">Household size</label>
          <select value={estimate.household} onChange={e => update('household', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200">
            <option value="1-2">1-2 people</option>
            <option value="3-4">3-4 people</option>
            <option value="5+">5+ people</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">Battery interest</label>
          <select value={estimate.battery_interest} onChange={e => update('battery_interest', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200">
            <option value="considering">Maybe later</option>
            <option value="wants_backup">Yes, want outage backup</option>
            <option value="not_interested">No</option>
          </select>
        </div>
      </div>

      <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 text-[11px] text-blue-700 dark:text-blue-300 flex items-start gap-2">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        <span>We'll back-compute your annual kWh from your monthly spend + your retailer's published rate. Less precise than a bill upload — you can refine later by uploading bills.</span>
      </div>
    </div>
  );
}

// ── Branch: Callback skip-ahead notice ──
function CallbackBranch({ onContinue }) {
  return (
    <div className="text-center py-8">
      <Phone size={48} className="mx-auto text-emerald-500 mb-4" />
      <div className="text-sm text-gray-700 dark:text-gray-200 mb-2">Got it — no data needed.</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
        We'll go straight to your contact details and a solar specialist will call you within 24 hours to discuss everything in person.
      </div>
      <button onClick={onContinue}
        className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition inline-flex items-center gap-2">
        Skip to contact details <ArrowRight size={14} />
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 3 — Projection placeholder (Phase 6.3 will hit the scenario engine)
// ════════════════════════════════════════════════════════════════════════════
function Step3Placeholder({ onBack, onNext }) {
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP 3 OF 4</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-2 dark:text-gray-100">Your projected savings</h1>
        <Construction size={32} className="mx-auto text-amber-500 my-4" />
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          Phase 6.3 will pipe your Step 2 inputs through the 25-year scenario engine and show the projection here, exactly like the existing /bill-analysis result.
        </p>
      </div>
      <div className="flex items-center justify-between pt-5 border-t border-gray-100 dark:border-white/10">
        <button onClick={onBack} className="text-xs font-bold text-gray-500 hover:text-gray-700">← Back</button>
        <button onClick={onNext} className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm hover:opacity-90 transition flex items-center gap-2">
          Get my proposal <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 4 — Contact placeholder (Phase 6.3 wires real form + OTP + submit)
// ════════════════════════════════════════════════════════════════════════════
function Step4Placeholder({ onBack, onSubmit, intent }) {
  const subtitle = intent === 'callback'
    ? 'Eric will call within 24 hours to discuss your options.'
    : 'Eric will call within 24 hours to walk you through your tailored quote.';
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP 4 OF 4</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-2 dark:text-gray-100">Get your tailored proposal</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        <Construction size={32} className="mx-auto text-amber-500 my-4" />
        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          Phase 6.3 will replace this with the full contact form (name / email / phone + OTP / address) and route the submission to <code className="bg-gray-100 dark:bg-white/10 px-1 rounded">/api/quote/submit</code> with the wizard's full state attached.
        </p>
      </div>
      <div className="flex items-center justify-between pt-5 border-t border-gray-100 dark:border-white/10">
        <button onClick={onBack} className="text-xs font-bold text-gray-500 hover:text-gray-700">← Back</button>
        <button onClick={onSubmit} className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm hover:opacity-90 transition flex items-center gap-2">
          Submit <CheckCircle size={14} />
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 5 — Confirmation
// ════════════════════════════════════════════════════════════════════════════
function Step5Confirmation() {
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-emerald-200 dark:border-emerald-500/30 shadow-xl p-8 text-center animate-fade-in">
      <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-300 text-4xl mb-4">✓</div>
      <h1 className="text-2xl md:text-3xl font-extrabold font-display mb-3 dark:text-gray-100">Got it! Eric will call within 24h.</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
        We'll prepare 3 tailored system options. Look for a call from <strong>+64 21 839 356</strong>.
      </p>
      <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-200 dark:border-amber-500/30 p-5 max-w-md mx-auto text-left mb-6">
        <div className="text-[10px] font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">WHAT HAPPENS NEXT</div>
        <ul className="space-y-2 text-xs text-gray-700 dark:text-gray-300">
          <li className="flex items-start gap-2"><span className="text-amber-600 font-bold">1.</span> SMS confirmation within 5 minutes</li>
          <li className="flex items-start gap-2"><span className="text-amber-600 font-bold">2.</span> Eric calls within 24h with 3 system options</li>
          <li className="flex items-start gap-2"><span className="text-amber-600 font-bold">3.</span> Free on-site survey (typically 5-7 days)</li>
          <li className="flex items-start gap-2"><span className="text-amber-600 font-bold">4.</span> Detailed proposal + install schedule within 1 week</li>
        </ul>
      </div>
      <Link to="/" className="text-xs font-bold text-amber-700 dark:text-amber-300 hover:underline">← Back to home</Link>
    </div>
  );
}
