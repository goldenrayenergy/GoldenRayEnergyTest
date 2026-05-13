// /get-quote — Option 6 Buyer path wizard.
//
// Phase 6.1 (this file): stub that renders the page shell + step indicator
//   so the route works and the nav links don't 404. Steps 1–4 are filled in
//   by phase 6.2 and 6.3.
//
// Phase 6.2: wires Step 1 (intent picker) + Step 2 (branches per intent).
// Phase 6.3: wires Step 3 (projection from scenario engine) + Step 4 (contact form + submit).

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Construction } from 'lucide-react';
import WebsiteNav from '../components/website/WebsiteNav';
import WebsiteFooter from '../components/website/WebsiteFooter';

export default function GetQuotePage() {
  const [step] = useState(1);
  const [searchParams] = useSearchParams();
  const prefilledPackage = searchParams.get('package');

  return (
    <div className="bg-white dark:bg-brand-dark font-body">
      <WebsiteNav />

      <main className="pt-12 pb-16 px-4 md:px-10 min-h-[60vh]">
        <div className="max-w-3xl mx-auto">

          {/* Progress bar — placeholder, real states wired in 6.2/6.3 */}
          <div className="mb-6">
            <div className="flex justify-between mb-2 text-[10px] font-bold tracking-widest text-gray-400 uppercase">
              <span className={step === 1 ? 'text-amber-700' : ''}>1 · How can we help?</span>
              <span className={step === 2 ? 'text-amber-700' : ''}>2 · Your home</span>
              <span className={step === 3 ? 'text-amber-700' : ''}>3 · Your savings</span>
              <span className={step === 4 ? 'text-amber-700' : ''}>4 · Contact details</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300"
                style={{ width: `${(step / 4) * 100}%` }}
              />
            </div>
          </div>

          <div className="bg-white dark:bg-brand-dark-1 rounded-3xl border border-gray-100 dark:border-white/10 shadow-xl p-8 text-center">
            <Construction size={36} className="mx-auto text-amber-500 mb-3" />
            <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">PHASE 6.1 · STUB</div>
            <h1 className="text-3xl md:text-4xl font-extrabold font-display mb-3 dark:text-gray-100">Get a tailored quote</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
              The 4-step quote wizard is being built. Phase 6.2 (intent picker + bill upload / estimate / callback branches)
              ships next, then Phase 6.3 (projection + contact form).
            </p>
            {prefilledPackage && (
              <div className="inline-block mb-6 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                Building on the <strong>{prefilledPackage.replace(/-/g, ' ')}</strong> package
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/solar-packages"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-white dark:bg-brand-dark border border-gray-200 dark:border-white/10 hover:border-amber-300 dark:hover:border-amber-500/50 text-sm font-bold text-gray-700 dark:text-gray-200 transition">
                <ArrowLeft size={14} /> Browse packages instead
              </Link>
              <a
                href="tel:+6421839356"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold hover:opacity-90 transition">
                📞 Or call us directly
              </a>
            </div>
          </div>
        </div>
      </main>

      <WebsiteFooter />
    </div>
  );
}
