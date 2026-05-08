import { useEffect, useState } from 'react';

// ── Schema-driven form renderer ──
// Renders one input per field in the task definition's schema.fields array.
// Calls onChange(fieldKey, value) on every keystroke; onSave({allFields}) on
// "Save fields" button click. Highlights fields that are required at the
// next state transition.

const TYPE_INPUTS = {
  text:       (props) => <input type="text"     {...props} />,
  textarea:   (props) => <textarea rows={3}     {...props} />,
  number:     (props) => <input type="number"   {...props} />,
  date:       (props) => <input type="date"     {...props} />,
  datetime:   (props) => <input type="datetime-local" {...props} />,
  boolean:    null,    // rendered specially below
  select:     null,    // rendered specially below
  currency:   (props) => <input type="number" step="0.01" {...props} />,
  percent:    (props) => <input type="number" step="0.01" max="100" min="0" {...props} />,
  phone:      (props) => <input type="tel"  {...props} />,
  email:      (props) => <input type="email" {...props} />,
  url:        (props) => <input type="url"  {...props} />,
};

export default function TaskFormGeneric({ schema, values, currentState, onSave }) {
  const [local, setLocal] = useState(values || {});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty]   = useState(false);

  useEffect(() => { setLocal(values || {}); setDirty(false); }, [values]);

  const fields = schema?.fields || [];

  function set(key, val) {
    setLocal(prev => ({ ...prev, [key]: val }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave?.(local);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  if (fields.length === 0) {
    return <p className="text-sm text-slate-500 italic">No structured fields for this task.</p>;
  }

  return (
    <div>
      <div className="space-y-3">
        {fields.map(f => {
          const v        = local[f.key];
          const required = f.requiredAt && f.requiredAt === currentState;

          const baseInput = "w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm";
          let control;

          if (f.type === 'boolean') {
            control = (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!v} onChange={e => set(f.key, e.target.checked)} />
                <span className="text-sm text-slate-700">{v ? 'Yes' : 'No'}</span>
              </label>
            );
          } else if (f.type === 'select') {
            control = (
              <select className={baseInput} value={v ?? ''} onChange={e => set(f.key, e.target.value || null)}>
                <option value="">— select —</option>
                {(f.options || []).map(o => (
                  <option key={o} value={o}>{String(o).replace(/_/g, ' ')}</option>
                ))}
              </select>
            );
          } else {
            const Render = TYPE_INPUTS[f.type] || TYPE_INPUTS.text;
            control = Render({
              className: baseInput,
              value: v ?? '',
              onChange: (e) => set(f.key, e.target.value === '' ? null : e.target.value),
              placeholder: f.placeholder,
              min: f.min,
              max: f.max,
              pattern: f.pattern,
            });
          }

          return (
            <div key={f.key}>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {f.label || f.key}
                {required && <span className="ml-1 text-amber-600" title="required for next state">*</span>}
                {f.requiredAt && !required && (
                  <span className="ml-1 text-[10px] text-slate-400">(req @ {f.requiredAt})</span>
                )}
              </label>
              {control}
              {f.helpText && <p className="text-[11px] text-slate-500 mt-0.5">{f.helpText}</p>}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm rounded font-medium">
          {saving ? 'Saving…' : 'Save fields'}
        </button>
        {dirty && <span className="text-xs text-amber-700">unsaved changes</span>}
      </div>
    </div>
  );
}
