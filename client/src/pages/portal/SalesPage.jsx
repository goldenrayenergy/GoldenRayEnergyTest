import { useState, useEffect } from 'react';
import { AreaChart, Area, BarChart, Bar, PieChart as RPie, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../../services/api';
import KPI from '../../components/ui/KPI';
import Card from '../../components/ui/Card';
import Tabs from '../../components/ui/Tabs';
import ProgressBar from '../../components/ui/ProgressBar';
import { fmt$, pct } from '../../utils/format';
import { CHART_COLORS } from '../../utils/constants';
import { DollarSign, Briefcase, Target, Users, TrendingUp } from 'lucide-react';

const CTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return <div className="bg-white border border-gray-100 rounded-lg px-3 py-2 shadow-md text-xs">
    <div className="font-semibold mb-1">{label}</div>
    {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: <b>{typeof p.value === 'number' && p.value > 999 ? fmt$(p.value) : p.value}</b></div>)}
  </div>;
};

export default function SalesPage() {
  const [tab, setTab] = useState('overview');
  const [deals, setDeals] = useState([]);
  const [team, setTeam] = useState([]);
  const [stats, setStats] = useState({ sources: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/deals'), api.get('/reports/team'), api.get('/leads/stats')])
      .then(([d, t, s]) => { setDeals(d.data); setTeam(t.data); setStats(s.data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  const wonDeals = deals.filter(d => d.stage === 'closed_won');
  const openDeals = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage));
  const wonVal = wonDeals.reduce((s, d) => s + Number(d.amount || 0), 0);
  const avgDeal = wonDeals.length ? Math.round(wonVal / wonDeals.length) : 0;
  const lostDeals = deals.filter(d => d.stage === 'closed_lost');
  const winRate = wonDeals.length + lostDeals.length > 0 ? Math.round(wonDeals.length / (wonDeals.length + lostDeals.length) * 100) : 0;
  const pipeVal = openDeals.reduce((s, d) => s + Number(d.amount) * (d.probability || 10) / 100, 0);

  const forecastData = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((m, i) => ({
    month: m,
    closed: wonDeals.filter(x => new Date(x.close_date).getMonth() === i).reduce((s, x) => s + Number(x.amount), 0),
    forecast: Math.round(openDeals.filter(x => new Date(x.close_date).getMonth() === i).reduce((s, x) => s + Number(x.amount) * (x.probability || 10) / 100, 0)),
    target: 150000,
  }));

  const srcData = (stats.sources || []).map(s => ({ name: (s.source || 'other').charAt(0).toUpperCase() + (s.source || 'other').slice(1), value: Number(s.count) }));

  return (
    <div className="animate-fade-in space-y-4">
      <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'forecast', label: 'Forecast' }, { id: 'team', label: 'Team performance' }]} active={tab} onChange={setTab} />

      {tab === 'overview' && <>
        <div className="grid grid-cols-4 gap-3">
          <KPI icon={DollarSign} label="Revenue" value={fmt$(wonVal)} accent="#10b981" trend={12} />
          <KPI icon={Briefcase} label="Avg deal" value={fmt$(avgDeal)} accent="#6366f1" />
          <KPI icon={Target} label="Close rate" value={`${winRate}%`} accent="#f59e0b" trend={5} />
          <KPI icon={Users} label="Contacts" value={stats.stages?.reduce((s, x) => s + Number(x.count), 0) || 0} accent="#3b82f6" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Card title="Revenue by month" subtitle="Closed-won">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={forecastData}>
                <defs><linearGradient id="rv" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.15} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="month" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} /><YAxis tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CTip />} /><Area type="monotone" dataKey="closed" stroke="#10b981" strokeWidth={2} fill="url(#rv)" name="Revenue" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Lead sources" subtitle="Where deals come from">
            <ResponsiveContainer width="100%" height={200}>
              <RPie><Pie data={srcData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value">{srcData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip content={<CTip />} /></RPie>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 justify-center">{srcData.map((s, i) => <div key={i} className="flex items-center gap-1 text-[10px] text-gray-400"><div className="w-2 h-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />{s.name}</div>)}</div>
          </Card>
        </div>
      </>}

      {tab === 'forecast' && <>
        <div className="grid grid-cols-3 gap-3">
          <KPI icon={DollarSign} label="Closed YTD" value={fmt$(wonVal)} accent="#10b981" />
          <KPI icon={TrendingUp} label="Forecast" value={fmt$(Math.round(pipeVal))} accent="#8b5cf6" />
          <KPI icon={Target} label="Pipeline" value={fmt$(openDeals.reduce((s, d) => s + Number(d.amount), 0))} accent="#6366f1" />
        </div>
        <Card title="Revenue forecast" subtitle="Closed vs forecast vs target">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={forecastData}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="month" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} /><YAxis tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip content={<CTip />} /><Bar dataKey="closed" fill="#10b981" radius={[3, 3, 0, 0]} name="Closed" /><Bar dataKey="forecast" fill="#8b5cf6" radius={[3, 3, 0, 0]} name="Forecast" /><Bar dataKey="target" fill="#f0f0f0" radius={[3, 3, 0, 0]} name="Target" /></BarChart>
          </ResponsiveContainer>
        </Card>
      </>}

      {tab === 'team' && <Card title="Team performance" subtitle="Win rate by rep">
        {team.map((t, i) => (
          <div key={i} className={`py-2.5 ${i < team.length - 1 ? 'border-b border-gray-50' : ''}`}>
            <div className="flex justify-between mb-1.5">
              <span className="text-xs font-semibold">{t.name}</span>
              <div className="flex gap-4 text-xs text-gray-400">
                <span>{t.total_leads} leads</span>
                <span className="font-semibold text-emerald-500">{t.won_leads} won</span>
                <span>{fmt$(t.won_value)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ProgressBar value={t.total_leads > 0 ? Math.round(t.won_leads / t.total_leads * 100) : 0} max={100} color={t.won_leads / Math.max(t.total_leads, 1) >= 0.3 ? '#10b981' : '#f59e0b'} height={8} />
              <span className="text-xs font-bold min-w-[36px]" style={{ color: t.won_leads / Math.max(t.total_leads, 1) >= 0.3 ? '#10b981' : '#f59e0b' }}>
                {t.total_leads > 0 ? Math.round(t.won_leads / t.total_leads * 100) : 0}%
              </span>
            </div>
          </div>
        ))}
      </Card>}
    </div>
  );
}
