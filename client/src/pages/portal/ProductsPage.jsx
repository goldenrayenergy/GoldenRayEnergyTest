import { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import { fmt$ } from '../../utils/format';
import { Search, Package, Upload, Plus, AlertTriangle, X, Loader2, Pencil, Archive, RotateCcw } from 'lucide-react';

const STOCK_COLOR = {
  in_stock: '#2ECC71',
  backorder: '#F5A623',
  discontinued: '#9CA3AF',
  unknown: '#6B7280',
};
const STOCK_LABEL = {
  in_stock: 'In Stock',
  backorder: 'Backorder',
  discontinued: 'Discontinued',
  unknown: 'Unknown',
};

const fmtPct = n => n == null ? '—' : `${Number(n).toFixed(0)}%`;

export default function ProductsPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState({ categories: [], brands: [], stock_statuses: [], website_categories: [], subcategoriesByCategory: {} });
  const [filters, setFilters] = useState({ q: '', category: '', brand: '', stock_status: '', is_active: 'true' });
  const [editing, setEditing] = useState(null);     // product object or null
  const [importOpen, setImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
      const { data } = await api.get('/products', { params });
      setRows(data.products || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Load products failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadFacets = async () => {
    try {
      const { data } = await api.get('/products/facets');
      setFacets(data);
    } catch {}
  };

  // Initial + filter changes (debounced for the text search)
  useEffect(() => {
    const t = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.category, filters.brand, filters.stock_status, filters.is_active]);

  useEffect(() => { loadFacets(); }, []);

  const updateFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const clearFilters = () => setFilters({ q: '', category: '', brand: '', stock_status: '', is_active: 'true' });

  const handleArchive = async (p) => {
    if (!confirm(`Archive "${p.name}"? It will hide from quotes & shop but old quotes keep referring to it.`)) return;
    await api.delete(`/products/${p.id}`);
    load();
  };

  const handleRestore = async (p) => {
    await api.patch(`/products/${p.id}`, { is_active: true });
    load();
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold font-display flex items-center gap-2">
            <Package size={18} className="text-amber-500" />
            Product Catalogue
          </h2>
          <p className="text-[11px] text-gray-400">
            Single source of truth for every product — feeds the website shop, sales quotes, design proposals, and packages.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 flex items-center gap-1.5 transition"
          >
            <Upload size={12} /> Import Excel
          </button>
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Plus size={12} /> New Product
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white dark:bg-brand-dark-1 rounded-xl border border-gray-100 dark:border-white/5 p-3 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            value={filters.q}
            onChange={e => updateFilter('q', e.target.value)}
            placeholder="Search SKU, name, brand, description…"
            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg text-xs outline-none focus:border-amber-400 bg-white dark:bg-brand-dark"
          />
        </div>
        <select value={filters.category} onChange={e => updateFilter('category', e.target.value)}
          className="px-2.5 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg text-xs bg-white dark:bg-brand-dark">
          <option value="">All categories</option>
          {facets.categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.brand} onChange={e => updateFilter('brand', e.target.value)}
          className="px-2.5 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg text-xs bg-white dark:bg-brand-dark">
          <option value="">All brands</option>
          {facets.brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={filters.stock_status} onChange={e => updateFilter('stock_status', e.target.value)}
          className="px-2.5 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg text-xs bg-white dark:bg-brand-dark">
          <option value="">All stock</option>
          {facets.stock_statuses.map(s => <option key={s} value={s}>{STOCK_LABEL[s] || s}</option>)}
        </select>
        <select value={filters.is_active} onChange={e => updateFilter('is_active', e.target.value)}
          className="px-2.5 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg text-xs bg-white dark:bg-brand-dark">
          <option value="true">Active only</option>
          <option value="false">Archived only</option>
          <option value="">All</option>
        </select>
        <button onClick={clearFilters} className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-amber-600 transition">Clear</button>
        <div className="ml-auto self-center text-[11px] text-gray-400">
          {loading ? 'Loading…' : `${total} ${total === 1 ? 'product' : 'products'}`}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-amber-500" /></div>
      ) : (
        <DataTable
          data={rows}
          onRowClick={p => setEditing(p)}
          columns={[
            { label: 'Name',    render: p => (
              <div>
                <div className="text-xs font-semibold truncate max-w-[260px]">{p.name}</div>
                <div className="text-[10px] text-gray-400 truncate max-w-[260px]">{p.brand ? `${p.brand} · ` : ''}{p.category}{p.subcategory ? ` · ${p.subcategory}` : ''}</div>
              </div>
            )},
            { label: 'Cost',    render: p => p.cost_nzd != null ? <span className="text-xs">{fmt$(p.cost_nzd)}</span> : <span className="text-gray-300">—</span> },
            { label: 'Margin',  render: p => <span className="text-xs">{fmtPct(p.default_margin_pct)}</span> },
            { label: 'Sell (incl GST)', render: p => p.sell_incl_gst != null ? <span className="text-xs font-semibold">{fmt$(p.sell_incl_gst)}</span> : <span className="text-gray-300">—</span> },
            { label: 'Stock',   render: p => (
              <Badge color={STOCK_COLOR[p.stock_status] || '#9CA3AF'}>
                {STOCK_LABEL[p.stock_status] || p.stock_status || '—'}
              </Badge>
            )},
            { label: 'Qty',     render: p => <span className="text-xs">{p.qty_available ?? 0}</span> },
            { label: 'MOQ',     render: p => p.moq > 1 ? <span className="text-xs text-amber-600 font-semibold">{p.moq}</span> : <span className="text-xs text-gray-400">{p.moq ?? 1}</span> },
            { label: '',        render: p => (
              <div className="flex gap-1 justify-end">
                <button onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                  title="Edit"
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400 hover:text-amber-600 transition">
                  <Pencil size={12} />
                </button>
                {p.is_active ? (
                  <button onClick={(e) => { e.stopPropagation(); handleArchive(p); }}
                    title="Archive"
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400 hover:text-red-500 transition">
                    <Archive size={12} />
                  </button>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); handleRestore(p); }}
                    title="Restore"
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400 hover:text-emerald-500 transition">
                    <RotateCcw size={12} />
                  </button>
                )}
              </div>
            )},
          ]}
        />
      )}

      {/* Edit / create drawer */}
      {(editing || creating) && (
        <ProductEditor
          product={editing}
          facets={facets}
          defaultCategory={creating ? filters.category : ''}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); loadFacets(); }}
        />
      )}

      {/* Import modal */}
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); load(); loadFacets(); }}
        />
      )}
    </div>
  );
}

// ── Product editor (slide-over panel) ─────────────────────────────────────
function ProductEditor({ product, facets = {}, defaultCategory = '', onClose, onSaved }) {
  const isNew = !product;
  const [form, setForm] = useState(product || {
    sku: '', category: defaultCategory || '', subcategory: '', brand: '', name: '',
    description: '', cost_nzd: '', default_margin_pct: 30,
    unit: 'EA', stock_status: 'unknown', qty_available: 0, moq: 1,
    availability_notes: '', available_from: '', website_category: '',
    image_url: '', datasheet_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const categoryOptions = facets.categories || [];
  const subcatMap = facets.subcategoriesByCategory || {};
  const subcategoryOptions = form.category ? (subcatMap[form.category] || []) : [];

  // If the picked Sub-category isn't valid for the current Category, clear it.
  // Runs only when category changes — keeps existing subcategory on first render.
  useEffect(() => {
    if (!form.category) return;
    const valid = subcatMap[form.category] || [];
    if (form.subcategory && !valid.includes(form.subcategory)) {
      setForm(f => ({ ...f, subcategory: '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.category]);

  // For a brand-new product where defaultCategory was passed: if that category
  // happens to have exactly one sub-category, prefill it so the user has less
  // to type. Existing products keep whatever was already on them.
  useEffect(() => {
    if (!isNew || !defaultCategory) return;
    const subs = subcatMap[defaultCategory] || [];
    if (subs.length === 1) setForm(f => ({ ...f, subcategory: subs[0] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e?.preventDefault?.();
    setSaving(true); setError('');
    try {
      // Strip empty strings to null for nullable columns
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])
      );
      delete payload.id; delete payload.created_at; delete payload.updated_at;
      delete payload.sell_excl_gst; delete payload.sell_incl_gst;

      if (isNew) await api.post('/products', payload);
      else       await api.patch(`/products/${product.id}`, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl h-full bg-white dark:bg-brand-dark-1 shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-brand-dark-1 border-b border-gray-100 dark:border-white/5 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="text-sm font-bold font-display">
            {isNew ? 'New Product' : `Edit · ${product.name}`}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-3">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{error}</div>}

          <Field label="Name *" name="name" value={form.name} onChange={handleChange} required />
          <div className="grid grid-cols-2 gap-2">
            <Field label="SKU" name="sku" value={form.sku || ''} onChange={handleChange} />
            <Field label="Brand" name="brand" value={form.brand || ''} onChange={handleChange} />
            <SelectOrAdd label="Category" name="category" value={form.category || ''} options={categoryOptions} onChange={handleChange} />
            <SelectOrAdd label="Sub-category" name="subcategory" value={form.subcategory || ''} options={subcategoryOptions} onChange={handleChange} disabled={!form.category} disabledHint={!form.category ? 'Pick a category first' : undefined} />
            <SelectOrAdd label="Website category" name="website_category" value={form.website_category || ''} options={facets.website_categories || []} onChange={handleChange} />
            <Field label="Unit" name="unit" value={form.unit || 'EA'} onChange={handleChange} />
          </div>

          <Field label="Description" name="description" type="textarea" value={form.description || ''} onChange={handleChange} />

          <div className="grid grid-cols-3 gap-2">
            <Field label="Cost NZD" name="cost_nzd" type="number" step="0.01" value={form.cost_nzd ?? ''} onChange={handleChange} />
            <Field label="Margin %" name="default_margin_pct" type="number" step="1" value={form.default_margin_pct ?? ''} onChange={handleChange} />
            <Field label="MOQ" name="moq" type="number" step="1" value={form.moq ?? 1} onChange={handleChange} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Stock Status</label>
              <select name="stock_status" value={form.stock_status || 'unknown'} onChange={handleChange}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs bg-white dark:bg-brand-dark">
                <option value="in_stock">In Stock</option>
                <option value="backorder">Backorder</option>
                <option value="discontinued">Discontinued</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <Field label="Qty Available" name="qty_available" type="number" step="1" value={form.qty_available ?? 0} onChange={handleChange} />
            <Field label="Available From" name="available_from" type="date" value={form.available_from || ''} onChange={handleChange} />
          </div>

          <Field label="Availability Notes" name="availability_notes" type="textarea" value={form.availability_notes || ''} onChange={handleChange} />

          <div className="grid grid-cols-2 gap-2">
            <Field label="Image URL" name="image_url" value={form.image_url || ''} onChange={handleChange} />
            <Field label="Datasheet URL" name="datasheet_url" value={form.datasheet_url || ''} onChange={handleChange} />
          </div>

          {form.needs_review && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-700 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span><strong>Needs review:</strong> {form.needs_review}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs font-semibold text-gray-600 dark:text-gray-300">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-50">
              {saving ? 'Saving…' : (isNew ? 'Create Product' : 'Save Changes')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, name, value, onChange, type = 'text', step, required }) {
  if (type === 'textarea') {
    return (
      <div>
        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
        <textarea name={name} value={value} onChange={onChange} rows={2}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs bg-white dark:bg-brand-dark resize-none"
        />
      </div>
    );
  }
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
      <input name={name} value={value} onChange={onChange} type={type} step={step} required={required}
        className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs bg-white dark:bg-brand-dark"
      />
    </div>
  );
}

// Dropdown of existing values with a "+ Add new…" escape hatch. Emits the
// same { target: { name, value } } shape as Field so the parent's handleChange
// works unchanged.
function SelectOrAdd({ label, name, value, options = [], onChange, disabled = false, disabledHint }) {
  // If the current value isn't in the options list (e.g. a newly-typed value
  // or one missing from the active-only facets), or there are no options at
  // all (e.g. a category that has no existing sub-categories), drop into
  // typing mode so the user can add one.
  const valueIsCustom = !!value && !options.includes(value);
  const noOptions = !disabled && options.length === 0;
  const [adding, setAdding] = useState(valueIsCustom || noOptions);

  useEffect(() => {
    setAdding((!!value && !options.includes(value)) || (!disabled && options.length === 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length, disabled]);

  const emit = (v) => onChange({ target: { name, value: v } });

  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide flex items-center justify-between">
        <span>{label}</span>
        {!disabled && !adding && options.length > 0 && (
          <button type="button"
            onClick={() => { setAdding(true); emit(''); }}
            className="text-[9px] font-bold text-amber-600 hover:text-amber-700 normal-case tracking-normal"
            title="Type a new value instead of picking">
            + Add new
          </button>
        )}
        {!disabled && adding && (
          <button type="button"
            onClick={() => { setAdding(false); emit(''); }}
            className="text-[9px] font-bold text-gray-400 hover:text-gray-600 normal-case tracking-normal"
            title="Back to the dropdown">
            ← Pick existing
          </button>
        )}
      </label>
      {adding ? (
        <input
          name={name}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={disabled ? (disabledHint || '') : 'Type new value…'}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs bg-white dark:bg-brand-dark disabled:bg-gray-50 disabled:text-gray-400"
        />
      ) : (
        <select
          name={name}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs bg-white dark:bg-brand-dark disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">{disabled ? (disabledHint || '—') : 'Select…'}</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      )}
    </div>
  );
}

// ── Excel import modal ────────────────────────────────────────────────────
function ImportModal({ onClose, onDone }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!file) return;
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/products/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-brand-dark-1 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
          <h3 className="text-sm font-bold font-display flex items-center gap-2"><Upload size={14} className="text-amber-500" /> Import from Excel</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {!result && (
            <>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Upload <code className="px-1 py-0.5 bg-gray-100 dark:bg-white/10 rounded">products_merged.xlsx</code> (the
                output of <code className="px-1 py-0.5 bg-gray-100 dark:bg-white/10 rounded">scripts/merge_product_excels.py</code>)
                or any spreadsheet with the same column shape. Rows with a SKU upsert by SKU; rows without insert new.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-amber-50 file:text-amber-700 file:font-semibold file:cursor-pointer hover:file:bg-amber-100"
              />
              {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{error}</div>}
              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs font-semibold text-gray-600 dark:text-gray-300">Cancel</button>
                <button onClick={submit} disabled={!file || uploading}
                  className="flex-1 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {uploading ? <><Loader2 size={12} className="animate-spin" /> Importing…</> : 'Import'}
                </button>
              </div>
            </>
          )}
          {result && (
            <>
              <div className="space-y-1.5 text-sm">
                <Row label="Total rows" value={result.total} />
                <Row label="Inserted" value={result.inserted} accent="emerald" />
                <Row label="Updated"  value={result.updated}  accent="blue" />
                <Row label="Skipped"  value={result.skipped} />
                <Row label="Errors"   value={result.errors?.length || 0} accent={result.errors?.length ? 'red' : undefined} />
              </div>
              {result.errors?.length > 0 && (
                <div className="max-h-48 overflow-y-auto px-3 py-2 bg-red-50 border border-red-200 rounded text-[11px] text-red-700 space-y-0.5">
                  {result.errors.slice(0, 30).map((e, i) => <div key={i}>Row {e.row}: {e.error}</div>)}
                  {result.errors.length > 30 && <div className="italic">…and {result.errors.length - 30} more</div>}
                </div>
              )}
              <button onClick={onDone} className="w-full px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold">Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, accent }) {
  const colorMap = {
    emerald: 'text-emerald-600 font-bold',
    blue: 'text-blue-600 font-bold',
    red: 'text-red-600 font-bold',
  };
  return (
    <div className="flex justify-between border-b border-gray-100 dark:border-white/5 py-1.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs ${accent ? colorMap[accent] : 'text-gray-800 dark:text-gray-200'}`}>{value}</span>
    </div>
  );
}
