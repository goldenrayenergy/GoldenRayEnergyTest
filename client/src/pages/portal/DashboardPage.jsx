import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../../services/api';
import KPI from '../../components/ui/KPI';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { fmt$, fmtDate, pct } from '../../utils/format';
import { Briefcase, DollarSign, Target, TrendingUp, Megaphone, Phone, Mail, Users, Globe, ExternalLink } from 'lucide-react';

const CTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return <div className="bg-white border border-gray-100 rounded-lg px-3 py-2 shadow-md text-xs">
    <div className="font-semibold mb-1">{label}</div>
    {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: <b>{typeof p.value === 'number' && p.value > 999 ? fmt$(p.value) : p.value}</b></div>)}
  </div>;
};

export default function DashboardPage() {
  const [dash, setDash] = useState(null);
  const [deals, setDeals] = useState([]);
  const [activities, setActivities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [webLeads, setWebLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [d, dl, act, tk, wl] = await Promise.all([
        api.get('/reports/dashboard'), api.get('/deals'), api.get('/activities?limit=6'), api.get('/tasks'),
        api.get('/leads?source=website&stage=new&limit=5'),
      ]);
      setDash(d.data); setDeals(dl.data); setActivities(act.data); setTasks(tk.data); setWebLeads(wl.data || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const completeTask = async (id) => {
    await api.patch(`/tasks/${id}`, { status: 'completed' });
    setTasks(p => p.map(t => t.id === id ? { ...t, status: 'completed' } : t));
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  const c = dash?.contacts || {}; const d = dash?.deals || {}; const cm = dash?.campaigns || {};
  const openDeals = deals.filter(x => !['closed_won', 'closed_lost'].includes(x.stage));
  const wonDeals = deals.filter(x => x.stage === 'closed_won');
  const pipelineVal = openDeals.reduce((s, x) => s + Number(x.amount || 0), 0);
  const wonVal = wonDeals.reduce((s, x) => s + Number(x.amount || 0), 0);
  const winRate = wonDeals.length + deals.filter(x => x.stage === 'closed_lost').length > 0
    ? Math.round(wonDeals.length / (wonDeals.length + deals.filter(x => x.stage === 'closed_lost').length) * 100) : 0;
  const roi = Number(cm.spent) > 0 ? Math.round((Number(cm.revenue || 0) - Number(cm.spent)) / Number(cm.spent) * 100) : 0;

  const forecastData = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((m, i) => ({
    month: m,
    closed: wonDeals.filter(x => new Date(x.close_date).getMonth() === i).reduce((s, x) => s + Number(x.amount), 0),
    forecast: openDeals.filter(x => new Date(x.close_date).getMonth() === i).reduce((s, x) => s + Number(x.amount) * (x.probability || 10) / 100, 0),
  }));

  return (
    <div className="animate-fade-in space-y-4">
      <div className="grid grid-cols-5 gap-3">
        <KPI icon={Briefcase} label="Open deals" value={openDeals.length} sub={fmt$(pipelineVal)} accent="#6366f1" trend={8} />
        <KPI icon={DollarSign} label="Won revenue" value={fmt$(wonVal)} sub={`${wonDeals.length} deals`} accent="#10b981" trend={12} />
        <KPI icon={Target} label="Win rate" value={`${winRate}%`} accent="#f59e0b" trend={5} />
        <KPI icon={TrendingUp} label="Forecast" value={fmt$(Math.round(openDeals.reduce((s, x) => s + Number(x.amount) * (x.probability || 10) / 100, 0)))} sub="Weighted" accent="#8b5cf6" />
        <KPI icon={Megaphone} label="Campaign ROI" value={`${roi}%`} sub={fmt$(cm.revenue || 0)} accent="#3b82f6" trend={18} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card title="Revenue & forecast" subtitle="Closed vs projected" className="col-span-2">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={forecastData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CTip />} />
              <Bar dataKey="closed" fill="#10b981" radius={[3, 3, 0, 0]} name="Closed" />
              <Bar dataKey="forecast" fill="#8b5cf620" stroke="#8b5cf6" strokeDasharray="3 3" radius={[3, 3, 0, 0]} name="Forecast" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Pipeline" subtitle="Deals by stage">
          {(dash?.pipeline || []).filter(s => s.stage !== 'closed_lost').map(s => (
            <div key={s.stage} className="flex items-center gap-2 mb-1.5">
              <span className="w-14 text-[9px] text-gray-400 text-right truncate">{s.stage.replace('_', ' ')}</span>
              <div className="flex-1 h-3.5 bg-gray-100 rounded overflow-hidden">
                <div className="h-full bg-indigo-500 rounded" style={{ width: `${Math.max(Number(s.count) * 15, 4)}%` }} />
              </div>
              <span className="text-[9px] text-gray-400 min-w-[40px] text-right">{s.count}·{fmt$(s.value)}</span>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card title="Recent activity" subtitle="Latest actions">
          {activities.slice(0, 5).map((a, i) => (
            <div key={a.id} className={`flex gap-2 py-1.5 ${i < 4 ? 'border-b border-gray-50' : ''}`}>
              <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${a.type === 'call' ? 'bg-blue-50' : a.type === 'email' ? 'bg-amber-50' : 'bg-purple-50'}`}>
                {a.type === 'call' ? <Phone size={10} className="text-blue-500" /> : a.type === 'email' ? <Mail size={10} className="text-amber-500" /> : <Users size={10} className="text-purple-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold truncate">{a.description}</div>
                <div className="text-[9px] text-gray-400">{a.user_name?.split(' ')[0]} · {fmtDate(a.created_at)}</div>
              </div>
            </div>
          ))}
        </Card>
        <Card title="New website leads" subtitle="Source: website form">
          {webLeads.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No new website leads yet.</p>
          ) : webLeads.map((lead, i) => (
            <div key={lead.id} className={`flex items-center gap-2 py-1.5 ${i < webLeads.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="w-6 h-6 rounded-md bg-amber-50 flex items-center justify-center flex-shrink-0">
                <Globe size={10} className="text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold truncate">{lead.name}</div>
                <div className="text-[9px] text-gray-400 truncate">
                  {lead.monthly_bill ? `$${lead.monthly_bill}/mo · ` : ''}{lead.location || lead.email || 'No contact info'}
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[8px] font-bold text-amber-600 bg-amber-50 rounded px-1 py-0.5">Score {lead.lead_score || 0}</span>
                <span className="text-[8px] text-gray-300">{fmtDate(lead.created_at)}</span>
              </div>
            </div>
          ))}
          {webLeads.length > 0 && (
            <a href="/portal/leads" className="flex items-center gap-1 mt-2 text-[9px] text-amber-600 hover:text-amber-700 font-medium">
              <ExternalLink size={9} /> View all leads
            </a>
          )}
        </Card>
        <Card title="Tasks due" subtitle="Upcoming">
          {tasks.filter(t => t.status !== 'completed').slice(0, 5).map((t, i) => {
            const overdue = new Date(t.due_date) < new Date() && t.status !== 'completed';
            return (
              <div key={t.id} className={`flex items-center gap-2 py-1.5 ${i < 4 ? 'border-b border-gray-50' : ''}`}>
                <button onClick={() => completeTask(t.id)}
                  className={`w-3.5 h-3.5 rounded border-2 flex-shrink-0 ${t.priority === 'high' ? 'border-red-400' : 'border-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-semibold truncate">{t.title}</div>
                  <div className={`text-[9px] ${overdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                    {t.assignee_name?.split(' ')[0]} · {fmtDate(t.due_date)}{overdue ? ' OVERDUE' : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
