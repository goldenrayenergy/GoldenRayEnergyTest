import { useState, useEffect } from 'react';
import api from '../../services/api';
import ProductPicker from '../../components/portal/ProductPicker';
import { fmt$ } from '../../utils/format';
import { Boxes, Plus, Pencil, Archive, RotateCcw, X, Loader2, Trash2, Package, AlertTriangle } from 'lucide-react';

const TIER_OPTIONS = [
  { value: '',                label: '— No tier —' },
  { value: 'starter',         label: 'Starter' },
  { value: 'standard',        label: 'Standard' },
  { value: 'premium',         label: 'Premium' },
  { value: 'premium-battery', label: 'Premium + Battery' },
  { value: 'whole-home',      label: 'Whole-home' },
  { value: 'off-grid',        label: 'Off-grid' },
  { value: 'commercial',      label: 'Commercial' },
];

const slugify = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export default function PackagesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('true');
  const [editing, setEditing] = useState(null);   // package object for edit drawer
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = activeFilter === '' ? {} : { is_active: activeFilter };
      const { data } = await api.get('/packages', { params });
      setRows(data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeFilter]);

  const archive = async (p) => {
    if (!confirm(`Archive package "${p.name}"? It will hide from the public site but stays in the DB.`)) return;
    await api.delete(`/packages/${p.id}`);
    load();
  };
  const restore = async (p) => {
    await api.patch(`/packages/${p.id}`, { is_active: true });
    load();
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold font-display flex items-center gap-2">
            <Boxes size={18} className="text-amber-500" />
            Solar Packages
          </h2>
          <p className="text-[11px] text-gray-400">
            Curated bundles of catalogue products shown on the public /solar-packages page.
          </p>
        </div>
        <div className="flex gap-2">
          <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)}
            className="px-2.5 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg text-xs bg-white dark:bg-brand-dark">
            <option value="true">Active only</option>
            <option value="false">Archived only</option>
            <option value="">All</option>
          </select>
          <button onClick={() => setCreating(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus size={12} /> New Package
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-amber-500" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-xl py-12 text-center">
          <Boxes size={28} className="mx-auto text-gray-300 mb-2" />
          <div className="text-sm font-semibold mb-0.5">No packages yet</div>
          <div className="text-[11px] text-gray-400">Create your first package to bundle catalogue products into a customer-facing system.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map(p => (
            <PackageCard key={p.id} pkg={p} onEdit={() => setEditing(p)} onArchive={() => archive(p)} onRestore={() => restore(p)} />
          ))}
        </div>
      )}

      {(editing || creating) && (
        <PackageEditor
          pkg={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

function PackageCard({ pkg, onEdit, onArchive, onRestore }) {
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-xl border border-gray-100 dark:border-white/5 p-3 flex flex-col gap-2 hover:shadow-md transition cursor-pointer" onClick={onEdit}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-bold truncate">{pkg.name}</div>
            {pkg.badge && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold whitespace-nowrap">{pkg.badge}</span>}
          </div>
          <div className="text-[10px] text-gray-400 truncate">{pkg.slug}</div>
        </div>
        <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={onEdit} title="Edit" className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600">
            <Pencil size={12} />
          </button>
          {pkg.is_active ? (
            <button onClick={onArchive} title="Archive" className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500">
              <Archive size={12} />
            </button>
          ) : (
            <button onClick={onRestore} title="Restore" className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-emerald-500">
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>

      {pkg.description && <div className="text-[11px] text-gray-500 line-clamp-2">{pkg.description}</div>}

      <div className="flex flex-wrap gap-1.5 mt-1">
        {pkg.tier && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{pkg.tier}</span>}
        {pkg.system_kw && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">{pkg.system_kw} kW</span>}
        {pkg.battery_kwh > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold">{pkg.battery_kwh} kWh</span>}
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{pkg.items?.length || 0} items</span>
      </div>

      <div className="flex justify-between items-end pt-1 mt-auto border-t border-gray-100">
        <div>
          <div className="text-[9px] text-gray-400 uppercase tracking-wide">From</div>
          <div className="text-base font-extrabold text-amber-600">{fmt$(pkg.from_price || 0)}</div>
          <div className="text-[9px] text-gray-400">incl GST</div>
        </div>
        <div className="text-right">
          {pkg.availability === 'backorder' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold flex items-center gap-1">
              <AlertTriangle size={9} /> Backorder
            </span>
          )}
          {pkg.has_inactive_products && (
            <span className="text-[10px] text-red-500 font-semibold">Inactive product(s)</span>
          )}
          {!pkg.is_active && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Archived</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PackageEditor({ pkg, onClose, onSaved }) {
  const isNew = !pkg;
  const [form, setForm] = useState(pkg || {
    slug: '', name: '', tier: '', badge: '',
    description: '', long_description: '',
    hero_image_url: '',
    system_kw: '', battery_kwh: '',
    estimated_annual_savings: '', estimated_payback_years: '',
    from_price_override: '',
    prefill: {},
    is_active: true,
    sort_order: 0,
  });
  const [items, setItems] = useState(pkg?.items || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({
      ...f,
      [name]: value,
      ...(name === 'name' && (!f.slug || f.slug === slugify(f.name)) ? { slug: slugify(value) } : {}),
    }));
  };

  const addProducts = async (newItems) => {
    if (isNew) {
      setError('Save the package first — items can be added once it has an ID.');
      return;
    }
    await api.post(`/packages/${pkg.id}/items`, { items: newItems });
    setPickerOpen(false);
    // Reload package to get fresh items + computed totals
    const { data } = await api.get(`/packages/${pkg.id}`);
    setItems(data.items || []);
  };

  const updateItem = async (item, field, value) => {
    await api.patch(`/packages/${pkg.id}/items/${item.id}`, { [field]: value });
    const { data } = await api.get(`/packages/${pkg.id}`);
    setItems(data.items || []);
  };

  const removeItem = async (item) => {
    if (!confirm(`Remove "${item.product?.name}" from this package?`)) return;
    await api.delete(`/packages/${pkg.id}/items/${item.id}`);
    const { data } = await api.get(`/packages/${pkg.id}`);
    setItems(data.items || []);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setSaving(true); setError('');
    try {
      const numericFields = ['system_kw', 'battery_kwh', 'estimated_annual_savings', 'estimated_payback_years', 'from_price_override', 'sort_order'];
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => {
          if (v === '') return [k, null];
          if (numericFields.includes(k) && v !== null) return [k, Number(v)];
          return [k, v];
        })
      );
      delete payload.id; delete payload.created_at; delete payload.updated_at;
      delete payload.items; delete payload.from_price; delete payload.computed_price_incl_gst;
      delete payload.availability; delete payload.available_from; delete payload.has_inactive_products;

      if (isNew) await api.post('/packages', payload);
      else       await api.patch(`/packages/${pkg.id}`, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl h-full bg-white dark:bg-brand-dark-1 shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-brand-dark-1 border-b border-gray-100 dark:border-white/5 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="text-sm font-bold font-display">{isNew ? 'New Package' : `Edit · ${pkg.name}`}</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-3">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{error}</div>}

          <Field label="Name *" name="name" value={form.name} onChange={handleChange} required />
          <div className="grid grid-cols-2 gap-2">
            <Field label="URL slug *" name="slug" value={form.slug} onChange={handleChange} required hint="lower-case-with-dashes" />
            <SelectField label="Tier" name="tier" value={form.tier || ''} onChange={handleChange} options={TIER_OPTIONS} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Badge (optional)" name="badge" value={form.badge || ''} onChange={handleChange} hint='e.g. "Most Popular"' />
            <Field label="Sort order" name="sort_order" type="number" value={form.sort_order ?? 0} onChange={handleChange} />
          </div>

          <Field label="Short description" name="description" type="textarea" value={form.description || ''} onChange={handleChange} hint="Shown on cards" />
          <Field label="Long description" name="long_description" type="textarea" value={form.long_description || ''} onChange={handleChange} hint="Shown on detail page" rows={4} />
          <Field label="Hero image URL" name="hero_image_url" value={form.hero_image_url || ''} onChange={handleChange} />

          <div className="grid grid-cols-2 gap-2">
            <Field label="System size (kW)" name="system_kw" type="number" step="0.1" value={form.system_kw ?? ''} onChange={handleChange} />
            <Field label="Battery (kWh)" name="battery_kwh" type="number" step="0.1" value={form.battery_kwh ?? ''} onChange={handleChange} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Annual savings $" name="estimated_annual_savings" type="number" step="100" value={form.estimated_annual_savings ?? ''} onChange={handleChange} />
            <Field label="Payback (years)" name="estimated_payback_years" type="number" step="0.1" value={form.estimated_payback_years ?? ''} onChange={handleChange} />
          </div>
          <Field label='"From" price override (incl GST)' name="from_price_override" type="number" step="50" value={form.from_price_override ?? ''} onChange={handleChange} hint="Leave blank to compute from items" />

          {/* Items section — only after the package is created */}
          {!isNew && (
            <div className="pt-3 border-t border-gray-100">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-xs font-bold flex items-center gap-1.5"><Package size={12} className="text-amber-500" /> Bill of Materials</h4>
                <button type="button" onClick={() => setPickerOpen(true)}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-[11px] font-bold flex items-center gap-1">
                  <Plus size={11} /> Add Products
                </button>
              </div>
              {items.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-gray-200 rounded text-xs text-gray-400">
                  No items yet — click "Add Products" to bundle products into this package.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded">
                  {items.map(it => (
                    <li key={it.id} className="px-3 py-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{it.product?.name || '— deleted product —'}</div>
                        <div className="text-[10px] text-gray-400">
                          {[it.product?.brand, it.product?.sku].filter(Boolean).join(' · ')}
                          {it.product?.is_active === false && <span className="ml-2 text-red-500 font-semibold">INACTIVE</span>}
                        </div>
                      </div>
                      <input
                        type="number" min="1"
                        defaultValue={it.qty}
                        onBlur={e => {
                          const v = Math.max(1, parseInt(e.target.value) || 1);
                          if (v !== it.qty) updateItem(it, 'qty', v);
                        }}
                        className="w-12 text-center text-xs border border-gray-200 rounded py-0.5"
                      />
                      <div className="text-xs text-gray-500 w-20 text-right">{fmt$(it.line_total_incl_gst || 0)}</div>
                      <button type="button" onClick={() => removeItem(it)} title="Remove"
                        className="p-1 text-gray-300 hover:text-red-500">
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-3">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs font-semibold text-gray-600 dark:text-gray-300">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-50">
              {saving ? 'Saving…' : (isNew ? 'Create Package' : 'Save Changes')}
            </button>
          </div>
        </form>

        <ProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onAdd={addProducts} />
      </div>
    </div>
  );
}

function Field({ label, name, value, onChange, type = 'text', step, required, hint, rows = 2 }) {
  if (type === 'textarea') {
    return (
      <div>
        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
        <textarea name={name} value={value} onChange={onChange} rows={rows}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs bg-white dark:bg-brand-dark resize-none" />
        {hint && <div className="text-[9px] text-gray-400 mt-0.5">{hint}</div>}
      </div>
    );
  }
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
      <input name={name} value={value} onChange={onChange} type={type} step={step} required={required}
        className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs bg-white dark:bg-brand-dark" />
      {hint && <div className="text-[9px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function SelectField({ label, name, value, onChange, options }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
      <select name={name} value={value} onChange={onChange}
        className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs bg-white dark:bg-brand-dark">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
