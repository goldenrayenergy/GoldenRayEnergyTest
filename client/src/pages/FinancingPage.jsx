// FinancingPage — public /financing route (customer-facing, no auth).
//
// Wired 2026-08-22 for Phase 1 of the Step-5 What-Next CTA rebuild. The
// "See financing options" CTA on Step 5 used to point at /finance which
// was gated behind <AdminRoute> — customers got bounced to /login. This
// page renders the same <SolarFinance> component (4 NZ financing product
// cards + eligibility check + application form → POST /api/finance/apply
// which is unauthenticated) inside the public marketing-site chrome.
//
// Not a placeholder — real financing content lives in the shared
// SolarFinance component. This page adds the marketing context (hero
// explaining why $0-upfront works) so cold visitors landing here from
// the Step-5 confirmation understand the story before hitting the form.

import { ShieldCheck, Sparkles, DollarSign, Clock } from 'lucide-react';
import WebsiteNav from '../components/website/WebsiteNav';
import WebsiteFooter from '../components/website/WebsiteFooter';
import SolarFinance from '../components/website/SolarFinance';

export default function FinancingPage() {
  return (
    <div className="bg-white dark:bg-brand-dark font-body min-h-screen">
      <WebsiteNav />

      {/* Hero — sets context that this is real, four available options,
          $0 down is achievable for most homeowners. Sits above the fold
          so cold arrivals from the Step-5 CTA get the story before the
          form. */}
      <section className="pt-24 md:pt-28 pb-10 md:pb-14 px-4 md:px-16 bg-gradient-to-br from-emerald-50 via-white to-amber-50 dark:from-emerald-950/30 dark:via-brand-dark dark:to-amber-950/30">
        <div className="max-w-6xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-xs font-bold uppercase tracking-widest mb-4">
            <DollarSign className="w-3.5 h-3.5" /> Solar financing
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold text-[#1A1614] dark:text-white tracking-tight max-w-3xl">
            Go solar with <span className="text-emerald-600 dark:text-emerald-400">$0 upfront</span>.
          </h1>
          <p className="mt-4 text-lg md:text-xl text-[#55504A] dark:text-gray-300 max-w-2xl">
            Four New Zealand financing paths, from 0% interest-free plans to
            bank green loans at 1% p.a. Pick the one that fits your situation
            — the panels start paying the loan back from month one.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <BenefitPill icon={ShieldCheck} text="No credit score impact to check eligibility" />
            <BenefitPill icon={Sparkles} text="Instant online approval on most plans" />
            <BenefitPill icon={Clock} text="Application takes ~2 minutes" />
          </div>
        </div>
      </section>

      {/* SolarFinance already renders the 4 product cards, eligibility check
          form, and application POST. No wrapper needed — the component ships
          its own headline and body. */}
      <section className="py-8 md:py-12 px-4 md:px-16">
        <div className="max-w-6xl mx-auto">
          <SolarFinance />
        </div>
      </section>

      {/* Fine print — sets honest expectations. Rates + terms are indicative
          only; specific approval requires the application. */}
      <section className="pb-16 px-4 md:px-16">
        <div className="max-w-3xl mx-auto text-xs text-[#8F887E] dark:text-gray-500 border-t border-[#E3D9C4] dark:border-gray-800 pt-6 leading-relaxed">
          Indicative rates and terms shown are subject to change and to the
          finance provider's own approval criteria. Bank green loans require
          an existing mortgage relationship. Interest-free plans have
          upper-limit and term caps. Home loan top-ups are subject to your
          current bank's lending policy. Submit an application above and one
          of our team will walk you through the option that best fits your
          situation.
        </div>
      </section>

      <WebsiteFooter />
    </div>
  );
}

function BenefitPill({ icon: Icon, text }) {
  return (
    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 dark:bg-white/10 border border-[#E3D9C4] dark:border-gray-700 text-sm text-[#55504A] dark:text-gray-300 backdrop-blur">
      <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
      <span>{text}</span>
    </div>
  );
}
