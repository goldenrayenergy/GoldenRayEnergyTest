import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import {
  Sun, CheckCircle2, Clock, Lock, Phone, Mail, MapPin, Zap, Battery, Calendar, Sparkles,
  HandHeart, FileText, AlertCircle,
} from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────────
// PublicProposalPage — customer-facing magic-link viewer at /p/<share_token>.
//
// No authentication; the token in the URL is the only credential. Backed by
// GET /api/public/p/:share_token which returns a deliberately-narrow payload
// (no cost basis, no margins, no internal notes).
//
// Renders three states based on where the project sits in its lifecycle:
//   - Early (sales / engineering / compliance) — "We're working on your design"
//   - Proposal sent (quote rows exist) — render Good/Better/Best summary
//   - Installed (commissioned_at set) — system summary + warranty cards
//
// This is the read-only first cut for B-1. Selection actions, view tracking,
// document downloads come in B-1.5.
// ────────────────────────────────────────────────────────────────────────────

const PHASE_LABEL = {
  sales:              'Getting to know your needs',
  engineering:        'Designing your system',
  design_finalised:   'Design ready · scheduling install',
  install_scheduled:  'Install scheduled',
  closing:            'Finishing touches',
  complete:           'System live — generating!',
};

const LANE_LABEL = {
  sales:       'Discovery',
  engineering: 'Design',
  compliance:  'Approvals',
  operations:  'Install',
  finance:     'Payment',
};

const LANE_ICON = {
  sales:       HandHeart,
  engineering: Sparkles,
  compliance:  Lock,
  operations:  Zap,
  finance:     FileText,
};

const STATUS_COLOR = {
  not_started: 'text-slate-300 border-slate-200 bg-white',
  in_progress: 'text-amber-700 border-amber-400 bg-amber-50',
  complete:    'text-emerald-700 border-emerald-400 bg-emerald-50',
};

const fmt$ = n => n == null ? '—' : `$${Number(n).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`;

export default function PublicProposalPage() {
  const { token } = useParams();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/public/p/${token}`)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.status === 404 ? 'not_found' : (e.response?.data?.error || e.message)))
      .finally(() => setLoading(false));
  }, [token]);

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-emerald-50 px-6 py-12 md:px-10 md:py-16">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="h-12 bg-white/60 rounded-lg animate-pulse" />
          <div className="h-48 bg-white/60 rounded-2xl animate-pulse" />
          <div className="h-32 bg-white/60 rounded-2xl animate-pulse" />
        </div>
      </main>
    );
  }

  // ── Not found / error ───────────────────────────────────────────────────
  if (error === 'not_found' || !data) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 to-amber-50 flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="mx-auto text-amber-500" size={48} />
          <h1 className="text-2xl font-bold text-slate-900">This link isn't valid</h1>
          <p className="text-sm text-slate-600">
            The link you followed has expired or was never issued. If you were expecting
            a project update from Goldenray Energy NZ, please contact your project manager —
            we'll send you a fresh link.
          </p>
          <div className="pt-4 border-t border-slate-200 mt-6">
            <a href="tel:+6421839356" className="inline-flex items-center gap-2 text-amber-700 font-semibold">
              <Phone size={16} /> +64 21 839 356
            </a>
          </div>
        </div>
      </main>
    );
  }
  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-2">
          <AlertCircle className="mx-auto text-red-500" size={36} />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </main>
    );
  }

  // ── Happy path ──────────────────────────────────────────────────────────
  const { project, phase, lane_summary, quote } = data;
  const phaseLabel = PHASE_LABEL[phase] || phase;
  const isComplete = !!project.commissioned_at;

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-emerald-50">
      {/* Branded top bar — slim, on-brand */}
      <div className="px-6 md:px-10 py-4 border-b border-amber-100 bg-white/70 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="bg-white rounded-xl p-1.5 shadow-sm ring-2 ring-amber-300/30">
            <img src="/logo.jpg" alt="Goldenray Energy NZ" className="h-9 w-auto object-contain" />
          </div>
          <div>
            <div className="text-[11px] font-extrabold text-slate-900 tracking-tight">GOLDENRAY ENERGY NZ</div>
            <div className="text-[10px] text-amber-700 italic">Powering a Sustainable Future</div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-8">

        {/* Hero — personal greeting + phase */}
        <section className="space-y-2">
          <div className="text-[11px] font-mono font-bold text-amber-600 tracking-wider">{project.code}</div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 leading-tight">
            Hi {project.first_name} 👋
          </h1>
          <p className="text-lg text-slate-700">
            Here's where your solar project sits right now.
          </p>
          <div className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-full bg-amber-100 border border-amber-300 text-amber-800 text-sm font-semibold">
            <Sun size={16} />
            <span>{phaseLabel}</span>
          </div>
        </section>

        {/* Timeline — 5 lanes as a horizontal progress chain */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4">Your project journey</h2>
          <ol className="flex items-stretch justify-between gap-2 overflow-x-auto">
            {lane_summary.map((l, i) => {
              const Icon = LANE_ICON[l.lane] || Clock;
              const css  = STATUS_COLOR[l.status] || STATUS_COLOR.not_started;
              return (
                <li key={l.lane} className="flex flex-col items-center text-center min-w-[110px] flex-1">
                  <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${css}`}>
                    {l.status === 'complete' ? <CheckCircle2 size={20} /> : <Icon size={18} />}
                  </div>
                  <div className="mt-2 text-xs font-semibold text-slate-800">{LANE_LABEL[l.lane]}</div>
                  <div className="text-[10px] text-slate-500 capitalize">{l.status.replace(/_/g, ' ')}</div>
                  {i < lane_summary.length - 1 && (
                    <div className="hidden md:block w-full h-px bg-slate-200 mt-2" />
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {/* System summary — only if engineering produced specs */}
        {(project.system_size_kw || project.panel_count || project.battery_kwh) && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4">Your system</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="System size" value={project.system_size_kw ? `${project.system_size_kw} kW` : '—'} icon={Sun} />
              <Stat label="Panels" value={project.panel_count ?? '—'} icon={Sparkles} />
              <Stat label="Battery" value={project.battery_kwh ? `${project.battery_kwh} kWh` : '—'} icon={Battery} />
              <Stat label="Type" value={project.system_type || '—'} icon={Zap} />
            </div>
            {project.city && (
              <div className="mt-4 text-xs text-slate-500 flex items-center gap-1">
                <MapPin size={12} /> Installation site: {project.city}{project.region ? `, ${project.region}` : ''}
              </div>
            )}
          </section>
        )}

        {/* Quote section — 3-quote summary if engine has run, else placeholder */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4">Your quotes</h2>

          {quote ? (
            <div className="space-y-3">
              {quote.recommendation_rationale && (
                <p className="text-sm text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <strong>Our recommendation:</strong> {quote.recommendation_rationale}
                </p>
              )}
              <div className="grid md:grid-cols-3 gap-3">
                <QuoteCard tier="Good"  letter="A" data={quote} recommended={quote.recommended_quote === 'A'} />
                <QuoteCard tier="Better" letter="B" data={quote} recommended={quote.recommended_quote === 'B'} />
                <QuoteCard tier="Best"  letter="C" data={quote} recommended={quote.recommended_quote === 'C'} />
              </div>
              <p className="text-[11px] text-slate-500 italic mt-2">
                Click each tier in conversation with your project manager to lock it in. A selection control will appear here in the next update.
              </p>
            </div>
          ) : (
            <div className="text-center py-6 px-4 bg-slate-50 rounded-lg border border-dashed border-slate-300">
              <Clock size={28} className="mx-auto text-slate-400 mb-2" />
              <div className="text-sm font-semibold text-slate-700">We're preparing your personalised quotes</div>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Your sales rep is working with our engineers to put together three options tailored to your site
                and budget. You'll see Good / Better / Best appear here when they're ready — usually within
                a few business days.
              </p>
            </div>
          )}
        </section>

        {/* Installed celebration */}
        {isComplete && (
          <section className="bg-gradient-to-br from-emerald-50 to-amber-50 border-2 border-emerald-300 rounded-2xl p-6 text-center">
            <Sparkles className="mx-auto text-emerald-600 mb-2" size={32} />
            <h2 className="text-xl font-bold text-emerald-900">Your system is live!</h2>
            <p className="text-sm text-emerald-800 mt-1">
              Commissioned {new Date(project.commissioned_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}.
              Generation tracking and your warranty documents will appear here soon.
            </p>
          </section>
        )}

        {/* Footer — contact your PM */}
        <section className="bg-slate-900 text-white rounded-2xl p-5 md:p-6 mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300 mb-3">Need to talk?</h2>
          <p className="text-sm text-slate-200 mb-4">
            Your project manager is your direct line for any question, big or small. Reply to the email
            that brought you here, or use the channels below.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <a href="tel:+6421839356" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-bold transition">
              <Phone size={14} /> +64 21 839 356
            </a>
            <a href="mailto:hello@goldenrayenergy.co.nz" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/20 hover:border-amber-400 hover:bg-white/5 transition">
              <Mail size={14} /> hello@goldenrayenergy.co.nz
            </a>
          </div>
          <p className="text-[10px] text-slate-500 mt-5">
            This page updates automatically as your project progresses. Bookmark it — it's yours, forever.
            Goldenray Energy NZ &middot; Powering a Sustainable Future
          </p>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="text-center">
      <Icon size={18} className="mx-auto text-amber-500 mb-1" />
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}

function QuoteCard({ tier, letter, data, recommended }) {
  const price   = data?.[`quote_${letter.toLowerCase()}_total_price_nzd`];
  const payback = data?.[`quote_${letter.toLowerCase()}_payback_years`];
  const savings = data?.[`quote_${letter.toLowerCase()}_25yr_savings_nzd`];
  const subTier = data?.[`quote_${letter.toLowerCase()}_tier`];
  return (
    <div className={`relative rounded-xl border-2 p-4 ${recommended ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      {recommended && (
        <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wider">
          Recommended
        </span>
      )}
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tier}</div>
      {subTier && <div className="text-[10px] text-slate-400 mb-1.5">{subTier}</div>}
      <div className="text-2xl font-extrabold text-slate-900 mt-1">{fmt$(price)}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">Total system cost</div>
      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500">Payback</span>
          <span className="font-semibold text-slate-800">{payback != null ? `${payback} yrs` : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">25-year savings</span>
          <span className="font-semibold text-emerald-700">{fmt$(savings)}</span>
        </div>
      </div>
    </div>
  );
}
