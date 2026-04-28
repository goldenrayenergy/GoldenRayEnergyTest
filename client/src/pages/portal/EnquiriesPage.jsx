import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import { fmt$, fmtDateTime } from '../../utils/format';
import { Search, Inbox } from 'lucide-react';

const STATUS_COLOR = {
  new:        '#F5A623',
  contacted:  '#1E90FF',
  qualified:  '#FF6A00',
  won:        '#2ECC71',
  lost:       '#EF4444',
};

const INSTALL_COLOR = {
  residential: '#1E90FF',
  commercial:  '#FF6A00',
  'off-grid':  '#F5A623',
  ppa:         '#2ECC71',
};

export default function EnquiriesPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/enquiries').then(r => setRows(r.data)).finally(() => setLoading(false));
  }, []);

  const filtered = rows.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${r.first_name || ''} ${r.last_name || ''}`.trim().toLowerCase();
    return name.includes(q) || r.email?.toLowerCase().includes(q) || r.phone?.toLowerCase().includes(q) || r.address?.toLowerCase().includes(q);
  });

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold font-display flex items-center gap-2">
            <Inbox size={18} className="text-amber-500" />
            Website Enquiries
          </h2>
          <p className="text-[11px] text-gray-400">Leads submitted through the public Get-Free-Quote form.</p>
        </div>
        <div className="text-[11px] text-gray-400">
          {rows.length} total {rows.length === 1 ? 'enquiry' : 'enquiries'}
        </div>
      </div>

      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email, phone, or address..."
          className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-amber-400" />
      </div>

      <DataTable
        onRowClick={r => nav(`/portal/enquiries/${r.id}`)}
        data={filtered}
        columns={[
          { label: 'Submitted', render: r => <span className="text-xs text-gray-500 whitespace-nowrap">{fmtDateTime(r.created_at)}</span> },
          { label: 'Name', render: r => (
            <div>
              <div className="text-xs font-semibold">{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</div>
              <div className="text-[10px] text-gray-400">{r.email || r.phone || '—'}</div>
            </div>
          )},
          { label: 'Location', render: r => <span className="text-[11px] text-gray-500 truncate max-w-[180px] inline-block">{r.address || '—'}</span> },
          { label: 'Type', render: r => r.installation_type
              ? <Badge color={INSTALL_COLOR[r.installation_type] || '#6b7280'}>{r.installation_type}</Badge>
              : <span className="text-gray-300">—</span> },
          { label: 'Monthly Bill', render: r => <span className="text-xs">{r.monthly_bill ? fmt$(r.monthly_bill) : '—'}</span> },
          { label: 'System', render: r => <span className="text-xs">{r.system_size_kw ? `${r.system_size_kw} kW` : '—'}</span> },
          { label: 'Quote', render: r => <span className="text-xs font-semibold">{r.total_cost ? fmt$(r.total_cost) : '—'}</span> },
          { label: 'Score', render: r => r.lead_score != null
              ? <span className={`text-xs font-bold ${r.lead_score >= 70 ? 'text-emerald-600' : r.lead_score >= 40 ? 'text-amber-600' : 'text-gray-400'}`}>{r.lead_score}</span>
              : '—' },
          { label: 'Status', render: r => <Badge color={STATUS_COLOR[r.status] || '#6b7280'}>{r.status || 'new'}</Badge> },
        ]}
      />
    </div>
  );
}
