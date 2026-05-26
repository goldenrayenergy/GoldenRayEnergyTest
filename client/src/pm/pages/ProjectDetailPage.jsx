import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pmProjectsAPI } from '../services/pmApi';
import { fmtDateLong } from '../../utils/format';
import ItemPanel from '../components/ItemPanel';
import { SkeletonProjectDetail, LoadError } from '../components/LoadingSkeletons';

const LANES = ['sales', 'engineering', 'compliance', 'operations', 'finance'];

// Static class strings — Tailwind JIT only picks up fully-written class names,
// so we cannot do `bg-${color}-50` dynamically.
const LANE_META = {
  sales:       { label: 'Sales',       headerBg: 'bg-amber-50',   desc: 'Lead → proposal → contract → deposit' },
  engineering: { label: 'Engineering', headerBg: 'bg-sky-50',     desc: 'Survey → design → SLD → simulation → BOM' },
  compliance:  { label: 'Compliance',  headerBg: 'bg-purple-50',  desc: 'Distributor → council → meter → COC' },
  operations:  { label: 'Operations',  headerBg: 'bg-emerald-50', desc: 'Materials → install → commissioning → handover' },
  finance:     { label: 'Finance',     headerBg: 'bg-rose-50',    desc: 'Deposit → progress → final → invoicing' },
};

const LANE_STATUS_STYLES = {
  not_started: 'bg-slate-100 text-slate-600 border-slate-200',
  in_progress: 'bg-blue-100 text-blue-800 border-blue-200',
  blocked:     'bg-red-100 text-red-800 border-red-200',
  done:        'bg-green-100 text-green-800 border-green-200',
};

const HEALTH_STYLES = {
  green:   'bg-green-100 text-green-800 border-green-200',
  amber:   'bg-amber-100 text-amber-800 border-amber-200',
  red:     'bg-red-100 text-red-800 border-red-200',
  blocked: 'bg-slate-300 text-slate-900 border-slate-400',
};

const TYPE_LABELS = {
  residential_rooftop: 'Residential rooftop',
  commercial: 'Commercial',
  ground_mount: 'Ground mount',
  battery_addon: 'Battery add-on',
  system_upgrade: 'System upgrade',
};

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState(null);

  // Currently-open item panel: { lane, itemDef } or null
  const [openItem, setOpenItem] = useState(null);

  function load() {
    setLoading(true);
    pmProjectsAPI.get(id)
      .then(r => { setProject(r.data); setLoading(false); })
      .catch(e => { setError(e.response?.data?.error || e.message); setLoading(false); });
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function setLaneStatus(lane, status, blockedReason) {
    setBusyKey(`${lane}.status`);
    setError('');
    try {
      await pmProjectsAPI.updateLane(id, lane, { status, blocked_reason: blockedReason });
      load();
    } catch (e) {
      const data = e.response?.data;
      setError(data?.error + (data?.done !== undefined ? ` (${data.done}/${data.total} gate-keepers complete)` : ''));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading && !project) return <SkeletonProjectDetail />;
  if (!project) return <LoadError error={error || 'Project not found.'} onRetry={load} title="Couldn't load this project" />;

  const { lane_status: laneStatus, lane_completion: completion, checklist } = project;

  return (
    <div>
      <div className="mb-6">
        <Link to="/pm" className="text-sm text-slate-500 hover:text-slate-800">← all projects</Link>
        <div className="flex items-start justify-between mt-2 gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900 font-mono">{project.code}</h1>
              <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium uppercase ${HEALTH_STYLES[project.health] || ''}`}>
                {project.health}
              </span>
              <span className="text-xs text-slate-500 capitalize">{project.status?.replace('_', ' ')}</span>
            </div>
            <p className="text-sm text-slate-600 mt-1">
              {TYPE_LABELS[project.project_type] || project.project_type}
              {project.contacts?.name && <> · {project.contacts.name}</>}
            </p>
            {project.address && <p className="text-xs text-slate-500 mt-0.5">{project.address}{project.suburb ? `, ${project.suburb}` : ''}{project.city ? `, ${project.city}` : ''}</p>}
            <p className="text-xs text-slate-400 mt-1">Created {fmtDateLong(project.created_at)}</p>
          </div>
          <div className="flex flex-col gap-2 text-right">
            <SystemCard project={project} />
            <ProposalDownloadButtons projectId={project.id} hasBill={!!project.bill_analysis_id} />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {LANES.map(lane => {
          const meta = LANE_META[lane];
          const state = laneStatus?.[lane] || { status: 'not_started', items: {} };
          const items = checklist?.[lane] || [];
          const comp = completion?.[lane] || { gate_keepers_done: 0, gate_keepers_total: 0, complete: false };
          return (
            <div key={lane} className="bg-white border border-slate-200 rounded-lg flex flex-col">
              <div className={`px-3 py-2 border-b border-slate-200 ${meta.headerBg}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm text-slate-800 uppercase tracking-wide">{meta.label}</h3>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase ${LANE_STATUS_STYLES[state.status] || ''}`}>
                    {(state.status || 'not_started').replace('_', ' ')}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{meta.desc}</p>
                <div className="text-[11px] text-slate-600 mt-1">
                  Gate-keepers: <strong>{comp.gate_keepers_done}/{comp.gate_keepers_total}</strong>
                </div>
              </div>

              <div className="flex-1 p-2 space-y-1">
                {items.map(it => {
                  const checked    = state.items?.[it.key] === true;
                  const itemMeta   = state.item_meta?.[it.key];
                  const itemArts   = (project.artifacts || []).filter(a => a.swim_lane === lane && a.metadata?.item_key === it.key);
                  const hasNotes   = itemMeta?.notes && itemMeta.notes.length > 0;
                  const itemBlock  = project.task_blockers?.[lane]?.[it.key];
                  const lockedByUpstream = !checked && (itemBlock?.cross_lane_blockers?.length || 0) > 0;
                  const itemState  = itemMeta?.state || it.initialState || 'not_started';
                  const inFlight   = !checked && itemState !== (it.initialState || 'not_started');
                  return (
                    <button
                      key={it.key}
                      onClick={() => setOpenItem({ lane, itemDef: it })}
                      className={`w-full text-left px-2 py-1.5 rounded border transition-colors group ${
                        checked
                          ? 'bg-green-50 border-green-200 hover:bg-green-100'
                          : lockedByUpstream
                            ? 'bg-slate-50 border-slate-200 hover:border-slate-300 opacity-75'
                            : inFlight
                              ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                              : 'bg-white border-slate-200 hover:border-amber-300 hover:bg-amber-50'
                      }`}>
                      <div className="flex items-start gap-2">
                        <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          checked ? 'bg-green-600 border-green-600' : lockedByUpstream ? 'bg-slate-200 border-slate-300' : 'border-slate-300 group-hover:border-amber-500'
                        }`}>
                          {checked && <span className="text-white text-[10px] leading-none">✓</span>}
                          {!checked && lockedByUpstream && <span className="text-slate-500 text-[10px] leading-none">🔒</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs leading-tight ${checked ? 'text-slate-600' : 'text-slate-800 font-medium'}`}>
                            {it.label}
                            {it.gateKeeper && <span className="ml-1 text-[10px] text-amber-700 font-bold" title="Gate-keeper">★</span>}
                          </div>
                          {!checked && (itemState !== (it.initialState || 'not_started')) && (
                            <div className="text-[10px] text-blue-700 mt-0.5">
                              state: {itemState.replace(/_/g, ' ')}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                            {it.artifactType && (
                              <span className={itemArts.length > 0 ? 'text-amber-700 font-medium' : ''}>
                                📎 {itemArts.length > 0 ? `${itemArts.length} file${itemArts.length === 1 ? '' : 's'}` : 'no files'}
                              </span>
                            )}
                            {hasNotes && <span className="text-slate-500">📝 notes</span>}
                            {lockedByUpstream && (
                              <span className="text-slate-500" title={`Waiting on: ${itemBlock.cross_lane_blockers.map(b => `${b.lane}.${b.item}`).join(', ')}`}>
                                🔒 waiting on upstream
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 px-3 py-2 flex flex-wrap gap-1">
                {state.status !== 'done' && comp.complete && (
                  <button
                    onClick={() => setLaneStatus(lane, 'done')}
                    disabled={busyKey === `${lane}.status`}
                    className="text-[11px] px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded">
                    Mark done
                  </button>
                )}
                {state.status !== 'blocked' && state.status !== 'done' && (
                  <button
                    onClick={() => {
                      const reason = prompt('Why is this lane blocked?');
                      if (reason !== null) setLaneStatus(lane, 'blocked', reason);
                    }}
                    disabled={busyKey === `${lane}.status`}
                    className="text-[11px] px-2 py-1 border border-slate-300 hover:bg-slate-50 rounded">
                    Block
                  </button>
                )}
                {state.status === 'blocked' && (
                  <button
                    onClick={() => setLaneStatus(lane, 'in_progress')}
                    disabled={busyKey === `${lane}.status`}
                    className="text-[11px] px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded">
                    Unblock
                  </button>
                )}
                {state.status === 'done' && (
                  <button
                    onClick={() => setLaneStatus(lane, 'in_progress')}
                    disabled={busyKey === `${lane}.status`}
                    className="text-[11px] px-2 py-1 border border-slate-300 hover:bg-slate-50 rounded">
                    Reopen
                  </button>
                )}
              </div>
              {state.blocked_reason && (
                <div className="border-t border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-800">
                  {state.blocked_reason}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {project.notes && (
        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-yellow-900 mb-1">Notes</h4>
          <p className="text-sm text-yellow-900 whitespace-pre-wrap">{project.notes}</p>
        </div>
      )}

      {openItem && (
        <ItemPanel
          projectId={project.id}
          lane={openItem.lane}
          itemDef={openItem.itemDef}
          laneState={laneStatus?.[openItem.lane]}
          artifacts={project.artifacts}
          blockers={project.task_blockers?.[openItem.lane]?.[openItem.itemDef.key]}
          onClose={() => setOpenItem(null)}
          onChange={load}
          onJumpToTask={(toLane, toItemKey) => {
            const toDef = (checklist?.[toLane] || []).find(i => i.key === toItemKey);
            if (toDef) setOpenItem({ lane: toLane, itemDef: toDef });
          }}
        />
      )}

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-500">
        <div className="bg-white border border-slate-200 rounded p-3">
          <h4 className="font-semibold text-slate-700 mb-1">Customer share link</h4>
          <p className="break-all text-[11px] font-mono">/p/{project.share_token}</p>
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={() => {
                const url = `${window.location.origin}/p/${project.share_token}`;
                navigator.clipboard.writeText(url).then(
                  () => alert('Customer link copied to clipboard:\n\n' + url),
                  () => alert('Copy failed — please select the URL above manually.')
                );
              }}
              className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white"
              title="Copy the full URL to your clipboard">
              Copy full URL
            </button>
            <a
              href={`/p/${project.share_token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-bold px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50">
              Preview ↗
            </a>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">Read-only · customer-facing · no login</p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3">
          <h4 className="font-semibold text-slate-700 mb-1">VPP-readiness</h4>
          <p>Capable hardware: {project.vpp_capable_hardware ? '✓' : '—'}</p>
          <p>Customer consented: {project.vpp_consented ? '✓' : '—'}</p>
          <p>Enrolled: {project.vpp_enrolled ? '✓' : '—'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3">
          <h4 className="font-semibold text-slate-700 mb-1">Commissioning</h4>
          <p>{project.commissioned_at ? fmtDateLong(project.commissioned_at) : 'Not yet commissioned'}</p>
          <p className="mt-1 text-slate-400">All five lanes must be done first</p>
        </div>
      </div>
    </div>
  );
}

function SystemCard({ project }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs text-slate-600">
      <div><strong>{project.system_size_kw || '—'}</strong> kW solar</div>
      {project.battery_kwh && <div><strong>{project.battery_kwh}</strong> kWh battery</div>}
      {project.panel_count && <div>{project.panel_count} panels</div>}
    </div>
  );
}

// B-2 — Goldenray-branded proposal PDF download. Two stages:
//   Stage 1 = preliminary (cost ranges; pre-site-visit)
//   Stage 2 = final (locked spec + price; post-site-visit, needs site_visit_done_at)
// Both stages are generated server-side via Puppeteer and streamed back as
// a file download. If no bill_analysis is linked, the proposal still renders
// but the savings projection falls back to industry averages.
function ProposalDownloadButtons({ projectId, hasBill }) {
  const [downloading, setDownloading] = useState(null);   // 1 | 2 | null
  const [error, setError] = useState('');

  async function download(stage) {
    setDownloading(stage); setError('');
    try {
      const token = localStorage.getItem('gr_token');
      const res = await fetch(`/api/pm/projects/${projectId}/proposal-pdf?stage=${stage}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      // Pull filename from Content-Disposition if present
      const cd = res.headers.get('Content-Disposition') || '';
      const m  = cd.match(/filename="([^"]+)"/);
      const name = m ? m[1] : `Goldenray-Proposal-Stage${stage}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => download(1)}
        disabled={downloading !== null}
        title={hasBill ? 'Generate Stage 1 preliminary proposal' : 'Generate Stage 1 — no bill linked, savings projection uses regional averages'}
        className="text-[11px] font-bold px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
      >
        {downloading === 1 ? '⏳ Generating…' : '📄 Stage 1 PDF'}
      </button>
      <button
        onClick={() => download(2)}
        disabled={downloading !== null}
        title="Generate Stage 2 final proposal (post-site-visit)"
        className="text-[11px] font-bold px-3 py-1.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
      >
        {downloading === 2 ? '⏳ Generating…' : '📄 Stage 2 PDF'}
      </button>
      {error && <div className="text-[10px] text-red-600 max-w-[200px] break-words">{error}</div>}
    </div>
  );
}
