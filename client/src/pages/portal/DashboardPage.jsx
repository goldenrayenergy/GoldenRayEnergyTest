import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../../services/api';
import KPI from '../../components/ui/KPI';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { fmt$, fmtDate, pct } from '../../utils/format';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Briefcase, DollarSign, Target, TrendingUp, Megaphone, Phone, Mail, Users, Globe, ExternalLink, AlertTriangle, Clock, EyeOff, Sun, FileCheck2, MessageCircle, CheckCircle, BarChart3 } from 'lucide-react';

const CTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return <div className="bg-white border border-gray-100 rounded-lg px-3 py-2 shadow-md text-xs">
    <div className="font-semibold mb-1">{label}</div>
    {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: <b>{typeof p.value === 'number' && p.value > 999 ? fmt$(p.value) : p.value}</b></div>)}
  </div>;
};

function RiskGroup({ title, icon: Icon, color, items }) {
  const tone = {
    red:    { bg: 'bg-white dark:bg-brand-dark-1 border-red-200',    title: 'text-red-700 dark:text-red-300',    hover: 'hover:bg-red-50 dark:hover:bg-red-500/10' },
    amber:  { bg: 'bg-white dark:bg-brand-dark-1 border-amber-200',  title: 'text-amber-700 dark:text-amber-300', hover: 'hover:bg-amber-50 dark:hover:bg-amber-500/10' },
    violet: { bg: 'bg-white dark:bg-brand-dark-1 border-violet-200', title: 'text-violet-700 dark:text-violet-300', hover: 'hover:bg-violet-50 dark:hover:bg-violet-500/10' },
  }[color] || { bg: 'bg-white border-gray-200', title: 'text-gray-700', hover: 'hover:bg-gray-50' };
  return (
    <div className={`rounded-lg border ${tone.bg} p-2.5`}>
      <div className={`flex items-center gap-1.5 text-[11px] font-bold ${tone.title} mb-1`}>
        <Icon size={11} /> {title}
      </div>
      <ul className="space-y-0.5">
        {items.slice(0, 4).map(it => {
          // Skip items missing a usable target — better than a broken link.
          if (!it.id) {
            return (
              <li key={it.label} className="text-[11px] text-gray-400 dark:text-gray-500 italic px-1.5 py-1">
                {it.label} (orphaned)
              </li>
            );
          }
          return (
            <li key={it.id}>
              <Link
                to={`/portal/projects/${it.id}`}
                className={`block w-full text-[11px] text-gray-700 dark:text-gray-200 px-1.5 py-1 rounded ${tone.hover} truncate`}
                title={`Open ${it.label}`}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
        {items.length > 4 && <li className="text-[10px] text-gray-400 italic px-1.5">+ {items.length - 4} more</li>}
      </ul>
    </div>
  );
}

// Compact "what you should do today" feed for the logged-in user.
function TodaysQueueCard({ tasks, userName }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toISOString().slice(0, 10);
  const todayTasks    = tasks.filter(t => t.due_date === todayStr);
  const overdueTasks  = tasks.filter(t => t.due_date && t.due_date < todayStr);
  const total = todayTasks.length + overdueTasks.length;
  const ICON = { call: Phone, email: Mail, meeting: Users, survey: Sun, proposal: FileCheck2, admin: CheckCircle, report: BarChart3 };
  const pColor = (p) => p === 'high' ? 'text-red-600' : p === 'low' ? 'text-gray-400' : 'text-amber-600';

  return (
    <Card title={`Today's queue${userName ? ` · ${userName.split(' ')[0]}` : ''}`} subtitle={total === 0 ? 'Inbox zero — well done' : `${total} item${total > 1 ? 's' : ''}: ${overdueTasks.length} overdue, ${todayTasks.length} due today`} className="col-span-1 lg:col-span-2">
      {total === 0 ? (
        <div className="py-6 text-center text-xs text-gray-400 italic">No calls, meetings, or follow-ups scheduled for today.</div>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {[...overdueTasks, ...todayTasks].slice(0, 12).map(t => {
            const Icon = ICON[t.task_type] || CheckCircle;
            const isOverdue = overdueTasks.includes(t);
            return (
              <li key={t.id}>
                <Link
                  to={t.project_id ? `/portal/projects/${t.project_id}` : '#'}
                  className={`flex items-start gap-2 p-2 rounded-md text-xs hover:bg-gray-50 dark:hover:bg-white/5 ${isOverdue ? 'bg-red-50 dark:bg-red-500/10' : ''}`}
                >
                  <Icon size={13} className={`flex-shrink-0 mt-0.5 ${pColor(t.priority)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-700 dark:text-gray-200 truncate">{t.title}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {isOverdue && <span className="text-red-600 font-bold">OVERDUE · </span>}
                      {t.task_type} · {t.priority} priority
                      {t.project?.code && <span> · <span className="text-amber-600">{t.project.code}</span></span>}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
          {total > 12 && <li className="text-[10px] text-gray-400 italic px-2">+ {total - 12} more</li>}
        </ul>
      )}
    </Card>
  );
}

// Stacked-bar of open project counts per sales user, segmented by stage.
function TeamWorkloadCard({ team }) {
  const STAGE_COLORS = { new: '#9ca3af', design: '#3b82f6', selling: '#f59e0b', installation: '#f97316', maintenance: '#10b981' };
  const STAGE_ORDER  = ['new', 'design', 'selling', 'installation', 'maintenance'];
  const max = team.length > 0 ? Math.max(...team.map(t => t.total)) : 0;

  return (
    <Card title="Team workload" subtitle={team.length === 0 ? 'No active projects assigned' : `${team.reduce((s, t) => s + t.total, 0)} active across ${team.length} ${team.length === 1 ? 'rep' : 'reps'}`}>
      {team.length === 0 ? (
        <div className="py-6 text-center text-xs text-gray-400 italic">Assign owners to active projects to see workload here.</div>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {team.map(t => (
            <li key={t.id}>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-semibold text-gray-700 dark:text-gray-200 truncate">{t.name}</span>
                <span className="text-gray-500 dark:text-gray-400 font-bold">{t.total}</span>
              </div>
              <div className="flex h-2.5 rounded overflow-hidden bg-gray-100 dark:bg-white/5">
                {STAGE_ORDER.map(s => {
                  const c = t.stages[s] || 0;
                  if (c === 0) return null;
                  const pct = (c / max) * 100;
                  return <div key={s} title={`${s}: ${c}`} style={{ width: `${pct}%`, background: STAGE_COLORS[s] }} />;
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-gray-100 dark:border-white/10 text-[9px]">
        {STAGE_ORDER.map(s => (
          <span key={s} className="inline-flex items-center gap-1 text-gray-500">
            <span className="w-2 h-2 rounded" style={{ background: STAGE_COLORS[s] }} /> {s}
          </span>
        ))}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [dash, setDash] = useState(null);
  const [deals, setDeals] = useState([]);
  const [activities, setActivities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [webLeads, setWebLeads] = useState([]);
  const [atRisk, setAtRisk] = useState({ slaOverdue: [], stuckInStage: [], ghostedProposals: [] });
  const [extras, setExtras] = useState({ todaysQueue: [], teamWorkload: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAll();
    // Refetch when the tab regains focus, covering the common pattern where
    // the manager navigates to a project, takes an action, then comes back.
    const onFocus = () => loadAll();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const loadAll = async () => {
    try {
      const [d, dl, act, tk, wl, ar, ex] = await Promise.all([
        api.get('/reports/dashboard'), api.get('/deals'), api.get('/activities?limit=6'), api.get('/tasks'),
        api.get('/leads?source=website&stage=new&limit=5'),
        api.get('/reports/at-risk').catch(() => ({ data: { slaOverdue: [], stuckInStage: [], ghostedProposals: [] } })),
        api.get('/reports/dashboard-extras').catch(() => ({ data: { todaysQueue: [], teamWorkload: [] } })),
      ]);
      setDash(d.data); setDeals(dl.data); setActivities(act.data); setTasks(tk.data); setWebLeads(wl.data || []);
      setAtRisk(ar.data || { slaOverdue: [], stuckInStage: [], ghostedProposals: [] });
      setExtras(ex.data || { todaysQueue: [], teamWorkload: [] });
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

  const totalAtRisk = atRisk.slaOverdue.length + atRisk.stuckInStage.length + atRisk.ghostedProposals.length;

  return (
    <div className="animate-fade-in space-y-4">
      {/* At-risk projects banner — shows the manager what needs intervention.
          Only renders when there's at least one at-risk item. */}
      {totalAtRisk > 0 && (
        <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-500/10 dark:to-orange-500/10 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
            <h3 className="text-sm font-bold text-red-800 dark:text-red-200">{totalAtRisk} project{totalAtRisk > 1 ? 's' : ''} need attention</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {atRisk.slaOverdue.length > 0 && (
              <RiskGroup title={`${atRisk.slaOverdue.length} lead${atRisk.slaOverdue.length > 1 ? 's' : ''} overdue for first call`} icon={Phone} color="red" items={atRisk.slaOverdue.map(p => ({
                id: p.id, code: p.code, label: `${p.contacts?.name || 'Unknown'} · ${p.users?.name || 'unassigned'}`,
              }))} />
            )}
            {atRisk.stuckInStage.length > 0 && (
              <RiskGroup title={`${atRisk.stuckInStage.length} project${atRisk.stuckInStage.length > 1 ? 's' : ''} stuck in stage`} icon={Clock} color="amber" items={atRisk.stuckInStage.map(p => ({
                id: p.id, code: p.code,
                label: `${p.code} · ${p.stage} · ${Math.floor((Date.now() - new Date(p.stage_entered_at).getTime()) / 86400000)}d`,
              }))} />
            )}
            {atRisk.ghostedProposals.length > 0 && (
              <RiskGroup title={`${atRisk.ghostedProposals.length} proposal${atRisk.ghostedProposals.length > 1 ? 's' : ''} sent but never viewed`} icon={EyeOff} color="violet" items={atRisk.ghostedProposals.map(p => ({
                id: p.project_id, code: 'v' + (p.version || 1),
                label: `${p.contact?.name || 'Unknown'} · ${Math.floor((Date.now() - new Date(p.sent_at).getTime()) / 86400000)}d ago`,
              }))} />
            )}
          </div>
        </div>
      )}

      {/* Today's queue + Team workload — surface what each user should do
          today and how work is distributed across the sales team. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <TodaysQueueCard tasks={extras.todaysQueue} userName={user?.name} />
        <TeamWorkloadCard team={extras.teamWorkload} />
      </div>

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
