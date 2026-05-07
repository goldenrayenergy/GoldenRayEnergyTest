import { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { fmt$ } from '../../utils/format';
import { Search, X, Package, Plus, Minus, Loader2, AlertTriangle } from 'lucide-react';

// Reusable slide-over for adding products from the catalogue to a project.
//
// Props:
//   open               — whether the panel is visible
//   onClose()          — close button / overlay click
//   onAdd(items)       — called with [{ product_id, name, sku, qty }, ...]
//                        when "Add" is clicked. Caller is responsible for
//                        POSTing them to the line-items endpoint.

export default function ProductPicker({ open, onClose, onAdd }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', category: '', brand: '' });
  const [facets, setFacets] = useState({ categories: [], brands: [] });
  // Map<productId, qty>
  const [selected, setSelected] = useState(new Map());
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = { is_active: 'true', limit: 200 };
      if (filters.q) params.q = filters.q;
      if (filters.category) params.category = filters.category;
      if (filters.brand) params.brand = filters.brand;
      const { data } = await api.get('/products', { params });
      setRows(data.products || []);
    } catch (e) {
      console.error('ProductPicker load error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, filters.q, filters.category, filters.brand]);

  useEffect(() => {
    if (!open) return;
    api.get('/products/facets').then(r => setFacets(r.data)).catch(() => {});
  }, [open]);

  // Reset selection on close
  useEffect(() => { if (!open) { setSelected(new Map()); setFilters({ q: '', category: '', brand: '' }); } }, [open]);

  const toggle = (p) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, 1);
      return next;
    });
  };
  const setQty = (id, qty) => {
    if (qty < 1) qty = 1;
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(id)) next.set(id, qty);
      return next;
    });
  };

  const subtotal = useMemo(() => {
    let total = 0;
    for (const [id, qty] of selected.entries()) {
      const p = rows.find(r => r.id === id);
      if (p?.sell_incl_gst) total += p.sell_incl_gst * qty;
    }
    return total;
  }, [selected, rows]);

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const items = [];
      for (const [id, qty] of selected.entries()) {
        const p = rows.find(r => r.id === id);
        if (!p) continue;
        items.push({ product_id: p.id, name: p.name, sku: p.sku, qty });
      }
      await onAdd(items);
      // Caller closes us
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl h-full bg-white dark:bg-brand-dark-1 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="border-b border-gray-100 dark:border-white/5 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-amber-500" />
            <h3 className="text-sm font-bold font-display">Add products</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Filter bar */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-white/5 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              value={filters.q}
              onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
              placeholder="Search SKU, name, brand…"
              className="w-full pl-8 pr-3 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg text-xs outline-none focus:border-amber-400 bg-white dark:bg-brand-dark"
            />
          </div>
          <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
            className="px-2.5 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg text-xs bg-white dark:bg-brand-dark">
            <option value="">All categories</option>
            {facets.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filters.brand} onChange={e => setFilters(f => ({ ...f, brand: e.target.value }))}
            className="px-2.5 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg text-xs bg-white dark:bg-brand-dark">
            <option value="">All brands</option>
            {facets.brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-amber-500" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-xs text-gray-400">No products match these filters</div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-white/5">
              {rows.map(p => {
                const isSelected = selected.has(p.id);
                const qty = selected.get(p.id) || 1;
                const lineTotal = (p.sell_incl_gst || 0) * qty;
                return (
                  <li key={p.id}
                    onClick={() => toggle(p)}
                    className={`px-5 py-2.5 flex items-start gap-3 cursor-pointer transition ${isSelected ? 'bg-amber-50/60 dark:bg-amber-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}
                  >
                    <input type="checkbox" checked={isSelected} readOnly
                      className="mt-1 w-3.5 h-3.5 accent-amber-500 cursor-pointer" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <div className="text-xs font-semibold truncate">{p.name}</div>
                        {p.sku && <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{p.sku}</span>}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {[p.brand, p.category].filter(Boolean).join(' · ')}
                        {p.stock_status === 'backorder' && <span className="ml-2 text-amber-600 font-semibold">· Backorder</span>}
                        {p.moq > 1 && <span className="ml-2 text-amber-600 font-semibold flex-shrink-0 inline-flex items-center gap-0.5"><AlertTriangle size={9} />MOQ {p.moq}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-bold">{fmt$(p.sell_incl_gst || 0)}</div>
                      <div className="text-[9px] text-gray-400">incl GST</div>
                    </div>
                    {/* Qty stepper appears only for selected rows */}
                    {isSelected && (
                      <div onClick={e => e.stopPropagation()} className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => setQty(p.id, qty - 1)}
                          className="p-1 rounded bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 hover:bg-gray-50 disabled:opacity-30"
                          disabled={qty <= 1}>
                          <Minus size={10} />
                        </button>
                        <input
                          type="number"
                          min="1"
                          value={qty}
                          onChange={e => setQty(p.id, parseInt(e.target.value) || 1)}
                          className="w-12 text-center text-xs border border-gray-200 dark:border-white/10 rounded py-0.5 bg-white dark:bg-brand-dark"
                        />
                        <button onClick={() => setQty(p.id, qty + 1)}
                          className="p-1 rounded bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 hover:bg-gray-50">
                          <Plus size={10} />
                        </button>
                        <div className="w-20 text-right text-[10px] text-gray-500 ml-1">= {fmt$(lineTotal)}</div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-white/5 px-5 py-3 flex items-center justify-between bg-gray-50 dark:bg-brand-dark">
          <div className="text-xs">
            <span className="font-semibold">{selected.size}</span>
            <span className="text-gray-400"> selected · subtotal </span>
            <span className="font-bold">{fmt$(subtotal)}</span>
            <span className="text-gray-400 text-[10px]"> incl GST</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-xs font-semibold text-gray-600 dark:text-gray-300">
              Cancel
            </button>
            <button onClick={handleAdd} disabled={selected.size === 0 || submitting}
              className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1">
              {submitting ? <><Loader2 size={12} className="animate-spin" /> Adding…</> : `Add ${selected.size > 0 ? selected.size : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
