import { useEffect, useRef, useState } from 'react';
import { pmProjectsAPI, pmArtifactsAPI } from '../services/pmApi';
import { fmtDateTime } from '../../utils/format';

// ────────────────────────────────────────────────────────────────────────────
// ItemPanel — slide-over for a single checklist item.
//
// Click an item in the swim-lane card → this panel opens on the right.
// Lets the team:
//   - read the item description + gate-keeper status
//   - upload artifact files (PDFs, photos, etc.) for items with artifactType
//   - browse / download / delete previously uploaded artifacts
//   - capture notes
//   - mark complete / reopen, with cross-lane gate enforcement
//
// All writes flow through the existing pmProjectsAPI.updateLane and the new
// pmArtifactsAPI. The panel re-fetches the project on close so the swim-lane
// view reflects the changes.
// ────────────────────────────────────────────────────────────────────────────

export default function ItemPanel({ projectId, lane, itemDef, laneState, artifacts, onClose, onChange }) {
  const itemKey  = itemDef.key;
  const checked  = laneState?.items?.[itemKey] === true;
  const meta     = laneState?.item_meta?.[itemKey] || {};
  const itemArts = (artifacts || []).filter(a => a.swim_lane === lane && a.metadata?.item_key === itemKey);

  const [notes, setNotes]         = useState(meta.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // Save notes (debounced via blur — user clicks save explicitly to avoid surprise writes)
  async function saveNotes() {
    setSavingNotes(true);
    setError('');
    try {
      await pmProjectsAPI.updateLane(projectId, lane, { item: itemKey, notes });
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingNotes(false);
    }
  }

  async function toggleComplete() {
    setBusy(true);
    setError('');
    try {
      await pmProjectsAPI.updateLane(projectId, lane, {
        item: itemKey,
        value: !checked,
        notes,  // also persist current notes
      });
      onChange?.();
    } catch (e) {
      const data = e.response?.data;
      if (data?.blockers?.length) {
        setError(`Blocked by: ${data.blockers.map(b => `${b.lane}.${b.item}`).join(', ')}`);
      } else {
        setError(data?.error || e.message);
      }
    } finally {
      setBusy(false);
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
      if (notes) fd.append('notes', notes);
      await pmArtifactsAPI.upload(projectId, fd);
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function deleteArtifact(artifactId) {
    if (!confirm('Delete this artifact? This removes the file too.')) return;
    setBusy(true);
    try {
      await pmArtifactsAPI.remove(projectId, artifactId);
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadArtifact(artifactId, name) {
    try {
      const r = await pmArtifactsAPI.signedUrl(projectId, artifactId);
      window.open(r.data.url, '_blank', 'noopener');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  // Close on escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {lane} {itemDef.gateKeeper && <span className="ml-1 text-amber-700">★ gate-keeper</span>}
              </div>
              <h2 className="text-lg font-bold text-slate-900 mt-1 leading-tight">
                {itemDef.label}
              </h2>
              {itemDef.artifactType && (
                <div className="text-[11px] text-slate-500 mt-1 font-mono">artifact: {itemDef.artifactType}</div>
              )}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
          </div>
        </div>

        {/* Status banner */}
        <div className={`px-5 py-3 border-b ${checked ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`text-sm font-semibold ${checked ? 'text-green-800' : 'text-amber-800'}`}>
                {checked ? '✓ Completed' : 'Not yet completed'}
              </div>
              {checked && meta.completed_at && (
                <div className="text-xs text-slate-600 mt-0.5">
                  {fmtDateTime(meta.completed_at)}
                  {meta.completed_by && <span className="text-slate-400"> · by user {meta.completed_by.slice(0, 8)}</span>}
                </div>
              )}
            </div>
            <button
              onClick={toggleComplete}
              disabled={busy}
              className={`text-sm font-medium px-3 py-1.5 rounded ${checked
                ? 'border border-slate-300 hover:bg-slate-50 text-slate-700'
                : 'bg-green-600 hover:bg-green-700 text-white disabled:opacity-50'}`}>
              {busy ? '…' : checked ? 'Reopen' : 'Mark complete'}
            </button>
          </div>
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Artifact upload */}
          {itemDef.artifactType && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">Artifacts</h3>
                <span className="text-xs text-slate-500">{itemArts.length} uploaded</span>
              </div>

              {itemArts.length > 0 ? (
                <ul className="space-y-1.5 mb-3">
                  {itemArts.map(a => (
                    <li key={a.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-800 truncate">
                          {a.metadata?.original_name || a.file_url?.split('/').pop()}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {fmtDateTime(a.uploaded_at)}
                          {a.file_size_bytes && ` · ${(a.file_size_bytes / 1024).toFixed(0)} KB`}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-2">
                        <button
                          onClick={() => downloadArtifact(a.id, a.metadata?.original_name)}
                          className="text-xs text-amber-700 hover:underline">Download</button>
                        <button
                          onClick={() => deleteArtifact(a.id)}
                          className="text-xs text-red-600 hover:underline">Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500 italic mb-3">No files uploaded yet.</p>
              )}

              <label className="block">
                <span className="sr-only">Upload file</span>
                <input
                  ref={fileRef}
                  type="file"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  disabled={uploading}
                  accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,.xlsx,.csv"
                  className="block w-full text-sm text-slate-600
                    file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0
                    file:text-sm file:font-medium file:bg-amber-100 file:text-amber-900
                    hover:file:bg-amber-200"
                />
              </label>
              {uploading && <div className="text-xs text-slate-500 mt-1">Uploading…</div>}
              <p className="text-[11px] text-slate-400 mt-1">PDF, image, DOC, XLSX. Max 25 MB per file.</p>
            </section>
          )}

          {/* Notes */}
          <section>
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Notes</h3>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the team should know…"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            <button
              onClick={saveNotes}
              disabled={savingNotes || notes === (meta.notes || '')}
              className="mt-2 text-sm px-3 py-1 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded">
              {savingNotes ? 'Saving…' : 'Save notes'}
            </button>
          </section>

          {/* Audit */}
          <section className="pt-2 border-t border-slate-200">
            <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">Audit</h3>
            <dl className="text-xs text-slate-600 space-y-0.5">
              {meta.completed_at && (
                <div className="flex justify-between">
                  <dt>Completed at</dt>
                  <dd className="font-mono">{fmtDateTime(meta.completed_at)}</dd>
                </div>
              )}
              {meta.last_uncompleted_at && (
                <div className="flex justify-between">
                  <dt>Reopened at</dt>
                  <dd className="font-mono">{fmtDateTime(meta.last_uncompleted_at)}</dd>
                </div>
              )}
              {!meta.completed_at && !meta.last_uncompleted_at && (
                <div className="text-slate-400 italic">No history yet</div>
              )}
            </dl>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button onClick={onClose} className="text-sm px-4 py-1.5 border border-slate-300 hover:bg-slate-100 rounded">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
