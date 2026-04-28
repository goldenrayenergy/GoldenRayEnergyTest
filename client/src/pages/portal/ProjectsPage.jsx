import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { PROJECT_STAGES, stageIndex, stageCompletion } from '../../utils/stages';
import { useAuth } from '../../context/AuthContext';
import { fmt$ } from '../../utils/format';
import { Search, Briefcase, ChevronRight, Lock } from 'lucide-react';

function daysSince(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function ProjectCard({ project, onMove, onOpen, isAdmin }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const customerName = project.contacts?.name || '—';
  const days = daysSince(project.stage_entered_at);
  const stale = days >= 7;
  const currentIdx = stageIndex(project.stage);
  const completion = stageCompletion(project.stage, project.stage_progress);
  const forwardBlocked = !isAdmin && !completion.complete;
  const missingCount = completion.total - completion.done;

  const handleMove = async (e, newStage, override = false) => {
    e.stopPropagation();
    setMenuOpen(false);
    await onMove(project, newStage, override);
  };

  return (
    <div
      onClick={() => onOpen(project)}
      className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm hover:shadow-md hover:border-amber-200 cursor-pointer transition-all relative group"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[9px] font-mono font-semibold text-amber-600 tracking-wider">{project.code}</span>
        {stale && (
          <span className="text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
            {days}d
          </span>
        )}
      </div>

      <div className="text-sm font-bold text-gray-900 leading-tight truncate">{customerName}</div>
      <div className="text-[10px] text-gray-400 truncate">{project.address || 'No address'}</div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
        <div className="text-[10px] text-gray-500">
          {project.system_size_kw ? `${project.system_size_kw} kW` : '—'}
          {project.system_type && <span className="ml-1.5 text-gray-400">· {project.system_type}</span>}
        </div>
        <div className="text-xs font-extrabold text-gray-900">
          {project.estimated_value ? fmt$(project.estimated_value) : '—'}
        </div>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white text-[9px] font-bold flex items-center justify-center">
          {initials(project.users?.name) || '—'}
        </div>
        <div className="relative">
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
            className="text-[10px] font-semibold text-amber-600 hover:text-amber-700 px-1.5 py-0.5 rounded hover:bg-amber-50 flex items-center gap-0.5"
          >
            Move <ChevronRight size={10} />
          </button>
          {menuOpen && (
            <div
              onClick={e => e.stopPropagation()}
              className="absolute right-0 bottom-full mb-1 bg-white dark:bg-brand-dark-1 border border-gray-200 dark:border-white/10 rounded-lg shadow-lg py-1 z-10 w-52"
            >
              {forwardBlocked && (
                <div className="px-3 py-1.5 mb-1 text-[9px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-100 dark:border-amber-500/20 flex items-center gap-1">
                  <Lock size={10} /> {missingCount} required item{missingCount > 1 ? 's' : ''} left
                </div>
              )}
              {PROJECT_STAGES.filter(s => s.id !== project.stage).map(s => {
                const i = stageIndex(s.id);
                const isForwardMove = i > currentIdx;
                const blocked = isForwardMove && forwardBlocked;
                return (
                  <button
                    key={s.id}
                    disabled={blocked}
                    onClick={e => handleMove(e, s.id)}
                    title={blocked ? 'Complete required items first' : `Move to ${s.label}`}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-amber-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                  >
                    <span>{s.icon}</span>
                    <span className="flex-1">{s.label}</span>
                    {blocked && <Lock size={10} className="text-gray-300 dark:text-gray-500" />}
                  </button>
                );
              })}
              {forwardBlocked && isAdmin && PROJECT_STAGES[currentIdx + 1] && (
                <>
                  <div className="my-1 border-t border-gray-100 dark:border-white/10" />
                  <button
                    onClick={e => handleMove(e, PROJECT_STAGES[currentIdx + 1].id, true)}
                    className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400 font-semibold"
                  >
                    Admin: Force advance
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState('');

  useEffect(() => {
    api.get('/projects').then(r => setProjects(r.data)).finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? projects.filter(p => {
        const q = search.toLowerCase();
        return p.code?.toLowerCase().includes(q) ||
               p.address?.toLowerCase().includes(q) ||
               p.contacts?.name?.toLowerCase().includes(q) ||
               p.contacts?.email?.toLowerCase().includes(q);
      })
    : projects;

  const byStage = (stageId) => filtered.filter(p => p.stage === stageId);

  const moveStage = async (project, newStage, override = false) => {
    setMoving(project.id);
    try {
      const { data } = await api.patch(`/projects/${project.id}`, {
        stage: newStage,
        previous_stage: project.stage,
        override,
      });
      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, ...data } : p));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to move stage');
    } finally {
      setMoving('');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold font-display flex items-center gap-2">
            <Briefcase size={18} className="text-amber-500" />
            Projects
          </h2>
          <p className="text-[11px] text-gray-400">Lifecycle tracking from lead to maintenance.</p>
        </div>
        <div className="text-[11px] text-gray-400">{projects.length} total</div>
      </div>

      <div className="relative max-w-md">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects by code, customer, address..."
          className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-amber-400" />
      </div>

      {/* Kanban — horizontal scroll on narrow screens */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {PROJECT_STAGES.map(stage => {
          const items = byStage(stage.id);
          return (
            <div key={stage.id} className="bg-gray-50 rounded-xl border border-gray-100 p-2 min-h-[300px]">
              <div className="flex items-center justify-between px-1 py-1.5 mb-2 border-b border-gray-200">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{stage.icon}</span>
                  <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">{stage.label}</span>
                </div>
                <span className="text-[10px] font-bold text-gray-400 bg-white rounded px-1.5 py-0.5">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="text-[10px] text-gray-300 text-center py-6 italic">No projects</div>
                ) : (
                  items.map(p => (
                    <div key={p.id} className={moving === p.id ? 'opacity-50 pointer-events-none' : ''}>
                      <ProjectCard project={p} onMove={moveStage} onOpen={pr => nav(`/portal/projects/${pr.id}`)} isAdmin={isAdmin} />
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
