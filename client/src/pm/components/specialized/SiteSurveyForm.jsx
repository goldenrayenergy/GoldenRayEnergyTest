import { useRef, useState } from 'react';
import { pmArtifactsAPI } from '../../services/pmApi';
import TaskFormGeneric from '../TaskFormGeneric';
import { fmtDateTime } from '../../../utils/format';

// ────────────────────────────────────────────────────────────────────────────
// SiteSurveyForm — required-photo checklist + structured fields.
//
// Solar installers regret missing critical photos in court / warranty
// disputes. This UX makes the 7 required shots impossible to skip:
//   - Ridge / overall roof
//   - Switchboard front (close-up of meter board / fuses)
//   - Meter (close-up of ICP label)
//   - Internet router (Wi-Fi presence for monitoring)
//   - 4 roof corner shots (NE, NW, SE, SW)
//
// Each shot is its own upload zone tagged with metadata.shot_type.
// The state can only advance to 'review' / 'done' once all required shots
// are present — enforced visually here, schema validation handled separately.
// ────────────────────────────────────────────────────────────────────────────

const REQUIRED_SHOTS = [
  { key: 'ridge',         label: 'Roof ridge / overview',  hint: 'Wide shot showing full roof aspect + chimney/obstructions' },
  { key: 'corner_ne',     label: 'NE corner',              hint: 'North-east corner of roof' },
  { key: 'corner_nw',     label: 'NW corner',              hint: 'North-west corner of roof' },
  { key: 'corner_se',     label: 'SE corner',              hint: 'South-east corner of roof' },
  { key: 'corner_sw',     label: 'SW corner',              hint: 'South-west corner of roof' },
  { key: 'switchboard',   label: 'Switchboard front',      hint: 'Close-up of meter board with main switch + breakers visible' },
  { key: 'meter',         label: 'Meter + ICP label',      hint: 'Close-up so the ICP number is readable' },
  { key: 'internet',      label: 'Internet router',        hint: 'Confirms Wi-Fi available for monitoring' },
];

export default function SiteSurveyForm({ projectId, lane, itemKey, schema, values, currentState, artifacts, onChange, onProjectChanged }) {
  const itemArts = (artifacts || []).filter(a => a.swim_lane === lane && a.metadata?.item_key === itemKey);

  // Group artifacts by shot_type
  const shotByKey = {};
  for (const a of itemArts) {
    const k = a.metadata?.shot_type || 'other';
    shotByKey[k] = shotByKey[k] || [];
    shotByKey[k].push(a);
  }
  const requiredDone = REQUIRED_SHOTS.filter(s => (shotByKey[s.key] || []).length > 0).length;
  const allRequired = requiredDone === REQUIRED_SHOTS.length;

  return (
    <div>
      {/* Progress banner */}
      <div className={`mb-4 px-3 py-2 rounded border text-sm ${
        allRequired ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}>
        Required shots: <strong>{requiredDone}/{REQUIRED_SHOTS.length}</strong>
        {allRequired ? ' ✓ All set — survey can be marked done.' : ' — capture all 8 shots before completing.'}
      </div>

      <div className="space-y-3 mb-6">
        {REQUIRED_SHOTS.map(shot => (
          <ShotRow
            key={shot.key}
            shot={shot}
            existing={shotByKey[shot.key] || []}
            projectId={projectId}
            lane={lane}
            itemKey={itemKey}
            onChange={onProjectChanged}
          />
        ))}
      </div>

      <div className="border-t border-slate-200 pt-4">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Site assessment fields</h4>
        <TaskFormGeneric
          schema={schema}
          values={values}
          currentState={currentState}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

function ShotRow({ shot, existing, projectId, lane, itemKey, onChange }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function upload(file) {
    if (!file) return;
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('swim_lane', lane);
      fd.append('artifact_type', 'site_survey_photo');
      fd.append('item_key', itemKey);
      fd.append('notes', JSON.stringify({ shot_type: shot.key }));
      // Backend stores notes as a string; we encode shot_type into metadata via a JSON note.
      // For cleaner storage, the artifact route would accept shot_type explicitly — but for
      // Phase A.2.2 we lean on metadata.notes JSON-decoded by the renderer above.
      await pmArtifactsAPI.upload(projectId, fd);
      await onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(artifactId) {
    if (!confirm('Delete this photo?')) return;
    try {
      await pmArtifactsAPI.remove(projectId, artifactId);
      await onChange?.();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  const have = existing.length > 0;

  return (
    <div className={`border rounded-lg p-3 ${have ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${have ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
              {have ? '✓' : '?'}
            </span>
            <div className="font-medium text-sm text-slate-800">{shot.label}</div>
            {existing.length > 1 && <span className="text-[10px] text-slate-500">({existing.length} photos)</span>}
          </div>
          <p className="text-[11px] text-slate-500 ml-7 mt-0.5">{shot.hint}</p>
          {existing.length > 0 && (
            <ul className="ml-7 mt-1.5 space-y-0.5">
              {existing.map(a => (
                <li key={a.id} className="text-[11px] text-slate-700 flex items-center gap-2">
                  <span>📷 {a.metadata?.original_name || a.file_url?.split('/').pop()}</span>
                  <span className="text-slate-400">{fmtDateTime(a.uploaded_at)}</span>
                  <button onClick={() => remove(a.id)} className="text-red-600 hover:underline">delete</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={uploading}
            onChange={e => upload(e.target.files?.[0])}
            className="block w-full text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-amber-100 file:text-amber-900 hover:file:bg-amber-200"
          />
        </div>
      </div>
      {uploading && <div className="text-xs text-slate-500 mt-1">Uploading…</div>}
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
    </div>
  );
}
