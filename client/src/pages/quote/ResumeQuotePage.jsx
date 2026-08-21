// ResumeQuotePage — Phase B2 I3 (2026-08-21) magic-link resume for the merged
// /get-quote residential wizard. Route: /get-quote/resume/:token
//
// Customer arrives via the CTA in the bail-out follow-up email 24-168h after
// they bailed mid-wizard. We call GET /api/quote/resume/:token which returns
// their contact + address + usage + tier pick (whichever they filled in
// before bailing), then mount ResidentialWizard with that as initial state,
// jumped to the farthest step they'd reached.
//
// Failure modes handled inline:
//   • 400 (invalid token shape) or 404 (not found / already submitted) — show
//     friendly copy pointing them at fresh /get-quote instead
//   • 5xx or network — same-shape error card + retry
//
// The wizard itself is unmodified — resumeInitialState prop takes precedence
// over the sessionStorage draft, so a customer who happens to have BOTH a
// local draft and a resume email gets the fresh server data.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Loader2, Home } from 'lucide-react';
import { publicApi } from '../../services/api';
import WebsiteNav from '../../components/website/WebsiteNav';
import ResidentialWizard from './ResidentialWizard';

export default function ResumeQuotePage() {
  const { token } = useParams();
  const [state,   setState]   = useState('loading');   // 'loading' | 'ready' | 'expired' | 'error'
  const [payload, setPayload] = useState(null);
  const [err,     setErr]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    publicApi.get(`/quote/resume/${token}`)
      .then(({ data }) => {
        if (cancelled) return;
        setPayload(data);
        setState('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        const status = e.response?.status;
        setErr(e.response?.data?.error || e.message || 'Could not load your saved quote.');
        setState(status === 404 || status === 400 ? 'expired' : 'error');
      });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="bg-gray-50 dark:bg-brand-dark font-body min-h-screen">
      <WebsiteNav />
      <main className="pt-12 pb-16 px-4 md:px-10">
        <div className="mx-auto max-w-6xl">
          {state === 'loading' && <ResumeLoadingCard />}
          {state === 'expired' && <ResumeExpiredCard message={err} />}
          {state === 'error'   && <ResumeErrorCard message={err} onRetry={() => window.location.reload()} />}
          {state === 'ready' && payload && (
            <>
              <WelcomeBackBanner email={payload.form?.email} />
              <ResidentialWizard
                resumeInitialState={payload}
                onBack={() => { window.location.href = '/get-quote'; }}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ResumeLoadingCard() {
  return (
    <div className="rounded-2xl border border-[#E3D9C4] bg-white p-12 text-center max-w-xl mx-auto">
      <Loader2 className="w-8 h-8 mx-auto text-[#D9531E] animate-spin" />
      <div className="mt-4 text-sm text-[#55504A]">Loading your saved quote…</div>
    </div>
  );
}

function ResumeExpiredCard({ message }) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-8 max-w-xl mx-auto">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-200 grid place-items-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-800" />
        </div>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest text-amber-800 font-bold">
            Link no longer active
          </div>
          <h2 className="font-serif text-2xl mt-1 text-[#1A1614]">
            This saved quote isn&apos;t available.
          </h2>
          <p className="mt-2 text-sm text-[#55504A]">
            {message || 'The link may have expired or the quote has already been finalised.'} No worries — starting a fresh one only takes a few minutes.
          </p>
          <a
            href="/get-quote"
            className="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#D9531E] text-white text-sm font-bold hover:bg-[#B84418] transition shadow-lg shadow-orange-500/20"
          >
            <Home className="w-4 h-4" /> Start a fresh quote
          </a>
        </div>
      </div>
    </div>
  );
}

function ResumeErrorCard({ message, onRetry }) {
  return (
    <div className="rounded-2xl border border-red-300 bg-red-50 p-8 max-w-xl mx-auto">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-red-200 grid place-items-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-red-800" />
        </div>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest text-red-800 font-bold">
            Couldn&apos;t reach the server
          </div>
          <h2 className="font-serif text-2xl mt-1 text-[#1A1614]">
            Something went wrong loading your quote.
          </h2>
          <p className="mt-2 text-sm text-[#55504A]">{message}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition"
            >
              Try again
            </button>
            <a
              href="/get-quote"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] text-sm text-[#55504A] hover:bg-[#F4EEE1]"
            >
              Start fresh instead
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeBackBanner({ email }) {
  return (
    <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
      <CheckCircle className="w-4 h-4 text-emerald-700 flex-shrink-0" />
      <div className="text-sm text-emerald-900">
        Welcome back{email ? <>, <strong>{email}</strong></> : ''}. We&apos;ve loaded your saved quote — we&apos;ll re-run the roof analysis to make sure it&apos;s current, then jump you to where you left off.
      </div>
    </div>
  );
}
