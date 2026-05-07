import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import Badge from '../../components/ui/Badge';
import { fmt$ } from '../../utils/format';
import { PIPE_STAGES } from '../../utils/constants';
import { Rocket } from 'lucide-react';

// Stages where the "Promote to Project" button shows up. Sales reps must
// have at least qualified the lead before an operational project starts.
const PROMOTABLE_STAGES = new Set(['qualified', 'survey', 'proposal_gen', 'proposal_sent', 'followup', 'negotiation']);

export default function PipelinePage() {
  const nav = useNavigate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(null);    // contact id being promoted
  const [toast, setToast] = useState(null);             // {kind, msg}

  const load = () => api.get('/leads').then(r => setLeads(r.data)).finally(() => setLoading(false));

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const move = async (id, stage) => {
    await api.patch(`/leads/${id}`, { stage });
    setLeads(p => p.map(l => l.id === id ? { ...l, stage } : l));
  };

  const promoteToProject = async (lead) => {
    if (!confirm(`Promote "${lead.name}" to an operational project?\n\nThis creates a project record and the design team picks it up from there.`)) return;
    setPromoting(lead.id);
    try {
      const { data } = await api.post(`/leads/${lead.id}/promote-to-project`);
      setToast({ kind: 'ok', msg: `Project ${data.code || ''} created${data.owner_name ? ` · assigned to ${data.owner_name}` : ''}` });
      load();
      setTimeout(() => nav(`/portal/projects/${data.id}`), 800);
    } catch (e) {
      const r = e.response?.data;
      if (e.response?.status === 409 && r?.projectId) {
        setToast({ kind: 'info', msg: `Already has project ${r.projectCode || ''} — opening…` });
        setTimeout(() => nav(`/portal/projects/${r.projectId}`), 800);
      } else {
        setToast({ kind: 'err', msg: r?.error || 'Promotion failed' });
      }
    } finally {
      setPromoting(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const grouped = useMemo(() => {
    const g = {}; PIPE_STAGES.forEach(s => g[s.id] = []); leads.forEach(l => { if (g[l.stage]) g[l.stage].push(l); }); return g;
  }, [leads]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  return (
    <>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-xs font-semibold animate-fade-in
          ${toast.kind === 'ok'   ? 'bg-emerald-500 text-white'
          : toast.kind === 'info' ? 'bg-blue-500 text-white'
                                  : 'bg-red-500 text-white'}`}>
          {toast.msg}
        </div>
      )}
      <div className="animate-fade-in flex gap-2 overflow-x-auto pb-2">
        {PIPE_STAGES.filter(s => s.id !== 'lost').map(stage => (
          <div key={stage.id} className="min-w-[195px] flex-shrink-0 bg-white rounded-xl border border-gray-100">
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
                    {PROMOTABLE_STAGES.has(l.stage) && (
                      <button
                        onClick={() => promoteToProject(l)}
                        disabled={promoting === l.id}
                        title="Promote to operational project"
                        className="text-[7px] px-1 rounded font-bold flex items-center gap-0.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Rocket size={7} />
                        {promoting === l.id ? '…' : 'Project'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
