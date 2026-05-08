import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { pmProjectsAPI } from '../services/pmApi';
import api from '../../services/api';

const TYPE_OPTIONS = [
  { value: 'residential_rooftop', label: 'Residential rooftop' },
  { value: 'commercial',          label: 'Commercial' },
  { value: 'ground_mount',        label: 'Ground mount' },
  { value: 'battery_addon',       label: 'Battery add-on (existing solar customer)' },
  { value: 'system_upgrade',      label: 'System upgrade' },
];

export default function ProjectNewPage() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    contact_id: '',
    project_type: 'residential_rooftop',
    address: '',
    suburb: '',
    city: '',
    postcode: '',
    region: '',
    system_size_kw: '',
    battery_kwh: '',
    panel_count: '',
    estimated_value_nzd: '',
    notes: '',
  });

  // Pull existing contacts for picker. Reusing the existing contacts API
  // (read-only — never modifies it).
  useEffect(() => {
    api.get('/leads')
      .then(r => setContacts(Array.isArray(r.data) ? r.data : (r.data?.data || [])))
      .catch(() => setContacts([]));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        ...form,
        system_size_kw:      form.system_size_kw ? Number(form.system_size_kw) : null,
        battery_kwh:         form.battery_kwh ? Number(form.battery_kwh) : null,
        panel_count:         form.panel_count ? Number(form.panel_count) : null,
        estimated_value_nzd: form.estimated_value_nzd ? Number(form.estimated_value_nzd) : null,
        contact_id:          form.contact_id || null,
      };
      const r = await pmProjectsAPI.create(payload);
      navigate(`/pm/projects/${r.data.id}`);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link to="/pm" className="text-sm text-slate-500 hover:text-slate-800">← back to projects</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">New project</h1>
        <p className="text-sm text-slate-500 mt-1">
          Creates a fresh project with all five lanes in <em>not started</em>. You can edit any field later.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Customer</label>
          <select
            value={form.contact_id}
            onChange={e => set('contact_id', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
            <option value="">— Select a contact (optional) —</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} {c.email ? `· ${c.email}` : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-1">Pulled from your existing contacts. Read-only — this tool never modifies them.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Project type *</label>
          <select
            value={form.project_type}
            onChange={e => set('project_type', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
            {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <p className="text-xs text-slate-500 mt-1">Drives which checklist items appear in each lane.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Site address</label>
            <input
              type="text"
              value={form.address}
              onChange={e => set('address', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Suburb</label>
            <input type="text" value={form.suburb} onChange={e => set('suburb', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
            <input type="text" value={form.city} onChange={e => set('city', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Postcode</label>
            <input type="text" value={form.postcode} onChange={e => set('postcode', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Region</label>
            <input type="text" value={form.region} onChange={e => set('region', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" placeholder="auckland" />
          </div>
        </div>

        <div className="border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">System (estimates — finalised in Engineering lane)</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">System (kW)</label>
              <input type="number" step="0.1" value={form.system_size_kw} onChange={e => set('system_size_kw', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Battery (kWh)</label>
              <input type="number" step="0.1" value={form.battery_kwh} onChange={e => set('battery_kwh', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Panel count</label>
              <input type="number" value={form.panel_count} onChange={e => set('panel_count', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Est. value ($NZ)</label>
              <input type="number" value={form.estimated_value_nzd} onChange={e => set('estimated_value_nzd', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea
            rows={3}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            placeholder="Anything the team should know about this project..."
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-md font-medium text-sm">
            {submitting ? 'Creating…' : 'Create project'}
          </button>
          <Link to="/pm" className="px-5 py-2 border border-slate-300 hover:bg-slate-50 rounded-md text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
