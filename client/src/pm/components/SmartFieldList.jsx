import { useState, useEffect, useRef } from 'react';

// ────────────────────────────────────────────────────────────────────────────
// SmartFieldList — focused field rendering for a state-machine task.
//
// Replaces the flat list of all fields with three priority sections:
//
//   🎯 NEEDED NOW    — fields required for the next state transition.
//                       Expanded by default. Auto-focuses the first empty.
//   ✓ Already filled — fields with a value. Collapsed by default.
//   ▾ Coming up      — fields required at later states. Collapsed by default.
//   …  Optional       — fields without requiredAt. Collapsed by default.
//
// Each field that has an upstream suggestion shows a small "Use [value] from
// [upstream task]" button that pre-fills it on click.
// ────────────────────────────────────────────────────────────────────────────

const TYPE_INPUTS = {
  text:     'text',  number:   'number',  date:     'date',  datetime: 'datetime-local',
  currency: 'number', percent:  'number',  phone:    'tel',   email:    'email',  url: 'url',
};

export default function SmartFieldList({ schema, values = {}, currentState, missingFields = [], upstreamSuggestions = {}, onChange, readOnly = false, heuristicMeta = {}, onHeuristicChange }) {
  const fields = schema?.fields || [];
  const stateOrder = schema?.states || [];

  // Group fields
  const missingKeys = new Set(missingFields.map(m => m.key));
  const buckets = { needed: [], filled: [], later: [], optional: [] };
  for (const f of fields) {
    const v   = values[f.key];
    const has = !(v === undefined || v === null || v === '');
    if (missingKeys.has(f.key))      buckets.needed.push(f);
    else if (has)                     buckets.filled.push(f);
    else if (f.requiredAt)            buckets.later.push(f);
    else                              buckets.optional.push(f);
  }

  // Auto-focus the first empty needed field on mount / state change
  const firstNeededRef = useRef(null);
  useEffect(() => { firstNeededRef.current?.focus?.(); /* eslint-disable-next-line */ }, [currentState, missingFields.length]);

  const totalFields = fields.length;
  const filledCount = buckets.filled.length;
  if (totalFields === 0) {
    return <p className="text-sm text-slate-500 italic">No structured fields for this task.</p>;
  }

  return (
    <div className="space-y-3">
      {buckets.needed.length > 0 && (
        <Section
          title="🎯 Needed now"
          subtitle={`${buckets.needed.length} field${buckets.needed.length === 1 ? '' : 's'} to advance`}
          tone="amber"
          defaultOpen={true}>
          <div className="space-y-3">
            {buckets.needed.map((f, i) => (
              <Field
                key={f.key}
                f={f}
                value={values[f.key]}
                onChange={onChange}
                values={values}
                upstream={upstreamSuggestions[f.key]}
                inputRef={i === 0 ? firstNeededRef : undefined}
                emphasis="strong"
                readOnly={readOnly}
                heuristic={heuristicMeta[f.key]}
                onHeuristicChange={onHeuristicChange}
              />
            ))}
          </div>
        </Section>
      )}

      {buckets.filled.length > 0 && (
        <Section title={`✓ Already filled`} subtitle={`${filledCount} of ${totalFields}`} tone="green" defaultOpen={readOnly}>
          <div className="space-y-3">
            {buckets.filled.map(f => (
              <Field key={f.key} f={f} value={values[f.key]} onChange={onChange} values={values} upstream={upstreamSuggestions[f.key]} emphasis="muted" readOnly={readOnly} heuristic={heuristicMeta[f.key]} onHeuristicChange={onHeuristicChange} />
            ))}
          </div>
        </Section>
      )}

      {buckets.later.length > 0 && (
        <Section title="▸ Coming up" subtitle={`${buckets.later.length} for later states`} tone="slate" defaultOpen={false}>
          <div className="space-y-3">
            {buckets.later.map(f => (
              <Field key={f.key} f={f} value={values[f.key]} onChange={onChange} values={values} upstream={upstreamSuggestions[f.key]} emphasis="muted" readOnly={readOnly} heuristic={heuristicMeta[f.key]} onHeuristicChange={onHeuristicChange} />
            ))}
          </div>
        </Section>
      )}

      {buckets.optional.length > 0 && (
        <Section title="… Optional" subtitle={`${buckets.optional.length}`} tone="slate" defaultOpen={false}>
          <div className="space-y-3">
            {buckets.optional.map(f => (
              <Field key={f.key} f={f} value={values[f.key]} onChange={onChange} values={values} upstream={upstreamSuggestions[f.key]} emphasis="muted" readOnly={readOnly} heuristic={heuristicMeta[f.key]} onHeuristicChange={onHeuristicChange} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

const TONE_STYLES = {
  amber: 'bg-amber-50 border-amber-300',
  green: 'bg-green-50 border-green-200',
  slate: 'bg-slate-50 border-slate-200',
};

function Section({ title, subtitle, tone = 'slate', defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`border rounded-lg overflow-hidden ${TONE_STYLES[tone]}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/40">
        <span className="text-xs font-semibold text-slate-800">{title}</span>
        <span className="text-[11px] text-slate-500">
          {subtitle} <span className="ml-1.5">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && <div className="px-3 pb-3 pt-1 bg-white/50">{children}</div>}
    </div>
  );
}

function Field({ f, value, onChange, values, upstream, inputRef, emphasis = 'normal', readOnly = false, heuristic, onHeuristicChange }) {
  const baseInput = `w-full px-2.5 py-1.5 border rounded text-sm ${
    readOnly ? 'bg-slate-50 text-slate-700 border-slate-200 cursor-not-allowed' :
    emphasis === 'strong' ? 'border-amber-400 bg-white' : 'border-slate-300 bg-white'
  }`;
  let control;
  function set(v) { if (!readOnly) onChange?.({ ...values, [f.key]: v }); }

  if (f.type === 'boolean') {
    control = (
      <label className="flex items-center gap-2">
        <input ref={inputRef} type="checkbox" checked={!!value} disabled={readOnly} onChange={e => set(e.target.checked)} />
        <span className="text-sm text-slate-700">{value ? 'Yes' : 'No'}</span>
      </label>
    );
  } else if (f.type === 'select') {
    control = (
      <select ref={inputRef} className={baseInput} value={value ?? ''} disabled={readOnly} onChange={e => set(e.target.value || null)}>
        <option value="">— select —</option>
        {(f.options || []).map(o => <option key={o} value={o}>{String(o).replace(/_/g, ' ')}</option>)}
      </select>
    );
  } else if (f.type === 'textarea') {
    control = (
      <textarea ref={inputRef} className={baseInput} rows={3} value={value ?? ''} disabled={readOnly}
        readOnly={readOnly}
        onChange={e => set(e.target.value === '' ? null : e.target.value)}
        placeholder={f.placeholder} />
    );
  } else {
    const t = TYPE_INPUTS[f.type] || 'text';
    control = (
      <input
        ref={inputRef}
        type={t}
        className={baseInput}
        value={value ?? ''}
        disabled={readOnly}
        readOnly={readOnly}
        onChange={e => set(e.target.value === '' ? null : e.target.value)}
        placeholder={f.placeholder}
        min={f.min} max={f.max}
        step={f.type === 'currency' || f.type === 'percent' ? '0.01' : undefined}
        pattern={f.pattern}
      />
    );
  }

  return (
    <div>
      <label className={`block text-xs mb-1 ${emphasis === 'strong' ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
        {f.label || f.key}
        {f.requiredAt && (
          <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">→ {f.requiredAt.replace(/_/g, ' ')}</span>
        )}
      </label>
      {control}
      {!readOnly && upstream && (
        <button
          type="button"
          onClick={() => set(upstream.value)}
          className="text-[11px] text-amber-700 hover:text-amber-900 hover:underline mt-0.5 inline-flex items-center gap-1">
          ↪ Use <strong className="mx-0.5">{String(upstream.value).slice(0, 40)}</strong> from {upstream.source_lane}.{upstream.source_item}
        </button>
      )}
      {heuristic && (
        <HeuristicBadge fieldKey={f.key} heuristic={heuristic} onHeuristicChange={onHeuristicChange} />
      )}
      {f.helpText && <p className="text-[11px] text-slate-500 mt-0.5">{f.helpText}</p>}
    </div>
  );
}

// Inline badge shown under any field whose value was auto-filled from a
// bill-analysis heuristic during /portal → /pm sync. Click "Mark verified"
// after confirming with the customer.
function HeuristicBadge({ fieldKey, heuristic, onHeuristicChange }) {
  const verified = !!heuristic?.verified;
  const confColor = heuristic.confidence === 'medium'
    ? 'bg-amber-100 border-amber-300 text-amber-800'
    : heuristic.confidence === 'high'
      ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
      : 'bg-slate-100 border-slate-300 text-slate-700';
  return (
    <div className={`mt-1 rounded-md border px-2 py-1.5 text-[11px] ${verified ? 'bg-emerald-50 border-emerald-300' : confColor}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold">
            {verified
              ? <span className="text-emerald-800">✓ Verified by sales</span>
              : <span>🔍 Estimated from bill — confidence: <span className="uppercase">{heuristic.confidence || 'low'}</span></span>}
          </div>
          {heuristic.basis && <div className="text-slate-600 mt-0.5">{heuristic.basis}</div>}
        </div>
        {onHeuristicChange && (
          <button
            type="button"
            onClick={() => onHeuristicChange(fieldKey, { verified: !verified })}
            className={`flex-shrink-0 text-[11px] font-semibold px-2 py-1 rounded border ${
              verified
                ? 'border-emerald-400 text-emerald-700 hover:bg-emerald-100'
                : 'border-amber-400 text-amber-800 hover:bg-amber-100'
            }`}
            title={verified ? 'Mark this as unverified (revert)' : 'Mark this heuristic as confirmed by sales'}>
            {verified ? 'Unmark' : 'Mark verified'}
          </button>
        )}
      </div>
    </div>
  );
}
