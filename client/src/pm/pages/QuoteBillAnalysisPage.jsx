import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../services/api';
import { pmQuotesAPI } from '../services/pmQuotesApi';
import { fmtDate } from '../../utils/format';

const fmt$ = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-NZ');
const fmtKwh = n => Math.round(Number(n) || 0).toLocaleString('en-NZ') + ' kWh';

// ────────────────────────────────────────────────────────────────────────────
// Read-only PM Tool view of a bill_analysis row.
// Sourced from the existing GET /api/billAnalysis/:id endpoint — no marketing
// chrome (no WebsiteNav / customer hero / sales CTA). Data-first layout for
// sales reps to verify what the engine is reading.
//
// Reached from BillsSection on the QuoteForm — gives the rep a way to see
// what numbers their quote is pulling from before they commit them.
// ────────────────────────────────────────────────────────────────────────────
export default function QuoteBillAnalysisPage() {
  const { id } = useParams();    // quote id
  const [quote, setQuote] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const q = await pmQuotesAPI.get(id);
        if (cancelled) return;
        setQuote(q.data.quote);

        // The bill_analysis_id is on the quote (set at create time when one was linked)
        const analysisId = q.data.quote.bill_analysis_id;
        if (!analysisId) {
          setError('No bill analysis linked to this quote — bills were typed manually.');
          setLoading(false); return;
        }
        // Server mounts at /api/bill-analysis (kebab-case); the camelCase
        // path 404s. One-shot fix — only call site in the client.
        const a = await api.get(`/bill-analysis/${analysisId}`);
        if (cancelled) return;
        setAnalysis(a.data?.analysis || a.data);
        setBills(a.data?.bills || []);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e.response?.data?.error || e.message);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="text-sm text-slate-500">Loading bill analysis…</div>;
  if (error) {
    return (
      <div>
        <div className="mb-4">
          <Link to={`/pm/quotes/${id}/edit`} className="text-sm text-slate-500 hover:text-slate-800">
            ← back to quote
          </Link>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-800">
          {error}
        </div>
      </div>
    );
  }
  if (!analysis) return null;

  return (
    <div>
      <div className="mb-6">
        <Link to={`/pm/quotes/${id}/edit`} className="text-sm text-slate-500 hover:text-slate-800">
          ← back to quote {quote?.quote_ref}
        </Link>
        <div className="mt-2 flex items-baseline justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Bill analysis</h1>
          <div className="text-sm text-slate-500">
            {analysis.period_start && analysis.period_end &&
              `${fmtDate(analysis.period_start)} → ${fmtDate(analysis.period_end)}`}
            {analysis.months_covered && ` · ${analysis.months_covered} months`}
          </div>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Source data for this quote's Bills tab. Read-only — to change values, edit the Bills tab directly.
        </p>
      </div>

      {/* Snapshot tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SnapshotTile label="Annual usage" value={fmtKwh(analysis.annual_kwh)} />
        <SnapshotTile label="Annual spend" value={fmt$(analysis.annual_spend_nzd)} />
        <SnapshotTile
          label="Effective rate"
          value={analysis.effective_rate_nzd
            ? `${(analysis.effective_rate_nzd * 100).toFixed(1)}c/kWh`
            : '—'}
        />
        <SnapshotTile
          label="Current retailer"
          value={analysis.retailer || '—'}
          sub={analysis.plan_name}
        />
      </div>

      {/* Per-bill table */}
      {bills.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-700">Bills parsed ({bills.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-xs text-slate-600">
                <th className="text-left px-4 py-2 font-medium">Period</th>
                <th className="text-left px-4 py-2 font-medium">Retailer</th>
                <th className="text-right px-4 py-2 font-medium">Days</th>
                <th className="text-right px-4 py-2 font-medium">kWh</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-right px-4 py-2 font-medium">OCR conf.</th>
              </tr>
            </thead>
            <tbody>
              {bills.map(b => (
                <tr key={b.id || `${b.period_start}-${b.period_end}`} className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-700">
                    {b.period_start && b.period_end
                      ? `${fmtDate(b.period_start)} → ${fmtDate(b.period_end)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{b.retailer || '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{b.days_in_period || '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{fmtKwh(b.kwh_total)}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{fmt$(b.total_nzd)}</td>
                  <td className="px-4 py-2 text-right text-slate-500">
                    {b.ocr_confidence != null
                      ? `${Math.round(b.ocr_confidence * 100)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Location + recommendation summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Location used</h2>
          <dl className="space-y-1.5 text-sm">
            <Row k="Region" v={analysis.region || '—'} />
            <Row k="Postcode" v={analysis.postcode || '—'} />
          </dl>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Analyser's recommendation</h2>
          <dl className="space-y-1.5 text-sm">
            <Row k="Recommended system" v={
              analysis.recommended_system_kw ? `${analysis.recommended_system_kw} kW` : '—'
            } />
            <Row k="Recommended battery" v={
              analysis.recommended_battery_kwh ? `${analysis.recommended_battery_kwh} kWh` : '—'
            } />
            <Row k="Recommended orientation" v={analysis.recommended_orientation || '—'} />
          </dl>
          <p className="text-xs text-slate-500 mt-3">
            These drove the auto-sizing on this quote's System tab.
          </p>
        </div>
      </div>

      {/* Patterns / insights (concise, sales-rep flavour) */}
      {Array.isArray(analysis.patterns) && analysis.patterns.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Detected patterns</h2>
          <ul className="space-y-2 text-sm">
            {analysis.patterns.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className={
                  'text-xs uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ' +
                  (p.severity === 'high'   ? 'bg-rose-100 text-rose-700'
                  : p.severity === 'medium' ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-700')
                }>{p.severity || 'info'}</span>
                <span><b className="text-slate-800">{p.label}</b>
                  {p.recommendation && <span className="text-slate-600"> — {p.recommendation}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer meta */}
      <div className="text-xs text-slate-500">
        Analysis ID: <code className="font-mono">{analysis.id}</code> ·
        {' '}Status: {analysis.status} ·
        {' '}Created: {fmtDate(analysis.created_at)}
      </div>
    </div>
  );
}

function SnapshotTile({ label, value, sub }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-900 font-medium">{v}</dd>
    </div>
  );
}
