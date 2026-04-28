import { useState, useEffect } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../../services/api';
import Card from '../../components/ui/Card';
import Tabs from '../../components/ui/Tabs';
import ProgressBar from '../../components/ui/ProgressBar';
import { fmt$, pct } from '../../utils/format';
import { MapPin, Leaf } from 'lucide-react';

const CTip = ({ active, payload, label }) => { if (!active || !payload?.length) return null; return <div className="bg-white border border-gray-100 rounded-lg px-3 py-2 shadow-md text-xs"><div className="font-semibold mb-1">{label}</div>{payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: <b>{typeof p.value === 'number' && p.value > 999 ? fmt$(p.value) : p.value}</b></div>)}</div>; };

export default function ReportsPage() {
  const [tab, setTab] = useState('revenue');
  const [stats, setStats] = useState({ stages: [], sources: [], regions: [] });
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { Promise.all([api.get('/leads/stats'), api.get('/reports/team')]).then(([s, t]) => { setStats(s.data); setTeam(t.data); }).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  const wonVal = (stats.stages || []).find(s => s.stage === 'won')?.total_value || 0;
  const co2 = Math.round(Number(wonVal) / 1850 * 4.5 * 365 * 0.8 * 0.098 / 1000 * 10) / 10;

  return (
    <div className="animate-fade-in space-y-4">
      <Tabs tabs={[{ id: 'revenue', label: 'Revenue' }, { id: 'funnel', label: 'Funnel' }, { id: 'regional', label: 'Regional' }, { id: 'environment', label: 'Environmental' }]} active={tab} onChange={setTab} />

      {tab === 'revenue' && <Card title="Pipeline stages" subtitle="Leads and value per stage">
        <div className="space-y-1.5">
          {(stats.stages || []).filter(s => Number(s.count) > 0).map(s => {
            const mx = Math.max(...(stats.stages || []).map(x => Number(x.count)), 1);
            return <div key={s.stage} className="flex items-center gap-2">
              <span className="w-16 text-[10px] text-gray-400 text-right">{s.stage}</span>
              <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden"><div className="h-full bg-amber-500 rounded flex items-center pl-1.5 min-w-[16px]" style={{ width: `${Number(s.count) / mx * 100}%` }}><span className="text-[8px] font-bold text-white">{s.count}</span></div></div>
              <span className="text-[10px] text-gray-400 min-w-[50px] text-right">{fmt$(s.total_value)}</span>
            </div>;
          })}
        </div>
      </Card>}

      {tab === 'funnel' && <Card title="Conversion funnel" subtitle="Lead progression">
        <div className="space-y-1">
          {(stats.stages || []).filter(s => s.stage !== 'lost').map((f, i) => {
            const mx = Math.max(...(stats.stages || []).map(x => Number(x.count)), 1);
            return <div key={i} className="flex items-center gap-2">
              <span className="w-16 text-[9px] text-gray-400 text-right">{f.stage}</span>
              <div className="flex-1 flex justify-center"><div className="h-5 rounded flex items-center justify-center border" style={{ width: `${Math.max(Number(f.count) / mx * 100, 10)}%`, background: '#6366f118', borderColor: '#6366f125' }}><span className="text-[10px] font-bold text-indigo-500">{f.count}</span></div></div>
            </div>;
          })}
        </div>
      </Card>}

      {tab === 'regional' && <div className="grid grid-cols-2 gap-3">
        <Card title="By region" subtitle="NZ spread">
          {(stats.regions || []).map((r, i) => {
            const mx = Math.max(...(stats.regions || []).map(x => Number(x.count)), 1);
            return <div key={i} className={`flex items-center gap-2 py-1 ${i < (stats.regions || []).length - 1 ? 'border-b border-gray-50' : ''}`}>
              <MapPin size={11} className="text-amber-500" /><span className="flex-1 text-xs">{r.location}</span>
              <div className="w-20"><ProgressBar value={Number(r.count)} max={mx} color="#f59e0b" /></div>
              <span className="text-xs font-semibold min-w-[16px] text-right">{r.count}</span>
            </div>;
          })}
        </Card>
        <Card title="Team performance" subtitle="Win rate">
          {team.map((t, i) => (
            <div key={i} className={`py-1.5 ${i < team.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="flex justify-between mb-1"><span className="text-xs font-semibold">{t.name}</span><span className="text-[10px] font-semibold" style={{ color: t.won_leads / Math.max(t.total_leads, 1) >= 0.3 ? '#10b981' : '#f59e0b' }}>{t.total_leads > 0 ? Math.round(t.won_leads / t.total_leads * 100) : 0}%</span></div>
              <ProgressBar value={t.total_leads > 0 ? Math.round(t.won_leads / t.total_leads * 100) : 0} max={100} color={t.won_leads / Math.max(t.total_leads, 1) >= 0.3 ? '#10b981' : '#f59e0b'} />
              <div className="text-[9px] text-gray-400 mt-0.5">{t.won_leads}/{t.total_leads} leads · {fmt$(t.won_value)}</div>
            </div>
          ))}
        </Card>
      </div>}

      {tab === 'environment' && <Card title="Environmental impact" subtitle="From won deals">
        <div className="grid grid-cols-4 gap-3">
          {[{ l: 'Capacity', v: `${Math.round(Number(wonVal) / 1850)}kW`, c: '#f59e0b' }, { l: 'Energy/yr', v: `${(Number(wonVal) / 1850 * 4.5 * 365 * 0.8 / 1000).toFixed(0)}MWh`, c: '#3b82f6' }, { l: 'CO₂/yr', v: `${co2}t`, c: '#059669' }, { l: 'Trees', v: Math.round(co2 * 40), c: '#16a34a' }].map((m, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold font-display" style={{ color: m.c }}>{m.v}</div>
              <div className="text-[9px] text-gray-400 uppercase mt-1">{m.l}</div>
            </div>
          ))}
        </div>
      </Card>}
    </div>
  );
}