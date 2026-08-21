// GetQuoteLanding — the 30-second pitch page that lives at /get-quote/preview
// (Phase B3, 2026-08-21). Sells the merged residential quote flow BEFORE
// asking the customer to do anything, then hands them off to /get-quote
// which enters the 5-step wizard.
//
// Owner action items marked `[OWNER]` in comments below — swap placeholder
// stats / testimonials for real numbers before promoting this URL widely.
//
// Structure:
//   Hero          — headline + subhead + primary + secondary CTA
//   Trust bar     — 3 quick "we're legit" signals
//   Value cards   — 3-col "what you get"
//   How it works  — 3-step visual walkthrough
//   Social proof  — stat panel + rotating testimonial
//   FAQ           — 4 quick answers to common objections
//   Bottom CTA    — mirrors hero for scrollers who reach the end
//
// Reuses WebsiteNav + WebsiteFooter for consistency with the marketing site.

import { Link } from 'react-router-dom';
import {
  ArrowRight, Zap, MapPin, LayoutGrid, DollarSign, Sun, Battery,
  Clock, Download, Shield, CheckCircle, Users, Star,
} from 'lucide-react';
import WebsiteNav from '../../components/website/WebsiteNav';
import WebsiteFooter from '../../components/website/WebsiteFooter';

export default function GetQuoteLanding() {
  return (
    <div className="bg-gray-50 dark:bg-brand-dark font-body min-h-screen">
      <WebsiteNav />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-50/50 via-orange-50/30 to-white dark:from-amber-500/5 dark:via-orange-500/5 dark:to-brand-dark pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 md:px-10 pt-16 md:pt-24 pb-14">
          <div className="grid lg:grid-cols-[1.15fr,1fr] gap-10 items-center">
            <div>
              <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-3 uppercase">
                Instant solar quote &middot; 90 seconds &middot; no signup
              </div>
              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50 leading-[1.05]">
                See your solar potential
                <br />
                <span className="text-amber-600 dark:text-amber-400">in 90 seconds.</span>
              </h1>
              <p className="mt-5 text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-xl leading-relaxed">
                3D roof analysis + 3 tiered systems + real 25-year savings &mdash; before you talk to anyone. Powered by Google Solar API + NZ LiDAR.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/get-quote"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm md:text-base font-bold shadow-lg shadow-amber-500/25 transition"
                >
                  Start my quote <ArrowRight className="w-4 h-4" />
                </Link>
                <a
                  href="#how"
                  className="inline-flex items-center gap-2 px-5 py-3.5 rounded-xl border-2 border-gray-300 dark:border-white/20 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-white/5 transition"
                >
                  See how it works
                </a>
              </div>
              <div className="mt-5 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> No signup to see quotes</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Real prices, real hardware</span>
              </div>
            </div>

            {/* Illustrative screenshot placeholder — visual anchor. Uses SVG
                so it renders instantly with no image asset. [OWNER: swap for
                a real screenshot of Step 4 3D + tier cards once we have one.] */}
            <div className="hidden lg:block">
              <div className="relative rounded-2xl border-4 border-amber-200 dark:border-amber-500/30 bg-white dark:bg-brand-dark-1 shadow-2xl overflow-hidden aspect-[4/3]">
                <HeroIllustration />
                <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-[10px] font-semibold uppercase tracking-wider">
                  Live 3D preview
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust bar ────────────────────────────────────────────────────── */}
      <section className="border-y border-gray-200 dark:border-white/10 bg-white/50 dark:bg-brand-dark-1/50">
        <div className="max-w-6xl mx-auto px-4 md:px-10 py-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
            <TrustSignal icon={Sun}       label="Powered by Google Solar API" />
            <TrustSignal icon={MapPin}    label="NZ LiDAR for accurate roofs" />
            <TrustSignal icon={Shield}    label="Your data stays private" />
          </div>
        </div>
      </section>

      {/* ── Value cards ──────────────────────────────────────────────────── */}
      <section className="py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <div className="text-center mb-12">
            <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2 uppercase">
              What you get
            </div>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
              A proper quote, not a callback.
            </h2>
            <p className="mt-3 text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
              Most solar sites take your phone number and put you in a call queue. We show you the actual system + price first.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <ValueCard
              icon={LayoutGrid}
              title="Your roof in 3D"
              desc="Real Google Photorealistic 3D of your house with panels laid out. Rotate, zoom, pick which roof faces to use."
              accent="orange"
            />
            <ValueCard
              icon={Battery}
              title="3 tiered systems, side by side"
              desc="Essential (solar only), Balanced (+battery), Premium (+battery+EV). Click any tier — 3D updates live."
              accent="green"
            />
            <ValueCard
              icon={Download}
              title="Downloadable proposal"
              desc="System spec + 25-year savings projection + engineering notes. Print or save as PDF, share with your partner."
              accent="blue"
            />
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" className="py-16 md:py-20 bg-gradient-to-b from-amber-50/40 to-white dark:from-amber-500/5 dark:to-brand-dark">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <div className="text-center mb-12">
            <div className="text-xs font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2 uppercase">
              How it works
            </div>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
              90 seconds to a real quote.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4 md:gap-6">
            <StepCard
              n="1"
              title="Tell us your usage"
              desc="Upload a bill (most accurate) or drag a slider for a quick estimate."
              icon={Zap}
              time="~15s"
            />
            <StepCard
              n="2"
              title="Confirm your house"
              desc="Search your address, drag the pin onto your actual roof."
              icon={MapPin}
              time="~15s"
            />
            <StepCard
              n="3"
              title="Pick your system"
              desc="3D view + 3 sized tiers. Choose one, get the proposal."
              icon={LayoutGrid}
              time="~60s"
            />
          </div>
        </div>
      </section>

      {/* ── Social proof ─────────────────────────────────────────────────── */}
      <section className="py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <div className="grid md:grid-cols-3 gap-4 md:gap-6">
            {/* [OWNER: replace placeholder stats with real numbers when available] */}
            <StatCard number="1,200+" label="NZ homes quoted" note="[OWNER: verify]" />
            <StatCard number="$8M+"   label="Solar savings unlocked" note="[OWNER: verify]" />
            <StatCard number="4.7/5"  label="From 180+ reviews" note="[OWNER: verify]" />
          </div>

          {/* Testimonial — [OWNER: replace with a real customer quote + name] */}
          <div className="mt-10 max-w-3xl mx-auto rounded-2xl bg-white dark:bg-brand-dark-1 border border-gray-200 dark:border-white/10 p-6 md:p-8 shadow-lg">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-500/20 grid place-items-center flex-shrink-0">
                <Star className="w-6 h-6 text-amber-600 fill-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <blockquote className="text-lg text-gray-800 dark:text-gray-200 leading-relaxed">
                  &ldquo;Best solar experience I&apos;ve had. Got the exact price + 3D view in about 90 seconds, no waiting for a callback. Installed 3 weeks later.&rdquo;
                </blockquote>
                <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  &mdash; <strong className="text-gray-700 dark:text-gray-200">[OWNER: real name]</strong>, [Suburb, City]
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="py-16 md:py-20 bg-white/60 dark:bg-brand-dark-1/40 border-y border-gray-200 dark:border-white/10">
        <div className="max-w-3xl mx-auto px-4 md:px-10">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-50 mb-6 text-center">
            Common questions
          </h2>
          <div className="space-y-3">
            <FaqRow q="Do I need to give you my address?">
              Yes &mdash; we can&apos;t render your roof or calculate sun-hours without it. We only use it to pull satellite imagery and design your system.
            </FaqRow>
            <FaqRow q="Is the price on the quote the real price?">
              Yes &mdash; every quote uses live pricing from our supplier catalogue. Site survey may reveal small adjustments (e.g. extra rail for a complex roof) but the ±5% ballpark is real.
            </FaqRow>
            <FaqRow q="Do you share my email?">
              Only with our installers so they can follow up. We never sell or share it with third-party lists. [OWNER: link to /privacy once it&apos;s wired.]
            </FaqRow>
            <FaqRow q="What happens after I submit?">
              Our team calls within 1 business day to confirm your address is accessible, book a site survey, and answer questions. Install typically 3-6 weeks from deposit.
            </FaqRow>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section className="py-16 md:py-24 text-center bg-gradient-to-b from-amber-50/60 to-orange-100/40 dark:from-amber-500/10 dark:to-orange-500/5">
        <div className="max-w-3xl mx-auto px-4 md:px-10">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
            Ready to see your roof?
          </h2>
          <p className="mt-3 text-lg text-gray-600 dark:text-gray-300">
            No signup, no phone number required to see your quote.
          </p>
          <Link
            to="/get-quote"
            className="mt-6 inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-base font-bold shadow-xl shadow-amber-500/30 transition"
          >
            Start my quote <ArrowRight className="w-5 h-5" />
          </Link>
          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Typically ~90 seconds to first quote
          </div>
        </div>
      </section>

      <WebsiteFooter />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function TrustSignal({ icon: Icon, label }) {
  return (
    <div className="inline-flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-300">
      <Icon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
      <span className="font-medium">{label}</span>
    </div>
  );
}

function ValueCard({ icon: Icon, title, desc, accent }) {
  const accentMap = {
    orange: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
    green:  'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    blue:   'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
  };
  return (
    <div className="rounded-2xl bg-white dark:bg-brand-dark-1 border border-gray-200 dark:border-white/10 p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition">
      <div className={`w-12 h-12 rounded-xl grid place-items-center mb-4 ${accentMap[accent]}`}>
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50 mb-2">{title}</h3>
      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{desc}</p>
    </div>
  );
}

function StepCard({ n, title, desc, icon: Icon, time }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-brand-dark-1 border border-gray-200 dark:border-white/10 p-6 relative">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-full bg-amber-600 text-white grid place-items-center font-bold text-sm flex-shrink-0">
          {n}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50 leading-tight">{title}</h3>
          <div className="text-xs text-amber-700 dark:text-amber-300 font-semibold mt-0.5">{time}</div>
        </div>
        <Icon className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300">{desc}</p>
    </div>
  );
}

function StatCard({ number, label, note }) {
  return (
    <div className="text-center p-6 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/5 border border-amber-100 dark:border-amber-500/20">
      <div className="font-display text-4xl md:text-5xl font-extrabold text-amber-700 dark:text-amber-300">
        {number}
      </div>
      <div className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center justify-center gap-1.5">
        <Users className="w-3.5 h-3.5" /> {label}
      </div>
      {note && (
        <div className="mt-1 text-[10px] text-gray-400 italic">
          {note}
        </div>
      )}
    </div>
  );
}

function FaqRow({ q, children }) {
  return (
    <details className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-1">
      <summary className="cursor-pointer px-5 py-4 font-semibold text-gray-900 dark:text-gray-50 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl flex items-center justify-between gap-3">
        <span>{q}</span>
        <span className="text-xs text-gray-400 flex-shrink-0">+</span>
      </summary>
      <div className="px-5 pb-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
        {children}
      </div>
    </details>
  );
}

// ── Hero illustration — inline SVG of a house with panels + a 3D-style badge.
// [OWNER: swap for a real screenshot of Step 4 3D view once available.]
function HeroIllustration() {
  return (
    <svg viewBox="0 0 400 300" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="lp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#DFF0FA" />
          <stop offset="70%" stopColor="#B7D9F0" />
          <stop offset="100%" stopColor="#F5F9FF" />
        </linearGradient>
        <linearGradient id="lp-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86EFAC" />
          <stop offset="100%" stopColor="#4A8259" />
        </linearGradient>
        <linearGradient id="lp-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B5A85" />
          <stop offset="100%" stopColor="#0F2540" />
        </linearGradient>
      </defs>
      {/* Sky */}
      <rect x="0" y="0" width="400" height="200" fill="url(#lp-sky)" />
      {/* Ground */}
      <rect x="0" y="200" width="400" height="100" fill="url(#lp-ground)" />
      {/* Sun */}
      <circle cx="320" cy="60" r="26" fill="#FCD34D" />
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <line key={i}
            x1={320 + Math.cos(a) * 32} y1={60 + Math.sin(a) * 32}
            x2={320 + Math.cos(a) * 40} y2={60 + Math.sin(a) * 40}
            stroke="#FCD34D" strokeWidth="2" strokeLinecap="round"
          />
        );
      })}
      {/* House */}
      <path d="M 90 200 L 90 140 L 190 90 L 290 140 L 290 200 Z" fill="#FEF3E2" stroke="#78350F" strokeWidth="2" />
      <path d="M 85 145 L 190 82 L 295 145" fill="none" stroke="#B45309" strokeWidth="4" />
      <path d="M 90 140 L 190 90 L 200 105 L 100 155 Z" fill="#B45309" />
      {/* Door */}
      <rect x="170" y="160" width="30" height="40" fill="#7C4A1E" />
      {/* Windows */}
      <rect x="115" y="155" width="30" height="25" fill="#93C5FD" stroke="#78350F" strokeWidth="1.5" />
      <rect x="220" y="155" width="30" height="25" fill="#93C5FD" stroke="#78350F" strokeWidth="1.5" />
      {/* Panels on roof face */}
      {Array.from({ length: 8 }).map((_, i) => {
        const r = Math.floor(i / 4);
        const c = i % 4;
        const rowY = 105 + r * 18;
        const x = 110 + c * 18 + r * 6;
        const y = rowY + (3 - c) * 1.5;
        return (
          <g key={i}>
            <path
              d={`M ${x} ${y} L ${x + 16} ${y - 2} L ${x + 18} ${y + 10} L ${x + 2} ${y + 12} Z`}
              fill="url(#lp-panel)" stroke="#0B1E36" strokeWidth="0.5"
            />
          </g>
        );
      })}
    </svg>
  );
}
