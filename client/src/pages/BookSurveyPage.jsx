// BookSurveyPage — public /book-survey route with embedded Cal.com booking widget.
//
// Wired 2026-08-22 for Phase 2 of the Step-5 What-Next CTA rebuild. Owner set
// up a Cal.com account with the "Site Survey" event type at:
//   https://cal.com/goldenrayenergy/sitesurvey
//
// The Cal.com event syncs with Owner's Google Calendar so the widget only
// offers slots that are actually free. Bookings land in Cal.com's dashboard
// AND on Owner's Google Calendar automatically. No backend work needed on
// our side — Cal.com handles the entire booking lifecycle (confirmation
// emails, reminders, reschedule/cancel flows).
//
// Uses Cal.com's official vanilla embed loader (loaded on-demand inside
// useEffect, not from index.html) so the ~40KB embed script only downloads
// on pages that actually need it. Falls back to a direct link if the script
// fails to load (network issue / adblocker).

import { useEffect, useRef, useState } from 'react';
import { Calendar, ExternalLink, CheckCircle2, Clock, MapPin, ChevronLeft } from 'lucide-react';
import WebsiteNav from '../components/website/WebsiteNav';
import WebsiteFooter from '../components/website/WebsiteFooter';

const CAL_LINK    = 'goldenrayenergy/sitesurvey';
const CAL_NS      = 'sitesurvey';
const CAL_ORIGIN  = 'https://cal.com';
const CAL_FULL_URL = `${CAL_ORIGIN}/${CAL_LINK}`;

export default function BookSurveyPage() {
  const containerRef = useRef(null);
  // Track load state so the fallback link can appear if the embed script
  // never resolves (adblocker, offline). Cal.com's own script sets
  // window.Cal — we listen for that as a heartbeat.
  const [scriptFailed, setScriptFailed] = useState(false);
  // Round 4-rework followup (2026-08-26). Post-booking success state.
  // Cal.com fires `bookingSuccessful` via its embed messaging API when
  // the customer completes a booking — we listen and swap the widget
  // for a clean "You're all booked" card with clear navigation options.
  // Without this the customer was stranded on the Cal.com iframe with
  // no visible way back into the Golden Ray site.
  const [bookedInfo, setBookedInfo] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Vanilla loader adapted from Cal.com's official docs
    // (https://cal.com/docs/embed/embed-vanilla). Idempotent — if Cal is
    // already on the window (customer navigated here twice in one session),
    // re-init just re-mounts into the current container.
    (function (C, A, L) {
      let p = function (a, ar) { a.q.push(ar); };
      let d = C.document;
      C.Cal = C.Cal || function () {
        let cal = C.Cal;
        let ar = arguments;
        if (!cal.loaded) {
          cal.ns = {};
          cal.q = cal.q || [];
          d.head.appendChild(d.createElement('script')).src = A;
          cal.loaded = true;
        }
        if (ar[0] === L) {
          const api = function () { p(api, arguments); };
          const namespace = ar[1];
          api.q = api.q || [];
          typeof namespace === 'string' ? (cal.ns[namespace] = api) && p(api, ar) : p(cal, ar);
          return;
        }
        p(cal, ar);
      };
    })(window, 'https://app.cal.com/embed/embed.js', 'init');

    window.Cal('init', CAL_NS, { origin: CAL_ORIGIN });
    // Fix (2026-08-27) — pull notes/name/email from our own URL params
    // and prefill them into Cal.com's booking form. Enables:
    //   /book-survey?notes=Roof analysis failed for: 7 Kent Street
    // to auto-populate the "Additional notes" field so the surveyor
    // sees the address the customer was quoting for when they bailed
    // to the survey path. Without this the surveyor gets a bare booking
    // with just name + email and no context about which property.
    const urlParams = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    const prefill = {};
    const notes = urlParams.get('notes');
    const name  = urlParams.get('name');
    const email = urlParams.get('email');
    if (notes) prefill.notes = notes;
    if (name)  prefill.name  = name;
    if (email) prefill.email = email;
    window.Cal.ns[CAL_NS]('inline', {
      elementOrSelector: containerRef.current,
      calLink: CAL_LINK,
      layout: 'month_view',
      config: Object.keys(prefill).length ? prefill : undefined,
    });
    window.Cal.ns[CAL_NS]('ui', {
      cssVarsPerTheme: {
        light: { 'cal-brand': '#D9531E' },   // GoldenRay orange
        dark:  { 'cal-brand': '#F5A623' },
      },
      hideEventTypeDetails: false,
      layout: 'month_view',
      // Bug 10 fix (2026-08-24): force 12-hour format with AM/PM. Without
      // this Cal.com falls back to browser locale detection which for
      // en-NZ is system-setting dependent — some customers saw 13:00,
      // others saw 1:00 with no AM/PM label. NZ residential customers
      // mostly think in 12h; owner can switch to 24 if that changes.
      timeFormat: 12,
    });

    // Round 4-rework followup: hook Cal.com's `bookingSuccessful` event.
    // Fires when the customer completes the booking flow — we swap the
    // widget for a native Golden Ray success card so the customer
    // isn't stranded inside the Cal.com iframe.
    try {
      window.Cal.ns[CAL_NS]('on', {
        action: 'bookingSuccessful',
        callback: (e) => {
          const detail = e?.detail?.data || {};
          setBookedInfo({
            startTime: detail?.booking?.startTime || null,
            attendeeEmail: detail?.booking?.attendees?.[0]?.email || null,
          });
        },
      });
    } catch (err) {
      // Non-fatal — if Cal.com's on() API isn't available, the customer
      // still gets a confirmation email from Cal.com itself. They just
      // won't see our native success card.
      console.warn('[BookSurveyPage] failed to bind Cal.com bookingSuccessful event:', err?.message || err);
    }

    // 8s failsafe — if the Cal.com iframe hasn't rendered into our
    // container by then, assume the embed script was blocked (adblocker
    // or offline) and surface the fallback link. Cal.com typically
    // renders within 1-2s over a warm connection.
    const failsafe = setTimeout(() => {
      const rendered = containerRef.current && containerRef.current.querySelector('iframe');
      if (!rendered) setScriptFailed(true);
    }, 8000);

    return () => clearTimeout(failsafe);
  }, []);

  return (
    <div className="bg-white dark:bg-brand-dark font-body min-h-screen">
      <WebsiteNav />

      {/* Hero — sets expectation: this is a real booking, not a callback
          request. Shows what happens after they pick a slot. */}
      <section className="pt-24 md:pt-28 pb-8 md:pb-12 px-4 md:px-16 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-amber-950/30 dark:via-brand-dark dark:to-orange-950/30">
        <div className="max-w-4xl mx-auto">
          {/* Fix (2026-08-27) — Back-to-Home now a proper pill button
              with brand colours, not the previous tiny text link. Sits
              above the "Book a site survey" chip so it's the first
              interactive element the customer sees. A second copy
              renders BELOW the Cal.com widget too (see bottom of this
              file) so customers who scrolled deep to book have an
              obvious exit after they're done. */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <a
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border-2 border-[#D9531E] text-[#D9531E] hover:bg-[#D9531E] hover:text-white text-sm font-semibold transition"
            >
              <ChevronLeft className="w-4 h-4" /> Back to Golden Ray home
            </a>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 text-xs font-bold uppercase tracking-widest">
              <Calendar className="w-3.5 h-3.5" /> Book a site survey
            </div>
          </div>
          <h1 className="font-serif text-3xl md:text-5xl font-bold text-[#1A1614] dark:text-white tracking-tight">
            Pick a time that works for you.
          </h1>
          <p className="mt-4 text-lg text-[#55504A] dark:text-gray-300 max-w-2xl">
            One of our techs will visit your property, measure the roof, check
            the switchboard, and confirm the exact system that fits. Takes
            about 45 minutes. You'll get a firm quote within 24 hours after.
          </p>

          <div className="mt-6 flex flex-wrap gap-4">
            <InfoPill icon={Clock} text="~45 min on-site" />
            <InfoPill icon={MapPin} text="Auckland region · free of charge" />
            <InfoPill icon={CheckCircle2} text="Firm quote within 24 hrs" />
          </div>
        </div>
      </section>

      {/* Cal.com embed OR the post-booking success card (Round 4-rework
          followup). Container ref is what Cal.com's inline embed mounts
          into. Height auto-adjusts as the widget navigates between month
          view / time picker / form. min-height prevents layout jitter. */}
      <section className="px-4 md:px-16 pb-16">
        <div className="max-w-5xl mx-auto">
          {bookedInfo ? (
            <BookingSuccessCard bookedInfo={bookedInfo} />
          ) : (
            <>
              {scriptFailed && (
                <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-3">
                  <div className="flex-1">
                    <div className="font-bold">Booking widget couldn't load.</div>
                    <div className="mt-0.5">
                      Looks like an ad-blocker or network filter is stopping it.
                      You can open the booking page directly instead:
                    </div>
                    <a
                      href={CAL_FULL_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition"
                    >
                      <ExternalLink className="w-4 h-4" /> Open booking page
                    </a>
                  </div>
                </div>
              )}
              <div
                ref={containerRef}
                className="min-h-[600px] rounded-2xl border border-[#E3D9C4] dark:border-gray-800 bg-white dark:bg-brand-dark/50 overflow-hidden"
              />
              {/* Fix (2026-08-27) — Second "Back to home" affordance
                  below the widget. Customer who scrolled deep into the
                  calendar to pick a slot but changed their mind (or
                  finished booking and Cal.com's own success view
                  doesn't offer navigation) has an obvious exit. */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <a
                  href="/"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-full border-2 border-[#D9531E] text-[#D9531E] hover:bg-[#D9531E] hover:text-white text-sm font-semibold transition"
                >
                  <ChevronLeft className="w-4 h-4" /> Back to Golden Ray home
                </a>
                <a
                  href="/get-quote?fresh=1"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#F4EEE1] hover:bg-[#EBE2CE] text-[#55504A] text-sm font-semibold transition"
                >
                  Start a fresh quote
                </a>
              </div>
            </>
          )}
        </div>
      </section>

      <WebsiteFooter />
    </div>
  );
}

// Post-booking success card — replaces the Cal.com widget once the
// customer completes their booking. Gives them explicit next steps
// (confirmation email is on the way from Cal.com; here are the paths
// back into the Golden Ray site).
function BookingSuccessCard({ bookedInfo }) {
  const startDateStr = bookedInfo?.startTime
    ? new Date(bookedInfo.startTime).toLocaleString('en-NZ', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : null;
  return (
    <div className="rounded-2xl border-2 border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-8 md:p-10 text-center">
      <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-500 grid place-items-center">
        <CheckCircle2 className="w-8 h-8 text-white" />
      </div>
      <h2 className="font-serif text-2xl md:text-3xl font-bold text-[#1A1614] dark:text-white">
        You're all booked.
      </h2>
      {startDateStr && (
        <p className="mt-2 text-lg text-emerald-900 dark:text-emerald-200 font-semibold">
          {startDateStr}
        </p>
      )}
      <p className="mt-3 text-sm text-[#55504A] dark:text-gray-300 max-w-md mx-auto">
        A confirmation is on its way to your inbox — including a Google
        Calendar invite and rescheduling link. See you soon.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a
          href="/"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition"
        >
          Back to Golden Ray home
        </a>
        <a
          href="/get-quote?fresh=1"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#D9531E] text-[#D9531E] text-sm font-semibold hover:bg-orange-50 dark:hover:bg-orange-900/20 transition"
        >
          Start a fresh quote
        </a>
      </div>
    </div>
  );
}

function InfoPill({ icon: Icon, text }) {
  return (
    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 dark:bg-white/10 border border-[#E3D9C4] dark:border-gray-700 text-sm text-[#55504A] dark:text-gray-300 backdrop-blur">
      <Icon className="w-4 h-4 text-[#D9531E] dark:text-orange-400 flex-shrink-0" />
      <span>{text}</span>
    </div>
  );
}
