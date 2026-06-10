import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pmQuotesAPI, REFERENCE } from '../services/pmQuotesApi';
import { fmtDate } from '../../utils/format';
import { SkeletonProjectList, LoadError } from '../components/LoadingSkeletons';
import { useAuth } from '../../context/AuthContext';

const STATUS_STYLES = {
  draft:                 'bg-slate-100 text-slate-700',
  pending_owner_review:  'bg-amber-100 text-amber-800',
  ready_to_generate:     'bg-blue-100 text-blue-800',
  generated:             'bg-violet-100 text-violet-800',
  sent_to_customer:      'bg-indigo-100 text-indigo-800',
  signed:                'bg-emerald-50 text-emerald-700',
  counter_signed:        'bg-emerald-100 text-emerald-800',
  deposit_received:      'bg-emerald-200 text-emerald-900',
  handed_off:            'bg-teal-100 text-teal-800',
  withdrawn:             'bg-slate-200 text-slate-500 line-through',
  expired:               'bg-rose-50 text-rose-700',
  closed_lost:           'bg-rose-100 text-rose-800',
  archived:              'bg-slate-300 text-slate-600 italic',
};

const STAGE_LABEL = {
  stage_1_estimate: 'Est',
  stage_2_firm:     'Firm',
};

export default function QuoteListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', stage: '', mine: '', search: '', include_archived: '' });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    pmQuotesAPI.list(params)
      .then(r => { if (!cancelled) { setQuotes(r.data); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.response?.data?.error || e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [filters]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quotes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Proposal generator · {quotes.length} {quotes.length === 1 ? 'quote' : 'quotes'}
          </p>
        </div>
        <Link
          to="/pm/quotes/new"
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md font-medium text-sm shadow-sm">
          + New quote
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search by quote ref or customer name/email…"
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          className="flex-1 min-w-[240px] px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                className="px-3 py-2 border border-slate-300 rounded text-sm">
          <option value="">All statuses</option>
          {REFERENCE.statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={filters.stage} onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))}
                className="px-3 py-2 border border-slate-300 rounded text-sm">
          <option value="">All stages</option>
          {REFERENCE.stages.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 px-3 py-2 text-sm text-slate-700">
          <input type="checkbox" checked={filters.mine === '1'}
                 onChange={e => setFilters(f => ({ ...f, mine: e.target.checked ? '1' : '' }))}
                 className="rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
          My quotes only
        </label>
        {isAdmin && (
          <label className="inline-flex items-center gap-2 px-3 py-2 text-sm text-slate-700">
            <input type="checkbox" checked={filters.include_archived === '1'}
                   onChange={e => setFilters(f => ({ ...f, include_archived: e.target.checked ? '1' : '' }))}
                   className="rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
            Show archived
          </label>
        )}
      </div>

      {loading && <SkeletonProjectList />}
      {error && <LoadError error={error} />}

      {!loading && !error && quotes.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <p className="text-slate-500">No quotes match your filters.</p>
          <Link to="/pm/quotes/new"
                className="inline-block mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md text-sm">
            Create the first quote
          </Link>
        </div>
      )}

      {!loading && !error && quotes.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Quote ref</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Status</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Stage</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Version</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Created</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Valid until</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(q => (
                <tr key={q.id} className="border-b border-slate-100 hover:bg-amber-50/30">
                  <td className="px-4 py-3">
                    <Link to={`/pm/quotes/${q.id}`}
                          className="font-mono font-semibold text-amber-700 hover:underline">
                      {q.quote_ref}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{q.contacts?.name || '—'}</div>
                    <div className="text-xs text-slate-500">{q.contacts?.email || ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[q.status] || 'bg-slate-100 text-slate-700'}`}>
                      {q.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{STAGE_LABEL[q.stage] || q.stage}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">v{q.current_version_number}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(q.created_at)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{q.valid_until ? fmtDate(q.valid_until) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
