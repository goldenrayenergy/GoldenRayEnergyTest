import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { publicApi } from '../services/api';
import {
  Sun, Battery, Zap, ArrowRight, Phone, Shield, CheckCircle, Loader2, ArrowLeft, AlertTriangle,
  TrendingUp, Clock, Leaf, Award, FileText,
} from 'lucide-react';
import WebsiteFooter from '../components/website/WebsiteFooter';
import SolarChatbot from '../components/website/SolarChatbot';
import WhatsAppAssistant from '../components/website/WhatsAppAssistant';

const fmt$ = n => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

export default function SolarPackageDetailPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const [pkg, setPkg]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    publicApi.get(`/packages/public/${slug}`)
      .then(r => setPkg(r.data))
      .catch(e => setError(e.response?.status === 404 ? 'Package not found' : (e.response?.data?.error || 'Failed to load')))
      .finally(() => setLoading(false));
  }, [slug]);

  // Compose the URL params used to prefill the website Get-Free-Quote form
  const quoteUrl = pkg ? `/?package=${pkg.slug}#calculator` : '/#calculator';

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-amber-500" size={32} /></div>;
  if (error)   return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-sm text-gray-500 mb-3">{error}</div>
        <Link to="/solar-packages" className="text-amber-600 underline text-xs">← Back to all packages</Link>
      </div>
    </div>
  );

  const hasBattery = (pkg.battery_kwh || 0) > 0;
  const isBackorder = pkg.availability === 'backorder';

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
          <Link to="/solar-packages" className="hidden md:flex items-center gap-1 text-xs font-semibold text-white/80 hover:text-amber-300">
            <ArrowLeft size={12} /> All packages
          </Link>
          <Link to={quoteUrl} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold flex items-center gap-1">
            <Phone size={12} /> Free Quote
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-24 md:pt-28 pb-10 px-6 md:px-10 bg-gradient-to-br from-amber-50 via-white to-emerald-50">
        <div className="max-w-6xl mx-auto">
          <Link to="/solar-packages" className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-semibold mb-4 hover:text-amber-700">
            <ArrowLeft size={11} /> Back to all packages
          </Link>

          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              {pkg.badge && (
                <div className="inline-block px-3 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-extrabold tracking-wide mb-3">
                  {pkg.badge}
                </div>
              )}
              <h1 className="text-3xl md:text-5xl font-extrabold font-display leading-tight mb-3">{pkg.name}</h1>
              {pkg.description && <p className="text-sm md:text-base text-gray-500 mb-5">{pkg.description}</p>}

              <div className="flex flex-wrap gap-2 mb-5">
                {pkg.system_kw && <SpecChip icon={Zap}     label={`${pkg.system_kw} kW`} />}
                {hasBattery   && <SpecChip icon={Battery} label={`${pkg.battery_kwh} kWh battery`} accent="emerald" />}
                {pkg.estimated_annual_savings && <SpecChip icon={TrendingUp} label={`~${fmt$(pkg.estimated_annual_savings)}/yr savings`} accent="emerald" />}
                {pkg.estimated_payback_years && <SpecChip icon={Clock} label={`${pkg.estimated_payback_years} yr payback`} />}
              </div>

              <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-lg">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">From</div>
                <div className="text-4xl font-extrabold text-amber-600">{fmt$(pkg.from_price)}</div>
                <div className="text-[10px] text-gray-400 mb-3">incl GST · fully installed</div>

                {isBackorder && (
                  <div className="px-3 py-2 mb-3 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                    <span>Some components are on backorder{pkg.available_from ? ` — available from ${pkg.available_from}` : ''}. We can lock in your spot.</span>
                  </div>
                )}

                <Link to={quoteUrl}
                  className="block w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm text-center hover:from-amber-400 hover:to-orange-400 transition flex items-center justify-center gap-2">
                  Get my free quote <ArrowRight size={14} />
                </Link>
                <div className="text-[9px] text-gray-400 text-center mt-2">No pressure · in-home consultation · email proposal in 1 day</div>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-amber-100 to-orange-100 aspect-[4/3] flex items-center justify-center">
              {pkg.hero_image_url ? (
                <img src={pkg.hero_image_url} alt={pkg.name} className="w-full h-full object-cover" />
              ) : (
                <Sun size={120} className="text-amber-400 opacity-40" />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="py-12 px-6 md:px-10">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-extrabold font-display mb-1">What's included</h2>
          <p className="text-xs text-gray-500 mb-6">Every component comes with manufacturer warranty + our 10-year workmanship guarantee.</p>

          {pkg.items?.length === 0 ? (
            <div className="text-xs text-gray-400 italic">Bill of materials coming soon — request a quote for the full breakdown.</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">Item</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wide">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pkg.items?.map(it => (
                    <tr key={it.id}>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-semibold">{it.product?.name || '—'}</div>
                        <div className="text-[10px] text-gray-400">
                          {[it.product?.brand, it.product?.category].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-bold">×{it.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Long description / suitability */}
      {pkg.long_description && (
        <section className="py-10 px-6 md:px-10 bg-gray-50">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-xl font-extrabold font-display mb-4">About this package</h2>
            <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{pkg.long_description}</div>
          </div>
        </section>
      )}

      {/* Lifetime impact */}
      <section className="py-12 px-6 md:px-10">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-extrabold font-display text-center mb-6">Lifetime impact</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ImpactStat icon={TrendingUp} label="Annual savings"  value={pkg.estimated_annual_savings ? fmt$(pkg.estimated_annual_savings) : '—'} accent="amber" />
            <ImpactStat icon={Clock}      label="Payback"          value={pkg.estimated_payback_years ? `${pkg.estimated_payback_years} yrs` : '—'} accent="blue" />
            <ImpactStat icon={Award}      label="Panel warranty"   value="25–30 yrs" accent="emerald" />
            <ImpactStat icon={Shield}     label="Workmanship"      value="10 yrs"    accent="indigo" />
          </div>
        </div>
      </section>

      {/* Trust band */}
      <section className="py-10 px-6 md:px-10 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-xl md:text-2xl font-extrabold font-display mb-2">Ready to make this your system?</h2>
          <p className="text-xs text-amber-50 mb-5">Free in-home consultation. We'll lock in pricing and fit a tailored proposal to your roof and bills within one business day.</p>
          <Link to={quoteUrl} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-amber-600 font-extrabold text-sm hover:bg-amber-50 transition">
            Get my free quote <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <SolarChatbot />
      <WhatsAppAssistant />
      <WebsiteFooter />
    </div>
  );
}

function SpecChip({ icon: Icon, label, accent }) {
  const cls = accent === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-bold ${cls}`}>
      <Icon size={11} /> {label}
    </span>
  );
}

function ImpactStat({ icon: Icon, label, value, accent }) {
  const colors = {
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600' },
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-600' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600' },
  }[accent || 'amber'];
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${colors.bg} ${colors.text} mb-2`}>
        <Icon size={16} />
      </div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-0.5">{label}</div>
      <div className={`text-base font-extrabold ${colors.text}`}>{value}</div>
    </div>
  );
}
