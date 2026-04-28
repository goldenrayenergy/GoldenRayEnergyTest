import { useState, useEffect } from 'react';
import api from '../../services/api';
import KPI from '../../components/ui/KPI';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { NewCompanyModal, confirmDelete } from '../../components/portal/CreateModals';
import { fmt$ } from '../../utils/format';
import { Building2, DollarSign, Users, Briefcase, Plus, Pencil, Trash2 } from 'lucide-react';

export default function CompaniesPage() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [editCo, setEditCo] = useState(null);

  const handleSaved = (c) => setCompanies(p => p.map(x => x.id === c.id ? { ...x, ...c } : x));
  const handleDelete = async (c) => {
    if (await confirmDelete({ url: '/companies', id: c.id, label: `company "${c.name}"` })) {
      setCompanies(p => p.filter(x => x.id !== c.id));
    }
  };
  useEffect(() => { api.get('/companies').then(r => setCompanies(r.data)).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold font-display">Companies</h2>
          <p className="text-[11px] text-gray-400">Organisations with open deals, contacts and account history.</p>
        </div>
        <Button icon={Plus} onClick={() => setNewOpen(true)}>New Company</Button>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <KPI icon={Building2} label="Companies" value={companies.length} accent="#8b5cf6" />
        <KPI icon={DollarSign} label="Total value" value={fmt$(companies.reduce((s, c) => s + Number(c.total_deal_value || 0), 0))} accent="#10b981" />
        <KPI icon={Users} label="Contacts" value={companies.reduce((s, c) => s + Number(c.contact_count || 0), 0)} accent="#3b82f6" />
        <KPI icon={Briefcase} label="Deals" value={companies.reduce((s, c) => s + Number(c.deal_count || 0), 0)} accent="#f59e0b" />
      </div>
      <DataTable columns={[
        { label: 'Company', render: r => <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center"><Building2 size={14} className="text-purple-500" /></div><div><div className="text-xs font-semibold">{r.name}</div><div className="text-[9px] text-gray-400">{r.domain}</div></div></div> },
        { label: 'Industry', render: r => <span className="text-xs">{r.industry}</span> },
        { label: 'Size', render: r => <span className="text-xs text-gray-400">{r.size}</span> },
        { label: 'City', render: r => <span className="text-xs text-gray-400">{r.city}</span> },
        { label: 'Lifecycle', render: r => <Badge color={r.lifecycle === 'customer' ? '#10b981' : '#f59e0b'}>{r.lifecycle}</Badge> },
        { label: 'Deal value', render: r => <span className="text-xs font-bold text-emerald-500">{fmt$(r.total_deal_value)}</span> },
        { label: 'Actions', render: r => (
          <div className="flex gap-1">
            <button onClick={() => setEditCo(r)} title="Edit" className="w-6 h-6 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center"><Pencil size={11} /></button>
            <button onClick={() => handleDelete(r)} title="Delete" className="w-6 h-6 rounded bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center"><Trash2 size={11} /></button>
          </div>
        ) },
      ]} data={companies} />

      <NewCompanyModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={c => setCompanies(p => [c, ...p])} />
      <NewCompanyModal open={!!editCo} onClose={() => setEditCo(null)} initial={editCo} onSaved={handleSaved} />
    </div>
  );
}