import { useState, useEffect } from 'react';
import api from '../../services/api';
import KPI from '../../components/ui/KPI';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import { fmt$ } from '../../utils/format';
import { PIPE_STAGES } from '../../utils/constants';
import { Target, TrendingUp, Users, Star } from 'lucide-react';

export default function LeadScoringPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/leads').then(r => setLeads(r.data)).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  const sorted = [...leads].sort((a, b) => (Number(b.lead_score) || 50) - (Number(a.lead_score) || 50));
  const avgScore = leads.length ? Math.round(leads.reduce((s, l) => s + (Number(l.lead_score) || 50), 0) / leads.length) : 0;

  return (
    <div className="animate-fade-in space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <KPI icon={Target} label="Hot leads" value={leads.filter(l => (Number(l.lead_score) || 0) >= 75).length} sub="Score ≥ 75" accent="#ef4444" />
        <KPI icon={TrendingUp} label="Warm" value={leads.filter(l => { const s = Number(l.lead_score) || 50; return s >= 50 && s < 75; }).length} sub="50-74" accent="#f59e0b" />
        <KPI icon={Users} label="Cold" value={leads.filter(l => (Number(l.lead_score) || 50) < 50).length} sub="Below 50" accent="#3b82f6" />
        <KPI icon={Star} label="Avg score" value={avgScore} accent="#8b5cf6" />
      </div>
      <DataTable columns={[
        { label: 'Contact', render: r => <div><div className="text-xs font-semibold">{r.name}</div><div className="text-[9px] text-gray-400">{r.email}</div></div> },
        { label: 'Score', render: r => { const sc = Number(r.lead_score) || 50; const c = sc >= 75 ? '#ef4444' : sc >= 50 ? '#f59e0b' : '#3b82f6'; return <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-extrabold" style={{ background: c + '12', color: c }}>{sc}</div>; } },
        { label: 'Source', render: r => <span className="text-xs">{r.source}</span> },
        { label: 'Stage', render: r => { const st = PIPE_STAGES.find(s => s.id === r.stage); return <Badge color={st?.color}>{st?.label}</Badge>; } },
        { label: 'Value', render: r => <span className="text-xs font-semibold">{r.estimated_value ? fmt$(r.estimated_value) : '—'}</span> },
      ]} data={sorted} />
    </div>
  );
}