import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart as RPie, Pie, Cell } from 'recharts';
import api from '../../services/api';
import KPI from '../../components/ui/KPI';
import Card from '../../components/ui/Card';
import Tabs from '../../components/ui/Tabs';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { NewCampaignModal, confirmDelete } from '../../components/portal/CreateModals';
import { fmt$, pct } from '../../utils/format';
import { CHART_COLORS } from '../../utils/constants';
import { Megaphone, Users, DollarSign, TrendingUp, Plus, Pencil, Trash2 } from 'lucide-react';

const CTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return <div className="bg-white border border-gray-100 rounded-lg px-3 py-2 shadow-md text-xs"><div className="font-semibold mb-1">{label}</div>{payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: <b>{typeof p.value === 'number' && p.value > 999 ? fmt$(p.value) : p.value}</b></div>)}</div>;
};

export default function CampaignsPage() {
  const [tab, setTab] = useState('overview');
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [editCamp, setEditCamp] = useState(null);

  const handleSaved = (c) => setCampaigns(p => p.map(x => x.id === c.id ? { ...x, ...c } : x));
  const handleDelete = async (c) => {
    if (await confirmDelete({ url: '/campaigns', id: c.id, label: `campaign "${c.name}"` })) {
      setCampaigns(p => p.filter(x => x.id !== c.id));
    }
  };

  useEffect(() => { api.get('/campaigns').then(r => setCampaigns(r.data)).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  const totalLeads = campaigns.reduce((s, c) => s + Number(c.leads_generated || 0), 0);
  const totalRevenue = campaigns.reduce((s, c) => s + Number(c.revenue_attributed || 0), 0);
  const totalSpent = campaigns.reduce((s, c) => s + Number(c.spent || 0), 0);
  const overallROI = totalSpent > 0 ? Math.round((totalRevenue - totalSpent) / totalSpent * 100) : 0;
  const emailCamps = campaigns.filter(c => c.channel === 'email');

  const channelData = ['email', 'google_ads', 'facebook', 'linkedin', 'referral', 'event'].map(ch => {
    const camps = campaigns.filter(c => c.channel === ch);
    return { channel: ch, spent: camps.reduce((s, c) => s + Number(c.spent || 0), 0), revenue: camps.reduce((s, c) => s + Number(c.revenue_attributed || 0), 0), leads: camps.reduce((s, c) => s + Number(c.leads_generated || 0), 0), count: camps.length };
  }).filter(c => c.count > 0);

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold font-display">Campaigns</h2>
          <p className="text-[11px] text-gray-400">Launch and track marketing campaigns across every channel.</p>
        </div>
        <Button icon={Plus} onClick={() => setNewOpen(true)}>New Campaign</Button>
      </div>
      <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'campaigns', label: 'All campaigns' }, { id: 'channels', label: 'Channels' }, { id: 'roi', label: 'ROI analysis' }]} active={tab} onChange={setTab} />

      {tab === 'overview' && <>
        <div className="grid grid-cols-4 gap-3">
          <KPI icon={Megaphone} label="Campaigns" value={campaigns.length} sub={`${campaigns.filter(c => c.status === 'active').length} active`} accent="#8b5cf6" />
          <KPI icon={Users} label="Leads" value={totalLeads} accent="#3b82f6" trend={22} />
          <KPI icon={DollarSign} label="Revenue" value={fmt$(totalRevenue)} accent="#10b981" trend={15} />
          <KPI icon={TrendingUp} label="ROI" value={`${overallROI}%`} accent="#f59e0b" />
        </div>
        <Card title="Campaign performance" subtitle="By revenue">
          {[...campaigns].sort((a, b) => Number(b.revenue_attributed) - Number(a.revenue_attributed)).map((c, i) => (
            <div key={c.id} className={`py-2 ${i < campaigns.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="flex justify-between mb-1">
                <div className="flex items-center gap-2"><Badge color={c.status === 'active' ? '#10b981' : '#999'}>{c.type}</Badge><span className="text-xs font-semibold">{c.name}</span></div>
                <span className="text-xs font-bold text-emerald-500">{fmt$(c.revenue_attributed)}</span>
              </div>
              <div className="flex gap-4 text-[9px] text-gray-400">
                <span>{c.leads_generated} leads</span><span>{c.conversions} converts</span>
                <span>Spent: {fmt$(c.spent)}</span>
                <span>ROI: {Number(c.spent) > 0 ? Math.round((Number(c.revenue_attributed) - Number(c.spent)) / Number(c.spent) * 100) : 0}%</span>
              </div>
            </div>
          ))}
        </Card>
      </>}

      {tab === 'campaigns' && <DataTable columns={[
        { label: 'Campaign', render: r => <div className="text-xs font-semibold">{r.name}</div> },
        { label: 'Type', render: r => <Badge color={r.type === 'email' ? '#3b82f6' : r.type === 'paid' ? '#f59e0b' : '#10b981'}>{r.type}</Badge> },
        { label: 'Status', render: r => <Badge color={r.status === 'active' ? '#10b981' : '#999'}>{r.status}</Badge> },
        { label: 'Budget', render: r => <span className="text-xs">{fmt$(r.budget)}</span> },
        { label: 'Spent', render: r => <span className="text-xs">{fmt$(r.spent)}</span> },
        { label: 'Leads', render: r => <span className="text-xs font-semibold">{r.leads_generated}</span> },
        { label: 'Revenue', render: r => <span className="text-xs font-bold text-emerald-500">{fmt$(r.revenue_attributed)}</span> },
        { label: 'ROI', render: r => { const roi = Number(r.spent) > 0 ? Math.round((Number(r.revenue_attributed) - Number(r.spent)) / Number(r.spent) * 100) : 0; return <span className={`text-xs font-semibold ${roi > 100 ? 'text-emerald-500' : 'text-amber-500'}`}>{roi}%</span>; } },
        { label: 'Actions', render: r => (
          <div className="flex gap-1">
            <button onClick={() => setEditCamp(r)} title="Edit" className="w-6 h-6 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center"><Pencil size={11} /></button>
            <button onClick={() => handleDelete(r)} title="Delete" className="w-6 h-6 rounded bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center"><Trash2 size={11} /></button>
          </div>
        ) },
      ]} data={campaigns} />}

      {tab === 'channels' && <div className="grid grid-cols-3 gap-3">
        {channelData.map(c => (
          <Card key={c.channel} title={c.channel.replace('_', ' ')} subtitle={`${c.count} campaigns`}>
            <div className="grid grid-cols-2 gap-2">
              {[['Spent', fmt$(c.spent), '#888'], ['Revenue', fmt$(c.revenue), '#10b981'], ['Leads', c.leads, '#3b82f6'], ['ROI', `${c.spent > 0 ? Math.round((c.revenue - c.spent) / c.spent * 100) : 0}%`, '#f59e0b']].map(([l, v, color], i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-2 text-center">
                  <div className="text-sm font-bold" style={{ color }}>{v}</div>
                  <div className="text-[8px] text-gray-400 uppercase">{l}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>}

      <NewCampaignModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={c => setCampaigns(p => [c, ...p])} />
      <NewCampaignModal open={!!editCamp} onClose={() => setEditCamp(null)} initial={editCamp} onSaved={handleSaved} />

      {tab === 'roi' && <Card title="Campaign ROI comparison">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={campaigns.map(c => ({ name: c.name.length > 18 ? c.name.slice(0, 18) + '…' : c.name, roi: Number(c.spent) > 0 ? Math.round((Number(c.revenue_attributed) - Number(c.spent)) / Number(c.spent) * 100) : 0 }))} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis type="number" tick={{ fontSize: 9, fill: '#999' }} axisLine={false} /><YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 9, fill: '#888' }} axisLine={false} />
            <Tooltip content={<CTip />} /><Bar dataKey="roi" fill="#f59e0b" radius={[0, 4, 4, 0]} name="ROI %" />
          </BarChart>
        </ResponsiveContainer>
      </Card>}
    </div>
  );
}
