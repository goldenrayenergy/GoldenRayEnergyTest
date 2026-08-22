// Step5Quote — merged 5-step flow, contact + submit + confirmation (B1.6, 2026-08-20).
//
// Two visual states:
//   (a) Contact form  — customer's chosen tier recapped at top, inline name /
//                       email / phone form. Submit → POST /api/quote/submit-with-design.
//   (b) Confirmation  — post-submit success. Shows tier recap + install timeline +
//                       delivery chips (PDF proposal emailed + calendar hold added
//                       via .ics), plus a "Print / save PDF" button as fallback
//                       (browser print dialog). Wired 2026-08-21 in Phase B4:
//                       the server fires-and-forgets a customer proposal email
//                       from leadService.fireCustomerProposalDelivery, so we
//                       show a confirmation chip here so the customer knows
//                       to check their inbox. If /api/quote/submit-with-design
//                       returned a share_token, we also render a "View online"
//                       deep link to /p/:token (magic-link customer viewer).
//                       Renders I4 next-step CTAs: book site survey, chat with
//                       installer, see financing, refer a friend.
//
// Escape hatch (per user 2026-08-20 Option 1 residential-single-CTA decision):
// small "Prefer to talk to sales first?" link under the submit button so
// customers who never wanted an instant quote can still convert as a callback.
//
// Sends the full { form, design } payload to leadService via the new endpoint.
// leadService handles website_enquiries + contacts + tasks + activities +
// projects_v2 (Phase 6.6 bundled). Team email fires automatically.

import { useState, useCallback } from 'react';
import {
  ChevronLeft, Loader2, AlertTriangle, CheckCircle, Printer,
  Calendar, MessageCircle, DollarSign, Users, Phone,
  Mail, CalendarPlus, ExternalLink, Plus,
} from 'lucide-react';
import { publicApi } from '../../services/api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object}   props
 * @param {object}   props.usage
 * @param {object}   props.address
 * @param {object}   props.analysis
 * @param {object}   props.design
 * @param {object}   props.chosenTier   — { id, tier }
 * @param {object}   props.contact
 * @param {function} props.onContactChange
 * @param {function} props.onSubmitted  — called with { enquiryId, contactId, projectId, shareToken } after success
 * @param {object}   [props.submittedInitial]  — Bug 6A. When present, Step 5 renders the
 *                                                confirmation view immediately on mount instead of
 *                                                the contact form. Set by ResidentialWizard on
 *                                                hydration from the persisted draft so back-nav
 *                                                from a What Next CTA restores the confirmation.
 * @param {function} props.onBack
 */
export default function Step5Quote({
  usage, address, analysis, design, chosenTier, contact,
  draftIds = null,
  submittedInitial = null,
  onContactChange, onSubmitted, onBack,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitted, setSubmitted] = useState(submittedInitial);   // { enquiryId, contactId, projectId, shareToken }

  const tier = chosenTier?.tier;
  const tierId = chosenTier?.id;

  const setField = (key, val) => onContactChange({ ...contact, [key]: val });

  const isValid =
    (contact.firstName || '').trim().length > 0 &&
    EMAIL_RE.test(contact.email || '') &&
    (contact.phone || '').replace(/\D/g, '').length >= 6;

  const submit = useCallback(async () => {
    if (!isValid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const form = {
        firstName:    contact.firstName?.trim(),
        lastName:     contact.lastName?.trim() || null,
        email:        contact.email?.trim().toLowerCase(),
        phone:        contact.phone?.trim(),
        address:      address?.formattedAddress || null,
        installationType: 'residential',
        customerType: 'residential',
        // Legacy wizard fields for /submit compatibility, even though this
        // hits /submit-with-design. leadService uses these too.
        callToDiscuss: 'yes',
        wizardIntent:  usage?.tab === 'bills' ? 'bills' : usage?.tab === 'kwh' ? 'manual_table' : 'estimate',
        monthlyBill:   usage?.bill?.total_nzd || null,
        // Phase B2 (2026-08-20) — echo the draft row's ids so leadService's
        // isUpdate path UPSERTS the same enquiry + contact rows (promotes
        // status='partial' → 'new') instead of creating duplicates. Null
        // when the customer never triggered a draft save (typed no email
        // in the header + never chose a tier before Step 5).
        enquiry_id:   draftIds?.enquiryId || null,
        contact_id:   draftIds?.contactId || null,
      };

      const designPayload = {
        chosenTierId: tierId,
        systemKwp:    tier?.panel?.total_kwp || tier?.system_size_kwp || tier?.kwp || null,
        panelCount:   tier?.panel?.count || tier?.panels || null,
        batteryKwh:   tier?.battery?.usable_kwh || tier?.battery_kwh || null,
        evIncluded:   !!tier?.wattpilot_included,
        tierPrice:    tier?.price_inc_gst || tier?.pricing?.total_incl_gst || tier?.price || null,
        roofSource:   analysis?.solar_source || analysis?.roof?.source || null,
        lat:          address?.latitude,
        lng:          address?.longitude,
        fullPayload:  { design, chosenTierId: tierId, usage: { tab: usage?.tab } },
      };

      const { data } = await publicApi.post('/quote/submit-with-design', {
        form,
        design: designPayload,
      });

      setSubmitted({
        enquiryId:  data.id,
        contactId:  data.contact_id,
        projectId:  data.project_id,
        shareToken: data.share_token,  // Phase B4 — magic-link viewer
      });
      onSubmitted?.({
        enquiryId:  data.id,
        contactId:  data.contact_id,
        projectId:  data.project_id,
        shareToken: data.share_token,
      });
    } catch (e) {
      const status = e.response?.status ? ` [HTTP ${e.response.status}]` : '';
      const body = e.response?.data;
      const bodyMsg = typeof body === 'string' ? body.slice(0, 300)
        : (body?.error || e.message || 'Submit failed.');
      setSubmitError(`${bodyMsg}${status}`);
    } finally {
      setSubmitting(false);
    }
  }, [isValid, contact, address, analysis, design, tier, tierId, usage, onSubmitted]);

  // ── Post-submit confirmation view ──────────────────────────────────────
  if (submitted) {
    return (
      <ConfirmationView
        submitted={submitted}
        contact={contact}
        tier={tier}
        address={address}
        design={design}
        onPrint={() => window.print()}
      />
    );
  }

  // ── Contact form + tier recap ──────────────────────────────────────────
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">
        Step 5 &middot; Get this quote
      </div>
      <h2 className="font-serif text-3xl md:text-4xl mt-3 tracking-tight text-[#1A1614]">
        Where should we send it?
      </h2>
      <p className="mt-2 text-[#55504A] max-w-2xl">
        You picked <strong>{tier?.label || tier?.name || 'this tier'}</strong>. Enter your details and we&apos;ll email the proposal + call you within 1 business day.
      </p>

      {/* Chosen tier recap */}
      {tier && (
        <div className="mt-6 rounded-2xl border-2 border-[#D9531E] bg-gradient-to-br from-[#FFF7F0] to-white p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4 text-[#D9531E]" />
            <div className="text-xs uppercase tracking-widest text-[#D9531E] font-bold">
              Your choice
            </div>
          </div>
          <div className="flex items-baseline flex-wrap gap-x-4 gap-y-1">
            <div className="font-serif text-2xl md:text-3xl font-bold text-[#1A1614]">
              {tier.label || tier.name || 'Tier'}
            </div>
            <div className="text-[#8F887E] text-sm">
              {tier.panel?.count || tier.panels || '?'} panels &middot;
              {' '}{tier.panel?.total_kwp || tier.system_size_kwp || tier.kwp || '?'} kWp
              {tier.battery?.usable_kwh > 0 && ` · ${tier.battery.usable_kwh} kWh battery`}
              {tier.wattpilot_included && ' · EV charger'}
            </div>
          </div>
          {tier.pricing?.total_incl_gst && (
            <div className="mt-2 text-xl font-bold text-[#1A1614]">
              ${Math.round(tier.pricing.total_incl_gst).toLocaleString('en-NZ')}
              <span className="text-xs text-[#8F887E] ml-2">incl. GST · installed</span>
            </div>
          )}
        </div>
      )}

      {/* Contact form */}
      <div className="mt-6 rounded-2xl border border-[#E3D9C4] bg-white p-6 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField label="First name*" value={contact.firstName} onChange={(v) => setField('firstName', v)} autoComplete="given-name" />
          <TextField label="Last name"    value={contact.lastName}  onChange={(v) => setField('lastName', v)}  autoComplete="family-name" />
          <TextField label="Email*"       value={contact.email}     onChange={(v) => setField('email', v)}      type="email" autoComplete="email" />
          <TextField label="Phone*"       value={contact.phone}     onChange={(v) => setField('phone', v)}      type="tel"   autoComplete="tel" placeholder="021 555 0000" />
        </div>
        <div className="mt-3 text-[11px] text-[#8F887E]">
          We&apos;ll only use these to send your proposal and schedule a call. See our privacy policy.
        </div>
      </div>

      {submitError && (
        <div className="mt-4 flex items-start gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>{submitError}</div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-10 pt-6 border-t border-[#E3D9C4] flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm text-[#55504A] disabled:opacity-50"
        >
          <ChevronLeft className="w-4 h-4" /> Back to tiers
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={submit}
          disabled={!isValid || submitting}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#D9531E] text-white text-sm font-bold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
            : <>Get my proposal &rarr;</>}
        </button>
      </div>

      {/* Callback escape hatch */}
      <div className="mt-4 text-center text-xs text-[#8F887E]">
        Prefer to talk to sales first?{' '}
        <a
          href="/get-quote?type=residential&intent=callback"
          className="text-[#D9531E] font-semibold hover:underline"
        >
          Request a callback instead &rarr;
        </a>
      </div>
    </div>
  );
}

// ── Confirmation view (I4 next-step CTAs) ──────────────────────────────────
function ConfirmationView({ submitted, contact, tier, address, design, onPrint }) {
  const savings25yr = tier?.savings?.expected_25yr_nzd
                   || tier?.savings?.expected_25yr
                   || tier?.savings_25yr;
  const paybackYrs  = tier?.payback?.expected_years
                   || tier?.payback_yrs
                   || tier?.payback_years;

  return (
    <div>
      <div className="rounded-2xl border-2 border-emerald-500 bg-gradient-to-br from-emerald-50 to-white p-6 md:p-8 shadow-lg shadow-emerald-500/10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-emerald-500 grid place-items-center">
            <CheckCircle className="w-7 h-7 text-white" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-emerald-700 font-bold">
              Proposal received
            </div>
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-[#1A1614]">
              Thanks, {contact.firstName || 'there'}!
            </h2>
          </div>
        </div>
        <p className="text-[#55504A]">
          One of our installers will call you within <strong>1 business day</strong> to walk through the proposal and schedule a site survey.
        </p>
        {/* A — Reference card. Prominent (not tiny 11px) because these are the
            IDs the customer quotes when calling us. Print-visible. */}
        <div className="mt-5 pt-4 border-t border-emerald-200">
          <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold mb-1.5">
            Your reference — mention this if you call us
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono">
            <div>
              <span className="text-xs text-[#8F887E] mr-1.5">Ref</span>
              <span className="text-lg md:text-xl font-bold text-emerald-800 tracking-wider">
                {(submitted.enquiryId || '').toString().slice(0, 8).toUpperCase()}
              </span>
            </div>
            {submitted.projectId && (
              <div>
                <span className="text-xs text-[#8F887E] mr-1.5">Project</span>
                <span className="text-lg md:text-xl font-bold text-emerald-800 tracking-wider">
                  {submitted.projectId.slice(0, 8).toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tier recap */}
      {tier && (
        <div className="mt-6 rounded-2xl border border-[#E3D9C4] bg-white p-6">
          <div className="text-xs uppercase tracking-widest text-[#8F887E] font-semibold mb-3">
            Your proposal
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="System size" value={`${tier.panel?.total_kwp || tier.system_size_kwp || tier.kwp || '?'} kWp`} />
            <Stat label="Panels"      value={`${tier.panel?.count || tier.panels || '?'}`} />
            <Stat label="Battery"     value={tier.battery?.usable_kwh > 0 ? `${tier.battery.usable_kwh} kWh` : 'None'} />
            <Stat label="Total price" value={(tier.price_inc_gst || tier.pricing?.total_incl_gst) ? `$${Math.round(tier.price_inc_gst || tier.pricing.total_incl_gst).toLocaleString('en-NZ')}` : '—'} />
            {savings25yr && <Stat label="25-yr savings" value={`$${Math.round(savings25yr).toLocaleString('en-NZ')}`} />}
            {paybackYrs  && <Stat label="Payback"       value={`${paybackYrs} yrs`} />}
            <Stat label="EV charger"  value={tier.wattpilot_included ? 'Included' : 'Not included'} />
            <Stat label="Address"     value={address?.formattedAddress || '—'} truncate />
          </div>

          {/* Phase B4 delivery chips — confirms server-side dispatch of the
              proposal email + calendar hold. Both are fire-and-forget on the
              server so we treat them as "on the way" rather than "delivered". */}
          <div className="mt-5 pt-4 border-t border-[#E3D9C4] flex flex-wrap gap-2">
            <DeliveryChip
              icon={Mail}
              label={`PDF proposal on its way to ${contact.email}`}
              color="emerald"
            />
            <DeliveryChip
              icon={CalendarPlus}
              label="Callback hold in the calendar attachment"
              color="orange"
            />
          </div>

          {/* C — Action row hidden when printing; buttons on paper are useless. */}
          <div className="mt-4 pt-4 border-t border-[#E3D9C4] flex flex-wrap gap-3 print:hidden">
            {submitted.shareToken && (
              <a
                href={`/p/${submitted.shareToken}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition shadow-md shadow-orange-500/20"
              >
                <ExternalLink className="w-4 h-4" /> View proposal online
              </a>
            )}
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1A1614] text-white text-sm font-semibold hover:bg-black transition"
            >
              <Printer className="w-4 h-4" /> Print / save this page
            </button>
          </div>
          <div className="mt-2 text-[11px] text-[#8F887E] print:hidden">
            Email doesn&apos;t arrive within a few minutes? Check spam, or reply to <strong>info@goldenrayenergy.nz</strong> and we&apos;ll resend.
          </div>
        </div>
      )}

      {/* I4 next-step CTAs. Hidden from print — these are digital actions;
          on paper they're just noise. */}
      <div className="mt-6 print:hidden">
        <div className="text-xs uppercase tracking-widest text-[#8F887E] font-semibold mb-3">
          What next?
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NextStepCTA
            icon={Calendar}
            title="Book a site survey now"
            desc="Skip the callback wait — pick a time our tech can visit."
            action="/get-quote?type=residential&intent=callback"
            color="orange"
          />
          <NextStepCTA
            icon={DollarSign}
            title="See financing options"
            desc="$0 upfront finance available. Check what you qualify for."
            action="/finance"
            color="green"
          />
          <NextStepCTA
            icon={MessageCircle}
            title="Chat with an installer"
            desc="Quick questions about the proposal? WhatsApp us."
            action="https://wa.me/64220000000"
            color="emerald"
            external
          />
          <NextStepCTA
            icon={Users}
            title="Refer a friend"
            desc="You save $500 when a friend installs. So do they."
            action="/refer"
            color="purple"
          />
        </div>

        {/* B — Start-a-new-quote CTA. Full-width row below the grid so it
            reads as "one more property to quote?", not another equal option. */}
        <a
          href="/get-quote?fresh=1"
          className="mt-3 block rounded-xl border-2 border-dashed border-[#8F887E]/40 bg-white hover:bg-[#F4EEE1] hover:border-[#D9531E] p-4 transition group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#F4EEE1] group-hover:bg-white grid place-items-center flex-shrink-0 transition">
              <Plus className="w-4 h-4 text-[#8F887E] group-hover:text-[#D9531E]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-[#1A1614]">Start a new quote for another property</div>
              <div className="text-xs text-[#55504A] mt-0.5">
                Wipes this quote and starts fresh from Step 1. Your reference above stays saved with us.
              </div>
            </div>
          </div>
        </a>
      </div>

      <div className="mt-8 text-center text-xs text-[#8F887E] print:hidden">
        Questions before we call? <a href="tel:+6499999999" className="text-[#D9531E] font-semibold"><Phone className="inline w-3 h-3" /> Give us a ring</a>
        {' '}or reply to the confirmation email.
      </div>
    </div>
  );
}

// ── Tiny helpers ───────────────────────────────────────────────────────────
function TextField({ label, value, onChange, type = 'text', autoComplete, placeholder }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-[#8F887E] font-semibold">{label}</span>
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2.5 rounded-lg border-2 border-[#E3D9C4] bg-white focus:border-[#D9531E] focus:outline-none text-sm text-[#1A1614]"
      />
    </label>
  );
}

function Stat({ label, value, truncate = false }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#8F887E] font-semibold">{label}</div>
      <div className={`mt-0.5 text-sm font-bold text-[#1A1614] ${truncate ? 'truncate' : ''}`} title={truncate ? value : undefined}>
        {value}
      </div>
    </div>
  );
}

// Phase B4 delivery-status chip. Neutral tone — "on its way" not "delivered",
// because the server fire-and-forgets the email so we don't wait on Resend
// before showing the confirmation page. If Resend hard-fails, the customer
// still gets the original sendCustomerAckEmail from fireLeadNotifications
// (fired first) and this chip is a slight over-promise. The trade-off is
// worth it: waiting on a synchronous email response adds 500-1500 ms of
// perceived latency on top of the PDF generation, and there's no way to
// meaningfully retry from the client anyway. Sales gets a copy of the team
// notification email either way so the lead is never dropped.
function DeliveryChip({ icon: Icon, label, color = 'emerald' }) {
  const colorMap = {
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    orange:  'bg-[#FFF7F0] text-[#B84418]  border-[#F3D5C0]',
  };
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${colorMap[color] || colorMap.emerald}`}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span>{label}</span>
    </div>
  );
}

function NextStepCTA({ icon: Icon, title, desc, action, color = 'orange', external = false }) {
  const colorMap = {
    orange:  'border-[#D9531E]  bg-[#FFF7F0]   text-[#D9531E]',
    green:   'border-emerald-500 bg-emerald-50  text-emerald-700',
    emerald: 'border-emerald-500 bg-emerald-50  text-emerald-700',
    purple:  'border-purple-500 bg-purple-50   text-purple-700',
  };
  return (
    <a
      href={action}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={`block rounded-xl border-2 p-4 transition hover:shadow-md hover:-translate-y-0.5 ${colorMap[color]}`}
    >
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold">{title}</div>
          <div className="text-xs text-[#55504A] mt-0.5">{desc}</div>
        </div>
      </div>
    </a>
  );
}
