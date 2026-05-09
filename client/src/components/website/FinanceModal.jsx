import { Phone, X, ArrowRight, Sprout, Percent, CreditCard, Banknote } from 'lucide-react';

// Extracted from WebsitePage so any public page can show it (via WebsiteNav).
// Same content as before — no behaviour change.
export default function FinanceModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-white dark:bg-brand-dark-1 rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/80 hover:bg-gray-100 dark:bg-brand-dark-2 dark:hover:bg-brand-dark-3 flex items-center justify-center text-gray-500 dark:text-gray-300 transition z-10"
          aria-label="Close"
        >
          <X size={14} />
        </button>

        <div className="p-6 pb-5 text-white" style={{ background: 'linear-gradient(135deg, #064e3b 0%, #0f766e 50%, #0e7490 100%)' }}>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/20 mb-3 text-[10px] font-bold tracking-widest">
            <Sprout size={11} /> SOLAR FINANCE
          </div>
          <h3 className="text-2xl font-extrabold font-display leading-tight">
            Solar from <span className="bg-gradient-to-r from-amber-300 via-pink-300 to-white bg-clip-text text-transparent">$0 upfront</span>
          </h3>
          <p className="text-xs text-white/85 mt-2 leading-relaxed">
            Spread the cost over time. For most homes, the monthly bill savings cover the repayment from day one.
          </p>
        </div>

        <div className="p-6 space-y-3">
          {[
            { icon: Percent,    title: 'Interest-free for 36 months', desc: 'Q Card finance on solar systems over $1,000' },
            { icon: Sprout,     title: 'Bank green loans at 1% p.a.',  desc: 'BNZ, ANZ, ASB & Kiwibank top-ups up to $80,000' },
            { icon: CreditCard, title: 'Payment plans from $45/week',  desc: 'No deposit, fixed terms 3–10 years' },
            { icon: Banknote,   title: 'Pre-approval in 24 hours',     desc: 'Soft credit check only — no impact on your score' },
          ].map((it, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <it.icon size={15} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-gray-800 dark:text-gray-100">{it.title}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{it.desc}</div>
              </div>
            </div>
          ))}

          <div className="border-t border-gray-100 dark:border-white/10 pt-4 mt-4">
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
              Our team handles the application end to end — soft credit check, lender match, and pre-approval. The fastest way to start is a quick chat.
            </p>
            <div className="flex gap-2">
              <a
                href="/#contact"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold text-center hover:from-amber-400 hover:to-orange-400 transition flex items-center justify-center gap-1.5"
              >
                Talk to an advisor <ArrowRight size={13} />
              </a>
              <a
                href="tel:+6421839356"
                className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 text-sm font-bold hover:bg-gray-50 dark:hover:bg-white/5 transition flex items-center gap-1.5"
              >
                <Phone size={13} /> Call
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
