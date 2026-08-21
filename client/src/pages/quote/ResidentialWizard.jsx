// ResidentialWizard — the merged 5-step flow for residential quotes.
//
// Created 2026-08-20 as Phase B1 ticket B1.1 of the /get-quote + /poc/quote
// integration ([[project-quote-flow-integration-plan]]).
//
// Renders when GetQuotePage.jsx routes residential customers here after
// Step 1 (intent picker). Manages its own 5-step state machine. Commercial /
// off-grid / PPA customers stay on the legacy GetQuotePage flow.
//
// The 5 steps (per locked plan):
//   1. Usage       — tabbed input (bills / spend / kWh). Contact NOT collected.
//   2. Your house  — Places autocomplete + Leaflet drag pin (reuses POC's PreviewStage).
//   3. Analysis    — Google Solar → LiDAR → OSM (reuses POC's analyseAddress + EnergyFlowOverlay).
//   4. Your system — 3D Cesium + 3 tiers + Customise (reuses POC's QuoteStage). Material picker inline.
//   5. Get quote   — contact form on chosen tier → POST /api/quote/submit-with-design → PDF + next-step CTAs.
//
// This session (2026-08-20) ships JUST the shell — a working 5-step state
// machine with placeholder content in each step. Subsequent B1 tickets
// (B1.2 → B1.6) fill in the real step content one at a time so we can
// checkpoint and E2E-verify between each.

import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronLeft, AlertTriangle, Mail, CheckCircle, Loader2 } from 'lucide-react';
import { publicApi } from '../../services/api';
import Step1Usage from './Step1Usage';
import Step2House from './Step2House';
import Step3Analysis from './Step3Analysis';
import Step4System from './Step4System';
import Step5Quote from './Step5Quote';

// Stable identity key for an address — prefers place_id (Google's) since
// it's a canonical string, falls back to formattedAddress. Used by the F5
// re-analyse modal to detect that the customer actually changed address vs
// just clicking through the same one.
function addressKey(a) {
  if (!a) return null;
  return a.place_id || a.formattedAddress || `${a.latitude},${a.longitude}`;
}

// Phase B2 draft persistence (2026-08-20). Save wizard state to sessionStorage
// so a browser refresh mid-flow doesn't lose the customer's progress. Skips
// the transient bits (upload File objects, Set instances) and stores only
// serialisable data. Auto-restores on next mount within the same session.
// Full server-side draft persistence + magic-link resume comes with I3 in a
// later ticket — this handles the same-session case only.
const DRAFT_KEY = 'poc:quote:draft:v1';
function serialiseDraft({ stepIdx, usage, address, analysis, design, chosenTier, contact }) {
  try {
    const safe = {
      stepIdx,
      usage: usage ? {
        tab: usage.tab || null,
        // bill is already a plain server-return object; safe to serialise
        bill: usage.bill || null,
        monthlySpend: usage.monthlySpend ?? null,
        annualKwh: usage.annualKwh ?? null,
        extractedAddress:  usage.extractedAddress  || null,
        extractedPostcode: usage.extractedPostcode || null,
      } : null,
      address: address || null,
      analysis: analysis || null,     // large, ~50-200 KB — sessionStorage handles it
      design:   design   || null,
      chosenTier: chosenTier ? {
        id: chosenTier.id || null,
        // Serialise a small subset of the tier to keep quota use down.
        tier: chosenTier.tier ? {
          label: chosenTier.tier.label,
          panel: chosenTier.tier.panel,
          battery: chosenTier.tier.battery,
          wattpilot_included: chosenTier.tier.wattpilot_included,
          price_inc_gst: chosenTier.tier.price_inc_gst,
        } : null,
      } : null,
      contact: contact || null,
      _savedAt: new Date().toISOString(),
    };
    return JSON.stringify(safe);
  } catch {
    return null;
  }
}
function readDraft() {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* corrupt or blocked */ }
  return null;
}
function writeDraft(payload) {
  try {
    if (typeof window === 'undefined') return;
    const s = serialiseDraft(payload);
    if (s) window.sessionStorage?.setItem(DRAFT_KEY, s);
  } catch { /* quota / private mode — non-fatal */ }
}
function clearDraft() {
  try { if (typeof window !== 'undefined') window.sessionStorage?.removeItem(DRAFT_KEY); }
  catch { /* noop */ }
}

// Step definitions — order + labels only. Step components fill in per ticket.
const STEPS = [
  { key: 'usage',    label: 'Your usage'        },
  { key: 'house',    label: 'Your house'        },
  { key: 'analysis', label: 'Roof analysis'     },
  { key: 'system',   label: 'Your system'       },
  { key: 'quote',    label: 'Get this quote'    },
];

/**
 * ResidentialWizard — 5-step container for the merged residential quote flow.
 *
 * @param {object}   props
 * @param {string}   [props.intent]              — carried over from Step 1 of GetQuotePage: 'bills' | 'estimate' | 'manual_table' | null
 * @param {object}   [props.utm]                 — QR/UTM attribution passed from GetQuotePage
 * @param {object}   [props.resumeInitialState]  — Phase B2 I3 magic-link resume payload. Shape matches server GET /api/quote/resume/:id response: { form:{firstName,lastName,email,phone}, address, usage, chosenTier, draftIds, farthest_step }. When provided, TAKES PRECEDENCE over the sessionStorage draft (customer arrived on this device from an email link — the fresh server data is authoritative). Enables StepRail forward-jump up to farthest_step so the customer can pick right back up.
 * @param {function} props.onBack                — return to GetQuotePage Step 1
 */
export default function ResidentialWizard({ intent = null, utm = null, resumeInitialState = null, onBack }) {
  // Hydrate from resume payload FIRST (Phase B2 I3, 2026-08-21), then fall
  // back to sessionStorage draft (Phase B2 same-tab refresh persistence).
  // Resume-from-email is always fresher than any local draft — it comes from
  // the server row the customer left behind, potentially days ago on a
  // different device. If we let the local draft win we'd stomp the good
  // rehydration with stale/empty state.
  const draft = useRef(null);
  if (draft.current === null) draft.current = resumeInitialState || readDraft();
  const initial = draft.current || {};
  const isResume = !!resumeInitialState;

  // Ceiling on how far the StepRail lets the customer jump forward.
  // Same-session draft: only backward jumps (`idx < stepIdx`) — original behavior.
  // Resume from email:  forward jumps allowed up to farthest_step so the
  // customer can skip back to where they left off after re-running analysis.
  const [farthestStep, setFarthestStep] = useState(
    Number.isFinite(initial.farthest_step) ? initial.farthest_step : 0,
  );

  const initialStepIdx = Number.isFinite(initial.stepIdx)
    ? initial.stepIdx
    : (isResume && Number.isFinite(initial.farthest_step) ? initial.farthest_step : 0);
  const [stepIdx, setStepIdx] = useState(initialStepIdx);
  const step = STEPS[stepIdx];

  // Wizard-wide state — placeholders. Individual step components populate.
  // Kept flat + shallow so subsequent tickets can lift into a reducer if the
  // state graph grows more complex than a handful of fields.
  //
  // Resume payload (I3) uses `form:{firstName,...}` shape from the server;
  // sessionStorage draft uses `contact:{firstName,...}`. Normalise here so
  // downstream state stays a single shape regardless of source.
  const initialContact = initial.contact
    || (initial.form
      ? { firstName: initial.form.firstName || '', lastName: initial.form.lastName || '', email: initial.form.email || '', phone: initial.form.phone || '' }
      : { firstName: '', lastName: '', email: '', phone: '' });

  const [usage, setUsage]         = useState(initial.usage || { bill: null, monthlySpend: null, annualKwh: null, tab: intent === 'estimate' ? 'spend' : intent === 'manual_table' ? 'kwh' : 'bills' });
  const [address, setAddress]     = useState(initial.address || null);
  const [analysis, setAnalysis]   = useState(initial.analysis || null);
  const [design, setDesign]       = useState(initial.design || null);
  const [chosenTier, setChosenTier] = useState(initial.chosenTier || null);
  const [contact, setContact]     = useState(initialContact);

  // Persist to sessionStorage whenever wizard state changes. Fires with a
  // short debounce so rapid state churn (e.g. typing in an input) doesn't
  // hammer the storage API. Draft cleared explicitly at Step 5 submit.
  useEffect(() => {
    const t = setTimeout(() => {
      writeDraft({ stepIdx, usage, address, analysis, design, chosenTier, contact });
    }, 400);
    return () => clearTimeout(t);
  }, [stepIdx, usage, address, analysis, design, chosenTier, contact]);

  // ── Phase B2 server-side draft (I2 + B4) ─────────────────────────────────
  // Whenever the customer types an email in the progressive-capture input
  // (I2) OR chooses a tier on Step 4 (B4), we fire POST /api/quote/draft
  // so the lead is saved on the server too. Debounced 900ms to swallow
  // typing bursts. Enquiry + contact ids from the first save are echoed
  // on subsequent saves so we UPSERT the same DB row instead of creating
  // duplicates. Cleared on Step 5 submit — /submit-with-design's isUpdate
  // path picks up the same ids and promotes 'partial' → 'new'.
  const [draftIds, setDraftIds] = useState(
    isResume && initial.draftIds
      ? { enquiryId: initial.draftIds.enquiryId || null, contactId: initial.draftIds.contactId || null }
      : { enquiryId: null, contactId: null }
  );
  const [draftState, setDraftState] = useState(isResume ? 'saved' : 'idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const draftFireTokenRef = useRef(0);   // guards against out-of-order responses

  useEffect(() => {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((contact.email || '').trim());
    if (!emailOk) return undefined;
    const t = setTimeout(async () => {
      const token = ++draftFireTokenRef.current;
      setDraftState('saving');
      try {
        const { data } = await publicApi.post('/quote/draft', {
          form: {
            firstName: contact.firstName || null,
            lastName:  contact.lastName || null,
            email:     contact.email,
            phone:     contact.phone || null,
            address:   address?.formattedAddress || null,
            customerType: 'residential',
            installationType: 'residential',
            wizardIntent: usage?.tab === 'bills' ? 'bills' : usage?.tab === 'kwh' ? 'manual_table' : 'estimate',
            monthlyBill: usage?.bill?.total_nzd || null,
            utm_source:  utm?.utm_source, utm_medium: utm?.utm_medium, utm_campaign: utm?.utm_campaign, qr_scan_id: utm?.qr_scan_id,
            enquiry_id: draftIds.enquiryId,
            contact_id: draftIds.contactId,
          },
          design: chosenTier ? {
            chosenTierId: chosenTier.id || null,
            systemKwp:    chosenTier.tier?.panel?.total_kwp || chosenTier.tier?.system_size_kwp || null,
            panelCount:   chosenTier.tier?.panel?.count || null,
            batteryKwh:   chosenTier.tier?.battery?.usable_kwh || null,
            evIncluded:   !!chosenTier.tier?.wattpilot_included,
            tierPrice:    chosenTier.tier?.price_inc_gst || chosenTier.tier?.pricing?.total_incl_gst || null,
            roofSource:   analysis?.solar_source || analysis?.roof?.source || null,
            lat:          address?.latitude, lng: address?.longitude,
            fullPayload:  { chosenTierId: chosenTier.id, tier: chosenTier.tier, savedAt: 'draft' },
          } : null,
        });
        // Only accept response if it's the latest we fired (out-of-order guard)
        if (token !== draftFireTokenRef.current) return;
        if (!draftIds.enquiryId) setDraftIds({ enquiryId: data.enquiry_id, contactId: data.contact_id });
        setDraftState('saved');
      } catch (e) {
        if (token !== draftFireTokenRef.current) return;
        console.warn('[draft] save failed (non-fatal):', e?.response?.data?.error || e.message);
        setDraftState('error');
      }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.email, chosenTier, address?.formattedAddress]);

  // ── F5 (2026-08-20) — address re-analyse safety modal ──────────────────
  // When customer goes back from Step 3+ to Step 2 and changes the address,
  // we can't quietly discard their analysis + tier picks. Track the address
  // the analysis was actually run against, and if the customer moves forward
  // from Step 2 with a different one, prompt to confirm the wipe.
  const analysedAddressKeyRef = useRef(null);
  useEffect(() => {
    if (analysis) {
      // Freeze the address key at analysis-commit time.
      analysedAddressKeyRef.current = addressKey(address);
    }
  }, [analysis, address]);
  const [reanalyseModal, setReanalyseModal] = useState(false);

  const goForward = useCallback(() => {
    // On Step 2 → 3, check for stale analysis before advancing.
    if (stepIdx === 1 && analysis && analysedAddressKeyRef.current
        && addressKey(address) !== analysedAddressKeyRef.current) {
      setReanalyseModal(true);
      return;
    }
    setStepIdx((i) => {
      const next = Math.min(i + 1, STEPS.length - 1);
      // Grow the farthest-reached ceiling (Phase B2 I3, 2026-08-21) so
      // subsequent StepRail forward jumps can reach the new max.
      setFarthestStep((f) => Math.max(f, next));
      return next;
    });
  }, [stepIdx, analysis, address]);

  const confirmReanalyse = useCallback(() => {
    // Wipe stale analysis + design + tier + customise state.
    setAnalysis(null);
    setDesign(null);
    setChosenTier(null);
    analysedAddressKeyRef.current = null;
    setReanalyseModal(false);
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  }, []);

  const goBack    = useCallback(() => {
    if (stepIdx === 0) return onBack?.();
    setStepIdx((i) => Math.max(i - 1, 0));
  }, [stepIdx, onBack]);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Step rail — visual progress + jump-back hitboxes for completed
          steps. Also allows FORWARD jumps up to `farthestStep` so the resume
          flow (Phase B2 I3, 2026-08-21) can hydrate + let customers skip
          re-doing steps they've already done. Backward is unconstrained. */}
      <StepRail
        current={stepIdx}
        farthest={farthestStep}
        onJump={(idx) => {
          if (idx === stepIdx) return;
          if (idx < stepIdx || idx <= farthestStep) setStepIdx(idx);
        }}
      />

      {/* I2 progressive email capture (Phase B2, 2026-08-20). Header-level
          "save my progress" input — customers who bail before Step 5 still
          leave us their email (draft goes to CRM as status='partial').
          Value is bound to contact.email so Step 5's contact form sees the
          same value pre-filled. Hidden on Step 5 (redundant with the form). */}
      {step.key !== 'quote' && (
        <ProgressiveEmailInput
          value={contact.email}
          onChange={(email) => setContact((c) => ({ ...c, email }))}
          state={draftState}
        />
      )}

      {/* Step body — one component per step. B1.2 shipped Step 1 as real
          content; B1.3-B1.6 fill in the remaining placeholders. */}
      <div className="mt-8">
        {step.key === 'usage' && (
          <Step1Usage
            usage={usage}
            onChange={setUsage}
            onContinue={goForward}
            onBack={goBack}
          />
        )}
        {step.key === 'house' && (
          <Step2House
            usage={usage}
            address={address}
            onChange={setAddress}
            onContinue={goForward}
            onBack={goBack}
          />
        )}
        {step.key === 'analysis' && (
          <Step3Analysis
            address={address}
            analysis={analysis}
            onChange={setAnalysis}
            onContinue={goForward}
            onBack={goBack}
          />
        )}
        {step.key === 'system' && (
          <Step4System
            usage={usage}
            address={address}
            analysis={analysis}
            design={design}
            chosenTier={chosenTier}
            onDesignChange={setDesign}
            onTierChosen={({ tierId, tier }) => {
              setChosenTier({ id: tierId, tier });
              goForward();
            }}
            onBack={goBack}
          />
        )}
        {step.key === 'quote' && (
          <Step5Quote
            usage={usage}
            address={address}
            analysis={analysis}
            design={design}
            chosenTier={chosenTier}
            contact={contact}
            draftIds={draftIds}     /* Phase B2 — upsert same enquiry row (partial → new) */
            onContactChange={setContact}
            onSubmitted={() => {
              // Draft is done — clear sessionStorage so a fresh page load
              // starts clean, not with the just-submitted quote pre-hydrated.
              clearDraft();
            }}
            onBack={goBack}
          />
        )}
      </div>

      {/* Silence the lint on placeholder state until B1.2+ wires them up. */}
      <span className="hidden">{JSON.stringify({ usage, address, analysis, design, chosenTier, contact, utm })}</span>

      {/* F5 re-analyse safety modal (2026-08-20). Only mounts when the
          customer changed the address AFTER an analysis had been run. */}
      {reanalyseModal && (
        <ReanalyseAddressModal
          onConfirm={confirmReanalyse}
          onCancel={() => setReanalyseModal(false)}
        />
      )}
    </div>
  );
}

// I2 (Phase B2, 2026-08-20) — progressive email capture pill under the
// StepRail. Types → fires debounced POST /api/quote/draft in the parent
// wizard. Shows the save state as a small chip so the customer knows their
// progress is being persisted (green tick = "saved"). Never shown on Step 5
// (redundant with the full contact form there).
function ProgressiveEmailInput({ value, onChange, state }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E3D9C4] bg-white/70">
      <label htmlFor="pw-email" className="text-[11px] uppercase tracking-wider text-[#8F887E] font-semibold flex items-center gap-1.5">
        <Mail className="w-3.5 h-3.5 text-[#D9531E]" />
        Email me if I don&apos;t finish
      </label>
      <input
        id="pw-email"
        type="email"
        autoComplete="email"
        placeholder="your@email"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-[180px] bg-transparent outline-none text-sm text-[#1A1614] placeholder:text-[#C4A57A]"
      />
      {state === 'saving' && <span className="inline-flex items-center gap-1 text-[11px] text-[#8F887E]"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>}
      {state === 'saved'  && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold"><CheckCircle className="w-3 h-3" /> Progress saved</span>}
      {state === 'error'  && <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 font-semibold"><AlertTriangle className="w-3 h-3" /> Save failed — retry on submit</span>}
    </div>
  );
}

// F5 (2026-08-20) — modal shown before wiping analysis + tier state when
// customer changes address mid-flow. Prevents "I lost my quote" surprise.
function ReanalyseAddressModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 grid place-items-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-amber-700 font-bold">
              Re-analyse roof?
            </div>
            <h3 className="font-serif text-xl mt-1 text-[#1A1614]">
              You&apos;ve changed your address.
            </h3>
            <p className="mt-2 text-sm text-[#55504A]">
              Continuing will re-analyse this new roof (~5&ndash;30&nbsp;seconds) and reset your battery + EV picks and chosen tier. Your bill data + contact info are kept.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-[#E3D9C4] text-sm text-[#55504A] hover:bg-[#F4EEE1]"
          >
            Cancel &mdash; keep current
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#D9531E] text-white text-sm font-bold hover:bg-[#B84418] transition"
          >
            Yes &mdash; re-analyse &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}

function StepRail({ current, onJump, farthest = 0 }) {
  return (
    <ol className="flex items-center gap-2 md:gap-4 text-xs md:text-sm">
      {STEPS.map((s, i) => {
        const done      = i < current;
        const active    = i === current;
        // Reachable = already completed OR within resume ceiling (Phase B2 I3).
        const reachable = done || i <= farthest;
        return (
          <li key={s.key} className="flex items-center gap-2 md:gap-3">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onJump(i)}
              className={`w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center font-bold text-[11px] md:text-xs transition ${
                active
                  ? 'bg-[#D9531E] text-white shadow-md shadow-orange-500/30'
                  : done
                    ? 'bg-emerald-500 text-white hover:brightness-110 cursor-pointer'
                    : reachable
                      ? 'bg-amber-200 text-amber-900 hover:brightness-110 cursor-pointer'
                      : 'bg-[#E3D9C4] text-[#8F887E]'
              }`}
              aria-current={active ? 'step' : undefined}
              aria-label={`Step ${i + 1} of ${STEPS.length} — ${s.label}${done ? ' (completed)' : reachable ? ' (available)' : ''}`}
            >
              {done ? '✓' : i + 1}
            </button>
            <span className={`hidden md:inline ${active ? 'text-[#1A1614] font-semibold' : done ? 'text-[#5C8B4A]' : reachable ? 'text-amber-800' : 'text-[#8F887E]'}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="w-4 md:w-6 h-px bg-[#E3D9C4]" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

// Placeholder step body — remove per-step when B1.2+ ships the real content.
function PlaceholderStep({ title, subtitle, onNext, onBack, finalStep = false }) {
  return (
    <div className="rounded-2xl border border-[#E3D9C4] bg-white p-8 md:p-12">
      <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-semibold mb-2">
        Placeholder · Phase B1 shell
      </div>
      <h2 className="font-serif text-2xl md:text-3xl text-[#1A1614]">{title}</h2>
      <p className="mt-2 text-[#55504A]">{subtitle}</p>

      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20"
        >
          {finalStep ? 'Submit (placeholder)' : 'Next step'} &rarr;
        </button>
      </div>
    </div>
  );
}
