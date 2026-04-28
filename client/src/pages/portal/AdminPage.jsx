import { useState, useEffect } from 'react';
import api from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { ROLES } from '../../utils/constants';

export default function AdminPage() {
  const [config, setConfig] = useState({});
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/config/solar-pricing'), api.get('/auth/users')])
      .then(([c, u]) => { setConfig(c.data); setUsers(u.data); })
      .finally(() => setLoading(false));
  }, []);

  const updateConfig = (key, value) => setConfig(p => ({ ...p, [key]: Number(value) }));
  const saveConfig = async () => { await api.put('/config/solar-pricing', config); alert('Saved!'); };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="animate-fade-in space-y-4">
      <Card title="Pricing configuration" subtitle="Solar system pricing" action={<Button size="sm" onClick={saveConfig}>Save</Button>}>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          {[['Cost/kW', 'costPerKw', 'NZD'], ['Battery', 'batteryCostPerKwh', 'NZD'], ['GST', 'taxRate', '%'], ['Markup', 'markup', '%'], ['Elec rate', 'defaultElecRate', '$/kWh'], ['Labor', 'laborPct', '%']].map(([l, k, s]) => (
            <div key={k}>
              <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1">{l}</label>
              <div className="relative">
                <input type="number" value={config[k] || ''} onChange={e => updateConfig(k, e.target.value)}
                  className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg text-sm outline-none focus:border-amber-400" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-300">{s}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Team" subtitle="Employees">
        {users.map(u => {
          const r = ROLES[u.role] || { label: u.role, color: '#888' };
          return (
            <div key={u.id} className="flex items-center gap-3 py-2 border-b border-gray-50">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ background: r.color + '12', color: r.color }}>{u.avatar || u.name?.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
              <div className="flex-1"><div className="text-xs font-semibold">{u.name}</div><div className="text-[10px] text-gray-400">{u.email}</div></div>
              <Badge color={r.color}>{r.label}</Badge>
            </div>
          );
        })}
      </Card>
    </div>
  );
}