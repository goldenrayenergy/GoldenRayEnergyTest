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
import { Calendar, ExternalLink, CheckCircle2, Clock, MapPin } from 'lucide-react';
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
    window.Cal.ns[CAL_NS]('inline', {
      elementOrSelector: containerRef.current,
      calLink: CAL_LINK,
      layout: 'month_view',
    });
    window.Cal.ns[CAL_NS]('ui', {
      cssVarsPerTheme: {
        light: { 'cal-brand': '#D9531E' },   // GoldenRay orange
        dark:  { 'cal-brand': '#F5A623' },
      },
      hideEventTypeDetails: false,
      layout: 'month_view',
    });

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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 text-xs font-bold uppercase tracking-widest mb-4">
            <Calendar className="w-3.5 h-3.5" /> Book a site survey
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

      {/* Cal.com embed. Container ref is what Cal.com's inline embed mounts
          into. Height auto-adjusts as the widget navigates between month
          view / time picker / form. min-height prevents layout jitter. */}
      <section className="px-4 md:px-16 pb-16">
        <div className="max-w-5xl mx-auto">
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
        </div>
      </section>

      <WebsiteFooter />
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
