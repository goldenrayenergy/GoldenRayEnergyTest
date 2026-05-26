import { useEffect, useRef, useState } from 'react';
import { pmProjectsAPI, pmArtifactsAPI, pmEventsAPI, pmCommentsAPI } from '../services/pmApi';
import { fmtDateTime } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import TaskFormGeneric from './TaskFormGeneric';
import StateMachineControl from './StateMachineControl';
import ActivityTimeline from './ActivityTimeline';
import CommentsThread from './CommentsThread';
import BlockersBanner from './BlockersBanner';

import SiteSurveyForm     from './specialized/SiteSurveyForm';
import SystemDesignForm   from './specialized/SystemDesignForm';
import BomLockedForm      from './specialized/BomLockedForm';
import CommissioningForm  from './specialized/CommissioningForm';
import CocForm            from './specialized/CocForm';
import ProposalForm       from './specialized/ProposalForm';

import { liveMissingForNextState } from '../utils/stateMachine';

// ────────────────────────────────────────────────────────────────────────────
// ItemPanel — Phase A.2.3 with single-button Save & advance.
//
// ItemPanel now owns the pendingFields state. All form components are
// controlled — they emit onChange with the next full fields object. One
// "Save & advance" button (in StateMachineControl) saves fields and
// auto-advances the state machine to the highest reachable state.
//
// BlockersBanner shows what's preventing the next state advance — either
// upstream lane tasks not done, or fields required for the next state.
// Clicking an upstream blocker jumps to that task.
// ────────────────────────────────────────────────────────────────────────────

export default function ItemPanel({ projectId, lane, itemDef, laneState, artifacts, blockers, onClose, onChange, onJumpToTask }) {
  const { user } = useAuth();
  const itemKey  = itemDef.key;
  const meta     = laneState?.item_meta?.[itemKey] || {};
  const checked  = laneState?.items?.[itemKey] === true;
  const itemArts = (artifacts || []).filter(a => a.swim_lane === lane && a.metadata?.item_key === itemKey);
  // Derive state: prefer explicit meta.state (set by the state-machine on
  // any transition). Fall back to doneState if items[key]=true (legacy/seed
  // data that pre-dates the state machine), else initialState.
  const currentState = meta.state
    || (checked ? itemDef.doneState : (itemDef.initialState || 'not_started'));

  // ── Field state lives here, not in form components ──
  const [pendingFields, setPendingFields] = useState(meta.fields || {});
  const [dirty, setDirty]       = useState(false);

  // Done tasks render read-only with a "Reopen to edit" button.
  const isDone = currentState === itemDef.doneState;

  // Live blockers — recomputed on every keystroke from pendingFields. Cross-lane
  // blockers come from the server (those don't change as you type). Field
  // requirements are computed locally so feedback is instant.
  const live           = liveMissingForNextState(itemDef, currentState, pendingFields);
  const liveBlockers   = {
    current_state:        currentState,
    next_state:           live.next_state,
    missing_fields:       live.missing_fields,
    cross_lane_blockers:  blockers?.cross_lane_blockers || [],
    upstream_suggestions: blockers?.upstream_suggestions || {},
  };
  const [busy, setBusy]         = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]       = useState('');
  const [events, setEvents]     = useState([]);
  const [comments, setComments] = useState([]);
  const fileRef = useRef(null);

  // Reset pending fields whenever the panel opens or the underlying server data changes
  useEffect(() => {
    setPendingFields(meta.fields || {});
    setDirty(false);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [itemKey, projectId, JSON.stringify(meta.fields)]);

  function loadActivity() {
    Promise.all([
      pmEventsAPI.list(projectId,   { lane, item_key: itemKey, limit: 100 }),
      pmCommentsAPI.list(projectId, { lane, item_key: itemKey }),
    ]).then(([e, c]) => {
      setEvents(e.data);
      setComments(c.data);
    }).catch(() => {/* non-fatal */});
  }

  useEffect(() => { loadActivity(); /* eslint-disable-next-line */ }, [projectId, lane, itemKey]);

  // ── Save & advance (the unified action) ──
  async function saveAndAdvance() {
    setBusy(true); setError('');
    try {
      await pmProjectsAPI.updateLane(projectId, lane, {
        item: itemKey,
        fields: pendingFields,
        auto_advance: true,
      });
      setDirty(false);
      await onChange?.();
      loadActivity();
    } catch (e) {
      const data = e.response?.data;
      if (data?.missing_fields?.length) {
        setError(`Required fields for next state: ${data.missing_fields.map(m => m.label).join(', ')}`);
      } else if (data?.blockers?.length) {
        setError(`Upstream not done: ${data.blockers.map(b => `${b.lane}.${b.item}`).join(', ')}`);
      } else {
        setError(data?.error || e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Force a specific state (advanced menu — bypasses auto-advance) ──
  async function forceState(targetState) {
    setBusy(true); setError('');
    try {
      // Save any pending field changes first, then transition
      await pmProjectsAPI.updateLane(projectId, lane, {
        item: itemKey,
        fields: pendingFields,
        target_state: targetState,
      });
      setDirty(false);
      await onChange?.();
      loadActivity();
    } catch (e) {
      const data = e.response?.data;
      setError(data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  // ── Reopen: regress state from doneState back to one before, re-enabling edits ──
  async function reopen() {
    if (!isDone) return;
    const stateOrder = itemDef.states || [];
    const prev = stateOrder[Math.max(0, stateOrder.indexOf(itemDef.doneState) - 1)] || itemDef.initialState;
    if (!confirm(`Reopen this completed task for editing? An audit event will be recorded.`)) return;
    await forceState(prev);
  }

  function setFields(next) {
    setPendingFields(next);
    setDirty(true);
  }

  async function handleFileUpload(file) {
    if (!file || !itemDef.artifactType) return;
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('swim_lane', lane);
      fd.append('artifact_type', itemDef.artifactType);
      fd.append('item_key', itemKey);
      await pmArtifactsAPI.upload(projectId, fd);
      await onChange?.();
      loadActivity();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function downloadArtifact(artifactId) {
    try {
      const r = await pmArtifactsAPI.signedUrl(projectId, artifactId);
      window.open(r.data.url, '_blank', 'noopener');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function deleteArtifactFile(artifactId) {
    if (!confirm('Delete this artifact?')) return;
    try {
      await pmArtifactsAPI.remove(projectId, artifactId);
      await onChange?.();
      loadActivity();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative ml-auto w-full max-w-5xl h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              {lane} {itemDef.gateKeeper && <span className="ml-1 text-amber-700">★ gate-keeper</span>}
              {itemDef.artifactType && <span className="ml-2 font-mono normal-case text-slate-400">artifact: {itemDef.artifactType}</span>}
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-0.5 leading-tight">{itemDef.label}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-red-800 text-sm">{error}</div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* LEFT — work surface */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5 border-r border-slate-200">
            <StateMachineControl
              itemDef={itemDef}
              currentState={currentState}
              blockers={liveBlockers}
              busy={busy}
              dirty={dirty}
              isDone={isDone}
              onSaveAndAdvance={saveAndAdvance}
              onForceState={forceState}
              onReopen={reopen}
            />

            {/* Completed banner — read-only with Reopen */}
            {isDone && (
              <div className="bg-green-50 border border-green-300 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-green-900 text-sm">✓ Task completed — fields locked</div>
                    <div className="text-xs text-green-800 mt-0.5">
                      {meta.completed_at && <>Completed {fmtDateTime(meta.completed_at)}</>}
                      {meta.completed_by && <span className="text-green-700"> · by user {String(meta.completed_by).slice(0, 8)}</span>}
                    </div>
                    <div className="text-[11px] text-green-700 mt-1">
                      To make corrections, click <strong>Reopen to edit</strong>. The reopen action is recorded in the activity timeline.
                    </div>
                  </div>
                  <button
                    onClick={reopen}
                    disabled={busy}
                    className="text-xs px-3 py-1.5 border border-green-400 hover:bg-white text-green-800 rounded font-medium disabled:opacity-50">
                    Reopen to edit
                  </button>
                </div>
              </div>
            )}

            {/* What's blocking the next state — only when not done */}
            {!isDone && <BlockersBanner blockers={liveBlockers} onJumpToTask={onJumpToTask} />}

            {/* Work surface — generic or specialized */}
            <section>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Fields</div>
              <SpecializedOrGeneric
                ux={itemDef.ux}
                projectId={projectId}
                lane={lane}
                itemKey={itemKey}
                schema={itemDef.schema}
                values={pendingFields}
                currentState={currentState}
                artifacts={artifacts}
                missingFields={liveBlockers.missing_fields}
                upstreamSuggestions={liveBlockers.upstream_suggestions}
                onChange={setFields}
                onProjectChanged={onChange}
                readOnly={isDone}
                heuristicMeta={meta.heuristic_meta || {}}
                onHeuristicChange={async (fieldKey, patch) => {
                  // Persist a heuristic_meta patch (typically { verified: true|false })
                  // immediately — these are metadata edits, not field edits, and
                  // we don't want them blocked by the readOnly field state.
                  try {
                    await pmProjectsAPI.updateLane(projectId, lane, {
                      item: itemKey,
                      heuristic_meta: { [fieldKey]: patch },
                    });
                    await onChange?.();
                    loadActivity();
                  } catch (e) {
                    setError(e.response?.data?.error || e.message);
                  }
                }}
              />
            </section>

            {/* Artifact uploads */}
            {itemDef.artifactType && (
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-semibold text-slate-500 uppercase">Files</div>
                  <span className="text-[11px] text-slate-500">{itemArts.length} uploaded</span>
                </div>
                {itemArts.length > 0 ? (
                  <ul className="space-y-1.5 mb-2">
                    {itemArts.map(a => (
                      <li key={a.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-slate-800 truncate">{a.metadata?.original_name || a.file_url?.split('/').pop()}</div>
                          <div className="text-[10px] text-slate-500">
                            {fmtDateTime(a.uploaded_at)}
                            {a.file_size_bytes && ` · ${(a.file_size_bytes / 1024).toFixed(0)} KB`}
                          </div>
                        </div>
                        <div className="flex gap-2 ml-2">
                          <button onClick={() => downloadArtifact(a.id)} className="text-xs text-amber-700 hover:underline">Open</button>
                          <button onClick={() => deleteArtifactFile(a.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400 italic mb-2">No files uploaded yet.</p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  disabled={uploading}
                  accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,.xlsx,.csv"
                  className="block w-full text-xs text-slate-600
                    file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0
                    file:text-xs file:font-medium file:bg-amber-100 file:text-amber-900
                    hover:file:bg-amber-200"
                />
                {uploading && <div className="text-xs text-slate-500 mt-1">Uploading…</div>}
              </section>
            )}

            <div className="text-[11px] text-slate-500 border-t border-slate-200 pt-3">
              Current state: <strong>{currentState.replace(/_/g, ' ')}</strong>
              {checked && meta.completed_at && <> · completed {fmtDateTime(meta.completed_at)}</>}
            </div>
          </div>

          {/* RIGHT — activity rail */}
          <div className="w-[40%] min-w-[300px] flex flex-col bg-slate-50">
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <section>
                <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Activity</div>
                <ActivityTimeline events={events} />
              </section>
              <div className="border-t border-slate-200 pt-4">
                <CommentsThread
                  projectId={projectId}
                  lane={lane}
                  itemKey={itemKey}
                  comments={comments}
                  currentUserId={user?.id}
                  onChange={loadActivity}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button onClick={onClose} className="text-sm px-4 py-1.5 border border-slate-300 hover:bg-slate-100 rounded">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Resolves specialized component by ux marker; all controlled. ──
function SpecializedOrGeneric({ ux, projectId, lane, itemKey, schema, values, currentState, artifacts, missingFields, upstreamSuggestions, onChange, onProjectChanged, readOnly, heuristicMeta, onHeuristicChange }) {
  const common = { schema, values, currentState, missingFields, upstreamSuggestions, onChange, readOnly, heuristicMeta, onHeuristicChange };
  switch (ux) {
    case 'site_survey':
      return <SiteSurveyForm projectId={projectId} lane={lane} itemKey={itemKey} {...common} artifacts={artifacts} onProjectChanged={onProjectChanged} />;
    case 'system_design':
      return <SystemDesignForm {...common} />;
    case 'bom_locked':
      return <BomLockedForm {...common} />;
    case 'commissioning_form':
      return <CommissioningForm projectId={projectId} lane={lane} itemKey={itemKey} {...common} onProjectChanged={onProjectChanged} />;
    case 'coc':
      return <CocForm {...common} />;
    case 'initial_proposal':
      return <ProposalForm stage="initial" {...common} />;
    case 'final_proposal':
      return <ProposalForm stage="final" {...common} />;
    default:
      return <TaskFormGeneric {...common} />;
  }
}
