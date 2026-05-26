import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pmProjectsAPI } from '../services/pmApi';
import { fmtDate } from '../../utils/format';
import { SkeletonProjectList, LoadError } from '../components/LoadingSkeletons';

const TYPE_LABELS = {
  residential_rooftop: 'Residential rooftop',
  commercial: 'Commercial',
  ground_mount: 'Ground mount',
  battery_addon: 'Battery add-on',
  system_upgrade: 'System upgrade',
};

const HEALTH_STYLES = {
  green:   'bg-green-100 text-green-800 border-green-200',
  amber:   'bg-amber-100 text-amber-800 border-amber-200',
  red:     'bg-red-100 text-red-800 border-red-200',
  blocked: 'bg-slate-300 text-slate-900 border-slate-400',
};

const STATUS_STYLES = {
  active:    'text-emerald-700',
  on_hold:   'text-amber-700',
  cancelled: 'text-slate-500',
  completed: 'text-blue-700',
};

export default function ProjectListPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', health: '', type: '', search: '' });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    pmProjectsAPI.list(params)
      .then(r => { if (!cancelled) { setProjects(r.data); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.response?.data?.error || e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [filters]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500 mt-1">
            Five-lane project tracking · {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </p>
        </div>
        <Link
          to="/pm/projects/new"
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md font-medium text-sm shadow-sm">
          + New project
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search by code, address, customer..."
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          className="flex-1 min-w-[240px] px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="px-3 py-2 border border-slate-300 rounded text-sm">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On hold</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={filters.health}
          onChange={e => setFilters(f => ({ ...f, health: e.target.value }))}
          className="px-3 py-2 border border-slate-300 rounded text-sm">
          <option value="">All health</option>
          <option value="green">Green</option>
          <option value="amber">Amber</option>
          <option value="red">Red</option>
          <option value="blocked">Blocked</option>
        </select>
        <select
          value={filters.type}
          onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}
          className="px-3 py-2 border border-slate-300 rounded text-sm">
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {error && !loading ? (
        <LoadError
          error={error}
          onRetry={() => setFilters(f => ({ ...f }))}
          title="Couldn't load projects"
        />
      ) : loading ? (
        <SkeletonProjectList rows={8} />
      ) : projects.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <p className="text-slate-500 mb-4">No projects yet.</p>
          <Link
            to="/pm/projects/new"
            className="inline-block px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md font-medium text-sm">
            Create your first project
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium text-slate-600">Code</th>
                <th className="px-4 py-2 font-medium text-slate-600">Customer</th>
                <th className="px-4 py-2 font-medium text-slate-600">Type</th>
                <th className="px-4 py-2 font-medium text-slate-600">System</th>
                <th className="px-4 py-2 font-medium text-slate-600">Health</th>
                <th className="px-4 py-2 font-medium text-slate-600">Status</th>
                <th className="px-4 py-2 font-medium text-slate-600">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/pm/projects/${p.id}`} className="font-mono text-amber-700 hover:underline">
                      {p.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {p.contacts?.name || <span className="text-slate-400">—</span>}
                    {p.address && <div className="text-xs text-slate-500">{p.address}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{TYPE_LABELS[p.project_type] || p.project_type}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.system_size_kw ? `${p.system_size_kw} kW` : '—'}
                    {p.battery_kwh ? ` · ${p.battery_kwh} kWh` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium uppercase ${HEALTH_STYLES[p.health] || ''}`}>
                      {p.health}
                    </span>
                  </td>
                  <td className={`px-4 py-3 capitalize ${STATUS_STYLES[p.status] || ''}`}>{p.status?.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
