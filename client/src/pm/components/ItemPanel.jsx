import { useEffect, useRef, useState } from 'react';
import { pmProjectsAPI, pmArtifactsAPI, pmEventsAPI, pmCommentsAPI } from '../services/pmApi';
import { fmtDateTime } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import TaskFormGeneric from './TaskFormGeneric';
import StateMachineControl from './StateMachineControl';
import ActivityTimeline from './ActivityTimeline';
import CommentsThread from './CommentsThread';

// ────────────────────────────────────────────────────────────────────────────
// ItemPanel — Phase A.2 split-panel work surface for a single task.
//
// Left  (~60%) — work surface: state machine, structured form, file uploads
// Right (~40%) — activity rail: append-only event timeline + comments thread
//
// Schema-driven: reads itemDef.schema.fields and itemDef.states/transitions
// to drive the UI. For tasks with ux !== 'generic' (site_survey,
// system_design, commissioning_form, coc, initial_proposal, final_proposal)
// a specialized component takes over the work surface — the activity rail
// stays the same.
// ────────────────────────────────────────────────────────────────────────────

export default function ItemPanel({ projectId, lane, itemDef, laneState, artifacts, onClose, onChange }) {
  const { user } = useAuth();
  const itemKey  = itemDef.key;
  const meta     = laneState?.item_meta?.[itemKey] || {};
  const checked  = laneState?.items?.[itemKey] === true;
  const itemArts = (artifacts || []).filter(a => a.swim_lane === lane && a.metadata?.item_key === itemKey);
  const currentState = meta.state || itemDef.initialState || 'not_started';

  const [busy, setBusy]         = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]       = useState('');
  const [events, setEvents]     = useState([]);
  const [comments, setComments] = useState([]);
  const fileRef = useRef(null);

  // ── Load activity (events + comments) for this task ──
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

  async function transition(toState) {
    setBusy(true);
    setError('');
    try {
      await pmProjectsAPI.updateLane(projectId, lane, { item: itemKey, target_state: toState });
      await onChange?.();
      loadActivity();
    } catch (e) {
      const data = e.response?.data;
      if (data?.missing_fields?.length) {
        setError(`Required fields missing: ${data.missing_fields.map(m => m.label).join(', ')}`);
      } else if (data?.blockers?.length) {
        setError(`Blocked by: ${data.blockers.map(b => `${b.lane}.${b.item}`).join(', ')}`);
      } else {
        setError(data?.error || e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveFields(fields) {
    setError('');
    try {
      await pmProjectsAPI.updateLane(projectId, lane, { item: itemKey, fields });
      await onChange?.();
      loadActivity();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      throw e;
    }
  }

  async function handleFileUpload(file) {
    if (!file || !itemDef.artifactType) return;
    setUploading(true);
    setError('');
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

  // ── Close on Esc ──
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative ml-auto w-full max-w-5xl h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* ── Header ── */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              {lane} {itemDef.gateKeeper && <span className="ml-1 text-amber-700">★ gate-keeper</span>}
              {itemDef.artifactType && <span className="ml-2 font-mono normal-case text-slate-400">artifact: {itemDef.artifactType}</span>}
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-0.5 leading-tight">
              {itemDef.label}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* ── Body: split-panel ── */}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT — work surface (60%) */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5 border-r border-slate-200">
            {/* State machine + transition controls */}
            <StateMachineControl
              itemDef={itemDef}
              currentState={currentState}
              onTransition={transition}
              busy={busy}
            />

            {/* Structured form (schema-driven) */}
            {itemDef.ux === 'generic' ? (
              <section>
                <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Fields</div>
                <TaskFormGeneric
                  schema={itemDef.schema}
                  values={meta.fields}
                  currentState={currentState}
                  onSave={saveFields}
                />
              </section>
            ) : (
              <section className="bg-amber-50 border border-amber-200 rounded p-3">
                <div className="text-xs text-amber-800 font-semibold mb-1">
                  Specialized UX: {itemDef.ux}
                </div>
                <p className="text-sm text-amber-900">
                  This task has a custom interface coming next. For now, structured fields are below.
                </p>
                <div className="mt-3">
                  <TaskFormGeneric
                    schema={itemDef.schema}
                    values={meta.fields}
                    currentState={currentState}
                    onSave={saveFields}
                  />
                </div>
              </section>
            )}

            {/* Artifacts */}
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
                          <div className="text-sm text-slate-800 truncate">
                            {a.metadata?.original_name || a.file_url?.split('/').pop()}
                          </div>
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

            {/* Status footer */}
            <div className="text-[11px] text-slate-500 border-t border-slate-200 pt-3">
              Current state: <strong>{currentState.replace(/_/g, ' ')}</strong>
              {checked && meta.completed_at && (
                <> · marked done {fmtDateTime(meta.completed_at)}</>
              )}
            </div>
          </div>

          {/* RIGHT — activity rail (40%) */}
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

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button onClick={onClose} className="text-sm px-4 py-1.5 border border-slate-300 hover:bg-slate-100 rounded">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
