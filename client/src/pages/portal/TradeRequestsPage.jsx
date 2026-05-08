import { useState, useEffect } from 'react';
import api from '../../services/api';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import { fmt$, fmtDateTime } from '../../utils/format';
import { ShoppingCart, Search, X, Loader2, ExternalLink, FileText } from 'lucide-react';

const STATUS_COLOR = {
  new:       '#F5A623',
  contacted: '#1E90FF',
  quoted:    '#FF6A00',
  won:       '#2ECC71',
  lost:      '#EF4444',
};

const STATUS_OPTIONS = ['new', 'contacted', 'quoted', 'won', 'lost'];

export default function TradeRequestsPage() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = statusFilter ? { status: statusFilter } : {};
      const { data } = await api.get('/trade-requests', { params });
      setRows(data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const filtered = rows.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.business_name?.toLowerCase().includes(q)
        || r.contact_name?.toLowerCase().includes(q)
        || r.email?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold font-display flex items-center gap-2">
            <ShoppingCart size={18} className="text-amber-500" />
            Trade Quote Requests
          </h2>
          <p className="text-[11px] text-gray-400">Cart submissions from electricians on /shop. Reply within 1 business day.</p>
        </div>
        <div className="text-[11px] text-gray-400">
          {rows.length} total
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center bg-white rounded-xl border border-gray-100 p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search business, contact, email…"
            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:border-amber-400" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-amber-500" /></div>
      ) : (
        <DataTable
          data={filtered}
          onRowClick={r => setSelected(r)}
          columns={[
            { label: 'Submitted', render: r => <span className="text-xs text-gray-500 whitespace-nowrap">{fmtDateTime(r.created_at)}</span> },
            { label: 'Business',  render: r => (
              <div>
                <div className="text-xs font-semibold">{r.business_name}</div>
                <div className="text-[10px] text-gray-400">{r.contact_name} · {r.email}</div>
              </div>
            )},
            { label: 'Items',     render: r => <span className="text-xs">{r.items?.length || 0}</span> },
            { label: 'Subtotal',  render: r => <span className="text-xs">{fmt$(r.subtotal_excl_gst || 0)}</span> },
            { label: 'Total',     render: r => <span className="text-xs font-bold">{fmt$(r.total_incl_gst || 0)}</span> },
            { label: 'Status',    render: r => <Badge color={STATUS_COLOR[r.status] || '#6b7280'}>{r.status}</Badge> },
          ]}
        />
      )}

      {selected && <RequestDetail request={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }} />}
    </div>
  );
}

function RequestDetail({ request, onClose, onSaved }) {
  const [status, setStatus] = useState(request.status);
  const [notes, setNotes]   = useState(request.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.patch(`/trade-requests/${request.id}`, { status, notes });
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  const items = Array.isArray(request.items) ? request.items : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between z-10">
          <div>
            <h3 className="text-sm font-bold font-display">{request.business_name}</h3>
            <div className="text-[10px] text-gray-400">{request.contact_name} · {request.email}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Buyer panel */}
          <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 gap-3 text-xs">
            <Field label="Phone"           value={request.phone} />
            <Field label="GST number"      value={request.gst_number} />
            <Field label="Delivery"        value={request.delivery_address} className="col-span-2" />
            {request.notes && <Field label="Buyer notes" value={request.notes} className="col-span-2" />}
          </div>

          {/* Items */}
          <div>
            <h4 className="text-xs font-bold mb-2 flex items-center gap-1.5"><FileText size={12} className="text-amber-500" /> Cart contents</h4>
            <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">Item</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wide">Qty</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wide">Unit (incl GST)</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wide">Line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((it, i) => {
                    const unit = it.unit_sell_incl_at_request || 0;
                    const line = unit * it.qty;
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <div className="text-xs font-semibold">{it.name}</div>
                          <div className="text-[10px] text-gray-400">{[it.brand, it.sku].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="px-3 py-2 text-right text-xs">{it.qty}</td>
                        <td className="px-3 py-2 text-right text-xs">{fmt$(unit)}</td>
                        <td className="px-3 py-2 text-right text-xs font-bold">{fmt$(line)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-100">
                  <tr>
                    <td colSpan="3" className="px-3 py-1.5 text-right text-[11px] text-gray-500">Sub-total (excl GST)</td>
                    <td className="px-3 py-1.5 text-right text-xs font-semibold">{fmt$(request.subtotal_excl_gst)}</td>
                  </tr>
                  <tr>
                    <td colSpan="3" className="px-3 py-1.5 text-right text-[11px] text-gray-500">GST 15%</td>
                    <td className="px-3 py-1.5 text-right text-xs font-semibold">{fmt$(request.gst_amount)}</td>
                  </tr>
                  <tr className="border-t border-gray-200">
                    <td colSpan="3" className="px-3 py-2 text-right text-xs font-bold text-amber-700">TOTAL (incl GST)</td>
                    <td className="px-3 py-2 text-right text-sm font-extrabold text-amber-700">{fmt$(request.total_incl_gst)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Status + notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-xs bg-white">
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {request.contact_id && (
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">CRM contact</label>
                <a href={`/portal/contacts`} className="mt-1 inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 py-2">
                  Open contact <ExternalLink size={10} />
                </a>
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Sales notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Track follow-up actions, pricing decisions, delivery questions…"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400" />
          </div>

          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{error}</div>}

          <div className="flex gap-2 pt-2">
            <button onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600">Close</button>
            <button onClick={save} disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, className = '' }) {
  return (
    <div className={className}>
      <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-xs text-gray-700 mt-0.5">{value || <span className="text-gray-300 italic">—</span>}</div>
    </div>
  );
}
