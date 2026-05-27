import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pmQrCodesAPI } from '../services/pmApi';
import { fmtDate } from '../../utils/format';
import { SkeletonProjectList, LoadError } from '../components/LoadingSkeletons';

// ────────────────────────────────────────────────────────────────────────────
// QR-code campaign management (Phase D)
//
//   /pm/admin/qr-codes
//
// Lists every QR code + scan/conversion stats. Lets an admin create new ones
// and download each as PNG (cards / flyers) or SVG (trade-show banner).
//
// baseUrl input controls what URL the QR will encode. Default is empty
// (server fills in from QR_BASE_URL env / request host). When you move from
// the Vercel URL to a custom domain, paste it here before downloading and
// the regenerated PNGs/SVGs will encode the new domain — no schema changes.
// ────────────────────────────────────────────────────────────────────────────

export default function QrCodesPage() {
  const [codes, setCodes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = () => {
    setLoading(true); setError('');
    pmQrCodesAPI.list()
      .then(r => { setCodes(r.data.data || []); setLoading(false); })
      .catch(e => { setError(e.response?.data?.error || e.message); setLoading(false); });
  };
  useEffect(load, []);

  const handleDownload = async (slug, format) => {
    try {
      await pmQrCodesAPI.download(slug, format, baseUrl || null);
    } catch (e) {
      alert(`Download failed: ${e.response?.data?.error || e.message}`);
    }
  };

  const handleToggleActive = async (id, current) => {
    try {
      await pmQrCodesAPI.update(id, { is_active: !current });
      load();
    } catch (e) {
      alert(`Update failed: ${e.response?.data?.error || e.message}`);
    }
  };

  if (loading) return <SkeletonProjectList rows={3} />;
  if (error)   return <LoadError error={error} onRetry={load} title="Couldn't load QR codes" />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">QR Code Campaigns</h1>
          <p className="text-sm text-slate-500 mt-1">
            Each QR code maps a slug ({'/qr/<slug>'}) to a destination + UTM tags. Print the slug-encoded URL once; change behaviour here without reprinting.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md font-medium text-sm shadow-sm">
          + New QR campaign
        </button>
      </div>

      {/* Base URL input */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <label className="block text-xs font-bold text-amber-900 uppercase tracking-wide mb-1">
          QR destination base URL (used when you download a PNG / SVG)
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://goldenrayenergy-test.vercel.app   (leave blank to use the server default)"
          className="w-full px-3 py-2 border border-amber-300 rounded text-sm font-mono"
        />
        <p className="text-xs text-amber-700 mt-1.5">
          Each QR will encode <code>{`{baseUrl}/qr/{slug}`}</code>. Use the Vercel URL for testing; switch to your custom domain (e.g. <code>https://goldenrayenergy.co.nz</code>) before printing anything for customers.
        </p>
      </div>

      {/* QR list */}
      {codes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <p className="text-slate-500 mb-4">No QR campaigns yet.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-block px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md font-medium text-sm">
            Create your first QR
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {codes.map(c => (
            <QrCard key={c.id} qr={c} baseUrl={baseUrl} onDownload={handleDownload} onToggleActive={handleToggleActive} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateQrModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      <p className="text-xs text-slate-500">
        <Link to="/pm/admin" className="text-amber-700 hover:underline">← Back to Admin</Link>
      </p>
    </div>
  );
}

// ── A single QR card row ──────────────────────────────────────────────────
function QrCard({ qr, baseUrl, onDownload, onToggleActive }) {
  const dest = `${qr.destination_path}?utm_source=${qr.utm_source}&utm_medium=${qr.utm_medium}&utm_campaign=${qr.utm_campaign}`;
  const fullEncodedUrl = `${baseUrl || '<server-default-base>'}/qr/${qr.slug}`;
  return (
    <div className={`bg-white border rounded-lg p-4 ${qr.is_active ? 'border-slate-200' : 'border-slate-300 bg-slate-50 opacity-70'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-bold text-slate-900">{qr.campaign_name}</h3>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${qr.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
              {qr.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-2">Created {fmtDate(qr.created_at)}</p>
          <div className="text-xs font-mono text-slate-700 bg-slate-50 rounded px-2 py-1.5 mb-2 break-all">
            {fullEncodedUrl}<span className="text-slate-400"> → </span>{dest}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>Scans: <strong className="text-slate-900">{qr.stats.scans}</strong></span>
            <span>Leads: <strong className="text-slate-900">{qr.stats.leads}</strong></span>
            <span>Conversion: <strong className="text-amber-700">{qr.conversion_pct}%</strong></span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={() => onDownload(qr.slug, 'png')}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-medium border border-slate-300"
            title="High-resolution PNG (2048×2048) — for business cards and flyers">
            ⬇ PNG
          </button>
          <button
            onClick={() => onDownload(qr.slug, 'svg')}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-medium border border-slate-300"
            title="Vector SVG — for the 3ft×6ft trade-show banner">
            ⬇ SVG
          </button>
          <button
            onClick={() => onToggleActive(qr.id, qr.is_active)}
            className={`px-3 py-1.5 rounded text-xs font-medium border ${qr.is_active ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'}`}>
            {qr.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create-QR modal ────────────────────────────────────────────────────────
function CreateQrModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    slug: '',
    campaign_name: '',
    destination_path: '/get-quote',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Auto-suggest UTM values from the slug
  useEffect(() => {
    if (form.slug && !form.utm_source) {
      const cleanSlug = form.slug.toLowerCase();
      const source = cleanSlug.split('-')[0];
      setForm(f => ({
        ...f,
        utm_source:   f.utm_source   || source,
        utm_campaign: f.utm_campaign || `${cleanSlug}-${new Date().getFullYear()}`,
      }));
    }
  }, [form.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setSaving(true); setError('');
    try {
      await pmQrCodesAPI.create(form);
      onCreated();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 space-y-3">
        <h2 className="text-lg font-bold text-slate-900">New QR campaign</h2>
        <p className="text-xs text-slate-500">
          The slug becomes part of the URL ({'/qr/<slug>'}) and is permanent once anything is printed.
        </p>

        <Field label="Slug" hint="URL-safe (lowercase, numbers, hyphens). e.g. card, show-akl, flyer-mtr">
          <input
            type="text"
            value={form.slug}
            onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
            placeholder="card"
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
          />
        </Field>

        <Field label="Campaign name" hint="Human-readable label shown in the admin list">
          <input
            type="text"
            value={form.campaign_name}
            onChange={e => setForm({ ...form, campaign_name: e.target.value })}
            placeholder="Business cards Q2 2026"
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
        </Field>

        <Field label="Destination path" hint="Where to redirect to (default /get-quote)">
          <input
            type="text"
            value={form.destination_path}
            onChange={e => setForm({ ...form, destination_path: e.target.value })}
            placeholder="/get-quote"
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
          />
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label="UTM source">
            <input
              type="text"
              value={form.utm_source}
              onChange={e => setForm({ ...form, utm_source: e.target.value })}
              placeholder="card"
              className="w-full px-2 py-2 border border-slate-300 rounded text-xs font-mono"
            />
          </Field>
          <Field label="UTM medium">
            <input
              type="text"
              value={form.utm_medium}
              onChange={e => setForm({ ...form, utm_medium: e.target.value })}
              placeholder="print"
              className="w-full px-2 py-2 border border-slate-300 rounded text-xs font-mono"
            />
          </Field>
          <Field label="UTM campaign">
            <input
              type="text"
              value={form.utm_campaign}
              onChange={e => setForm({ ...form, utm_campaign: e.target.value })}
              placeholder="cards-2026"
              className="w-full px-2 py-2 border border-slate-300 rounded text-xs font-mono"
            />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <textarea
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            rows={2}
            placeholder="500 cards ordered for May networking events"
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
        </Field>

        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded text-sm">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !form.slug || !form.campaign_name || !form.utm_source || !form.utm_medium || !form.utm_campaign}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white rounded text-sm font-medium">
            {saving ? 'Creating…' : 'Create QR'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
