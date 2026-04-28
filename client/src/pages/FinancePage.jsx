import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowLeft, Lock, Phone, Mail, MapPin, Sprout, ShieldCheck, Clock, HelpCircle,
  Handshake, FileCheck, Wrench, TrendingDown, Building2, Users, MapPinned, Zap,
  CheckCircle2, ArrowRight, CreditCard,
} from 'lucide-react';
import Button from '../components/ui/Button';
import SolarChatbot from '../components/website/SolarChatbot';
import WhatsAppAssistant from '../components/website/WhatsAppAssistant';
import WebsiteFooter from '../components/website/WebsiteFooter';

// ═══════════════════════════════════════════════════════════════════════
// At-a-glance headline numbers
// ═══════════════════════════════════════════════════════════════════════
const GLANCE = [
  { label: 'Q Card interest-free',    value: '36 months',  gradient: 'from-amber-500 to-orange-500' },
  { label: 'BNZ / ANZ / ASB rate',    value: '1% p.a.',    gradient: 'from-emerald-500 to-teal-500' },
  { label: 'Max borrowing (banks)',   value: '$80,000',    gradient: 'from-sky-500 to-blue-600' },
  { label: 'Westpac interest-free',   value: '5 years',    gradient: 'from-pink-500 to-fuchsia-500' },
  { label: 'Finance partners',        value: '6 options',  gradient: 'from-violet-500 to-indigo-500' },
];

const TRUST_BADGES = [
  { icon: Handshake, label: '6 Finance Partners' },
  { icon: CreditCard, label: '$0 Upfront Available' },
  { icon: MapPinned,  label: 'NZ-Wide Installation' },
  { icon: TrendingDown, label: 'Save from Day 1' },
];

// ═══════════════════════════════════════════════════════════════════════
// 4-step "How it works"
// ═══════════════════════════════════════════════════════════════════════
const STEPS = [
  { n: '01', icon: HelpCircle, title: 'Free consultation',   desc: 'Talk to our solar advisors. We assess your home, usage, and the best package for your needs — completely free, no pressure.', gradient: 'from-sky-400 to-blue-500' },
  { n: '02', icon: Handshake,  title: 'Choose your finance', desc: 'We walk you through all available options — Q Card, green bank loans, or your own bank. You pick what suits your situation.',  gradient: 'from-pink-500 to-fuchsia-500' },
  { n: '03', icon: Wrench,     title: 'We install',          desc: 'Our certified team handles everything — design, consent, installation, and compliance sign-off.',                             gradient: 'from-amber-500 to-orange-500' },
  { n: '04', icon: TrendingDown, title: 'Start saving',      desc: 'Your solar starts generating and you begin reducing your reliance on the grid — often enough to offset your repayments.',     gradient: 'from-emerald-500 to-teal-500' },
];

// ═══════════════════════════════════════════════════════════════════════
// NZ bank cards
// ═══════════════════════════════════════════════════════════════════════
const BANKS = [
  { brand: 'BNZ', product: 'Green Home Loan Top-Up',
    bullets: ['Up to $80,000', '1% p.a. fixed · 3 years', 'Solar + EV eligible'],
    desc: 'BNZ Green Home Loan Top-Ups make sustainable upgrades easy. Get up to $80,000 at a discounted rate for solar, insulation, EVs, and more. Flexible terms after the initial period.',
    color: '#00695c', href: 'https://www.bnz.co.nz/personal-banking/home-loans/sustainable-home-loan' },
  { brand: 'ANZ', product: 'Good Energy Home Loan',
    bullets: ['Up to $80,000', '1% p.a. fixed · 3 years', 'Solar eligible'],
    desc: "ANZ's Good Energy Home Loan offers a 1.00% p.a. fixed rate for 3 years on up to $80,000. Elevate your home with solar panels and energy improvements. Eligibility criteria apply.",
    color: '#004687', href: 'https://www.anz.co.nz/personal/home-loans-mortgages/good-energy-home-loan/' },
  { brand: 'ASB', product: 'Better Homes Top Up',
    bullets: ['Up to $80,000', '3-year fixed rate', 'EV + solar eligible'],
    desc: 'ASB Better Homes Top Up offers a 3-year fixed rate to borrow up to $80,000 for home improvements or an EV purchase. Minimum equity and solar installation quotes required.',
    color: '#ffcc00', accent: '#1a1a1a', href: 'https://www.asb.co.nz/home-loans-mortgages/better-homes-top-up.html' },
  { brand: 'Westpac', product: 'Greater Choices Home Loan',
    bullets: ['Up to $50,000', 'Interest-free · 5 years', 'Solar + EV eligible'],
    desc: 'Transform your home with up to $50,000 interest-free for 5 years. Covers insulation, solar panels, and eco-friendly electric transport upgrades.',
    color: '#d5002b', href: 'https://www.westpac.co.nz/home-loans-mortgages/sustainable-upgrades/' },
  { brand: 'Kiwibank', product: 'Sustainable Energy Loan',
    bullets: ['Solar eligible', 'Fee waived for existing customers', 'Renewable energy focus'],
    desc: 'Kiwibank Sustainable Energy Loan offers financing for renewable energy systems including solar. The top-up fee is waived for existing home loan customers — making it a great option if you already bank with Kiwibank.',
    color: '#d72c2c', href: 'https://www.kiwibank.co.nz/personal-banking/home-loans/sustainable-energy-loan/' },
];

// ═══════════════════════════════════════════════════════════════════════
// Comparison table rows
// ═══════════════════════════════════════════════════════════════════════
const COMPARE = [
  { provider: 'Q Card',   max: 'Any purchase $1,000+',  rate: '0% interest-free',      term: '36 months' },
  { provider: 'BNZ',      max: 'Up to $80,000',         rate: '1% p.a. fixed',          term: '3 years' },
  { provider: 'ANZ',      max: 'Up to $80,000',         rate: '1% p.a. fixed',          term: '3 years' },
  { provider: 'ASB',      max: 'Up to $80,000',         rate: '3-yr fixed rate',        term: '3 years' },
  { provider: 'Westpac',  max: 'Up to $50,000',         rate: '0% interest-free',       term: '5 years' },
  { provider: 'Kiwibank', max: 'Renewable system',      rate: 'Standard loan rate',     term: 'Flexible' },
];

// ═══════════════════════════════════════════════════════════════════════
// FAQ (aligned with reference page)
// ═══════════════════════════════════════════════════════════════════════
const FAQ = [
  { q: 'Do I need equity in my home to get finance?',
    a: 'For Q Card, no — it works like a retail credit product. For bank green loans (BNZ, ANZ, ASB), yes, you typically need some home equity. Our advisors will help you work out which option fits.' },
  { q: 'Will the solar savings cover my repayments?',
    a: 'For most NZ homes, the monthly power-bill savings partially or fully offset the repayments — especially with today\'s rising electricity prices. We model this for you during the free consultation.' },
  { q: 'How long does finance approval take?',
    a: 'Q Card approval can happen the same day. Bank green-loan top-ups typically take a few business days. We guide you through the process from start to finish.' },
  { q: 'Can I pay it off early?',
    a: 'Most options allow early repayment. Q Card is fully flexible. Bank loans may have conditions — your bank can confirm this when you apply.' },
  { q: 'What if I switch banks or sell my home?',
    a: 'Green loan top-ups are tied to your home loan. If you sell, the loan is typically repaid from the sale proceeds. Solar adds value to your home, so it often works in your favour.' },
  { q: 'Is there a catch with interest-free offers?',
    a: 'With Q Card, standard rates apply if the balance isn\'t cleared by the end of the interest-free period. We recommend setting up a repayment plan so you\'re covered well before then.' },
];

// ═══════════════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════════════
export default function FinancePage() {
  const [openFaq, setOpenFaq] = useState(0);

  return (
    <div className="bg-white font-body min-h-screen flex flex-col">
      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 md:px-10 h-16 flex items-center justify-between backdrop-blur-md shadow-lg shadow-black/20"
        style={{ background: 'linear-gradient(90deg, rgba(15,23,42,0.96) 0%, rgba(30,27,75,0.96) 45%, rgba(80,7,36,0.96) 100%)' }}>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-400 via-pink-500 via-fuchsia-500 via-violet-500 to-teal-400" />
        <Link to="/" className="flex items-center gap-3 relative">
          <div className="bg-white rounded-xl p-1.5 shadow-lg shadow-amber-500/30 ring-2 ring-amber-300/40">
            <img src="/logo.jpg" alt="Goldenray Energy NZ" className="h-11 w-auto object-contain" />
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-extrabold font-display tracking-tight text-white">
              GOLDENRAY <span className="bg-gradient-to-r from-amber-300 via-pink-300 to-violet-300 bg-clip-text text-transparent">ENERGY NZ</span>
            </div>
            <div className="text-[9px] text-amber-200/80 italic">Powering a Sustainable Future</div>
          </div>
        </Link>
        <div className="flex items-center gap-5 relative">
          <Link to="/" className="text-sm text-gray-200 hover:text-amber-300 font-medium transition flex items-center gap-1.5">
            <ArrowLeft size={13} /> Home
          </Link>
          <a href="/#calculator" className="text-sm text-gray-200 hover:text-amber-300 font-medium transition hidden md:inline">Calculator</a>
          <a href="/#case-studies" className="text-sm text-gray-200 hover:text-amber-300 font-medium transition hidden md:inline">Case Studies</a>
          <a href="/#contact" className="text-sm text-gray-200 hover:text-amber-300 font-medium transition hidden md:inline">Contact</a>
          <Link to="/login"><Button size="sm" icon={Lock}>Employee Login</Button></Link>
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Hero */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="pt-24 md:pt-32 pb-12 md:pb-14 px-4 md:px-16 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #064e3b 0%, #0f766e 40%, #0e7490 100%)' }}>
        <div className="absolute -top-24 -right-24 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-amber-400 to-pink-400 opacity-25 blur-3xl animate-blob" />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 opacity-25 blur-3xl animate-blob-delay-2" />
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/15 border border-white/25 mb-5 backdrop-blur">
            <Sprout size={13} className="text-emerald-200" />
            <span className="text-xs font-extrabold tracking-widest">SOLAR FINANCE NZ</span>
          </div>
          <h1 className="text-3xl md:text-6xl font-extrabold font-display leading-[1.05] mb-5">
            Go Solar <br className="hidden md:block" />
            for <span className="bg-gradient-to-r from-amber-300 via-pink-300 to-white bg-clip-text text-transparent animate-gradient">$0 Upfront</span>
          </h1>
          <p className="text-base md:text-lg text-white/85 leading-relaxed max-w-2xl mb-7">
            Upfront cost should not stand between you and lower power bills. Through bank green loans and interest-free finance, you can begin saving on day one — before any capital outlay.
          </p>
          <div className="flex gap-3 flex-wrap">
            <a href="/#contact"><Button size="lg" icon={ArrowRight}>Talk to a solar advisor</Button></a>
            <a href="/#contact"><Button variant="dark" size="lg" icon={Phone}>Contact us</Button></a>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Finance at a glance */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="py-10 md:py-16 px-4 md:px-16 bg-gradient-to-b from-white via-emerald-50/30 to-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-cool">AT A GLANCE</div>
            <h2 className="text-2xl md:text-3xl font-extrabold font-display">Finance <span className="text-gradient-warm">at a glance</span></h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {GLANCE.map((g, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 text-center hover:-translate-y-1 hover:shadow-lg transition-all">
                <div className={`text-2xl md:text-2xl md:text-3xl font-extrabold font-display bg-gradient-to-br ${g.gradient} bg-clip-text text-transparent`}>{g.value}</div>
                <div className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide mt-1 leading-tight">{g.label}</div>
              </div>
            ))}
          </div>
          <div className="bg-gradient-to-r from-amber-50 via-pink-50 to-violet-50 border border-amber-100 rounded-xl px-5 py-3 text-center mb-6">
            <span className="text-xs text-gray-700"><b>Tip:</b> Most New Zealand homeowners qualify for at least one of these finance options. Our advisors will identify the best fit for your circumstances — no obligation.</span>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {TRUST_BADGES.map((b, i) => (
              <div key={i} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-gray-100 shadow-sm">
                <b.icon size={14} className="text-amber-500" />
                <span className="text-xs font-semibold text-gray-700">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* How it works — 4 steps */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-20 px-4 md:px-16 bg-gradient-to-br from-violet-50 via-white to-cyan-50">
        <div className="text-center mb-12">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-warm">SIMPLE PROCESS</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display">How financing <span className="text-gradient-warm">works</span></h2>
          <p className="text-sm text-gray-500 mt-2 max-w-lg mx-auto">Getting solar with finance is straightforward. We handle the complexity so you don't have to.</p>
        </div>
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6 relative">
          <div className="absolute top-12 left-[12.5%] right-[12.5%] h-1 bg-gradient-to-r from-sky-400 via-pink-400 via-amber-400 to-emerald-400 hidden md:block rounded-full opacity-60" />
          {STEPS.map((s, i) => (
            <div key={i} className="relative text-center">
              <div className={`w-24 h-24 rounded-2xl mx-auto flex items-center justify-center mb-4 relative z-10 bg-gradient-to-br ${s.gradient} shadow-xl hover:scale-110 hover:rotate-3 transition-transform`}>
                <s.icon size={32} className="text-white drop-shadow" />
              </div>
              <div className={`text-[10px] font-extrabold tracking-widest mb-1 bg-gradient-to-r ${s.gradient} bg-clip-text text-transparent`}>STEP {s.n}</div>
              <h4 className="text-sm font-bold font-display mb-2">{s.title}</h4>
              <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Featured: Q Card interest-free */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-20 px-4 md:px-16 bg-gradient-to-br from-amber-50 via-white to-pink-50/40">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-solar">FEATURED OPTION</div>
            <h2 className="text-2xl md:text-3xl font-extrabold font-display"><span className="text-gradient-warm">Interest-free</span> finance</h2>
            <p className="text-sm text-gray-500 mt-2">The fastest, simplest way to go solar. No bank required.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Left — explainer */}
            <div className="bg-white rounded-2xl border border-gray-100 p-7 shadow-sm">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-200 mb-3">
                <CreditCard size={12} className="text-amber-600" />
                <span className="text-[10px] font-bold text-amber-700 tracking-widest">Q CARD · IN-STORE FINANCE</span>
              </div>
              <h3 className="text-2xl font-extrabold font-display mb-1">36 Months Interest-Free</h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-4">
                Available on all GoldenRay Energy NZ purchases above <b>$1,000</b>. Apply directly through our team — approval is typically same-day, with no home refinance required.
              </p>
              <ul className="space-y-2 mb-4">
                {[
                  '36 months interest-free on purchases over $1,000',
                  'Apply directly through Goldenray — no bank needed',
                  'Fast approval, minimal paperwork',
                  'Works alongside all our solar packages',
                ].map((perk, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" /> {perk}
                  </li>
                ))}
              </ul>
              <div className="text-[10px] text-gray-400 italic border-t border-gray-100 pt-3">
                * Please note: an 8% finance fee is added on top of the purchase price when using Q Card interest-free finance.
              </div>
              <a href="/#contact" className="inline-block mt-4">
                <Button icon={ArrowRight}>Talk to an advisor</Button>
              </a>
            </div>

            {/* Right — example card */}
            <div className="rounded-2xl overflow-hidden shadow-xl" style={{ background: 'linear-gradient(135deg, #f59e0b, #ec4899, #8b5cf6)' }}>
              <div className="bg-white/10 backdrop-blur px-6 py-5 flex justify-between items-center">
                <div>
                  <div className="text-xs uppercase tracking-widest text-white/80 font-bold">Q Card</div>
                  <div className="text-4xl font-extrabold font-display text-white">$0</div>
                  <div className="text-xs text-white/80">upfront today</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-white/80 font-bold">Interest-Free</div>
                  <div className="text-xl font-extrabold text-white">36 Months</div>
                </div>
              </div>
              <div className="bg-white p-6">
                <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Example — 16-panel system</h4>
                <div className="space-y-2.5 mb-4">
                  <Row label="System cost"                value="~$21,386" />
                  <Row label="Upfront payment"            value="$0"       highlight="emerald" />
                  <Row label="Est. monthly repayment"     value="~$594/mo" />
                  <Row label="Avg monthly power saving"   value="~$200–$350" highlight="amber" />
                </div>
                <div className="text-[10px] text-gray-400 italic leading-relaxed border-t border-gray-100 pt-3">
                  * Indicative figures only. Actual repayments, savings and system costs vary based on your home, usage, and finance terms.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* NZ bank green loans */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-20 px-4 md:px-16 bg-gradient-to-b from-white via-cyan-50/30 to-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-cool">NZ BANK GREEN LOANS</div>
            <h2 className="text-2xl md:text-3xl font-extrabold font-display">Low-rate <span className="text-gradient-warm">bank options</span></h2>
            <p className="text-sm text-gray-500 mt-2 max-w-xl mx-auto">All major NZ banks offer green loan top-ups specifically for solar. Rates as low as <b>1% p.a. fixed</b> for 3 years.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {BANKS.map((b, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:-translate-y-1 hover:shadow-xl transition-all duration-300">
                <div className="px-5 py-4 flex items-center gap-3" style={{ background: b.color, color: b.accent || '#fff' }}>
                  <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center backdrop-blur">
                    <Building2 size={18} />
                  </div>
                  <div>
                    <div className="text-lg font-extrabold font-display leading-tight">{b.brand}</div>
                    <div className="text-xs opacity-90">{b.product}</div>
                  </div>
                </div>
                <div className="p-5">
                  <p className="text-xs text-gray-500 leading-relaxed mb-4">{b.desc}</p>
                  <ul className="space-y-1.5 mb-4">
                    {b.bullets.map((bullet, j) => (
                      <li key={j} className="flex items-center gap-2 text-xs text-gray-700">
                        <CheckCircle2 size={11} className="text-emerald-500 flex-shrink-0" /> {bullet}
                      </li>
                    ))}
                  </ul>
                  <a href={b.href} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 hover:text-amber-700 transition">
                    Learn more at {b.brand} <ArrowRight size={11} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Comparison table */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-20 px-4 md:px-16 bg-gradient-to-br from-pink-50 via-white to-amber-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-warm">SIDE BY SIDE</div>
            <h2 className="text-2xl md:text-3xl font-extrabold font-display">Compare <span className="text-gradient-warm">all options</span></h2>
            <p className="text-sm text-gray-500 mt-2">A quick breakdown of every finance option available through GoldenRay Energy NZ.</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-slate-900 via-indigo-900 to-rose-900 text-white">
                  <th className="text-left px-5 py-3 text-[11px] uppercase tracking-widest font-bold">Provider</th>
                  <th className="text-left px-5 py-3 text-[11px] uppercase tracking-widest font-bold">Max amount</th>
                  <th className="text-left px-5 py-3 text-[11px] uppercase tracking-widest font-bold">Rate</th>
                  <th className="text-left px-5 py-3 text-[11px] uppercase tracking-widest font-bold">Term</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((row, i) => (
                  <tr key={i} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-amber-50/40 transition`}>
                    <td className="px-5 py-3 text-sm font-bold font-display">{row.provider}</td>
                    <td className="px-5 py-3 text-xs text-gray-700">{row.max}</td>
                    <td className="px-5 py-3 text-xs font-semibold text-emerald-600">{row.rate}</td>
                    <td className="px-5 py-3 text-xs text-gray-700">{row.term}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Application CTA — applications are processed by our team, so the */}
      {/* public-facing flow is "talk to an advisor" rather than self-serve.*/}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="py-10 md:py-16 px-4 md:px-16 bg-gradient-to-br from-amber-50 via-white to-emerald-50">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-warm">READY TO APPLY?</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display mb-3">
            Talk to an advisor to <span className="text-gradient-warm">start your application</span>
          </h2>
          <p className="text-sm text-gray-500 max-w-xl mx-auto leading-relaxed mb-6">
            Our team handles your application from end to end — soft credit check, lender match, and pre-approval — usually within 24 hours. The fastest way to get started is a quick chat with an advisor.
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <a href="/#contact"><Button size="lg" icon={ArrowRight}>Talk to an advisor</Button></a>
            <a href="tel:+6421839356"><Button variant="dark" size="lg" icon={Phone}>+64 21 839 356</Button></a>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Finance FAQ */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-20 px-4 md:px-16 bg-gradient-to-br from-violet-50 via-white to-amber-50">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-widest mb-2 text-gradient-cool">
              <HelpCircle size={13} /> COMMON QUESTIONS
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold font-display">Finance <span className="text-gradient-warm">FAQs</span></h2>
            <p className="text-sm text-gray-500 mt-2">Straight answers to the questions we get asked most.</p>
          </div>
          <div className="space-y-3">
            {FAQ.map((f, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition">
                  <span className="text-sm font-semibold text-gray-800 pr-4">{f.q}</span>
                  <span className={`text-amber-500 text-xl font-bold transition-transform ${openFaq === i ? 'rotate-45' : ''}`}>+</span>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4">
                    <p className="text-sm text-gray-600 leading-relaxed">{f.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Final CTA */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="py-10 md:py-16 px-4 md:px-16 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #500724 80%, #7c2d12 100%)' }}>
        <div className="absolute -top-20 right-1/3 w-80 h-80 rounded-full bg-gradient-to-br from-amber-400 to-pink-400 opacity-20 blur-3xl" />
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <div className="text-xs font-extrabold tracking-widest mb-3 text-amber-300">READY TO GET STARTED?</div>
          <h3 className="text-3xl md:text-4xl font-extrabold font-display mb-4">
            Get solar for <span className="bg-gradient-to-r from-amber-300 via-pink-300 to-violet-300 bg-clip-text text-transparent">$0 upfront</span>
          </h3>
          <p className="text-sm text-gray-300 mb-6 max-w-xl mx-auto leading-relaxed">
            Speak with a GoldenRay Energy NZ advisor. We will identify the right finance option for your home and walk you through every step of the process — no pressure, no obligation.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <a href="/#calculator"><Button size="lg" icon={Zap}>Get a free quote</Button></a>
            <a href="/#contact"><Button variant="dark" size="lg" icon={Phone}>Contact us</Button></a>
          </div>
        </div>
      </section>

      {/* ── Footer (shared with homepage) ── */}
      <WebsiteFooter homepage={false} />

      <SolarChatbot />
      <WhatsAppAssistant />
    </div>
  );
}

// Small row helper for the example card
const Row = ({ label, value, highlight }) => {
  const color = highlight === 'emerald' ? 'text-emerald-600' : highlight === 'amber' ? 'text-amber-600' : 'text-gray-800';
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-b-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
  );
};
