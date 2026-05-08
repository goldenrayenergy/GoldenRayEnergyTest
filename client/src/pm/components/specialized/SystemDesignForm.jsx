import { useEffect, useState } from 'react';
import api from '../../../services/api';
import TaskFormGeneric from '../TaskFormGeneric';
import { fmt$ } from '../../../utils/format';

// ── System design form with BOM picker ──
// Reuses the existing /api/products catalogue (read-only). Engineers pick
// products + qty to assemble a Bill of Materials. The BOM is stored in
// item_meta.fields.bom (JSONB array of { product_id, sku, name, qty,
// unit_cost_nzd, line_total }). On save, totals are computed client-side
// for display; server stores it as part of the lane PATCH.
//
// This is intentionally simpler than a full Mapbox panel-layout designer —
// that's a Phase B+ goal once the workflow framework is proven.

export default function SystemDesignForm({ schema, values, currentState, onSave }) {
  const [products, setProducts]     = useState([]);
  const [productSearch, setSearch]  = useState('');
  const [bom, setBom]               = useState(values?.bom || []);
  const [v, setV]                   = useState(values || {});
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    setBom(values?.bom || []);
    setV(values || {});
  }, [values]);

  useEffect(() => {
    api.get('/products', { params: { limit: 200 } })
      .then(r => setProducts(Array.isArray(r.data) ? r.data : (r.data?.data || [])))
      .catch(() => setProducts([]));
  }, []);

  const filtered = (products || []).filter(p => {
    if (!productSearch) return true;
    const q = productSearch.toLowerCase();
    return p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q);
  }).slice(0, 30);

  function addLine(p) {
    if (bom.find(l => l.product_id === p.id)) return;
    const cost = Number(p.cost_nzd || 0);
    const margin = Number(p.default_margin_pct || 0) / 100;
    const unit = cost * (1 + margin);
    setBom([...bom, {
      product_id: p.id,
      sku: p.sku, name: p.name, category: p.category,
      qty: 1, unit_cost_nzd: unit, line_total: unit,
    }]);
  }

  function setQty(idx, qty) {
    const next = [...bom];
    next[idx] = { ...next[idx], qty: Number(qty) || 0 };
    next[idx].line_total = next[idx].qty * next[idx].unit_cost_nzd;
    setBom(next);
  }

  function removeLine(idx) {
    setBom(bom.filter((_, i) => i !== idx));
  }

  const total = bom.reduce((s, l) => s + (l.line_total || 0), 0);

  async function save() {
    setSaving(true);
    try {
      await onSave({ ...v, bom, bom_total_nzd: total, bom_line_count: bom.length });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* BOM picker */}
      <div className="bg-sky-50 border border-sky-200 rounded p-3 mb-4">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Bill of Materials</h4>

        <input
          type="text"
          value={productSearch}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search products by name, SKU, category…"
          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white mb-2"
        />

        {productSearch && (
          <div className="max-h-40 overflow-y-auto border border-slate-200 rounded bg-white mb-2">
            {filtered.length === 0 ? (
              <div className="text-xs text-slate-400 p-2 italic">No matching products.</div>
            ) : filtered.map(p => (
              <button
                key={p.id}
                onClick={() => { addLine(p); setSearch(''); }}
                className="block w-full text-left px-2 py-1 hover:bg-amber-50 text-xs">
                <span className="font-mono text-slate-500 mr-2">{p.sku || '—'}</span>
                {p.name}
                <span className="text-slate-400 ml-2">{fmt$(p.cost_nzd)}</span>
              </button>
            ))}
          </div>
        )}

        {bom.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No items yet. Search above to add components.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-white">
              <tr className="text-left">
                <th className="px-2 py-1 font-medium text-slate-600">SKU</th>
                <th className="px-2 py-1 font-medium text-slate-600">Item</th>
                <th className="px-2 py-1 font-medium text-slate-600 w-16">Qty</th>
                <th className="px-2 py-1 font-medium text-slate-600 w-24 text-right">Unit</th>
                <th className="px-2 py-1 font-medium text-slate-600 w-24 text-right">Line</th>
                <th className="px-2 py-1 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bom.map((l, i) => (
                <tr key={i} className="bg-white">
                  <td className="px-2 py-1 font-mono text-slate-500">{l.sku || '—'}</td>
                  <td className="px-2 py-1 truncate max-w-[200px]">{l.name}</td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      value={l.qty}
                      onChange={e => setQty(i, e.target.value)}
                      className="w-14 px-1 py-0.5 border border-slate-300 rounded text-xs"
                    />
                  </td>
                  <td className="px-2 py-1 text-right">{fmt$(l.unit_cost_nzd)}</td>
                  <td className="px-2 py-1 text-right font-medium">{fmt$(l.line_total)}</td>
                  <td className="px-2 py-1">
                    <button onClick={() => removeLine(i)} className="text-red-600 hover:underline text-[10px]">×</button>
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={4} className="px-2 py-1 text-right">Total</td>
                <td className="px-2 py-1 text-right">{fmt$(total)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="mt-3 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-sm rounded font-medium disabled:opacity-50">
          {saving ? 'Saving…' : 'Save BOM'}
        </button>
      </div>

      {/* Standard system design fields */}
      <div className="border-t border-slate-200 pt-4">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Design specs</h4>
        <TaskFormGeneric
          schema={schema}
          values={values}
          currentState={currentState}
          onSave={onSave}
        />
      </div>
    </div>
  );
}
