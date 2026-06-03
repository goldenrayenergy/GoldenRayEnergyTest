// /get-quote — Option 6 Buyer path wizard.
//
// Step map (post-Pattern B unification — same flow for QR + direct visitors):
//   1  Intent picker    — bills / estimate / callback / manual
//   2  Branch           — upload bills / answer questions / type rows / "callback please"
//   3  Capture          — name + email + phone (required, soft framing) — creates partial enquiry
//   4  Projection       — runs bill analysis, shows 25-yr savings or review_required screen
//                          (skipped for callback intent and non-residential)
//   5  Final details    — address + property + (callback only) OTP — promotes partial → 'new'
//   6  Confirmation
//
// Partial capture at Step 3 means every visitor who fills the form becomes a
// reachable lead even if they bail at projection — the 24h bail-out job
// follows them up. Step 5 enriches the same row (UPDATE) rather than insert.

import { useState, useCallback, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Upload, FileText, Zap, Phone, X, CheckCircle,
  Info, Loader2, AlertTriangle, TrendingUp, DollarSign, Battery, Sun, Send,
  ChevronDown, Home, Building2, FilePen,
} from 'lucide-react';
import { publicApi } from '../services/api';
import WebsiteNav from '../components/website/WebsiteNav';
import WebsiteFooter from '../components/website/WebsiteFooter';
import AddressAutocomplete from '../components/ui/AddressAutocomplete';

const fmt$ = n => '$' + Math.round(Number(n || 0)).toLocaleString('en-NZ');
const fmtSign = n => (n >= 0 ? '+' : '') + fmt$(n);

// ────────────────────────────────────────────────────────────────────────────

export default function GetQuotePage() {
  const [searchParams] = useSearchParams();
  const prefilledPackage = searchParams.get('package');

  // QR-campaign attribution — captured from URL params set by /qr/:slug redirect.
  // Echoed back to the server on form-submit so the lead can be tied to its
  // marketing source (van wrap, business card, trade show, flyer, etc.).
  // Pattern B: no separate Step 0 for QR — same flow as direct visitors; UTM
  // just rides along to /submit-partial + /submit so attribution is preserved.
  const utm = {
    utm_source:   searchParams.get('utm_source')   || null,
    utm_medium:   searchParams.get('utm_medium')   || null,
    utm_campaign: searchParams.get('utm_campaign') || null,
    qr_scan_id:   searchParams.get('qr_scan_id')   || null,
  };

  // Holds the enquiry/contact ids returned by /quote/submit-partial at Step 3.
  // Echoed back on the final wizard submit so the backend UPDATEs that row.
  const [partial, setPartial] = useState({ enquiry_id: null, contact_id: null, done: false });

  const [step, setStep] = useState(1);
  const [customerType, setCustomerType] = useState('residential');   // Phase 7.1 segmentation
  const [intent, setIntent] = useState(null);                // 'bills' | 'estimate' | 'callback' | 'manual_table'

  // Door A (bills) state
  const [files, setFiles] = useState([]);
  const filesInputRef = useRef(null);

  // Door D (manual table) state — fallback when PDF parsing can't read the bills
  // (image-only PDFs, unrecognised retailers), or when the customer prefers to
  // type their numbers from a spreadsheet they already keep.
  // Each row: { days, fixed_nzd, kwh, usage_nzd, total_nzd }
  const [manualRows, setManualRows] = useState([
    { days: '', fixed_nzd: '', kwh: '', usage_nzd: '', total_nzd: '' },
  ]);

  // Door B (estimate) state — covers all customer types; each branch reads
  // a different subset. Single state keeps back-navigation values preserved.
  const [estimate, setEstimate] = useState({
    // Residential
    monthly_spend:    250,
    retailer:         'mercury',
    postcode:         '',
    household:        '3-4',
    battery_interest: 'considering',
    // Off-grid
    daily_kwh:        20,
    autonomy_days:    '2',
    generator_backup: 'no',
    off_grid_reason:  'no_grid_available',
    critical_loads:   '',
    // Commercial
    business_type:    '',
    operating_hours:  'business-hours',
    site_area_sqm:    '',
    // PPA
    contract_length:  '15',
    decision_makers:  'owner-only',
  });

  // Step 3 — analysis result (filled by Step3Projection on mount)
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisId, setAnalysisId] = useState(null);

  // Step 4 — contact form state
  const [contact, setContact] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    address: '', addressStreet: '', addressSuburb: '', addressCity: '', addressPostcode: '',
    owns_home: '', roof_type: '', battery_option: '',
    installation_timeframe: '', lead_source: 'website',
    notes: '',                                                // open-ended customer message
  });
  const [otp, setOtp] = useState({ sent: false, value: '', verified: false, loading: false, error: '', demoCode: '' });
  const [submitState, setSubmitState] = useState({ loading: false, error: '', done: false });

  // ── Navigation ──
  // Step 4 (projection) is only shown for RESIDENTIAL customers on bills or
  // estimate intent. Non-residential customers and callback intent skip it.
  // Reasoning: the 25-yr scenario engine is residential-calibrated; running
  // it for commercial / off-grid / PPA produces misleading numbers, and
  // those customers need a site visit anyway.
  const skipProjection = intent === 'callback' || customerType !== 'residential';

  function next() {
    if (step === 1) return setStep(2);
    if (step === 2) return setStep(3);                            // → capture
    if (step === 3) return setStep(skipProjection ? 5 : 4);       // capture → projection (or final)
    if (step === 4) return setStep(5);
    if (step === 5) return setStep(6);
  }

  function back() {
    if (step === 5) return setStep(skipProjection ? 3 : 4);
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
  // Accepts PDFs (from email / desktop) AND images (from phone camera).
  // Image bills go through Tesseract OCR server-side via parseBillImage().
  const onDropFiles = useCallback((dropped) => {
    const accepted = Array.from(dropped).filter(f => {
      const name = (f.name || '').toLowerCase();
      return f.type === 'application/pdf'
          || name.endsWith('.pdf')
          || /^image\/(jpe?g|png|webp|heic|heif)$/i.test(f.type || '')
          || /\.(jpe?g|png|webp|heic|heif)$/i.test(name)
          // Smart-meter CSVs from Mercury / Genesis / Contact / Powerswitch
          || name.endsWith('.csv')
          || /^(text\/csv|application\/(csv|vnd\.ms-excel))$/i.test(f.type || '');
    });
    setFiles(prev => [...prev, ...accepted].slice(0, 12));
  }, []);
  const removeFile = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  // ── Step 2 readiness — controls whether Next is enabled ──
  // Type-specific minimums for the estimate branch (the bills + callback
  // branches don't depend on customer type).
  const step2Ready = (() => {
    if (intent === 'bills')        return files.length > 0;
    if (intent === 'callback')     return true;
    if (intent === 'manual_table') return manualRows.some(r => r.days && r.kwh && r.total_nzd);
    if (intent !== 'estimate')     return false;

    if (customerType === 'residential') return estimate.monthly_spend >= 50;
    if (customerType === 'off-grid')    return estimate.daily_kwh >= 1 && estimate.off_grid_reason;
    if (customerType === 'commercial')  return estimate.business_type && estimate.monthly_spend >= 50;
    if (customerType === 'ppa')         return estimate.business_type && estimate.monthly_spend >= 50 && estimate.contract_length;
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
          <ProgressBar step={step} skipProjection={skipProjection} />

          {/* Step content */}
          {step === 1 && <Step1IntentPicker customerType={customerType} setCustomerType={setCustomerType} onPick={pickIntent} />}
          {step === 2 && (
            <Step2Container
              subtitle={subtitleForIntent(intent, customerType)}
              onBack={back} onNext={next} nextEnabled={step2Ready}
              skipProjection={skipProjection}>
              {intent === 'bills'        && <BillsBranch files={files} onDrop={onDropFiles} removeFile={removeFile} inputRef={filesInputRef} onSwitchToManual={() => setIntent('manual_table')} />}
              {intent === 'estimate'     && <EstimateBranch customerType={customerType} estimate={estimate} setEstimate={setEstimate} />}
              {intent === 'callback'     && <CallbackBranch onContinue={next} />}
              {intent === 'manual_table' && <ManualTableBranch rows={manualRows} setRows={setManualRows} onSwitchToUpload={() => setIntent('bills')} />}
            </Step2Container>
          )}
          {step === 3 && (
            <Step3Capture
              intent={intent}
              customerType={customerType}
              estimate={estimate}
              utm={utm}
              contact={contact}
              setContact={setContact}
              partial={partial}
              onBack={back}
              skipProjection={skipProjection}
              onCaptured={(ids) => {
                setPartial({ enquiry_id: ids.enquiry_id, contact_id: ids.contact_id, done: true });
                setStep(skipProjection ? 5 : 4);
              }}
            />
          )}
          {step === 4 && (
            <Step3Projection
              intent={intent}
              files={files}
              estimate={estimate}
              manualRows={manualRows}
              partial={partial}
              onAnalysisReady={(data) => { setAnalysisResult(data); setAnalysisId(data?.id || null); }}
              cachedResult={analysisResult}
              onBack={back}
              onNext={next}
              onFallbackToManual={() => { setIntent('manual_table'); setStep(2); setAnalysisResult(null); }}
            />
          )}
          {step === 5 && (
            <Step4ContactForm
              intent={intent}
              customerType={customerType}
              estimate={estimate}
              analysisId={analysisId}
              analysisResult={analysisResult}
              contact={contact}
              setContact={setContact}
              otp={otp}
              setOtp={setOtp}
              submitState={submitState}
              onBack={back}
              onSubmit={async () => {
                setSubmitState({ loading: true, error: '', done: false });
                try {
                  // Map our customerType to the legacy installationType field the server already understands
                  const installationType =
                    customerType === 'off-grid'   ? 'off-grid' :
                    customerType === 'commercial' ? 'commercial' :
                    customerType === 'ppa'        ? 'ppa' :
                                                    'residential';
                  await publicApi.post('/quote/submit', {
                    form: {
                      ...contact,
                      monthlyBill: estimate.monthly_spend,
                      installationType,
                      customerType,                              // Phase 7.1 segmentation tag
                      callToDiscuss: 'yes',
                      phoneVerified: otp.verified,                // surface verified flag in CRM
                      // Wizard provenance — surface in CRM
                      wizardIntent:   intent,
                      analysisId:    analysisId,
                      // Step 3 captured the partial — ids tell backend to UPDATE
                      // that row to 'new' status rather than insert a duplicate.
                      enquiry_id:   partial.enquiry_id,
                      contact_id:   partial.contact_id,
                      // QR-campaign attribution (Phase D) — passes through to
                      // website_enquiries + contacts so we know which marketing
                      // surface produced this lead. All null when visitor came
                      // in directly without a QR scan.
                      utm_source:   utm.utm_source,
                      utm_medium:   utm.utm_medium,
                      utm_campaign: utm.utm_campaign,
                      qr_scan_id:   utm.qr_scan_id,
                      // Phase 7.2 — type-specific estimate fields ride along
                      // (server logs them in task description; column persistence
                      // is a separate schema change)
                      dailyKwh:        estimate.daily_kwh,
                      autonomyDays:    estimate.autonomy_days,
                      generatorBackup: estimate.generator_backup,
                      offGridReason:   estimate.off_grid_reason,
                      criticalLoads:   estimate.critical_loads,
                      businessType:    estimate.business_type,
                      operatingHours:  estimate.operating_hours,
                      siteAreaSqm:     estimate.site_area_sqm,
                      contractLength:  estimate.contract_length,
                      decisionMakers:  estimate.decision_makers,
                    },
                  });
                  setSubmitState({ loading: false, error: '', done: true });
                  setStep(6);
                } catch (e) {
                  setSubmitState({ loading: false, error: e.response?.data?.error || e.message, done: false });
                }
              }}
            />
          )}
          {step === 6 && <Step5Confirmation contact={contact} customerType={customerType} />}

        </div>
      </main>

      <WebsiteFooter />
    </div>
  );
}

function subtitleForIntent(intent, customerType) {
  if (intent === 'bills') {
    if (customerType === 'commercial') return "Upload your commercial usage bills (any month — we'll scope from your data).";
    if (customerType === 'off-grid')   return "Upload existing electricity bills if you have them — gives us your load profile.";
    if (customerType === 'ppa')        return "Upload your bills so we can scope the PPA against your real consumption.";
    return 'Upload your power bills below — drop up to 12.';
  }
  if (intent === 'estimate') {
    if (customerType === 'commercial') return 'Tell us about your business and site.';
    if (customerType === 'off-grid')   return 'Tell us about your site and power needs.';
    if (customerType === 'ppa')        return 'Tell us about your business and PPA preferences.';
    return 'A few quick questions about your power use.';
  }
  if (intent === 'callback') return "We'll skip straight to your contact details.";
  if (intent === 'manual_table') return "Type the numbers from your bills below — paste from Excel works.";
  return '';
}

// ════════════════════════════════════════════════════════════════════════════
// Progress bar — top of every step
// ════════════════════════════════════════════════════════════════════════════
function ProgressBar({ step, skipProjection }) {
  // Labels follow the actual flow:
  //   1=intent  2=branch  3=capture  4=projection(opt)  5=final  6=confirm
  // Step 6 (confirmation) is post-submit, never shown in the bar — we cap
  // currentIdx at the last visible label.
  const labels = skipProjection
    ? ['How can we help?', 'Your home', 'Your details', 'Final details']
    : ['How can we help?', 'Your home', 'Your details', 'Your savings', 'Final details'];
  const totalSteps = labels.length;
  // step state values → bar index
  //                   step=1 → 0   step=2 → 1   step=3 → 2
  //   if skipProjection: step=5 → 3
  //   else:              step=4 → 3, step=5 → 4
  let currentIdx;
  if (step <= 3)       currentIdx = step - 1;
  else if (step === 4) currentIdx = skipProjection ? 3 : 3;
  else if (step === 5) currentIdx = skipProjection ? 3 : 4;
  else                 currentIdx = totalSteps - 1;
  return (
    <div className="mb-6">
      <div className="flex justify-between mb-2 text-[10px] font-bold tracking-widest uppercase">
        {labels.map((label, i) => {
          const cls = i === currentIdx  ? 'text-amber-700 dark:text-amber-300'
                    : i <  currentIdx   ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-gray-400 dark:text-gray-600';
          return (
            <span key={i} className={cls}>
              <span className="hidden sm:inline">{i + 1} · </span>{label}
            </span>
          );
        })}
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300"
             style={{ width: `${Math.min(100, ((currentIdx + 1) / totalSteps) * 100)}%` }} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 3 — Unified mid-flow contact capture
//
// Replaces the old QR-only Step 0 (Pattern B in design notes). Shown to EVERY
// visitor regardless of door — bills/estimate/manual/callback — after they've
// expressed intent but before the heavy work (analysis or final form).
//
// Why this exists: customers who bail at the projection screen, the OTP step,
// or the address block leave us with nothing. By capturing name+email+phone
// here we guarantee a reachable lead for the 24-hour bail-out follow-up.
//
// Required: name, email, phone. Soft framing ("so we can send the analysis")
// rather than pressure. No skip — but no other hoops either. Submits to
// /api/quote/submit-partial which creates a status='partial' row; the final
// /api/quote/submit promotes it to 'new' using the ids we hand back.
// ════════════════════════════════════════════════════════════════════════════
function Step3Capture({ intent, customerType, estimate, utm, contact, setContact, partial, onBack, onCaptured, skipProjection }) {
  // Read first/last name as a single field for friction reduction, then split.
  const initialName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  const [v, setV] = useState({
    fullName: initialName,
    email:    contact.email || '',
    phone:    contact.phone || '',
  });
  const [state, setState] = useState({ loading: false, error: '' });
  const set = (k, val) => setV(s => ({ ...s, [k]: val }));

  // Soft validation — required but tolerant
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim());
  const phoneValid = /^[\d+\s\-()]{8,}$/.test(v.phone.trim());
  const nameValid  = v.fullName.trim().split(/\s+/).filter(Boolean).length >= 1;
  const ready = nameValid && emailValid && phoneValid;

  const splitName = (full) => {
    const parts = full.trim().split(/\s+/).filter(Boolean);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
  };

  // Subtitle copy varies by intent — keeps the framing soft and contextual
  // rather than a generic "give us your details".
  const subtitle = (() => {
    if (intent === 'callback')     return "We'll call you back — just need to know who to reach.";
    if (intent === 'bills')        return "We'll email your analysis here. No spam — your specialist may follow up if there's anything to discuss.";
    if (intent === 'manual_table') return "We'll email your projection here. Your specialist may call to walk through the numbers.";
    return "We'll email your estimate here. Your specialist may follow up to refine the numbers.";
  })();

  const submit = async () => {
    if (!ready || state.loading) return;
    setState({ loading: true, error: '' });
    try {
      const { firstName, lastName } = splitName(v.fullName);
      // Persist to the wizard contact state so subsequent steps can show
      // "we already have your details" without re-asking.
      setContact(c => ({ ...c, firstName, lastName, email: v.email.trim(), phone: v.phone.trim() }));

      const installationType =
        customerType === 'off-grid'   ? 'off-grid' :
        customerType === 'commercial' ? 'commercial' :
        customerType === 'ppa'        ? 'ppa' :
                                        'residential';

      const { data } = await publicApi.post('/quote/submit-partial', {
        form: {
          firstName, lastName,
          email:    v.email.trim(),
          phone:    v.phone.trim(),
          monthlyBill: estimate.monthly_spend,
          installationType,
          customerType,
          wizardIntent:   intent,
          // Idempotency hint: if we've already created a partial row in this
          // session (e.g. customer hit Back from Step 4 and resubmitted Step 3),
          // pass the existing ids so the server UPDATEs that row instead of
          // creating a duplicate.
          enquiry_id:   partial?.enquiry_id || null,
          contact_id:   partial?.contact_id || null,
          utm_source:   utm.utm_source,
          utm_medium:   utm.utm_medium,
          utm_campaign: utm.utm_campaign,
          qr_scan_id:   utm.qr_scan_id,
        },
      });
      onCaptured({ enquiry_id: data.enquiry_id, contact_id: data.contact_id });
    } catch (e) {
      setState({ loading: false, error: e.response?.data?.error || 'Something went wrong — please try again.' });
    }
  };

  // Continue-button label depends on what comes next so the customer knows
  // what they're actually unlocking with this step.
  const nextLabel = intent === 'callback' || skipProjection
    ? 'Continue'
    : 'See my savings';

  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP 3 OF {skipProjection ? 4 : 5}</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-2 dark:text-gray-100">Where should we send this?</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">{subtitle}</p>
      </div>

      <div className="space-y-4 max-w-md mx-auto">
        <Field label="Your name *" value={v.fullName} onChange={x => set('fullName', x)} placeholder="John Smith" />
        <Field label="Email *" type="email" value={v.email} onChange={x => set('email', x)} placeholder="john@example.com" />
        <Field label="Mobile *" type="tel" value={v.phone} onChange={x => set('phone', x)} placeholder="+64 21 …" />

        {state.error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{state.error}</span>
          </div>
        )}

        <button onClick={submit} disabled={!ready || state.loading}
          className={`w-full px-5 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition
            ${ready && !state.loading
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg hover:shadow-xl'
              : 'bg-gray-200 dark:bg-white/10 text-gray-400 cursor-not-allowed'}`}>
          {state.loading
            ? (<><Loader2 size={14} className="animate-spin" /> Saving…</>)
            : (<>{nextLabel} <ArrowRight size={14} /></>)}
        </button>

        <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
          We never share your details. We may email or call you about your solar enquiry — nothing else.
        </p>
      </div>

      <div className="flex items-center justify-between mt-6 pt-5 border-t border-gray-100 dark:border-white/10">
        <button onClick={onBack}
          className="px-3 py-2 -ml-3 rounded-lg text-sm font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">← Back</button>
        <div className="text-[10px] text-gray-400">Required to continue · no skip</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 1 — Intent picker (the door selector)
// ════════════════════════════════════════════════════════════════════════════
function Step1IntentPicker({ customerType, setCustomerType, onPick }) {
  const isResidential = customerType === 'residential';
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP 1</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-3 dark:text-gray-100">How can we help?</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Tell us about your installation, then how you'd like to engage.</p>
      </div>

      {/* ── Customer type segmentation (Phase 7.1) ── */}
      <div className="mb-6">
        <div className="text-[10px] font-extrabold tracking-widest text-gray-500 dark:text-gray-400 mb-2 uppercase">
          What kind of installation?
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <TypeCard active={customerType === 'residential'} onClick={() => setCustomerType('residential')}
            icon={Home}   label="Residential" sub="My home" />
          <TypeCard active={customerType === 'off-grid'}    onClick={() => setCustomerType('off-grid')}
            icon={Sun}    label="Off-grid"    sub="No grid / autonomy" />
          <TypeCard active={customerType === 'commercial'}  onClick={() => setCustomerType('commercial')}
            icon={Building2} label="Commercial" sub="Business site" />
          <TypeCard active={customerType === 'ppa'}         onClick={() => setCustomerType('ppa')}
            icon={FilePen} label="PPA"        sub="$0 upfront contract" />
        </div>

        {!isResidential && (
          <div className="mt-3 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 text-[11px] text-blue-700 dark:text-blue-300 flex items-start gap-2">
            <Info size={12} className="flex-shrink-0 mt-0.5" />
            <span>
              {customerType === 'off-grid'   && <>Off-grid systems need a site assessment to size battery autonomy + generator backup. We'll capture your basics now and a specialist will call within 2 business days to schedule a survey.</>}
              {customerType === 'commercial' && <>Commercial sites are custom-designed against your peak demand, hours of operation and tariff structure. We'll capture basics now and our commercial team will call within 2 business days.</>}
              {customerType === 'ppa'        && <>Power Purchase Agreements are negotiated per-site (rate, term length, ownership). We'll capture basics now and our finance team will call within 2 business days.</>}
            </span>
          </div>
        )}
      </div>

      {/* ── Intent cards (same as before — but framed by customer type above) ── */}
      <div className="text-[10px] font-extrabold tracking-widest text-gray-500 dark:text-gray-400 mb-2 uppercase">
        How would you like to proceed?
      </div>
      <div className="space-y-3">
        <IntentCard color="amber" accuracy="±2%" icon="📄"
          title="I have my power bills"
          desc={isResidential
            ? 'Upload 1-12 PDFs · Get your exact 25-year savings · Most accurate path'
            : 'Upload your usage bills · Helps us scope your install accurately'}
          onClick={() => onPick('bills')} />
        <IntentCard color="blue" accuracy="±15%" icon="⚡"
          title="I don't have bills handy"
          desc={isResidential
            ? 'Answer 4 quick questions · Get an estimate · Refine later'
            : 'Answer a few questions about your site · We\'ll fill in detail on the call'}
          onClick={() => onPick('estimate')} />
        <IntentCard color="emerald" accuracy="FAST" icon="📞"
          title="I just want a callback"
          desc={isResidential
            ? 'Skip the numbers · Sales rep will call within 24h'
            : 'Skip the numbers · Our specialist will call to walk through your site'}
          onClick={() => onPick('callback')} />
      </div>

      <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mt-6">
        All three paths produce one customer record. You can change your mind later.
      </p>
    </div>
  );
}

function TypeCard({ active, onClick, icon: Icon, label, sub }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-3 rounded-xl border-2 text-left transition flex items-start gap-2
        ${active
          ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10 ring-1 ring-amber-300'
          : 'border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-1 hover:border-amber-300'}`}>
      <Icon size={18} className={`flex-shrink-0 mt-0.5 ${active ? 'text-amber-600 dark:text-amber-300' : 'text-gray-400'}`} />
      <div className="min-w-0">
        <div className={`text-xs font-bold leading-tight ${active ? 'text-amber-700 dark:text-amber-200' : 'dark:text-gray-200'}`}>{label}</div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">{sub}</div>
      </div>
    </button>
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
function Step2Container({ subtitle, onBack, onNext, nextEnabled, skipProjection, children }) {
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP 2</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-2 dark:text-gray-100">Your home</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>

      {children}

      <div className="flex items-center justify-between mt-6 pt-5 border-t border-gray-100 dark:border-white/10">
        <button onClick={onBack}
          className="px-3 py-2 -ml-3 rounded-lg text-sm font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">← Back</button>
        <button
          onClick={onNext}
          disabled={!nextEnabled}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
          Continue <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Branch: Bills upload ──
function BillsBranch({ files, onDrop, removeFile, inputRef, onSwitchToManual }) {
  const [dragOver, setDragOver] = useState(false);
  const cameraInputRef = useRef(null);
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
        <div className="text-sm font-bold mb-1 dark:text-gray-100">Drop 1-12 power bills here</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">PDFs, photos, or smart-meter CSVs · Mercury, Genesis, Contact, Pulse, Ecotricity, Powerswitch · 10 MB max</div>
        <input ref={inputRef} type="file"
          accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.csv,text/csv,application/vnd.ms-excel"
          multiple
          onChange={e => onDrop(e.target.files)} className="hidden" />
      </div>

      {/* Smart-meter CSV upgrade hint — most customers don't know they CAN download
          half-hourly data from their retailer's portal. Mentioning it converts
          some uncertain bill-uploaders into high-accuracy CSV-uploaders. */}
      <div className="mt-2 text-[10px] text-gray-400 dark:text-gray-500 text-center">
        💡 Got smart-meter CSV from your retailer's app? Drop that here for the most accurate projection.
      </div>

      {/* Mobile-first: tap to open the phone camera and snap a photo of the bill. */}
      {/* `capture="environment"` hints mobile browsers to use the rear camera. */}
      {/* Desktop browsers ignore `capture` and show a normal file picker. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-200 dark:border-amber-500/30 hover:border-amber-400 transition text-sm font-bold text-amber-700 dark:text-amber-200 flex items-center justify-center gap-2">
          📷 Take a photo
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border-2 border-gray-200 dark:border-white/10 hover:border-amber-300 transition text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center justify-center gap-2">
          📁 Choose file
        </button>
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple
          onChange={e => onDrop(e.target.files)} className="hidden" />
      </div>

      <div className="mt-2 text-[10px] text-gray-400 text-center">
        Tip: on mobile, "Take a photo" opens your camera. Make sure the bill is well-lit and in focus for best results.
      </div>

      {onSwitchToManual && (
        <div className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          Photos / PDFs not working? Some bill formats can't be auto-read.{' '}
          <button onClick={onSwitchToManual} className="text-amber-700 dark:text-amber-300 font-bold hover:underline">
            Type my numbers instead →
          </button>
        </div>
      )}

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
              <div key={i} className="pl-4 pr-2 py-1.5 flex items-center gap-3">
                <FileText size={14} className="text-amber-500 flex-shrink-0" />
                <span className="text-xs flex-1 truncate dark:text-gray-200">{f.name}</span>
                <span className="text-[10px] text-gray-400">{Math.round(f.size / 1024)} KB</span>
                <button onClick={() => removeFile(i)}
                  className="w-9 h-9 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center justify-center flex-shrink-0"
                  title="Remove file" aria-label={`Remove ${f.name}`}>
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Branch: Manual entry table (Door D) — fallback when PDFs can't be parsed ──
// Customers paste from a spreadsheet (Excel paste works natively in input
// fields) one row per billing period. Five columns map directly onto the
// fields a successful PDF parse would have produced.
function ManualTableBranch({ rows, setRows, onSwitchToUpload }) {
  const update = (i, k, v) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const addRow = () => setRows(rs => rs.length >= 12 ? rs : [...rs, { days: '', fixed_nzd: '', kwh: '', usage_nzd: '', total_nzd: '' }]);
  const removeRow = (i) => setRows(rs => rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i));

  // Paste handler — supports pasting a multi-row block from Excel/Sheets into
  // any cell. Splits on \n / \r\n, then \t / "  +" between columns.
  const onCellPaste = (startRowIdx, startColIdx, cols) => (e) => {
    const text = e.clipboardData.getData('text');
    if (!text || !text.includes('\n') && !text.includes('\t')) return;   // single value paste — let default happen
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    setRows(prev => {
      const next = [...prev];
      for (let i = 0; i < lines.length; i++) {
        const cells = lines[i].split(/\t|\s{2,}/).map(c => c.replace(/[^0-9.]/g, ''));
        const rowIdx = startRowIdx + i;
        // Auto-grow rows if needed
        while (next.length <= rowIdx && next.length < 12) {
          next.push({ days: '', fixed_nzd: '', kwh: '', usage_nzd: '', total_nzd: '' });
        }
        if (rowIdx >= next.length) break;
        const r = { ...next[rowIdx] };
        for (let j = 0; j < cells.length && (startColIdx + j) < cols.length; j++) {
          if (cells[j]) r[cols[startColIdx + j]] = cells[j];
        }
        next[rowIdx] = r;
      }
      return next;
    });
  };

  const COLS = ['days', 'fixed_nzd', 'kwh', 'usage_nzd', 'total_nzd'];
  const completedRows = rows.filter(r => r.days && r.kwh && r.total_nzd).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/5 p-4">
        <div className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-1">Type your power bill numbers</div>
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
          One row per billing period (most recent first works best). <strong>You can paste rows from Excel</strong> — copy your spreadsheet, click into the first cell, and Ctrl+V. We need at least the days, kWh, and total for each row.
        </p>
      </div>

      {/* Mobile-first: stacked cards, one per billing period. md+ shows the
          original 5-column table for paste-from-Excel ergonomics. Same data
          + onPaste handler, two layouts. */}
      <div className="md:hidden space-y-3">
        {rows.map((r, i) => {
          const FIELD_LABELS = {
            days:      { label: 'Days in period',       required: true,  placeholder: '32',      hint: 'How many days the bill covers' },
            kwh:       { label: 'Electricity used (kWh)', required: true, placeholder: '1906',    hint: 'Total kWh for the period' },
            total_nzd: { label: 'Total incl GST (NZ$)', required: true,  placeholder: '558.23',  hint: 'Final amount on the bill' },
            fixed_nzd: { label: 'Fixed daily charge (NZ$)', required: false, placeholder: '0.00', hint: 'Optional — sum of daily charges' },
            usage_nzd: { label: 'Usage charge (NZ$)',   required: false, placeholder: '0.00',    hint: 'Optional — variable kWh charges' },
          };
          const rowOK = r.days && r.kwh && r.total_nzd;
          return (
            <div key={i} className={`rounded-xl border-2 p-4 transition
              ${rowOK ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-500/5'
                      : 'border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-1'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300">
                  BILL {i + 1} {rowOK && <span className="ml-1 text-emerald-600">✓</span>}
                </div>
                {rows.length > 1 && (
                  <button onClick={() => removeRow(i)}
                    className="w-9 h-9 -mr-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center justify-center"
                    title="Remove this bill" aria-label="Remove this bill">
                    <X size={18} />
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {['days', 'kwh', 'total_nzd', 'fixed_nzd', 'usage_nzd'].map((c, j) => {
                  const meta = FIELD_LABELS[c];
                  return (
                    <div key={c}>
                      <label className="text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                        {meta.label} {meta.required && <span className="text-amber-600">*</span>}
                      </label>
                      <input
                        type="number" step="0.01" inputMode="decimal"
                        value={r[c] ?? ''}
                        onChange={e => update(i, c, e.target.value)}
                        onPaste={onCellPaste(i, COLS.indexOf(c), COLS)}
                        placeholder={meta.placeholder}
                        className="w-full px-3 py-3 rounded-lg border border-gray-200 dark:border-white/10 text-base bg-white dark:bg-brand-dark focus:border-amber-400 focus:ring-2 focus:ring-amber-200 outline-none"
                      />
                      <div className="text-[10px] text-gray-400 mt-1">{meta.hint}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop / tablet: original compact table — easier to scan multiple
          rows side-by-side and Excel paste flows naturally into adjacent cells. */}
      <div className="hidden md:block overflow-x-auto bg-white dark:bg-brand-dark-1 border border-gray-200 dark:border-white/10 rounded-xl">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-white/5">
            <tr>
              <th className="px-3 py-2 text-left font-bold text-gray-600 dark:text-gray-300">#</th>
              <th className="px-3 py-2 text-left font-bold text-gray-600 dark:text-gray-300">Days <span className="text-amber-600">*</span></th>
              <th className="px-3 py-2 text-left font-bold text-gray-600 dark:text-gray-300">Fixed daily NZ$</th>
              <th className="px-3 py-2 text-left font-bold text-gray-600 dark:text-gray-300">Electricity kWh <span className="text-amber-600">*</span></th>
              <th className="px-3 py-2 text-left font-bold text-gray-600 dark:text-gray-300">Usage NZ$</th>
              <th className="px-3 py-2 text-left font-bold text-gray-600 dark:text-gray-300">Total incl GST NZ$ <span className="text-amber-600">*</span></th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100 dark:border-white/5">
                <td className="px-3 py-1 text-gray-400 text-[10px] font-mono">{i + 1}</td>
                {COLS.map((c, j) => (
                  <td key={c} className="px-2 py-1">
                    <input
                      type="number" step="0.01" inputMode="decimal"
                      value={r[c] ?? ''}
                      onChange={e => update(i, c, e.target.value)}
                      onPaste={onCellPaste(i, j, COLS)}
                      placeholder={c === 'days' ? '32' : c === 'kwh' ? '1906' : c === 'total_nzd' ? '558.23' : '0.00'}
                      className="w-full px-2 py-1 rounded border border-gray-200 dark:border-white/10 text-xs bg-white dark:bg-brand-dark focus:border-amber-400 outline-none"
                    />
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  {rows.length > 1 && (
                    <button onClick={() => removeRow(i)} className="w-7 h-7 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 inline-flex items-center justify-center" title="Remove row" aria-label="Remove row">
                      <X size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={addRow}
          disabled={rows.length >= 12}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Add another row {rows.length >= 12 && '(max 12)'}
        </button>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          <span className={completedRows >= 1 ? 'text-emerald-600 font-bold' : ''}>{completedRows}</span> of {rows.length} rows ready · need at least 1 to continue
        </div>
      </div>

      {onSwitchToUpload && (
        <div className="text-center text-xs text-gray-500 dark:text-gray-400">
          <button onClick={onSwitchToUpload} className="text-amber-700 dark:text-amber-300 font-bold hover:underline">
            ← Back to PDF upload
          </button>
        </div>
      )}
    </div>
  );
}

// ── Branch: Estimate form — branches by customer type ──
function EstimateBranch({ customerType, estimate, setEstimate }) {
  const update = (k, v) => setEstimate(s => ({ ...s, [k]: v }));
  if (customerType === 'off-grid')   return <EstimateOffGrid   estimate={estimate} update={update} />;
  if (customerType === 'commercial') return <EstimateCommercial estimate={estimate} update={update} />;
  if (customerType === 'ppa')        return <EstimatePPA        estimate={estimate} update={update} />;
  return <EstimateResidential estimate={estimate} update={update} />;
}

function EstimateResidential({ estimate, update }) {
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
        <SelectInput label="Your retailer" value={estimate.retailer} onChange={v => update('retailer', v)}
          options={[
            ['mercury','Mercury'],['genesis','Genesis'],['contact','Contact'],['meridian','Meridian'],
            ['electric_kiwi','Electric Kiwi'],['powershop','Powershop'],['frank','Frank Energy'],['flick','Flick Electric'],
          ]} />
        <TextInput label="Postcode" value={estimate.postcode} onChange={v => update('postcode', v.replace(/\D/g, '').slice(0, 4))} placeholder="1010" inputMode="numeric" maxLength={4} />
        <SelectInput label="Household size" value={estimate.household} onChange={v => update('household', v)}
          options={[['1-2','1-2 people'],['3-4','3-4 people'],['5+','5+ people']]} />
        <SelectInput label="Battery interest" value={estimate.battery_interest} onChange={v => update('battery_interest', v)}
          options={[['considering','Maybe later'],['wants_backup','Yes, want outage backup'],['not_interested','No']]} />
      </div>

      <EstimateNote>
        We'll back-compute your annual kWh from your monthly spend + your retailer's published rate. Less precise than a bill upload — you can refine later by uploading bills.
      </EstimateNote>
    </div>
  );
}

function EstimateOffGrid({ estimate, update }) {
  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center justify-between mb-2">
          Daily power needed
          <span className="text-amber-600 dark:text-amber-300 font-extrabold text-base font-mono">{estimate.daily_kwh} kWh/day</span>
        </label>
        <input type="range" min="1" max="100" step="1" value={estimate.daily_kwh}
          onChange={e => update('daily_kwh', parseInt(e.target.value))}
          className="w-full accent-amber-500" />
        <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-mono">
          <span>1 kWh (cabin)</span><span>20-30 kWh (typical home)</span><span>100+ kWh (large)</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SelectInput label="Backup autonomy needed" value={estimate.autonomy_days} onChange={v => update('autonomy_days', v)}
          options={[['1','1 day (sunny climate)'],['2','2 days (typical)'],['3','3 days'],['5','5 days'],['7','7+ days (wet/cloudy)']]} />
        <SelectInput label="Generator backup?" value={estimate.generator_backup} onChange={v => update('generator_backup', v)}
          options={[['no','No generator'],['existing','Have one already'],['need_one','Need one designed in']]} />
        <SelectInput label="Why off-grid?" value={estimate.off_grid_reason} onChange={v => update('off_grid_reason', v)}
          options={[
            ['no_grid_available','No grid available at site'],
            ['grid_connection_cost','Grid connection too expensive'],
            ['independence','Want full independence'],
            ['existing_disconnect','Disconnecting from grid'],
          ]} />
        <TextInput label="Postcode" value={estimate.postcode} onChange={v => update('postcode', v.replace(/\D/g, '').slice(0, 4))} placeholder="1010" inputMode="numeric" maxLength={4} />
      </div>

      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">Critical loads <span className="text-gray-300 dark:text-gray-600 font-normal normal-case">(optional)</span></label>
        <textarea value={estimate.critical_loads} onChange={e => update('critical_loads', e.target.value)}
          placeholder="e.g. 'Heat pump + fridge + lighting' / 'Workshop with welder' / 'Just essentials — fridge, internet, lights'"
          rows={2} maxLength={400}
          className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200 resize-y" />
      </div>

      <EstimateNote>
        Off-grid sizing requires a site visit — the numbers below give our designer a starting point. We'll confirm everything with a survey before quoting.
      </EstimateNote>
    </div>
  );
}

function EstimateCommercial({ estimate, update }) {
  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center justify-between mb-2">
          Monthly power bill
          <span className="text-amber-600 dark:text-amber-300 font-extrabold text-base font-mono">${estimate.monthly_spend}</span>
        </label>
        <input type="range" min="50" max="20000" step="100" value={estimate.monthly_spend}
          onChange={e => update('monthly_spend', parseInt(e.target.value))}
          className="w-full accent-amber-500" />
        <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-mono"><span>$50</span><span>$5,000</span><span>$20,000+</span></div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SelectInput label="Business type" value={estimate.business_type} onChange={v => update('business_type', v)}
          options={[
            ['','— Select —'],
            ['office','Office'],['warehouse','Warehouse'],['factory','Factory / manufacturing'],
            ['retail','Retail'],['hospitality','Hospitality / restaurant'],['agriculture','Agriculture / farm'],
            ['school','School / education'],['other','Other'],
          ]} />
        <SelectInput label="Operating hours" value={estimate.operating_hours} onChange={v => update('operating_hours', v)}
          options={[
            ['business-hours','Business hours (~8am-6pm)'],
            ['extended','Extended (~6am-10pm)'],
            ['24-7','24/7 operation'],
            ['seasonal','Seasonal / variable'],
          ]} />
        <TextInput label="Roof / site area (sqm)" value={estimate.site_area_sqm} onChange={v => update('site_area_sqm', v.replace(/\D/g, '').slice(0, 6))} placeholder="500" inputMode="numeric" />
        <TextInput label="Postcode" value={estimate.postcode} onChange={v => update('postcode', v.replace(/\D/g, '').slice(0, 4))} placeholder="1010" inputMode="numeric" maxLength={4} />
      </div>

      <EstimateNote>
        Commercial systems are custom-designed against your peak demand, tariff structure, and tax position. Our commercial team will book a site visit and quote with depreciation schedule + IRR.
      </EstimateNote>
    </div>
  );
}

function EstimatePPA({ estimate, update }) {
  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center justify-between mb-2">
          Monthly power bill
          <span className="text-amber-600 dark:text-amber-300 font-extrabold text-base font-mono">${estimate.monthly_spend}</span>
        </label>
        <input type="range" min="500" max="50000" step="500" value={estimate.monthly_spend}
          onChange={e => update('monthly_spend', parseInt(e.target.value))}
          className="w-full accent-amber-500" />
        <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-mono"><span>$500</span><span>$10,000</span><span>$50,000+</span></div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SelectInput label="Business type" value={estimate.business_type} onChange={v => update('business_type', v)}
          options={[
            ['','— Select —'],
            ['office','Office'],['warehouse','Warehouse'],['factory','Factory / manufacturing'],
            ['retail','Retail'],['hospitality','Hospitality'],['agriculture','Agriculture / farm'],
            ['school','School / education'],['other','Other'],
          ]} />
        <SelectInput label="Contract length willing" value={estimate.contract_length} onChange={v => update('contract_length', v)}
          options={[['10','10 years'],['15','15 years'],['20','20 years'],['25','25 years']]} />
        <SelectInput label="Decision-making" value={estimate.decision_makers} onChange={v => update('decision_makers', v)}
          options={[
            ['owner-only','I decide alone'],
            ['small-team','2-3 stakeholders'],
            ['board','Board / formal approval needed'],
          ]} />
        <TextInput label="Postcode" value={estimate.postcode} onChange={v => update('postcode', v.replace(/\D/g, '').slice(0, 4))} placeholder="1010" inputMode="numeric" maxLength={4} />
      </div>

      <EstimateNote>
        Under a PPA you pay no upfront cost — you sign a contract to buy power from us at a discounted rate. Our finance team will design a contract against your site and run you through the terms.
      </EstimateNote>
    </div>
  );
}

// ── Small shared form primitives ──
function TextInput({ label, value, onChange, placeholder, type = 'text', inputMode, maxLength }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">{label}</label>
      <input type={type} value={value} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-300" />
    </div>
  );
}
function SelectInput({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200">
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </div>
  );
}
function EstimateNote({ children }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 text-[11px] text-blue-700 dark:text-blue-300 flex items-start gap-2">
      <Info size={11} className="flex-shrink-0 mt-0.5" />
      <span>{children}</span>
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
// STEP 4 — Projection — hits the existing scenario engine
// (Receives the Step-3 partial ids so the analyzer can link the analysis to
// the lead AND escalate to a team email if review_required fires mid-flow.)
// ════════════════════════════════════════════════════════════════════════════
function Step3Projection({ intent, files, estimate, manualRows, partial, onAnalysisReady, cachedResult, onBack, onNext, onFallbackToManual }) {
  const [loading, setLoading] = useState(!cachedResult);
  const [result, setResult] = useState(cachedResult);
  const [error, setError] = useState('');

  useEffect(() => {
    if (cachedResult) return;
    let cancelled = false;
    (async () => {
      try {
        let data;
        // Step-3 partial ids (when present) ride along so the backend can link
        // the analysis to the lead and escalate review_required cases.
        const partialIds = {
          enquiry_id: partial?.enquiry_id || '',
          contact_id: partial?.contact_id || '',
        };
        if (intent === 'bills') {
          const fd = new FormData();
          for (const f of files) fd.append('files', f);
          if (estimate.postcode) fd.append('postcode', estimate.postcode);
          if (partialIds.enquiry_id) fd.append('enquiry_id', partialIds.enquiry_id);
          if (partialIds.contact_id) fd.append('contact_id', partialIds.contact_id);
          const res = await publicApi.post('/bill-analysis', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
          });
          data = res.data;
        } else if (intent === 'manual_table') {
          // Door D — typed rows from the customer's spreadsheet
          const rows = (manualRows || [])
            .filter(r => r.days && r.kwh && r.total_nzd)
            .map(r => ({
              days:       Number(r.days),
              fixed_nzd:  Number(r.fixed_nzd || 0),
              kwh:        Number(r.kwh),
              usage_nzd:  Number(r.usage_nzd || 0),
              total_nzd:  Number(r.total_nzd),
              month_year: r.month_year || null,
            }));
          const res = await publicApi.post('/bill-analysis/tabular', {
            rows,
            postcode: estimate.postcode || undefined,
            ...partialIds,
          }, { timeout: 60000 });
          data = res.data;
        } else {
          // intent === 'estimate'
          const res = await publicApi.post('/bill-analysis/estimate', {
            monthly_spend: estimate.monthly_spend,
            retailer_id:   estimate.retailer,
            postcode:      estimate.postcode || undefined,
            household_size: estimate.household,
            ...partialIds,
          }, { timeout: 60000 });
          data = res.data;
        }
        if (cancelled) return;
        setResult(data);
        onAnalysisReady(data);
      } catch (e) {
        if (cancelled) return;
        setError(e.response?.data?.error || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);   // intentional: only run once on mount

  if (loading) {
    return (
      <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-12 text-center animate-fade-in">
        <Loader2 size={48} className="animate-spin text-amber-500 mx-auto mb-4" />
        <h1 className="text-xl font-extrabold font-display mb-2 dark:text-gray-100">Crunching your numbers…</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          {intent === 'bills'
            ? `Parsing ${files.length} bill${files.length > 1 ? 's' : ''} · Building 25-year scenarios · Checking retailer switch options`
            : intent === 'manual_table'
              ? `Aggregating your ${(manualRows || []).filter(r => r.days && r.kwh && r.total_nzd).length} bill rows · Building 25-year scenarios`
              : 'Computing your annual kWh from your monthly spend · Building 25-year scenarios'}
        </p>
        <div className="text-[11px] text-gray-400 mt-4">Usually takes 5-15 seconds.</div>
      </div>
    );
  }

  if (error) {
    // If parsing PDFs failed, offer the manual-entry fallback — most NZ retailer
    // PDFs are image-based and pdf-parse can't read them, so this is the most
    // common reason we end up here.
    const offerManual = intent === 'bills' && !!onFallbackToManual;
    return (
      <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-red-200 dark:border-red-500/30 shadow-xl p-8 text-center animate-fade-in">
        <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-extrabold font-display mb-2 dark:text-gray-100">Couldn't read your bills automatically</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 max-w-md mx-auto mb-5">
          {offerManual
            ? 'Many NZ retailer PDFs are image-based and our parser can\'t read them yet. Type the key numbers from your bills below — takes about 2 minutes and gives you a full 25-year projection.'
            : error}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {offerManual && (
            <button onClick={onFallbackToManual} className="px-5 py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-400 transition shadow-md">
              Type my numbers instead →
            </button>
          )}
          <button onClick={onBack} className={`px-5 py-2.5 rounded-xl ${offerManual ? 'border border-gray-200 dark:border-white/15 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5' : 'bg-amber-500 text-white hover:bg-amber-400'} font-bold text-sm transition`}>
            {offerManual ? 'Or try again' : 'Try again'}
          </button>
        </div>
      </div>
    );
  }

  const a = result.analysis;

  // ── REVIEW-REQUIRED BRANCH ──
  // When the bill analysis engine flagged the upload (parse_suspect, multiple
  // addresses, low field confidence, etc.), do NOT show the customer a precise
  // savings projection — those numbers could be 2x wrong. Instead show a
  // "we're verifying" message + the three most popular packages (specs only,
  // no $-amounts — the specialist will quote during the call).
  if (a.review_required) {
    return <Step3ReviewRequired analysis={a} onBack={onBack} onNext={onNext} />;
  }

  const doNothing  = a.scenarios.find(s => s.id === 'do-nothing');
  const solarOnly  = a.scenarios.find(s => s.id === 'solar-only');
  const solarBatt  = a.scenarios.find(s => s.id === 'solar-plus-battery');
  const best       = [...a.scenarios].sort((x, y) => y.net_25yr - x.net_25yr)[0];

  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP 4 OF 5</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-2 dark:text-gray-100">Your projected savings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Based on your {intent === 'bills' ? `${files.length} bill${files.length > 1 ? 's' : ''}` : 'inputs'} · {a.region || 'Auckland'} · 25-year horizon
          {result.confidence_band && <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-[10px] font-bold uppercase tracking-widest">{result.confidence_band} confidence</span>}
        </p>
      </div>

      {/* Hero number — net savings of best scenario */}
      <div className="rounded-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-amber-950 p-6 md:p-8 text-center text-white relative overflow-hidden mb-5">
        <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-amber-500 to-orange-500 opacity-20 blur-3xl rounded-full" />
        <div className="text-[10px] font-extrabold tracking-widest text-amber-300 mb-1 relative">YOUR 25-YEAR NET SAVINGS</div>
        <div className="text-5xl md:text-6xl font-extrabold font-display bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent relative">
          {fmt$(best.net_25yr)}
        </div>
        <div className="text-[11px] text-gray-400 mt-1 relative">vs continuing your current bills</div>

        <div className="grid grid-cols-3 gap-3 mt-6 max-w-xl mx-auto relative">
          <StatPill label="Payback" value={`${best.payback_years} yr`} />
          <StatPill label="System" value={`${a.recommendation.recommended_system_kw} kW`} />
          <StatPill label="Battery" value={a.recommendation.recommended_battery_kwh > 0 ? `${a.recommendation.recommended_battery_kwh} kWh` : '—'} />
        </div>
      </div>

      {/* Scenario summary cards */}
      <div className="grid md:grid-cols-3 gap-3 mb-5">
        {doNothing && (
          <div className="bg-red-50 dark:bg-red-500/10 rounded-xl border border-red-100 dark:border-red-500/20 p-4 text-center">
            <div className="text-[10px] uppercase tracking-widest text-red-700 dark:text-red-300 font-bold mb-1">Doing nothing</div>
            <div className="text-2xl font-extrabold font-display text-red-700 dark:text-red-300">{fmt$(doNothing.year_25_cost)}</div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">25-yr cost</div>
          </div>
        )}
        {solarOnly && (
          <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-100 dark:border-amber-500/20 p-4 text-center">
            <div className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-300 font-bold mb-1">Solar only</div>
            <div className="text-2xl font-extrabold font-display text-amber-700 dark:text-amber-300">{fmt$(solarOnly.net_25yr)}</div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">25-yr net gain</div>
          </div>
        )}
        {solarBatt && (
          <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/20 p-4 text-center">
            <div className="text-[10px] uppercase tracking-widest text-emerald-700 dark:text-emerald-300 font-bold mb-1">Solar + battery</div>
            <div className="text-2xl font-extrabold font-display text-emerald-700 dark:text-emerald-300">{fmt$(solarBatt.net_25yr)}</div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">25-yr net gain</div>
          </div>
        )}
      </div>

      {/* Energy snapshot — the data we used to calculate */}
      <div className="bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 p-5 mb-5">
        <div className="text-[10px] font-extrabold tracking-widest text-gray-500 dark:text-gray-400 mb-3">YOUR ENERGY SNAPSHOT — THE NUMBERS BEHIND THE PROJECTION</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SnapStat label="Annual usage"    value={`${a.aggregate.annual_kwh.toLocaleString()} kWh`} />
          <SnapStat label="Annual spend"    value={fmt$(a.aggregate.annual_spend_nzd)} />
          <SnapStat label="Effective rate"  value={`${(a.aggregate.effective_rate_nzd * 100).toFixed(1)}c/kWh`} />
          <SnapStat label="Current retailer" value={a.aggregate.retailer || '—'} sub={a.aggregate.plan_name} />
        </div>
      </div>

      {/* ─── Tabbed deep-dive: insights / transparency / scenarios table ─── */}
      <DeepDive analysis={a} />

      <div className="rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 border border-amber-200 dark:border-amber-500/30 p-5 text-center my-5">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Want this tailored to your home with 3 system options?
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
          One more step — your contact details so Eric can call within 24h.
        </p>
      </div>

      {/* Disclaimer */}
      {a.transparency?.disclaimer && (
        <div className="px-4 py-3 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed mb-5">
          <strong className="text-gray-700 dark:text-gray-300">Disclaimer:</strong> {a.transparency.disclaimer}
        </div>
      )}

      <div className="flex items-center justify-between pt-5 border-t border-gray-100 dark:border-white/10">
        <button onClick={onBack}
          className="px-3 py-2 -ml-3 rounded-lg text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-50">← Back</button>
        <button onClick={onNext} className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm hover:opacity-90 transition flex items-center gap-2 shadow-md shadow-amber-500/30">
          Get my tailored proposal <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Step 3 — REVIEW REQUIRED branch ─────────────────────────────────────
// Rendered when the bill analysis engine flagged the upload (parse_suspect,
// multi-address, low field confidence, etc.). Shows a verification message
// + 3 popular packages with system specs only — NO $-amounts (sales quotes
// the price during the verification call).
function Step3ReviewRequired({ analysis, onBack, onNext }) {
  const [packages, setPackages] = useState(null);
  const [loadErr, setLoadErr]   = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await publicApi.get('/packages/public');
        if (cancelled) return;
        // Show the 3 we recommend by default: the recommended slug + 2 others.
        // If recommended slug not in catalogue, just take the top 3 by sort_order.
        const recommended = analysis.recommendation?.recommended_package_slug;
        const sorted = (data || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const picked = recommended
          ? [sorted.find(p => p.slug === recommended), ...sorted.filter(p => p.slug !== recommended)].filter(Boolean).slice(0, 3)
          : sorted.slice(0, 3);
        setPackages(picked);
      } catch (e) {
        if (!cancelled) setLoadErr(e.response?.data?.error || e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [analysis]);

  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP 4 OF 5</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-2 dark:text-gray-100">We're verifying your bills</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
          Thanks — we've received your bills. Our analysis found a few things worth verifying
          with you before we issue a precise savings quote. <strong className="text-gray-700 dark:text-gray-200">
          A specialist will call within 24 hours</strong> to walk through your real usage and
          recommend the right system.
        </p>
      </div>

      {/* Honest "why" — small print so customer trusts the friction */}
      <div className="bg-amber-50 dark:bg-amber-500/10 border-l-4 border-amber-400 p-4 rounded-r-lg mb-6">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-amber-600 dark:text-amber-300 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-800 dark:text-amber-200 mb-1">Why we're calling instead of auto-quoting:</p>
            <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
              <li>• Solar economics scale with your real usage — getting it right matters more than getting it fast</li>
              <li>• A few items on your bills need a human eye to confirm what's energy use vs one-off charges</li>
              <li>• The system size we recommend during the call will be honest, not optimistic</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="text-center mb-4">
        <h2 className="text-base font-extrabold dark:text-gray-100 mb-1">In the meantime — here's what most NZ homes choose</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">Browse what suits you. Final pricing tailored to your home during the call.</p>
      </div>

      {/* Package cards — SPECS ONLY, NO PRICES */}
      {!packages && !loadErr && (
        <div className="text-center py-8">
          <Loader2 size={24} className="animate-spin text-amber-500 mx-auto" />
        </div>
      )}
      {loadErr && (
        <div className="text-center py-6 text-xs text-red-500">Could not load packages — your specialist will walk you through them on the call.</div>
      )}
      {packages && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          {packages.map(pkg => (
            <a
              key={pkg.slug}
              href={`/solar-packages/${pkg.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border-2 border-gray-200 dark:border-white/10 hover:border-amber-400 transition p-4 bg-white dark:bg-brand-dark-1"
            >
              {pkg.badge && (
                <div className="inline-block text-[9px] font-extrabold tracking-widest text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20 rounded-full px-2 py-0.5 mb-2">
                  {pkg.badge}
                </div>
              )}
              <div className="text-base font-extrabold dark:text-gray-100 mb-1">{pkg.name}</div>
              <div className="space-y-1.5 mt-3">
                <div className="flex items-center gap-2 text-xs">
                  <Sun size={12} className="text-amber-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300"><strong>{pkg.system_kw} kW</strong> solar</span>
                </div>
                {pkg.battery_kwh > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <Battery size={12} className="text-emerald-500 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300"><strong>{pkg.battery_kwh} kWh</strong> battery</span>
                  </div>
                )}
                {pkg.description && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mt-2 line-clamp-2">{pkg.description}</div>
                )}
              </div>
              <div className="mt-3 text-[10px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1">
                View details <ArrowRight size={10} />
              </div>
            </a>
          ))}
        </div>
      )}

      <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 border border-amber-200 dark:border-amber-500/30 p-5 rounded-xl text-center mb-5">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Almost done — one more step so we can call you
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
          Your contact details on the next page, then our specialist will be in touch within 24 hours.
        </p>
      </div>

      <div className="flex items-center justify-between pt-5 border-t border-gray-100 dark:border-white/10">
        <button onClick={onBack}
          className="px-3 py-2 -ml-3 rounded-lg text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-50">← Back</button>
        <button onClick={onNext} className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm hover:opacity-90 transition flex items-center gap-2 shadow-md shadow-amber-500/30">
          Continue to contact details <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function SnapStat({ label, value, sub }) {
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-lg border border-gray-100 dark:border-white/10 p-3 text-center">
      <div className="text-[9px] text-gray-400 uppercase tracking-widest font-bold mb-1">{label}</div>
      <div className="text-base font-extrabold dark:text-gray-100 truncate">{value}</div>
      {sub && <div className="text-[9px] text-gray-400 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

// ── Deep-dive tabbed view: Scenarios / Insights / How we calculated this ──
function DeepDive({ analysis }) {
  const [tab, setTab] = useState('scenarios');
  return (
    <div>
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-white/10 overflow-x-auto">
        <TabBtn label="Compare scenarios" active={tab === 'scenarios'} onClick={() => setTab('scenarios')} />
        <TabBtn label="Insights" active={tab === 'insights'} onClick={() => setTab('insights')} count={analysis.patterns?.length || 0} />
        <TabBtn label="How we calculated this" active={tab === 'transparency'} onClick={() => setTab('transparency')} />
      </div>
      {tab === 'scenarios'    && <ScenariosTable scenarios={analysis.scenarios} switchAdvice={analysis.switch_advice} />}
      {tab === 'insights'     && <PatternsList patterns={analysis.patterns || []} switchAdvice={analysis.switch_advice} />}
      {tab === 'transparency' && <TransparencyView t={analysis.transparency} />}
    </div>
  );
}

function TabBtn({ label, active, onClick, count }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 whitespace-nowrap
        ${active ? 'border-amber-500 text-amber-600 dark:text-amber-300' : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
      {label}
      {count > 0 && <span className="text-[9px] bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 rounded-full px-1.5 py-0.5">{count}</span>}
    </button>
  );
}

function ScenariosTable({ scenarios, switchAdvice }) {
  const orderedIds = ['do-nothing', 'switch-retailer', 'solar-only', 'solar-plus-battery'];
  const ordered = orderedIds.map(id => scenarios.find(s => s.id === id)).filter(Boolean);
  const best = [...scenarios].sort((a, b) => b.net_25yr - a.net_25yr)[0];
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-xl border border-gray-100 dark:border-white/10 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10">
          <tr>
            <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-400 uppercase">Option</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">Upfront</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">Year 1</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">Year 25</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">Payback</th>
            <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 uppercase">25-yr Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-white/5">
          {ordered.map(s => (
            <tr key={s.id} className={best.id === s.id ? 'bg-emerald-50/40 dark:bg-emerald-500/5' : ''}>
              <td className="px-3 py-3">
                <div className="font-bold dark:text-gray-100">{s.label}</div>
                {s.id === 'switch-retailer' && switchAdvice && (
                  <div className="text-[9px] text-blue-600 mt-0.5">Save {fmt$(switchAdvice.annualSaving)}/yr</div>
                )}
              </td>
              <td className="px-3 py-3 text-right dark:text-gray-200">{s.upfront_cost === 0 ? '—' : fmt$(s.upfront_cost)}</td>
              <td className="px-3 py-3 text-right dark:text-gray-200">
                <div className="font-semibold">{fmt$(s.year_1_cost)}</div>
                {s.year_1_cost_range && (
                  <div className="text-[9px] text-gray-400">{fmt$(s.year_1_cost_range.low)} – {fmt$(s.year_1_cost_range.high)}</div>
                )}
              </td>
              <td className="px-3 py-3 text-right font-semibold dark:text-gray-200">{fmt$(s.year_25_cost)}</td>
              <td className="px-3 py-3 text-right dark:text-gray-200">
                {s.payback_years === null ? <span className="text-red-500 font-semibold">never</span>
                 : s.payback_years === 0 ? <span className="text-emerald-600 font-semibold">0 (free)</span>
                 : `${s.payback_years} yrs`}
              </td>
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

function PatternsList({ patterns, switchAdvice }) {
  if (patterns.length === 0 && !switchAdvice) {
    return <div className="text-center py-8 text-sm text-gray-400">No specific patterns detected — your usage looks typical for an NZ household.</div>;
  }
  const sevColors = {
    info:     'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30',
    warning:  'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
    positive: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  };
  return (
    <div className="space-y-3">
      {switchAdvice && (
        <div className="bg-white dark:bg-brand-dark-1 rounded-xl border-2 border-blue-200 dark:border-blue-500/40 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-blue-600 dark:text-blue-400" />
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-blue-700 dark:text-blue-300">Switch retailer (independent advice)</div>
          </div>
          <div className="text-sm font-bold mb-1 dark:text-gray-100">Switch to {switchAdvice.retailerName} {switchAdvice.planName}</div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Save approximately <strong>{fmt$(switchAdvice.annualSaving)}/year</strong> based on your usage profile — before you do anything else. We don't earn commission from this; it's just what the numbers say.
          </div>
        </div>
      )}
      {patterns.map((p, i) => (
        <div key={i} className={`rounded-xl border p-4 ${sevColors[p.severity] || sevColors.info}`}>
          <div className="text-sm font-bold mb-1">{p.label}</div>
          <div className="text-xs mb-2">{p.details}</div>
          {p.recommendation && <div className="text-[11px] italic">{p.recommendation}</div>}
        </div>
      ))}
    </div>
  );
}

function TransparencyView({ t }) {
  if (!t) return <div className="text-xs text-gray-400 py-6 text-center">No transparency data available for this analysis.</div>;
  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-brand-dark-1 rounded-xl border border-gray-100 dark:border-white/10 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Info size={14} className="text-amber-500" />
          <div className="text-sm font-bold dark:text-gray-100">
            Confidence in this analysis: <span className="text-amber-600 dark:text-amber-300 uppercase">{t.overall_confidence}</span>
          </div>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-300 mb-3">{t.confidence_explanation}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          Data current as of {t.as_of} · Next refresh due {t.next_data_refresh_due}
        </div>
      </div>

      {t.data_sources && (
        <Collapsible title="Public data sources" count={t.data_sources.length}>
          <ul className="space-y-2 text-xs">
            {t.data_sources.map((s, i) => (
              <li key={i} className="flex flex-col">
                <span className="font-semibold dark:text-gray-200">{s.name}</span>
                <span className="text-gray-500 dark:text-gray-400">{s.source}</span>
                {s.value_used && <span className="text-amber-600 dark:text-amber-300 font-mono text-[10px]">value used: {s.value_used}</span>}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      {t.assumptions && (
        <Collapsible title="Key assumptions" count={t.assumptions.length}>
          <ul className="space-y-2 text-xs">
            {t.assumptions.map((a, i) => (
              <li key={i}>
                <div className="font-semibold dark:text-gray-200">
                  {a.label} = <span className="font-mono">{typeof a.value === 'number' && a.value < 1 && a.value > 0 ? (a.value * 100).toFixed(1) + '%' : a.value}</span>
                </div>
                <div className="text-gray-500 dark:text-gray-400">Basis: {a.basis}</div>
                {a.why_matters && <div className="text-amber-600 dark:text-amber-300 italic">Why it matters: {a.why_matters}</div>}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      {t.limitations && (
        <Collapsible title="Known limitations" count={t.limitations.length}>
          <ul className="space-y-3 text-xs">
            {t.limitations.map((l, i) => (
              <li key={i} className="p-3 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
                <div className="font-semibold dark:text-gray-200">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded mr-2 ${l.severity === 'high' ? 'bg-red-100 text-red-700' : l.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>{l.severity}</span>
                  {l.label}
                </div>
                <div className="text-gray-600 dark:text-gray-400 mt-1">{l.impact}</div>
                {l.mitigation && <div className="text-emerald-700 dark:text-emerald-300 italic mt-1">→ {l.mitigation}</div>}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      {t.methodology_summary && (
        <Collapsible title="Methodology">
          <div className="text-xs text-gray-700 dark:text-gray-300">{t.methodology_summary}</div>
          {t.sensitivity?.basis && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">Sensitivity basis: {t.sensitivity.basis}</div>
          )}
        </Collapsible>
      )}
    </div>
  );
}

function Collapsible({ title, count, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-xl border border-gray-100 dark:border-white/10 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/5 transition">
        <div className="text-sm font-bold flex items-center gap-2 dark:text-gray-100">
          {title}
          {count != null && <span className="text-[9px] bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 rounded-full px-1.5 py-0.5">{count}</span>}
        </div>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''} dark:text-gray-400`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-white/10">{children}</div>}
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div className="rounded-xl bg-white/10 border border-white/10 py-3">
      <div className="text-[9px] uppercase tracking-widest text-amber-200 font-bold">{label}</div>
      <div className="text-xl font-extrabold font-display text-amber-300">{value}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 5 — Final details — address + property + (callback) OTP — submits to /api/quote/submit
//
// At this point Step 3 has already captured name/email/phone into a partial
// website_enquiries row. This step enriches that row (via enquiry_id passed
// back in form) with the address + property details and promotes status
// 'partial' → 'new'. We show captured contact details as a summary banner;
// the customer can still tap "edit" to fix typos.
// ════════════════════════════════════════════════════════════════════════════
function Step4ContactForm({ intent, customerType, estimate, analysisId, analysisResult, contact, setContact, otp, setOtp, submitState, onBack, onSubmit }) {
  const set = (k, v) => setContact(c => ({ ...c, [k]: v }));
  const [editContact, setEditContact] = useState(false);

  const teamLabel =
    customerType === 'commercial' ? 'Our commercial team'
    : customerType === 'off-grid'  ? 'Our off-grid specialist'
    : customerType === 'ppa'       ? 'Our finance team'
    :                                'Eric (our sales lead)';
  const responseWindow = customerType === 'residential' ? 'within 24 hours' : 'within 2 business days';

  const subtitle = intent === 'callback'
    ? `Almost done — these last few details help ${teamLabel.toLowerCase()} make a useful call ${responseWindow}.`
    : analysisResult
      ? `One more step — confirm your address so ${teamLabel.toLowerCase()} can call ${responseWindow} to walk through your projection.`
      : `One more step — confirm your address so ${teamLabel.toLowerCase()} can call ${responseWindow}.`;

  // OTP is REQUIRED for callback-only intent (no bills, no projection — we
  // need extra signal the customer is genuine). For bills/estimate intents,
  // OTP is optional — they've already given us real data.
  const otpRequired = intent === 'callback';
  const phoneVerifiedOk = !otpRequired || otp.verified;

  // Address + property fields are ALWAYS required at the final step now —
  // sales can't quote or schedule a survey without an address regardless of
  // intent. Roof/owns_home are optional for bills/estimate (specialist can
  // ask on the call) but required for callback (no other context to work from).
  const detailsRequired = intent === 'callback';

  const addressOk = !!contact.address;
  const detailsOk = !detailsRequired || (
    contact.owns_home && contact.roof_type && contact.installation_timeframe
  );

  // Captured-at-Step-3 fields are guaranteed populated when we land here.
  // We still defensively check in case the customer somehow short-circuited.
  const captureOk = contact.firstName && contact.email && contact.phone;

  const requiredOk = captureOk && addressOk && phoneVerifiedOk && detailsOk;

  const sendOtp = async () => {
    if (!contact.phone) return;
    setOtp(s => ({ ...s, loading: true, error: '', demoCode: '' }));
    try {
      const { data } = await publicApi.post('/otp/send', { phone: contact.phone });
      setOtp(s => ({ ...s, loading: false, sent: true, demoCode: data.demoOtp || '' }));
    } catch (e) {
      setOtp(s => ({ ...s, loading: false, error: e.response?.data?.error || 'Failed to send OTP.' }));
    }
  };

  const verifyOtp = async () => {
    setOtp(s => ({ ...s, loading: true, error: '' }));
    try {
      await publicApi.post('/otp/verify', { phone: contact.phone, otp: otp.value });
      setOtp(s => ({ ...s, loading: false, verified: true, sent: false, demoCode: '' }));
    } catch (e) {
      setOtp(s => ({ ...s, loading: false, error: e.response?.data?.error || 'Invalid OTP.' }));
    }
  };

  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">STEP {intent === 'callback' || customerType !== 'residential' ? '4 OF 4' : '5 OF 5'}</div>
        <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-2 dark:text-gray-100">Final details</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>

      <div className="space-y-4">
        {/* Captured contact summary — name/email/phone collected at Step 3 */}
        {!editContact ? (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-500/5 p-3 flex items-center gap-3">
            <CheckCircle size={16} className="text-emerald-500 flex-shrink-0" />
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-bold text-gray-800 dark:text-gray-100 truncate">
                {[contact.firstName, contact.lastName].filter(Boolean).join(' ') || '—'}
              </div>
              <div className="text-gray-500 dark:text-gray-400 truncate">
                {contact.email} · {contact.phone}
              </div>
            </div>
            <button type="button" onClick={() => setEditContact(true)}
              className="px-3 py-2 -mr-1 rounded-lg text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-100/50 dark:hover:bg-amber-500/10 whitespace-nowrap">Edit</button>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name *" value={contact.firstName} onChange={v => set('firstName', v)} placeholder="John" />
              <Field label="Last name *"  value={contact.lastName}  onChange={v => set('lastName', v)}  placeholder="Smith" />
            </div>
            <Field label="Email *" value={contact.email} onChange={v => set('email', v)} placeholder="john@example.com" type="email" />
            <div className="text-right">
              <button type="button" onClick={() => setEditContact(false)}
                className="px-3 py-2 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/50 dark:hover:bg-emerald-500/10">Done editing</button>
            </div>
          </div>
        )}

        {/* Phone OTP verification — callback intent only. Verifies the phone
            number captured at Step 3 (we don't re-collect it here). */}
        {otpRequired && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/5 p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                Verify {contact.phone || 'your phone'} <span className="text-red-500">*</span>
                {otp.verified && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-300 normal-case font-semibold ml-1"><CheckCircle size={11} /> Verified</span>}
              </label>
              {!otp.verified && (
                <button onClick={sendOtp} disabled={!contact.phone || otp.loading}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold transition disabled:opacity-50 whitespace-nowrap flex items-center gap-1">
                  {otp.loading && !otp.sent ? <Loader2 size={13} className="animate-spin" /> : null}
                  {otp.sent ? 'Resend' : 'Send OTP'}
                </button>
              )}
            </div>

            {otp.demoCode && (
              <div className="mt-2 px-3 py-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg flex items-center justify-between">
                <span className="text-[10px] text-blue-600 dark:text-blue-300 font-semibold">Demo OTP (no SMS key set):</span>
                <span className="text-sm font-extrabold text-blue-700 dark:text-blue-200 tracking-[0.25em]">{otp.demoCode}</span>
              </div>
            )}

            {otp.sent && !otp.verified && (
              <div className="mt-2 space-y-1.5">
                <div className="flex gap-2">
                  <input type="text" inputMode="numeric" maxLength={6} placeholder="Enter 6-digit code"
                    value={otp.value}
                    onChange={e => setOtp(s => ({ ...s, value: e.target.value.replace(/\D/g, ''), error: '' }))}
                    className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 transition text-center font-bold tracking-[0.3em]" />
                  <button onClick={verifyOtp} disabled={otp.value.length !== 6 || otp.loading}
                    className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold transition disabled:opacity-50 flex items-center gap-1">
                    {otp.loading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                    Verify
                  </button>
                </div>
                {otp.error && <p className="text-[10px] text-red-500 font-medium">{otp.error}</p>}
                <p className="text-[9px] text-gray-400 dark:text-gray-500">Code expires in 5 minutes.</p>
              </div>
            )}

            {!otp.verified && !otp.sent && (
              <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1 flex items-center gap-1">
                <Info size={10} /> We verify callback numbers so our sales team isn't chasing wrong numbers.
              </p>
            )}
          </div>
        )}

        {/* Open notes — anything else the customer wants the sales rep to know */}
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">
            Anything else to mention? <span className="text-gray-300 dark:text-gray-600 font-normal normal-case">(optional)</span>
          </label>
          <textarea
            value={contact.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="e.g. 'We're getting an EV in 2026 — can you size for that?' / 'Best to call after 6pm' / 'We've had quotes from X and Y — interested in your difference'"
            rows={3}
            maxLength={1000}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y" />
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 text-right font-mono">
            {(contact.notes || '').length} / 1000
          </div>
        </div>

        {/* Property details — required when callback intent, optional otherwise */}
        <DetailsSection
          required={detailsRequired}
          intent={intent}
          contact={contact}
          set={set}
        />
      </div>

      {submitState.error && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-[11px] text-red-700 dark:text-red-300">
          {submitState.error}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={!requiredOk || submitState.loading}
        className="mt-6 w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-extrabold text-base hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md shadow-amber-500/30">
        {submitState.loading
          ? <><Loader2 size={16} className="animate-spin" /> Submitting…</>
          : <>Submit · {teamLabel} will call {responseWindow} <Send size={14} /></>}
      </button>

      <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mt-3">
        By submitting, you agree to be contacted by a Goldenray specialist.
      </p>

      <div className="flex items-center justify-center mt-5 pt-5 border-t border-gray-100 dark:border-white/10">
        <button onClick={onBack}
          className="px-4 py-2 rounded-lg text-sm font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">
          ← {analysisResult ? 'Back to savings' : 'Back'}
        </button>
      </div>
    </div>
  );
}

// Property details. Address is ALWAYS required at the final step (sales needs
// it to schedule a survey regardless of intent). owns_home / roof_type /
// installation_timeframe are required for callback intent only — for
// bills/estimate intent they're optional, the specialist can confirm on the
// call. Always uses NZ AddressAutocomplete so postcode + suburb get auto-filled.
function DetailsSection({ required, intent, contact, set }) {
  const [open, setOpen] = useState(true);  // always open — address is required even when other fields aren't

  const handleAddressSelect = (parsed) => {
    set('address',         parsed.formatted);
    set('addressStreet',   parsed.street);
    set('addressSuburb',   parsed.suburb);
    set('addressCity',     parsed.city);
    set('addressPostcode', parsed.postcode);
  };

  const Body = (
    <div className={`p-4 space-y-3 ${required ? '' : 'border-t border-gray-100 dark:border-white/10'}`}>
      {/* Address with NZ autocomplete — required at final step regardless of intent */}
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
          Address <span className="text-red-500">*</span>
        </label>
        <AddressAutocomplete
          value={contact.address}
          onChange={(e) => set('address', e.target.value)}
          onSelect={handleAddressSelect}
        />
        {/* Show parsed components as confirmation pills once an address is selected */}
        {(contact.addressStreet || contact.addressSuburb || contact.addressCity || contact.addressPostcode) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {contact.addressStreet   && <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{contact.addressStreet}</span>}
            {contact.addressSuburb   && <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{contact.addressSuburb}</span>}
            {contact.addressCity     && <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{contact.addressCity}</span>}
            {contact.addressPostcode && <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{contact.addressPostcode}</span>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SelectField label={`Own home? ${required ? '*' : ''}`} value={contact.owns_home} onChange={v => set('owns_home', v)}
          options={[{value:'',label:'—'},{value:'yes',label:'Yes'},{value:'no',label:'No'}]} />
        <SelectField label={`Roof type ${required ? '*' : ''}`} value={contact.roof_type} onChange={v => set('roof_type', v)}
          options={[{value:'',label:'—'},
            {value:'corrugated-iron',label:'Coloursteel'},
            {value:'concrete-tiles', label:'Concrete tile'},
            {value:'clay-tiles',     label:'Clay tile'},
            {value:'flat-membrane',  label:'Flat membrane'},
            {value:'other',          label:'Other'}]} />
        <SelectField label="Battery preference" value={contact.battery_option} onChange={v => set('battery_option', v)}
          options={[{value:'',label:'—'},
            {value:'with-battery',   label:'With battery'},
            {value:'without-battery',label:'Without'},
            {value:'unsure',         label:'Unsure'}]} />
        <SelectField label={`Install when? ${required ? '*' : ''}`} value={contact.installation_timeframe} onChange={v => set('installation_timeframe', v)}
          options={[{value:'',label:'—'},
            {value:'asap',         label:'ASAP'},
            {value:'1-month',      label:'Within 1 month'},
            {value:'1-3-months',   label:'1-3 months'},
            {value:'3-6-months',   label:'3-6 months'},
            {value:'6-12-months',  label:'6-12 months'},
            {value:'researching',  label:'Just researching'}]} />
      </div>
    </div>
  );

  if (required) {
    // Open + required header
    return (
      <div className="bg-amber-50/40 dark:bg-amber-500/5 rounded-xl border border-amber-200 dark:border-amber-500/30">
        <div className="px-4 py-3 text-xs font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2">
          <Info size={12} /> Required for callback enquiries — helps our sales rep make a useful call
        </div>
        {Body}
      </div>
    );
  }

  // Bills / estimate / manual intent — address required, rest optional
  return (
    <div className="bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10">
      <div className="px-4 py-3 text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
        <Home size={12} /> Address + property details
      </div>
      {Body}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">{label}</label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-300" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-brand-dark dark:text-gray-200">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 5 — Confirmation
// ════════════════════════════════════════════════════════════════════════════
function Step5Confirmation({ contact, customerType }) {
  const isCommercial = customerType === 'commercial' || customerType === 'ppa';
  const isOffGrid    = customerType === 'off-grid';
  const teamLabel =
    customerType === 'commercial' ? 'Our commercial team'
    : customerType === 'off-grid'  ? 'Our off-grid specialist'
    : customerType === 'ppa'       ? 'Our finance team'
    :                                'Eric';
  const responseWindow = customerType === 'residential' ? 'within 24h' : 'within 2 business days';

  const steps = customerType === 'residential' ? [
    'Email confirmation in a few minutes',
    `Eric calls ${responseWindow} with 3 system options`,
    'Free on-site survey (typically 5-7 days)',
    'Detailed proposal + install schedule within 1 week',
  ] : isOffGrid ? [
    'Email confirmation in a few minutes',
    `Off-grid specialist calls ${responseWindow} to walk through your needs`,
    'On-site survey scheduled to map roof + battery location + generator setup',
    'Custom-designed system + quote with autonomy guarantee (~2 weeks)',
  ] : customerType === 'commercial' ? [
    'Email confirmation in a few minutes',
    `Commercial team calls ${responseWindow} to discuss your operation`,
    'On-site survey + tariff analysis (typically 1-2 weeks)',
    'Custom proposal with depreciation schedule + IRR (~3 weeks total)',
  ] : [   // ppa
    'Email confirmation in a few minutes',
    `Finance team calls ${responseWindow} to review your suitability`,
    'On-site survey + tariff modelling (typically 2-3 weeks)',
    'PPA contract draft + per-kWh rate proposal (~4-6 weeks total)',
  ];

  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-emerald-200 dark:border-emerald-500/30 shadow-xl p-8 text-center animate-fade-in">
      <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-300 text-4xl mb-4">✓</div>
      <h1 className="text-2xl md:text-3xl font-extrabold font-display mb-3 dark:text-gray-100">
        {contact?.firstName ? `Thanks ${contact.firstName}!` : 'Got it!'} {teamLabel} will call {responseWindow}.
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
        {customerType === 'residential'
          ? <>We'll prepare 3 tailored system options. Look for a call from <strong>+64 21 839 356</strong>.</>
          : isCommercial
            ? <>We'll prepare a custom site assessment. Look for a call from <strong>+64 21 839 356</strong>.</>
            : <>We'll prepare a custom off-grid design. Look for a call from <strong>+64 21 839 356</strong>.</>}
      </p>
      <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-200 dark:border-amber-500/30 p-5 max-w-md mx-auto text-left mb-6">
        <div className="text-[10px] font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">WHAT HAPPENS NEXT</div>
        <ul className="space-y-2 text-xs text-gray-700 dark:text-gray-300">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2"><span className="text-amber-600 font-bold">{i + 1}.</span> {s}</li>
          ))}
        </ul>
      </div>
      <Link to="/" className="text-xs font-bold text-amber-700 dark:text-amber-300 hover:underline">← Back to home</Link>
    </div>
  );
}
