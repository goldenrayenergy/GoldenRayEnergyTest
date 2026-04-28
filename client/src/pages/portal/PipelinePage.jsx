import { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import Badge from '../../components/ui/Badge';
import { fmt$ } from '../../utils/format';
import { PIPE_STAGES } from '../../utils/constants';

export default function PipelinePage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get('/leads').then(r => setLeads(r.data)).finally(() => setLoading(false)); }, []);

  const move = async (id, stage) => {
    await api.patch(`/leads/${id}`, { stage });
    setLeads(p => p.map(l => l.id === id ? { ...l, stage } : l));
  };

  const grouped = useMemo(() => {
    const g = {}; PIPE_STAGES.forEach(s => g[s.id] = []); leads.forEach(l => { if (g[l.stage]) g[l.stage].push(l); }); return g;
  }, [leads]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="animate-fade-in flex gap-2 overflow-x-auto pb-2">
      {PIPE_STAGES.filter(s => s.id !== 'lost').map(stage => (
        <div key={stage.id} className="min-w-[185px] flex-shrink-0 bg-white rounded-xl border border-gray-100">
          <div className="px-2.5 py-2 border-b border-gray-100 flex justify-between items-center">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: stage.color }} />
              <span className="text-[10px] font-bold">{stage.label}</span>
            </div>
            <span className="text-[9px] text-gray-400 bg-gray-50 px-1.5 rounded">{grouped[stage.id].length}</span>
          </div>
          <div className="p-1.5 min-h-[60px]">
            {grouped[stage.id].map(l => (
              <div key={l.id} className="p-2 bg-gray-50 rounded-lg mb-1 border border-gray-100">
                <div className="text-[10px] font-semibold mb-0.5">{l.name}</div>
                <div className="text-[9px] text-gray-400 mb-1">{l.type} · {l.location}</div>
                {l.estimated_value && <div className="text-xs font-bold text-amber-500 mb-1">{fmt$(l.estimated_value)}</div>}
                <div className="flex gap-0.5 flex-wrap">
                  {PIPE_STAGES.filter(s => s.id !== l.stage && s.id !== 'lost').slice(0, 2).map(ns => (
                    <button key={ns.id} onClick={() => move(l.id, ns.id)}
                      className="text-[7px] px-1 rounded font-semibold" style={{ background: ns.color + '12', color: ns.color }}>
                      →{ns.label.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
