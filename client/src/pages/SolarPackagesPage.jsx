import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { publicApi } from '../services/api';
import {
  Sun, Battery, Zap, ArrowRight, Phone, Shield, Award, Clock, CheckCircle, Loader2,
  Sparkles, Package as PackageIcon, MapPin, ChevronDown, X, Building2, TrendingUp,
} from 'lucide-react';
import WebsiteFooter from '../components/website/WebsiteFooter';
import SolarChatbot from '../components/website/SolarChatbot';
import WhatsAppAssistant from '../components/website/WhatsAppAssistant';

const fmt$ = n => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

// Bucket → filter predicate. Used by the homepage Products section (3 cards
// link in here with ?bucket=...) and shown as a clearable chip on this page.
const BUCKETS = {
  'solar-only':    { label: 'Home Rooftop',     desc: 'Grid-tied solar without battery storage',                  test: p => !(p.battery_kwh > 0) && p.tier !== 'commercial' },
  'with-battery':  { label: 'Solar + Battery',  desc: 'Solar with battery storage for backup and self-consumption', test: p => (p.battery_kwh > 0) },
  'commercial':    { label: 'Commercial',       desc: 'Large-scale systems for offices, warehouses, factories',   test: p => p.tier === 'commercial' },
};

const BENEFITS = [
  { icon: Shield,     title: 'Tier-1 brands',       desc: 'Fronius, REC, Tesla Powerwall — only what passes our durability tests.' },
  { icon: Sun,        title: 'Tuned for NZ',         desc: 'Designed for NZ winters, salt air, and wind zones — not borrowed from Australia.' },
  { icon: Award,      title: 'Accredited installers', desc: 'Every system installed by an EWRB-licenced electrician.' },
  { icon: Sparkles,   title: 'Real performance',     desc: '25-year performance warranty + monitoring app for life.' },
];

const TRUST_BRANDS = ['Fronius', 'REC', 'Phono Solar', 'Tesla', 'BYD', 'Victron'];

const FAQS = [
  { q: 'Will solar work on cloudy NZ days?', a: 'Yes — modern panels generate from diffuse light too. Auckland typically sees 1,700–2,100 sunshine hours/year, more than parts of Germany where solar is huge. Our designs assume realistic NZ conditions.' },
  { q: 'How long does an install take?',       a: '1–2 days for residential, on-site. We schedule installs Monday–Friday and provide a fixed window.' },
  { q: 'What about my power bill in winter?',  a: 'Your system feeds the grid year-round. Even in winter, summer-banked credits and self-consumption keep most monthly bills well below pre-solar levels.' },
  { q: 'Can I add a battery later?',           a: 'Yes — every package uses a hybrid-ready inverter (or can be upgraded with one). Adding a Powerwall or Reserva later is a one-day install.' },
];

export default function SolarPackagesPage() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [openFaq, setOpenFaq] = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const bucketKey = searchParams.get('bucket');
  const bucket = bucketKey && BUCKETS[bucketKey] ? BUCKETS[bucketKey] : null;

  const filteredPackages = useMemo(() => {
    if (!bucket) return packages;
    return packages.filter(bucket.test);
  }, [packages, bucket]);

  const clearBucket = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('bucket');
    setSearchParams(next);
  };

  useEffect(() => {
    publicApi.get('/packages/public')
      .then(r => setPackages(r.data || []))
      .catch(e => setError(e.response?.data?.error || 'Failed to load packages'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white font-body">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-4 md:px-10 h-16 flex items-center justify-between backdrop-blur-md shadow-lg shadow-black/20"
        style={{ background: 'linear-gradient(90deg, rgba(11,15,26,0.96) 0%, rgba(17,23,42,0.96) 50%, rgba(11,15,26,0.96) 100%)' }}>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-500" />
        <Link to="/" className="flex items-center gap-3">
          <div className="bg-white rounded-xl p-1.5 shadow-lg ring-2 ring-amber-300/40">
            <img src="/logo.jpg" alt="Goldenray Energy NZ" className="h-9 md:h-11 w-auto object-contain" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-extrabold font-display tracking-tight text-white">GOLDENRAY <span className="text-amber-400">NZ</span></div>
            <div className="text-[9px] text-amber-200 italic">Sustainable Future</div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/" className="hidden md:block text-xs font-semibold text-white/80 hover:text-amber-300 transition">Home</Link>
          <Link to="/shop" className="hidden md:block text-xs font-semibold text-white/80 hover:text-amber-300 transition">Shop</Link>
          <Link to="/finance" className="hidden md:block text-xs font-semibold text-white/80 hover:text-amber-300 transition">Finance</Link>
          <Link to="/bill-analysis" className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold flex items-center gap-1">
            <TrendingUp size={12} /> See My Savings
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-24 md:pt-32 pb-12 px-6 md:px-10 bg-gradient-to-br from-amber-50 via-white to-emerald-50">
        <div className="max-w-6xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold mb-4">
            <PackageIcon size={11} /> Solar Packages for New Zealand Homes
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold font-display leading-tight mb-3">
            Pick the right solar package <br className="hidden md:inline" /> for your home.
          </h1>
          <p className="text-sm md:text-base text-gray-500 max-w-2xl mx-auto mb-6">
            Pre-designed systems for NZ residential customers — Tier-1 components, fixed pricing, no surprises.
            Not sure which? <Link to="/bill-analysis" className="text-amber-600 underline">Upload your bills for a 25-year savings projection</Link>.
          </p>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-10 px-6 md:px-10 border-y border-gray-100">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {BENEFITS.map((b, i) => (
            <div key={i} className="text-center p-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-amber-50 text-amber-600 mb-2">
                <b.icon size={18} />
              </div>
              <div className="text-xs font-bold mb-0.5">{b.title}</div>
              <div className="text-[10px] text-gray-500 leading-snug">{b.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Package grid */}
      <section className="py-12 px-6 md:px-10 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-6">
            <h2 className="text-2xl md:text-3xl font-extrabold font-display mb-2">
              {bucket ? bucket.label : 'Choose your system'}
            </h2>
            <p className="text-xs text-gray-500">
              {bucket ? bucket.desc : 'Prices are "from" — final cost depends on roof type, switchboard, and any extras.'}
            </p>
          </div>

          {/* Active filter chip */}
          {bucket && (
            <div className="flex justify-center mb-6">
              <button onClick={clearBucket}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold hover:bg-amber-200 transition">
                Filter: {bucket.label} <X size={11} /> Clear
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-amber-500" size={28} /></div>
          ) : error ? (
            <div className="text-center py-12 text-red-500 text-sm">{error}</div>
          ) : filteredPackages.length === 0 ? (
            bucketKey === 'commercial' ? (
              <CommercialEmptyState onClear={clearBucket} />
            ) : (
              <div className="text-center py-12 text-gray-400 text-sm">
                No packages match this filter.{' '}
                {bucket ? (
                  <button onClick={clearBucket} className="text-amber-600 underline">View all packages</button>
                ) : (
                  <Link to="/bill-analysis" className="text-amber-600 underline">Get a custom analysis from your bills</Link>
                )}
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPackages.map(p => <PackageCard key={p.id} pkg={p} />)}
            </div>
          )}
        </div>
      </section>

      {/* Brand strip */}
      <section className="py-8 px-6 md:px-10 border-y border-gray-100">
        <div className="max-w-6xl mx-auto text-center">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Trusted brands we install</div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-gray-400">
            {TRUST_BRANDS.map(b => (
              <span key={b} className="text-base md:text-lg font-display font-bold tracking-tight hover:text-amber-600 transition">{b}</span>
            ))}
          </div>
        </div>
      </section>

      {/* 3-step process */}
      <section className="py-12 px-6 md:px-10">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-extrabold font-display text-center mb-8">How it works</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { num: '1', title: 'Free consultation', desc: 'On-site visit, roof check, energy review. No charge.' },
              { num: '2', title: 'System design',     desc: 'We design and price a system that fits your roof and bills.' },
              { num: '3', title: 'Install + monitor', desc: '1–2 days on site. Switch on, watch it generate.' },
            ].map(s => (
              <div key={s.num} className="text-center p-4">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-500 text-white font-extrabold text-base mb-3">{s.num}</div>
                <div className="text-sm font-bold mb-1">{s.title}</div>
                <div className="text-[11px] text-gray-500">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 px-6 md:px-10 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-extrabold font-display text-center mb-6">Common questions</h2>
          <div className="space-y-2">
            {FAQS.map((f, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex justify-between items-center px-4 py-3 text-left hover:bg-gray-50 transition">
                  <span className="text-xs font-bold">{f.q}</span>
                  <ChevronDown size={14} className={`transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && <div className="px-4 pb-3 text-[11px] text-gray-500 leading-relaxed">{f.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 px-6 md:px-10 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-xl md:text-2xl font-extrabold font-display mb-2">See your real 25-year savings</h2>
          <p className="text-xs md:text-sm text-amber-50 mb-5">Upload 1–12 months of bills. See do-nothing cost vs solar over 25 years. The most honest quote in NZ.</p>
          <Link to="/bill-analysis" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-amber-600 font-bold text-sm hover:bg-amber-50 transition">
            See my 25-year savings <ArrowRight size={14} />
          </Link>
          <div className="mt-3 text-[11px] text-amber-100">
            No bills handy? <Link to="/#callback" className="underline hover:text-white">Quick callback form</Link>.
          </div>
        </div>
      </section>

      <SolarChatbot />
      <WhatsAppAssistant />
      <WebsiteFooter />
    </div>
  );
}

function PackageCard({ pkg }) {
  const hasBattery = (pkg.battery_kwh || 0) > 0;
  const isBackorder = pkg.availability === 'backorder';

  return (
    <Link to={`/solar-packages/${pkg.slug}`}
      className={`group relative bg-white rounded-2xl border-2 transition-all hover:shadow-xl flex flex-col
        ${pkg.badge ? 'border-amber-300' : 'border-gray-100 hover:border-amber-200'}`}>
      {pkg.badge && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-extrabold tracking-wide whitespace-nowrap shadow-md">
          {pkg.badge}
        </div>
      )}

      <div className="p-5 flex-1 flex flex-col">
        {/* Hero image area */}
        <div className="-m-5 mb-4 h-32 rounded-t-2xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center overflow-hidden">
          {pkg.hero_image_url ? (
            <img src={pkg.hero_image_url} alt={pkg.name} className="w-full h-full object-cover" />
          ) : (
            <Sun size={48} className="text-amber-400 opacity-50" />
          )}
        </div>

        <div className="flex-1">
          <h3 className="text-base font-extrabold font-display mb-1">{pkg.name}</h3>
          {pkg.description && <p className="text-[11px] text-gray-500 mb-3 line-clamp-2">{pkg.description}</p>}

          <div className="flex flex-wrap gap-1.5 mb-3">
            {pkg.system_kw && (
              <span className="text-[9px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 font-bold flex items-center gap-1">
                <Zap size={9} /> {pkg.system_kw} kW
              </span>
            )}
            {hasBattery && (
              <span className="text-[9px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold flex items-center gap-1">
                <Battery size={9} /> {pkg.battery_kwh} kWh
              </span>
            )}
            {hasBattery && (
              <span className="text-[9px] px-2 py-1 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-extrabold flex items-center gap-1 uppercase tracking-wide" title="Eligible for the Goldenray VPP launching 2027">
                <Zap size={9} /> VPP-ready
              </span>
            )}
            <span className="text-[9px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-bold">
              {pkg.items?.length || 0} components
            </span>
          </div>

          {pkg.estimated_annual_savings && (
            <div className="text-[10px] text-emerald-600 font-bold mb-3">
              ~ {fmt$(pkg.estimated_annual_savings)} / year savings
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 pt-3 flex justify-between items-end">
          <div>
            <div className="text-[9px] text-gray-400 uppercase tracking-wide">From</div>
            <div className="text-2xl font-extrabold text-amber-600">{fmt$(pkg.from_price)}</div>
            <div className="text-[9px] text-gray-400">incl GST · fully installed</div>
          </div>
          <div className="text-right">
            {isBackorder && (
              <div className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold mb-1">Backorder</div>
            )}
            <div className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 group-hover:text-amber-500">
              View <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// Empty state when ?bucket=commercial — we don't have packaged commercial
// systems (they're always custom-quoted) so we show a clear "talk to us" CTA.
function CommercialEmptyState({ onClear }) {
  return (
    <div className="bg-white rounded-2xl border border-amber-200 p-8 md:p-10 text-center max-w-2xl mx-auto">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 mb-4">
        <Building2 size={26} />
      </div>
      <h3 className="text-xl font-extrabold font-display mb-2">Commercial systems are always custom</h3>
      <p className="text-sm text-gray-500 mb-5 max-w-md mx-auto">
        Every commercial install has different roof structure, three-phase load profile, and tax/depreciation considerations.
        We design and price each one from scratch — no off-the-shelf packages.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/bill-analysis"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold">
          Start with bill analysis <ArrowRight size={14} />
        </Link>
        <button onClick={onClear}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
          View residential packages
        </button>
      </div>
    </div>
  );
}
