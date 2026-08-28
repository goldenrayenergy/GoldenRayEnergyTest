import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Zap, Phone, Lock, Star, Mail, MapPin, Clock, CheckCircle, Send, Leaf, ArrowRight, DollarSign, User, Calculator, Battery, TrendingUp, Download, MessageCircle, Loader2, ChevronDown, Shield, Award, Wrench, Eye, Home, Building, Truck, Power, Upload, X, Sprout, Percent, CreditCard, Banknote, Info, Megaphone } from 'lucide-react';
import Button from '../components/ui/Button';
import AddressAutocomplete from '../components/ui/AddressAutocomplete';
import BatteryComparisonModal from '../components/ui/BatteryComparisonModal';
import LeadSourceField from '../components/ui/LeadSourceField';
import SolarChatbot from '../components/website/SolarChatbot';
import WhatsAppAssistant from '../components/website/WhatsAppAssistant';
import WebsiteFooter from '../components/website/WebsiteFooter';
import WebsiteNav from '../components/website/WebsiteNav';
import FinanceModal from '../components/website/FinanceModal';
import axios from 'axios';
import { publicApi } from '../services/api';

const SYSTEM_TYPES = [
  { value: 'on-grid', label: 'On-Grid', desc: 'Grid-connected, sell excess back', icon: '🔌' },
  { value: 'hybrid', label: 'Hybrid', desc: 'Grid + battery backup', icon: '🔋' },
  { value: 'off-grid', label: 'Off-Grid', desc: 'Fully independent', icon: '🏡' },
];

const fmt = n => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

const CASE_STUDY_IMAGES = [
  <img key='res' src='https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=220&fit=crop&auto=format&q=80' alt='Residential solar panels on Auckland family home' className='w-full h-full object-cover' />,
  <img key='com' src='https://images.unsplash.com/photo-1611365892117-00ac5ef43c90?w=600&h=220&fit=crop&auto=format&q=80' alt='Commercial solar panels on warehouse roof' className='w-full h-full object-cover' />,
  <img key='com2' src='https://images.unsplash.com/photo-1466611653911-95081537e5b7?w=600&h=220&fit=crop&auto=format&q=80' alt='Community solar installation' className='w-full h-full object-cover' />,
];

const INITIAL_FORM = {
  firstName: '', lastName: '', email: '', phone: '',
  address: '', addressStreet: '', addressSuburb: '', addressCity: '', addressPostcode: '',
  ownsHome: '', floors: '', roofType: '',
  installationType: '', batteryOption: '',
  callToDiscuss: '', installationTimeframe: '',
  monthlyBill: '', electricityRate: '0.32',
  leadSource: '', leadSourceOther: '', referrerName: '', referrerPhone: '',
};
const INITIAL_OTP = { sent: false, value: '', verified: false, loading: false, error: '', demoCode: '' };

export default function WebsitePage() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [powerBillFile, setPowerBillFile] = useState(null);
  const [openFaq, setOpenFaq] = useState(null);
  const [otpState, setOtpState] = useState(INITIAL_OTP);
  const [submitState, setSubmitState] = useState({ loading: false, done: false, error: '', id: '' });
  const [financeModalOpen, setFinanceModalOpen] = useState(false);
  const [batteryModalOpen, setBatteryModalOpen] = useState(false);
  const [addressExpanded, setAddressExpanded] = useState(false);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  // Called by AddressAutocomplete when the user picks a suggestion
  const handleAddressSelect = (parsed) => {
    setForm(f => ({
      ...f,
      address: parsed.formatted,
      addressStreet: parsed.street,
      addressSuburb: parsed.suburb,
      addressCity: parsed.city,
      addressPostcode: parsed.postcode,
    }));
    setAddressExpanded(false);
  };

  const sendOtp = async () => {
    if (!form.phone) return;
    setOtpState(s => ({ ...s, loading: true, error: '', demoCode: '' }));
    try {
      const { data } = await publicApi.post('/otp/send', { phone: form.phone });
      setOtpState(s => ({ ...s, loading: false, sent: true, demoCode: data.demoOtp || '' }));
    } catch (e) {
      setOtpState(s => ({ ...s, loading: false, error: e.response?.data?.error || 'Failed to send OTP.' }));
    }
  };

  const verifyOtp = async () => {
    setOtpState(s => ({ ...s, loading: true, error: '' }));
    try {
      await publicApi.post('/otp/verify', { phone: form.phone, otp: otpState.value });
      setOtpState(s => ({ ...s, loading: false, verified: true, sent: false, demoCode: '' }));
    } catch (e) {
      setOtpState(s => ({ ...s, loading: false, error: e.response?.data?.error || 'Invalid OTP.' }));
    }
  };

  const submitEnquiry = async () => {
    setSubmitState({ loading: true, done: false, error: '', id: '' });
    try {
      const { data } = await publicApi.post('/quote/submit', { form });
      setSubmitState({ loading: false, done: true, error: '', id: data.id });
      setForm(INITIAL_FORM);
      setPowerBillFile(null);
      setOtpState(INITIAL_OTP);
      setTimeout(() => document.getElementById('quote-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      setSubmitState({ loading: false, done: false, error: e.response?.data?.error || 'Submission failed. Please try again.', id: '' });
    }
  };

  // Address autocomplete is handled inside <AddressAutocomplete /> (Nominatim).
  // To swap to Google Places later, replace the searchAddresses + parseSelection
  // helpers in client/src/components/ui/AddressAutocomplete.jsx.

  // ── Prefill from a package detail page (?package=<slug>) ────────────────
  // When the customer clicks "Get my free quote" on /solar-packages/:slug,
  // we land here with ?package=<slug>; fetch the package's prefill payload
  // and seed the form so battery / installation type are already chosen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('package');
    if (!slug) return;
    publicApi.get(`/packages/public/${slug}`)
      .then(r => {
        const p = r.data?.prefill || {};
        const hasBattery = (r.data?.battery_kwh || 0) > 0;
        setForm(f => ({
          ...f,
          installationType: p.installation_type || f.installationType || 'residential',
          batteryOption:    p.battery_option    || (hasBattery ? 'with-battery' : 'without-battery'),
          monthlyBill:      p.estimated_monthly_bill ? String(p.estimated_monthly_bill) : f.monthlyBill,
        }));
        setTimeout(() => document.getElementById('calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
      })
      .catch(() => { /* silently ignore — the user just sees the empty form */ });
  }, []);

  return (
    <div className="bg-white dark:bg-brand-dark font-body transition-colors">
      <WebsiteNav />

      {/* Hero */}
      <section className="min-h-[80vh] md:min-h-screen flex items-center px-4 md:px-16 pt-20 md:pt-0 bg-mesh-vibrant relative overflow-hidden">
        <div className="absolute -top-20 -left-20 w-[420px] h-[420px] rounded-full bg-gradient-to-br from-amber-400 to-orange-500 opacity-25 blur-3xl animate-blob" />
        <div className="absolute top-[10%] right-[-80px] w-[460px] h-[460px] rounded-full bg-gradient-to-br from-orange-500 to-amber-500 opacity-25 blur-3xl animate-blob-delay-2" />
        <div className="absolute bottom-[-100px] left-[30%] w-[400px] h-[400px] rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 opacity-20 blur-3xl animate-blob-delay-4" />
        <div className="absolute top-[8%] right-[5%] opacity-[0.08] animate-spin-slow">
          <svg viewBox="0 0 200 200" className="w-[480px]">
            {Array.from({ length: 12 }).map((_, i) => {
              const a = i * 30 * Math.PI / 180;
              return <line key={i} x1={100 + Math.cos(a) * 50} y1={100 + Math.sin(a) * 50} x2={100 + Math.cos(a) * 90} y2={100 + Math.sin(a) * 90} stroke="#FF6A00" strokeWidth="3" />;
            })}
            <circle cx="100" cy="100" r="35" fill="#F5A623" />
          </svg>
        </div>
        {/* ── Original brand hero — kept for narrative + brand recall ── */}
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-white dark:bg-brand-dark-1 border border-amber-300 dark:border-amber-500/40 shadow-sm shadow-amber-200/60 dark:shadow-none mb-6">
            <span className="text-xs font-bold text-gradient-warm">NEW ZEALAND'S SOLAR ENERGY EXPERTS</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold font-display leading-tight mb-5 dark:text-gray-100">
            Clean Energy for<br />New Zealand's <span className="text-gradient-warm animate-gradient">Future</span>
          </h1>
          <p className="text-base text-gray-600 dark:text-gray-300 leading-relaxed max-w-lg mb-8">
            From single-family homes to large commercial sites, <span className="font-semibold text-orange-600 dark:text-orange-400">GoldenRay Energy NZ</span> designs, installs, and supports solar systems built around your usage — with transparent pricing and detailed proposals.
          </p>
          <div className="flex gap-2 md:gap-3 flex-wrap">
            <Link to="/get-quote?fresh=1"><Button size="lg" icon={Zap}>Get Free Quote</Button></Link>
            <Button onClick={() => setFinanceModalOpen(true)} variant="success" size="lg" icon={DollarSign}>$0 Upfront Finance</Button>
            <a href="tel:+6421839356"><Button variant="dark" size="lg" icon={Phone}>+64 21 839 356</Button></a>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 max-w-md">
            Two ways to engage:{' '}
            <a href="#path-selector" className="text-amber-600 hover:underline font-semibold">browse our packages</a> at your own pace, or{' '}
            <Link to="/get-quote?fresh=1" className="text-amber-600 hover:underline font-semibold">walk through our 4-step quote wizard</Link>.
          </p>
          <div className="grid grid-cols-2 md:flex md:gap-12 gap-4 mt-10 md:mt-12">
            {[
              { n: '1,800+', l: 'Installations', c: 'from-amber-500 to-orange-500' },
              { n: '$32M+',  l: 'Savings',       c: 'from-emerald-500 to-emerald-600' },
              { n: '12,000t',l: 'CO₂ Saved',     c: 'from-blue-500 to-emerald-500' },
              { n: '98%',    l: 'Satisfaction',  c: 'from-amber-500 to-blue-500' },
            ].map((s, i) => (
              <div key={i}>
                <div className={`text-xl md:text-2xl font-extrabold font-display bg-gradient-to-br ${s.c} bg-clip-text text-transparent`}>{s.n}</div>
                <div className="text-[11px] md:text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Path selector (Option 6 two-card panel) — separate section under the brand hero ── */}
      <section id="path-selector" className="py-16 md:py-20 px-4 md:px-16 bg-gradient-to-br from-amber-50/60 via-white to-emerald-50/60 dark:from-brand-dark dark:via-brand-dark-1 dark:to-brand-dark relative overflow-hidden">
        <div className="max-w-5xl mx-auto relative">
          <div className="text-center mb-10">
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-bold mb-4">
              ★ 200+ NZ HOMES POWERED
            </div>
            <h2 className="text-2xl md:text-4xl font-extrabold font-display leading-tight mb-3 dark:text-gray-100">
              Solar in NZ, done <span className="text-gradient-warm">properly.</span>
            </h2>
            <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
              Pick the path that fits where you are right now.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 md:gap-5 max-w-4xl mx-auto">
            {/* Explorer path */}
            <Link
              to="/solar-packages"
              className="group bg-white dark:bg-brand-dark-1 rounded-3xl border-2 border-blue-200 dark:border-blue-500/40 hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-200/40 transition p-6 md:p-7 flex flex-col">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-500/20 dark:to-blue-500/10 flex items-center justify-center text-2xl mb-3">🔍</div>
              <div className="text-[10px] font-extrabold tracking-widest text-blue-700 dark:text-blue-300 mb-2">I'M JUST EXPLORING</div>
              <h3 className="text-xl md:text-2xl font-extrabold font-display mb-2 dark:text-gray-100">Browse solar systems</h3>
              <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-4 flex-1">
                See all our packages, compare panels and batteries, learn how solar pricing works in NZ. No forms, no pressure.
              </p>
              <ul className="space-y-1 text-[11px] text-gray-600 dark:text-gray-400 mb-4">
                <li className="flex items-center gap-2"><span className="text-blue-500">✓</span> 6 packages from 3kW to 13kW</li>
                <li className="flex items-center gap-2"><span className="text-blue-500">✓</span> Real install photos &amp; case studies</li>
                <li className="flex items-center gap-2"><span className="text-blue-500">✓</span> Transparent component breakdowns</li>
              </ul>
              <div className="inline-flex items-center gap-1.5 text-blue-700 dark:text-blue-300 font-bold text-sm group-hover:gap-2.5 transition-all">
                Browse the catalogue <ArrowRight size={14} />
              </div>
            </Link>

            {/* Buyer path */}
            <Link
              to="/get-quote?fresh=1"
              className="group bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 rounded-3xl border-2 border-amber-300 dark:border-amber-400/50 hover:border-amber-500 hover:shadow-2xl hover:shadow-amber-200/40 transition p-6 md:p-7 flex flex-col">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-2xl mb-3">💬</div>
              <div className="text-[10px] font-extrabold tracking-widest text-amber-700 dark:text-amber-300 mb-2">I'M READY FOR A QUOTE</div>
              <h3 className="text-xl md:text-2xl font-extrabold font-display mb-2 dark:text-gray-100">Get a tailored quote</h3>
              <p className="text-xs md:text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-4 flex-1">
                Tell us about your home — see your 25-year savings instantly and a sales rep will call within 24 hours.
              </p>
              <ul className="space-y-1 text-[11px] text-gray-700 dark:text-gray-400 mb-4">
                <li className="flex items-center gap-2"><span className="text-amber-600 font-bold">✓</span> Upload bills or use a quick estimate</li>
                <li className="flex items-center gap-2"><span className="text-amber-600 font-bold">✓</span> See your 25-year savings number</li>
                <li className="flex items-center gap-2"><span className="text-amber-600 font-bold">✓</span> Sales call within 24h, no obligation</li>
              </ul>
              <div className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-bold text-sm group-hover:gap-2.5 transition-all">
                Start my quote <ArrowRight size={14} />
              </div>
            </Link>
          </div>

          <p className="text-center text-xs text-gray-500 dark:text-gray-400 mt-6">
            Still on the fence? <a href="tel:+6421839356" className="text-amber-600 dark:text-amber-300 font-semibold hover:underline">Call +64 21 839 356</a> — we'll talk it through.
          </p>
        </div>
      </section>

      {/* Products */}
      <section id="products" className="py-16 md:py-24 px-4 md:px-16 bg-gradient-to-b from-white via-amber-50/40 to-white dark:from-brand-dark dark:via-brand-dark-1 dark:to-brand-dark transition-colors">
        <div className="text-center mb-12">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-solar">PRODUCTS</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display dark:text-gray-100">Solar Solutions for <span className="text-gradient-warm">New Zealand</span></h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-xl mx-auto">Three ways to think about your system — pick the bucket that fits your home and we'll show the matching packages.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {[
            {
              name:     'Home Rooftop',
              tagline:  'Solar without battery',
              size:     '3-7kW · From $8,990',
              desc:     'Grid-tied panels for daytime use, lower upfront cost. Hybrid-ready inverter so a battery can join later.',
              to:       '/solar-packages?bucket=solar-only',
              badge:    'from-blue-500 to-blue-600',
              priceColor: 'from-blue-500 to-blue-600',
              img:      'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&h=400&fit=crop&auto=format&q=80',
              alt:      'Rooftop solar panels on residential home',
            },
            {
              name:     'Solar + Battery',
              tagline:  'Solar plus overnight backup',
              size:     '7-13kW · From $26,990',
              desc:     'Solar with a 10 kWh battery stack. Power outages, evening usage, near-zero grid bill.',
              to:       '/solar-packages?bucket=with-battery',
              badge:    'from-emerald-500 to-emerald-600',
              priceColor: 'from-emerald-500 to-emerald-600',
              img:      'https://images.unsplash.com/photo-1559302504-64aae6ca6b6d?w=800&h=400&fit=crop&auto=format&q=80',
              alt:      'Home solar with Tesla Powerwall battery storage',
            },
            {
              name:     'Commercial',
              tagline:  'Custom-engineered',
              size:     '25-500kW · Custom Quote',
              desc:     'Warehouses, factories, office blocks. Always custom-designed for the roof, load profile, and tax position.',
              to:       '/solar-packages?bucket=commercial',
              badge:    'from-amber-500 to-orange-500',
              priceColor: 'from-amber-500 to-orange-500',
              img:      'https://images.unsplash.com/photo-1497440001374-f26997328c1b?w=800&h=400&fit=crop&auto=format&q=80',
              alt:      'Large commercial solar farm installation',
            },
          ].map((p, i) => (
            <Link key={i} to={p.to}
              className="bg-white dark:bg-brand-dark-1 rounded-2xl border border-gray-100 dark:border-white/5 overflow-hidden hover:-translate-y-2 hover:shadow-2xl hover:shadow-amber-100 dark:hover:shadow-amber-900/30 transition-all duration-300 group block">
              <div className="h-44 relative overflow-hidden">
                <img src={p.img} alt={p.alt} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                <div className={`absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold text-white shadow-lg bg-gradient-to-r ${p.badge}`}>{p.tagline}</div>
              </div>
              <div className="p-5">
                <h4 className="font-bold font-display mb-1 dark:text-gray-100">{p.name}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{p.desc}</p>
                <div className="flex justify-between items-center pt-3 border-t border-gray-100 dark:border-white/5">
                  <span className={`text-sm font-extrabold font-display bg-gradient-to-r ${p.priceColor} bg-clip-text text-transparent`}>{p.size}</span>
                  <span className="text-xs font-bold text-amber-600 group-hover:text-amber-500 flex items-center gap-1">
                    View <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link to="/solar-packages" className="text-sm font-bold text-amber-600 hover:text-amber-500 inline-flex items-center gap-1.5">
            See all packages <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-16 md:py-24 px-4 md:px-16 bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-brand-dark-1 dark:via-brand-dark dark:to-brand-dark-1 transition-colors">
        <div className="text-center mb-14">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-cool">HOW IT WORKS</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display dark:text-gray-100">Solar in <span className="text-gradient-warm">4 Simple Steps</span></h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-lg mx-auto">From first enquiry to switch-on, our team manages every step — design, council consents, installation, and grid connection.</p>
        </div>
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 relative">
          <div className="absolute top-12 left-[12.5%] right-[12.5%] h-1 bg-gradient-to-r from-blue-400 via-amber-400 via-orange-400 to-emerald-400 hidden md:block rounded-full opacity-60" />
          {[
            { step: '01', icon: Eye,    title: 'Free Consultation',    desc: 'We review your power bills, roof orientation, and energy goals, then prepare a tailored proposal within one business day.',     gradient: 'from-blue-500 to-blue-600',       ring: 'ring-blue-200 dark:ring-blue-800/40' },
            { step: '02', icon: Wrench, title: 'Custom Design',        desc: 'Our engineers size the panel array, inverter, and optional battery storage to match your usage profile and roof.',              gradient: 'from-amber-500 to-orange-500',    ring: 'ring-amber-200 dark:ring-amber-800/40' },
            { step: '03', icon: Truck,  title: 'Professional Install', desc: 'Certified installers complete mounting, wiring, council consent, and grid connection paperwork end to end.',                    gradient: 'from-orange-500 to-orange-600',   ring: 'ring-orange-200 dark:ring-orange-800/40' },
            { step: '04', icon: Power,  title: 'Power On & Save',      desc: 'Your system is commissioned and brought online. Track generation and savings through the monitoring app for decades to come.',  gradient: 'from-emerald-500 to-emerald-600', ring: 'ring-emerald-200 dark:ring-emerald-800/40' },
          ].map((s, i) => (
            <div key={i} className="relative text-center">
              <div className={`w-24 h-24 rounded-2xl mx-auto flex items-center justify-center mb-4 relative z-10 bg-gradient-to-br ${s.gradient} shadow-xl ring-4 ${s.ring} hover:scale-110 hover:rotate-3 transition-transform duration-300`}>
                <s.icon size={34} className="text-white drop-shadow" />
              </div>
              <div className={`text-[10px] font-extrabold tracking-widest mb-1 bg-gradient-to-r ${s.gradient} bg-clip-text text-transparent`}>STEP {s.step}</div>
              <h4 className="text-sm font-bold font-display mb-2 dark:text-gray-100">{s.title}</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-12">
          <Link to="/get-quote?fresh=1"><Button size="lg" icon={TrendingUp}>Get a tailored quote</Button></Link>
        </div>
      </section>

      {/* ═══════ CALLBACK BANNER — old form removed in Option 6.5, folded into /get-quote wizard ═══════ */}
      <section id="calculator" className="py-16 px-6 md:px-16 bg-mesh-calc relative overflow-hidden transition-colors">
        <a id="callback" className="block -mt-20 pt-20" />
        <div className="absolute top-20 -right-32 w-80 h-80 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 opacity-20 blur-3xl animate-blob" />
        <div className="absolute bottom-20 -left-32 w-80 h-80 rounded-full bg-gradient-to-br from-blue-400 to-emerald-400 opacity-20 blur-3xl animate-blob-delay-2" />
        <div className="relative max-w-3xl mx-auto bg-white dark:bg-brand-dark-1 rounded-3xl border-2 border-amber-300 dark:border-amber-500/40 p-8 md:p-10 text-center shadow-xl">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-warm">READY FOR A QUOTE?</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display mb-3 dark:text-gray-100">Get a tailored quote in <span className="text-gradient-warm">60 seconds.</span></h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xl mx-auto mb-6">
            Pick whether you have bills handy, just want an estimate, or prefer a phone call — our 4-step wizard adapts to you, and a sales rep follows up within 24 hours.
          </p>
          <Link to="/get-quote?fresh=1" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-extrabold text-sm hover:opacity-90 transition shadow-md shadow-amber-500/30">
            Start my quote <ArrowRight size={14} />
          </Link>
          <p className="text-[11px] text-gray-400 mt-3">
            Just exploring? <Link to="/solar-packages" className="underline hover:text-amber-600">Browse the package catalogue instead</Link>
          </p>
        </div>
      </section>
      {/* === REMOVED 6.5: the inline callback form (name/email/phone/OTP/address/owns_home/floors/roof/install_type/battery/monthly_bill/timeframe/lead_source + cadence preview + battery modal trigger). Its full functionality lives in /get-quote (Buyer path wizard). === */}

      {/* Testimonials */}
      <section id="testimonials" className="py-16 md:py-24 px-4 md:px-16 bg-gradient-to-br from-amber-50 via-white to-emerald-50 dark:from-brand-dark-1 dark:via-brand-dark dark:to-brand-dark-1 transition-colors">
        <div className="text-center mb-12">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-solar">TESTIMONIALS</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display dark:text-gray-100">What Our <span className="text-gradient-warm">Customers Say</span></h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {[
            { name: 'Tane & Maia',  text: '6kW system dropped our bill from $380 to $45/month!', loc: 'Auckland',     accent: 'from-amber-500 to-orange-500',   bg: 'from-amber-50/70 to-white dark:from-amber-500/5 dark:to-brand-dark-1' },
            { name: 'Sarah Chen',   text: '120kW powers our winery. $4,000+/month savings.',     loc: 'Marlborough',  accent: 'from-emerald-500 to-emerald-600', bg: 'from-emerald-50/70 to-white dark:from-emerald-500/5 dark:to-brand-dark-1' },
            { name: 'Dave O\'Brien', text: 'Off-grid was the best decision. No more power bills!', loc: 'Waikato',    accent: 'from-blue-500 to-blue-600',      bg: 'from-blue-50/70 to-white dark:from-blue-500/5 dark:to-brand-dark-1' },
          ].map((t, i) => (
            <div key={i} className={`bg-gradient-to-br ${t.bg} rounded-2xl p-6 border border-white dark:border-white/5 shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden`}>
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${t.accent}`} />
              <div className="flex gap-0.5 mb-3">{Array.from({ length: 5 }).map((_, j) => <Star key={j} size={13} fill="#F5A623" color="#F5A623" />)}</div>
              <p className="text-sm text-gray-700 dark:text-gray-200 italic leading-relaxed mb-4">"{t.text}"</p>
              <div className="pt-3 border-t border-gray-100 dark:border-white/5 flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${t.accent} flex items-center justify-center text-white text-[11px] font-extrabold shadow`}>
                  {t.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <div className="text-sm font-semibold dark:text-gray-100">{t.name}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">{t.loc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Case Studies */}
      <section id="case-studies" className="py-16 md:py-24 px-4 md:px-16 bg-gradient-to-b from-white via-blue-50/30 to-white dark:from-brand-dark dark:via-brand-dark-1 dark:to-brand-dark transition-colors">
        <div className="text-center mb-12">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-cool">CASE STUDIES</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display dark:text-gray-100">Real Projects, <span className="text-gradient-warm">Real Savings</span></h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-lg mx-auto">A look at the system specs, costs, and savings behind recent installations across New Zealand.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {[
            { type: 'Residential', title: 'Auckland Family Home', system: '8.2 kW', panels: 15, before: '$420/mo', after: '$52/mo', savings: '$88,000+', payback: '5.8 years', co2: '2.1t/yr', color: '#1E90FF', gradient: 'from-blue-50 to-blue-100' },
            { type: 'Commercial', title: 'Mega Foods Warehouse', system: '120 kW', panels: 218, before: '$6,200/mo', after: '$680/mo', savings: '$1.4M+', payback: '4.2 years', co2: '28t/yr', color: '#FF6A00', gradient: 'from-orange-50 to-amber-50' },
            { type: 'Community', title: 'Rauawaawa Kaumātua Trust', system: '35 kW', panels: 64, before: '$1,800/mo', after: '$190/mo', savings: '$385,000+', payback: '5.1 years', co2: '8.4t/yr', color: '#2ECC71', gradient: 'from-emerald-50 to-green-50' },
          ].map((cs, i) => (
            <div key={i} className="bg-white dark:bg-brand-dark-1 rounded-2xl border border-gray-100 dark:border-white/5 overflow-hidden hover:-translate-y-1 transition-transform">
              <div className="h-44 overflow-hidden relative">
                {CASE_STUDY_IMAGES[i]}
                <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-bold text-white shadow-md" style={{ background: cs.color }}>{cs.system}</div>
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold text-white shadow-md" style={{ background: cs.color + 'cc' }}>{cs.type}</div>
              </div>
              <div className="p-5">
                <h4 className="font-bold font-display text-base mb-3 dark:text-gray-100">{cs.title}</h4>
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400 dark:text-gray-500">Panels</span>
                    <span className="font-semibold dark:text-gray-200">{cs.panels} panels</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400 dark:text-gray-500">Before Solar</span>
                    <span className="font-semibold text-red-500">{cs.before}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400 dark:text-gray-500">After Solar</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{cs.after}</span>
                  </div>
                  <div className="flex justify-between text-xs border-t border-gray-100 dark:border-white/5 pt-2">
                    <span className="text-gray-400 dark:text-gray-500">Payback Period</span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">{cs.payback}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-lg p-2.5 text-center">
                    <div className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">{cs.savings}</div>
                    <div className="text-[9px] text-emerald-500">25-year savings</div>
                  </div>
                  <div className="bg-green-50 dark:bg-emerald-500/10 rounded-lg p-2.5 text-center">
                    <div className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">{cs.co2}</div>
                    <div className="text-[9px] text-emerald-500">CO₂ reduced</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* VPP-readiness preview */}
      <section id="vpp" className="py-16 md:py-24 px-4 md:px-16 bg-gradient-to-br from-emerald-50 via-white to-amber-50 relative overflow-hidden dark:from-brand-dark dark:via-brand-dark-1 dark:to-brand-dark transition-colors">
        <div className="absolute -top-20 right-1/3 w-96 h-96 rounded-full bg-gradient-to-br from-emerald-300 to-amber-300 opacity-20 blur-3xl animate-blob pointer-events-none" />
        <div className="absolute bottom-0 -left-20 w-80 h-80 rounded-full bg-gradient-to-br from-amber-300 to-orange-300 opacity-20 blur-3xl animate-blob-delay-2 pointer-events-none" />

        <div className="relative z-10 max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-emerald-100 to-amber-100 dark:from-emerald-500/10 dark:to-amber-500/10 border border-emerald-300/50 dark:border-emerald-500/30 mb-3">
              <Zap size={14} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-extrabold tracking-widest text-gradient-warm">FUTURE-READY · LAUNCHING 2027</span>
            </div>
            <h2 className="text-2xl md:text-4xl font-extrabold font-display dark:text-gray-100 mb-4">
              Your battery, <span className="text-gradient-warm">earning you money</span> — from 2027
            </h2>
            <p className="text-base text-gray-600 dark:text-gray-300 max-w-3xl mx-auto leading-relaxed">
              Goldenray is building New Zealand's next-generation Virtual Power Plant.
              When we launch in 2027, every Goldenray solar + battery customer with compatible
              hardware can opt in and earn an estimated{' '}
              <strong className="text-emerald-700 dark:text-emerald-400">$200–$400 per year</strong>{' '}
              in additional revenue — from the same battery that already powers their home.
            </p>
          </div>

          {/* What it is / What you earn / Your control */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
            <div className="bg-white dark:bg-brand-dark-1 rounded-2xl p-6 border border-emerald-100 dark:border-emerald-500/20 shadow-sm hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mb-4 shadow-md">
                <Battery size={20} className="text-white" />
              </div>
              <h3 className="text-base font-extrabold mb-2 dark:text-gray-100">What is a VPP?</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                A Virtual Power Plant is a network of home batteries acting as one big grid asset.
                When the grid needs power for peak hours or frequency events, thousands of small
                batteries discharge tiny amounts collectively — and grid operators pay for that
                service. You'd never notice it happening.
              </p>
            </div>

            <div className="bg-white dark:bg-brand-dark-1 rounded-2xl p-6 border border-amber-100 dark:border-amber-500/20 shadow-sm hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-4 shadow-md">
                <DollarSign size={20} className="text-white" />
              </div>
              <h3 className="text-base font-extrabold mb-2 dark:text-gray-100">What you earn</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-3">
                Estimated <strong className="text-amber-700 dark:text-amber-400">$200–$400 per year</strong> in
                revenue share — paid monthly. Your bill savings stay the same; this is on top.
              </p>
              <div className="text-xs text-gray-500 dark:text-gray-400 italic">
                Conservative estimate based on Australian VPP pilots. Adjusts as the NZ market matures.
              </div>
            </div>

            <div className="bg-white dark:bg-brand-dark-1 rounded-2xl p-6 border border-blue-100 dark:border-blue-500/20 shadow-sm hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center mb-4 shadow-md">
                <Shield size={20} className="text-white" />
              </div>
              <h3 className="text-base font-extrabold mb-2 dark:text-gray-100">You're in control</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                Set your minimum reserve so you always have backup. Pause for any reason
                (camping, visitors, big day ahead). Opt out at any time, no penalty.
                Your battery, your rules.
              </p>
            </div>
          </div>

          {/* Eligibility & lock-in CTA */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 dark:from-brand-dark-1 dark:to-brand-dark text-white rounded-2xl p-8 md:p-10 relative overflow-hidden border border-slate-700/50">
            <div className="absolute -top-10 right-10 w-40 h-40 rounded-full bg-emerald-500/30 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-10 left-10 w-32 h-32 rounded-full bg-amber-500/30 blur-3xl pointer-events-none" />
            <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <div className="text-xs font-extrabold tracking-widest text-emerald-300 mb-2">⚡ HOW TO BE READY</div>
                <h3 className="text-xl md:text-2xl font-extrabold mb-4">
                  Lock in VPP-ready hardware <span className="text-amber-300">today</span>
                </h3>
                <p className="text-sm text-gray-300 leading-relaxed mb-5">
                  Not every solar system can join a VPP. Compatible inverters and batteries are
                  required. Goldenray installs only VPP-ready hardware as standard — so you're
                  future-proof without paying extra.
                </p>
                <div className="space-y-2 text-sm">
                  {[
                    'Fronius, Sungrow, Tesla, SolarEdge inverters',
                    'Reserva, Powerwall, BYD, Tesla, Sungrow batteries',
                    'No additional hardware cost when VPP launches',
                    'Priority enrollment for existing Goldenray customers',
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <CheckCircle size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-200">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="bg-white/10 backdrop-blur rounded-xl p-6 border border-white/20">
                  <div className="text-[10px] font-extrabold tracking-widest text-emerald-300 mb-1">25-YEAR EARNINGS POTENTIAL</div>
                  <div className="text-4xl md:text-5xl font-extrabold mb-1 bg-gradient-to-r from-amber-300 to-emerald-300 bg-clip-text text-transparent">
                    $5k – $10k
                  </div>
                  <div className="text-xs text-gray-400 mb-4">
                    in additional revenue from your battery — on top of bill savings
                  </div>
                  <p className="text-xs text-gray-300 italic mb-5 border-l-2 border-emerald-400/50 pl-3">
                    "We're playing the long game. The NZ grid in 2030 will pay you to help balance it.
                    Hardware bought today should be ready for that."
                  </p>
                  <a
                    href="#calculator"
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold px-5 py-2.5 rounded-lg text-sm transition shadow-lg shadow-emerald-500/30">
                    Get a VPP-ready quote
                    <ArrowRight size={14} />
                  </a>
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-6 max-w-2xl mx-auto">
            VPP launch planned for 2027, subject to regulatory approval. Earnings figures are
            illustrative based on Australian VPP outcomes; actual NZ revenue will depend on grid
            demand, your battery size, and your usage profile. No commitment required at the time
            of solar install — opt in later when launched.
          </p>
        </div>
      </section>

      {/* Our Mission */}
      <section className="py-16 md:py-24 px-4 md:px-16 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0B0F1A 0%, #11172A 40%, #1C2340 100%)' }}>
        <div className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 opacity-25 blur-3xl animate-blob" />
        <div className="absolute -bottom-32 -right-20 w-[420px] h-[420px] rounded-full bg-gradient-to-br from-orange-500 to-amber-500 opacity-25 blur-3xl animate-blob-delay-2" />
        <div className="absolute top-1/3 right-1/4 w-80 h-80 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 opacity-20 blur-3xl animate-blob-delay-4" />
        <div className="absolute inset-0 opacity-10">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            {Array.from({ length: 12 }).map((_, i) => {
              const a = i * 30 * Math.PI / 180;
              return <line key={i} x1={100 + Math.cos(a) * 50} y1={100 + Math.sin(a) * 50} x2={100 + Math.cos(a) * 90} y2={100 + Math.sin(a) * 90} stroke="#F5A623" strokeWidth="3" />;
            })}
            <circle cx="100" cy="100" r="35" fill="#F5A623" />
          </svg>
        </div>
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-block text-xs font-extrabold tracking-widest mb-3 px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-emerald-400 bg-clip-text text-transparent border border-amber-400/30 backdrop-blur">OUR MISSION</div>
          <h2 className="text-2xl md:text-4xl font-extrabold font-display mb-6">
            Powering <span className="bg-gradient-to-r from-amber-300 via-orange-300 to-emerald-300 bg-clip-text text-transparent animate-gradient">New Zealand</span> with Trusted Solar
          </h2>
          <p className="text-base text-gray-200 leading-relaxed max-w-2xl mx-auto mb-10">
            We design, install, and support solar systems that lower power bills, reduce carbon emissions, and give homes and businesses across New Zealand long-term control over their energy. Clean, affordable energy should be accessible to everyone — that is the standard we build to.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl mx-auto">
            {[
              { icon: DollarSign, label: 'Real Savings',         desc: 'Average 85% reduction in electricity bills', gradient: 'from-amber-400 to-orange-500' },
              { icon: Leaf,       label: 'Lower Emissions',      desc: '12,000+ tonnes of CO₂ offset and counting',   gradient: 'from-emerald-400 to-emerald-600' },
              { icon: Shield,     label: 'Energy Independence',  desc: 'Protection from rising electricity costs',    gradient: 'from-blue-400 to-blue-600' },
            ].map((m, i) => (
              <div key={i} className="text-center group">
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${m.gradient} flex items-center justify-center mx-auto mb-3 shadow-xl group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
                  <m.icon size={22} className="text-white drop-shadow" />
                </div>
                <div className="text-sm font-bold mb-1">{m.label}</div>
                <div className="text-[11px] text-gray-300">{m.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Partners & Certifications */}
      <section className="py-12 md:py-16 px-4 md:px-16 bg-gradient-to-b from-white via-amber-50/40 to-white dark:from-brand-dark dark:via-brand-dark-1 dark:to-brand-dark transition-colors">
        <div className="text-center mb-10">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-solar">TRUSTED BY</div>
          <h2 className="text-2xl font-extrabold font-display dark:text-gray-100">Our Partners & <span className="text-gradient-warm">Certifications</span></h2>
        </div>
        <div className="max-w-4xl mx-auto grid grid-cols-3 md:grid-cols-6 gap-4">
          {[
            { name: 'SEANZ', desc: 'Sustainable Energy Association NZ', emoji: '🏛️', tint: 'hover:border-amber-300 hover:bg-amber-50/60 dark:hover:border-amber-500/50 dark:hover:bg-amber-500/5' },
            { name: 'EECA', desc: 'Energy Efficiency & Conservation Authority', emoji: '⚡', tint: 'hover:border-orange-300 hover:bg-orange-50/60 dark:hover:border-orange-500/50 dark:hover:bg-orange-500/5' },
            { name: 'CEC', desc: 'Clean Energy Council Approved', emoji: '✅', tint: 'hover:border-emerald-300 hover:bg-emerald-50/60 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-500/5' },
            { name: 'Master Electricians', desc: 'Licensed & Certified', emoji: '🔧', tint: 'hover:border-blue-300 hover:bg-blue-50/60 dark:hover:border-blue-500/50 dark:hover:bg-blue-500/5' },
            { name: 'SBN', desc: 'Sustainable Business Network', emoji: '🌿', tint: 'hover:border-emerald-300 hover:bg-emerald-50/60 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-500/5' },
            { name: 'ENZ', desc: 'Electricity Networks NZ', emoji: '🔌', tint: 'hover:border-blue-300 hover:bg-blue-50/60 dark:hover:border-blue-500/50 dark:hover:bg-blue-500/5' },
          ].map((p, i) => (
            <div key={i} className={`flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 dark:border-white/10 bg-white dark:bg-brand-dark-1 ${p.tint} transition-all hover:-translate-y-1 hover:shadow-lg`}>
              <div className="text-2xl mb-2">{p.emoji}</div>
              <div className="text-[10px] font-bold text-gray-700 dark:text-gray-200 text-center">{p.name}</div>
              <div className="text-[8px] text-gray-400 dark:text-gray-500 text-center mt-0.5">{p.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 md:py-24 px-4 md:px-16 bg-gradient-to-br from-amber-50 via-white to-emerald-50 dark:from-brand-dark-1 dark:via-brand-dark dark:to-brand-dark-1 transition-colors">
        <div className="text-center mb-12">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-warm">FAQ</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display dark:text-gray-100">Frequently Asked <span className="text-gradient-warm">Questions</span></h2>
        </div>
        <div className="max-w-3xl mx-auto space-y-3">
          {[
            { q: 'How much does a solar system cost in New Zealand?', a: 'Residential systems typically range from $8,500 for a basic 3kW setup to $25,000+ for larger systems with battery storage. Use our free calculator above for an instant personalised quote based on your actual electricity usage.' },
            { q: 'How long does installation take?', a: 'Most residential installations are completed in 1-2 days. Commercial projects may take 1-2 weeks depending on system size. We handle all council consents and grid connection paperwork — usually the whole process from quote to power-on takes 4-6 weeks.' },
            { q: 'What happens on cloudy days or at night?', a: 'On-grid systems draw power from the grid when solar production is low, so you never lose power. With a hybrid or off-grid system, battery storage covers nighttime and cloudy periods. NZ gets enough sunlight year-round for solar to be highly effective.' },
            { q: 'How much can I save on my electricity bill?', a: 'Most of our customers see an 80-90% reduction in their electricity bills. A typical Auckland household with a $300/month bill saves around $250/month with solar. Your exact savings depend on system size, usage patterns, and electricity rates.' },
            { q: 'What warranties do you offer?', a: 'Our solar panels come with a 25-year performance warranty, inverters have a 10-year warranty, and we provide a 10-year workmanship guarantee on all installations. We also include a free system health check in your first year.' },
            { q: 'Do I need council consent?', a: 'Most residential solar installations are permitted activities under NZ building regulations and don\'t require a building consent. We handle all the paperwork and compliance requirements for you, including electrical certificates and grid connection applications.' },
            { q: 'Can I sell excess power back to the grid?', a: 'Yes! With an on-grid or hybrid system, excess power you generate is exported to the grid and your retailer credits you at a buy-back rate (typically 8-12c/kWh). This further reduces your electricity costs.' },
            { q: 'How long until the system pays for itself?', a: 'The average payback period is 5-8 years depending on system size and your electricity usage. After that, your solar energy is essentially free for the remaining 17-20+ years of panel life. Use our calculator for your exact payback timeline.' },
          ].map((f, i) => (
            <div key={i} className="bg-white dark:bg-brand-dark-1 rounded-xl border border-gray-100 dark:border-white/5 overflow-hidden">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 pr-4">{f.q}</span>
                <ChevronDown size={16} className={`text-gray-400 dark:text-gray-500 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
              </button>
              {openFaq === i && (
                <div className="px-6 pb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{f.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-16 md:py-24 px-4 md:px-16 bg-gradient-to-br from-white via-blue-50/40 to-emerald-50/30 dark:from-brand-dark dark:via-brand-dark-1 dark:to-brand-dark transition-colors">
        <div className="text-center mb-12">
          <div className="text-xs font-extrabold tracking-widest mb-2 text-gradient-cool">CONTACT</div>
          <h2 className="text-2xl md:text-3xl font-extrabold font-display dark:text-gray-100">Talk to a <span className="text-gradient-warm">Solar Specialist</span></h2>
        </div>
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-brand-dark-1 rounded-2xl p-6 border border-gray-100 dark:border-white/5 space-y-3">
            {['Name', 'Phone', 'Email'].map(l => (
              <div key={l}>
                <label className="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase mb-1">{l}</label>
                <input className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-2 text-gray-900 dark:text-gray-100 rounded-lg text-sm outline-none focus:border-amber-400 dark:focus:border-amber-500" />
              </div>
            ))}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase mb-1">Message</label>
              <textarea className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-2 text-gray-900 dark:text-gray-100 rounded-lg text-sm outline-none focus:border-amber-400 dark:focus:border-amber-500 min-h-[70px] resize-y" />
            </div>
            <Button block size="lg" icon={Send}>Send Enquiry</Button>
          </div>
          <div className="space-y-3">
            {[
              { icon: MapPin, text: 'Level 3, 45 Queen St, Auckland',  gradient: 'from-blue-500 to-blue-600' },
              { icon: Phone,  text: '+64 21 839 356',                  gradient: 'from-emerald-500 to-emerald-600' },
              { icon: Mail,   text: 'hello@goldenrayenergy.co.nz',     gradient: 'from-amber-500 to-orange-500' },
              { icon: Clock,  text: 'Mon-Fri 8am-6pm, Sat 9am-1pm',    gradient: 'from-orange-500 to-amber-500' },
            ].map((c, i) => (
              <div key={i} className="flex gap-3 p-4 bg-white dark:bg-brand-dark-1 rounded-xl border border-gray-100 dark:border-white/5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${c.gradient} shadow-md`}>
                  <c.icon size={17} className="text-white" />
                </div>
                <div className="flex items-center text-sm text-gray-700 dark:text-gray-200 font-medium">{c.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Finance modal — extracted into shared component (also used by WebsiteNav drawer).
          The hero "$0 Upfront Finance" button below opens this modal too. */}
      <FinanceModal open={financeModalOpen} onClose={() => setFinanceModalOpen(false)} />

      {/* Floating widgets — SolarBot (right) + WhatsApp (left) */}
      <SolarChatbot />
      <WhatsAppAssistant />

      {/* Battery vs No-Battery comparison modal — invoked from the form */}
      <BatteryComparisonModal
        open={batteryModalOpen}
        onClose={() => setBatteryModalOpen(false)}
        onChoose={(choice) => setForm(f => ({ ...f, batteryOption: choice }))}
      />

      {/* Footer */}
      <WebsiteFooter homepage />
    </div>
  );
}
