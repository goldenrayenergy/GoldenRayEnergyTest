// ── Schema-driven controlled form renderer (Phase A.2.3) ──
// Now fully controlled — no internal state, no save button. Field state
// lives in the ItemPanel. One unified "Save & advance" button at the top
// of the panel saves all fields and auto-advances the state machine.

const TYPE_INPUTS = {
  text:       'text',
  number:     'number',
  date:       'date',
  datetime:   'datetime-local',
  currency:   'number',
  percent:    'number',
  phone:      'tel',
  email:      'email',
  url:        'url',
};

export default function TaskFormGeneric({ schema, values = {}, currentState, onChange }) {
  const fields = schema?.fields || [];
  if (fields.length === 0) {
    return <p className="text-sm text-slate-500 italic">No structured fields for this task.</p>;
  }

  function set(key, val) {
    onChange?.({ ...values, [key]: val });
  }

  return (
    <div className="space-y-3">
      {fields.map(f => {
        const v             = values[f.key];
        const requiredNow   = f.requiredAt && f.requiredAt === currentState;
        const requiredLater = f.requiredAt && f.requiredAt !== currentState;
        const baseInput     = "w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm";
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
        } else if (f.type === 'textarea') {
          control = (
            <textarea
              className={baseInput} rows={3}
              value={v ?? ''}
              onChange={e => set(f.key, e.target.value === '' ? null : e.target.value)}
              placeholder={f.placeholder}
            />
          );
        } else {
          const t = TYPE_INPUTS[f.type] || 'text';
          control = (
            <input
              type={t}
              className={baseInput}
              value={v ?? ''}
              onChange={e => set(f.key, e.target.value === '' ? null : e.target.value)}
              placeholder={f.placeholder}
              min={f.min} max={f.max} step={f.type === 'currency' || f.type === 'percent' ? '0.01' : undefined}
              pattern={f.pattern}
            />
          );
        }

        return (
          <div key={f.key}>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {f.label || f.key}
              {requiredNow && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">required now</span>}
              {requiredLater && <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">→ {f.requiredAt.replace(/_/g, ' ')}</span>}
            </label>
            {control}
            {f.helpText && <p className="text-[11px] text-slate-500 mt-0.5">{f.helpText}</p>}
          </div>
        );
      })}
    </div>
  );
}
