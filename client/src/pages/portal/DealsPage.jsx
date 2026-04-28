import { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import KPI from '../../components/ui/KPI';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { fmt$, fmtDate, fmtDateLong } from '../../utils/format';
import { DEAL_STAGES } from '../../utils/constants';
import Button from '../../components/ui/Button';
import { NewDealModal, confirmDelete } from '../../components/portal/CreateModals';
import { Briefcase, DollarSign, Target, TrendingUp, Plus, Pencil, Trash2 } from 'lucide-react';

export default function DealsPage() {
  const [deals, setDeals] = useState([]);
  const [selDeal, setSelDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [editDeal, setEditDeal] = useState(null);

  useEffect(() => { api.get('/deals').then(r => setDeals(r.data)).finally(() => setLoading(false)); }, []);

  const moveDeal = async (id, stage) => {
    await api.patch(`/deals/${id}`, { stage });
    setDeals(p => p.map(d => d.id === id ? { ...d, stage } : d));
    if (selDeal?.id === id) setSelDeal(p => ({ ...p, stage }));
  };

  const handleSaved = (d) => { setDeals(p => p.map(x => x.id === d.id ? { ...x, ...d } : x)); setSelDeal(null); setEditDeal(null); };
  const handleDelete = async (d) => {
    if (await confirmDelete({ url: '/deals', id: d.id, label: `deal "${d.name}"` })) {
      setDeals(p => p.filter(x => x.id !== d.id));
      setSelDeal(null);
    }
  };

  const openDeals = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage));
  const wonDeals = deals.filter(d => d.stage === 'closed_won');
  const lostDeals = deals.filter(d => d.stage === 'closed_lost');
  const pipelineVal = openDeals.reduce((s, d) => s + Number(d.amount || 0), 0);
  const wonVal = wonDeals.reduce((s, d) => s + Number(d.amount || 0), 0);
  const winRate = wonDeals.length + lostDeals.length > 0 ? Math.round(wonDeals.length / (wonDeals.length + lostDeals.length) * 100) : 0;
  const weighted = openDeals.reduce((s, d) => s + Number(d.amount || 0) * (d.probability || 10) / 100, 0);

  const dealsByStage = useMemo(() => {
    const g = {}; DEAL_STAGES.forEach(s => { g[s.id] = []; }); deals.forEach(d => { if (g[d.stage]) g[d.stage].push(d); }); return g;
  }, [deals]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold font-display">Deals</h2>
          <p className="text-[11px] text-gray-400">Track and close opportunities across your pipeline.</p>
        </div>
        <Button icon={Plus} onClick={() => setNewOpen(true)}>New Deal</Button>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <KPI icon={Briefcase} label="Open pipeline" value={fmt$(pipelineVal)} sub={`${openDeals.length} deals`} accent="#6366f1" />
        <KPI icon={DollarSign} label="Closed won" value={fmt$(wonVal)} sub={`${wonDeals.length} deals`} accent="#10b981" />
        <KPI icon={Target} label="Win rate" value={`${winRate}%`} accent="#f59e0b" />
        <KPI icon={TrendingUp} label="Weighted" value={fmt$(Math.round(weighted))} accent="#8b5cf6" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {DEAL_STAGES.filter(s => s.id !== 'closed_lost').map(stage => {
          const stDeals = dealsByStage[stage.id] || [];
          const stVal = stDeals.reduce((s, d) => s + Number(d.amount || 0), 0);
          return (
            <div key={stage.id} className="min-w-[195px] flex-shrink-0 bg-white rounded-xl border border-gray-100">
              <div className="px-3 py-2 border-b border-gray-100 flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: stage.color }} />
                  <span className="text-[10px] font-bold">{stage.label}</span>
                </div>
                <span className="text-[9px] text-gray-400 bg-gray-50 px-1.5 rounded">{stDeals.length}</span>
              </div>
              <div className="p-1.5 min-h-[60px]">
                {stDeals.map(d => (
                  <div key={d.id} onClick={() => setSelDeal(d)}
                    className="p-2 bg-gray-50 rounded-lg mb-1 border border-gray-100 cursor-pointer hover:bg-indigo-50/50 transition">
                    <div className="text-[10px] font-semibold mb-0.5">{d.name}</div>
                    <div className="text-[9px] text-gray-400 mb-1">{d.owner_name || 'Unassigned'}</div>
                    <div className="text-xs font-bold mb-1" style={{ color: stage.color }}>{fmt$(d.amount)}</div>
                    <div className="text-[8px] text-gray-300">{fmtDate(d.close_date)}</div>
                    <div className="flex gap-0.5 mt-1 flex-wrap">
                      {DEAL_STAGES.filter(s => s.id !== d.stage && s.id !== 'closed_lost').slice(0, 2).map(ns => (
                        <button key={ns.id} onClick={e => { e.stopPropagation(); moveDeal(d.id, ns.id); }}
                          className="text-[7px] px-1 rounded font-semibold" style={{ background: ns.color + '12', color: ns.color }}>
                          →{ns.label.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <NewDealModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={d => setDeals(p => [d, ...p])} />
      <NewDealModal open={!!editDeal} onClose={() => setEditDeal(null)} initial={editDeal} onSaved={handleSaved} />

      <Modal open={!!selDeal} onClose={() => setSelDeal(null)} title={selDeal?.name}>
        {selDeal && (
          <div>
            <div className="flex flex-wrap gap-1 mb-4">
              {DEAL_STAGES.map(ps => (
                <button key={ps.id} onClick={() => moveDeal(selDeal.id, ps.id)}
                  className="px-2 py-0.5 rounded text-[9px] font-semibold"
                  style={{ background: selDeal.stage === ps.id ? ps.color + '20' : '#f5f5f5', color: selDeal.stage === ps.id ? ps.color : '#888' }}>
                  {ps.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1">
              {[['Amount', fmt$(selDeal.amount)], ['Owner', selDeal.owner_name || '—'], ['Close date', fmtDateLong(selDeal.close_date)],
                ['Type', selDeal.deal_type], ['Priority', selDeal.priority], ['Probability', `${selDeal.probability || 0}%`]
              ].map(([l, v], i) => (
                <div key={i} className="text-xs text-gray-400 py-1 border-b border-gray-50">
                  <b className="text-gray-900">{l}:</b> {v}
                </div>
              ))}
            </div>
            {selDeal.notes && <div className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg p-3"><b className="text-gray-700">Notes:</b> {selDeal.notes}</div>}
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
              <button onClick={() => handleDelete(selDeal)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition">
                <Trash2 size={13} /> Delete
              </button>
              <Button icon={Pencil} onClick={() => { setEditDeal(selDeal); setSelDeal(null); }}>Edit</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
