// ── State machine UI — Phase A.2.3 redesign ──
// Visual stepper instead of per-state transition buttons. The user no
// longer manually clicks "→ drafted", "→ reviewing", "→ approved" — they
// fill in fields and click ONE "Save & advance" button. The server
// auto-advances the state to the highest reachable point.
//
// A small "..." menu offers force-set / regress for edge cases.

const STATE_COLORS = {
  // base
  not_started:        'text-slate-500',
  // active progress
  attempted:          'text-blue-700',
  reached:            'text-blue-700',
  qualified:          'text-blue-700',
  drafting:           'text-blue-700',
  drafted:            'text-blue-700',
  reviewing:          'text-blue-700',
  scheduled:          'text-blue-700',
  on_site:            'text-blue-700',
  review:             'text-blue-700',
  in_progress:        'text-blue-700',
  partial:            'text-amber-700',
  pending:            'text-amber-700',
  awaiting:           'text-amber-700',
  awaiting_survey:    'text-amber-700',
  awaiting_signature: 'text-amber-700',
  date_proposed:      'text-amber-700',
  customer_confirmed: 'text-blue-700',
  reminded:           'text-blue-700',
  photos_uploaded:    'text-blue-700',
  in_progress_alt:    'text-blue-700',
  submitted:          'text-amber-700',
  asset_populated:    'text-emerald-700',
  // completion
  approved:           'text-emerald-700',
  signed:             'text-emerald-700',
  signed_off:         'text-emerald-700',
  customer_signed:    'text-emerald-700',
  counter_signed:     'text-emerald-700',
  complete:           'text-emerald-700',
  viewed:             'text-emerald-700',
  received:           'text-emerald-700',
  reconciled:         'text-emerald-700',
  // sent (waiting external)
  sent:               'text-amber-700',
  sent_to_customer:   'text-amber-700',
  invoiced:           'text-amber-700',
  // bad
  rejected:           'text-red-700',
  // done
  done:               'text-green-800 font-semibold',
};

const colorOf = (s) => STATE_COLORS[s] || 'text-slate-700';

export default function StateMachineControl({ itemDef, currentState, blockers, onSaveAndAdvance, onForceState, busy, dirty }) {
  const states     = itemDef.states || [];
  const currentIdx = states.indexOf(currentState);
  const nextState  = blockers?.next_state;

  const blocked      = blockers && (
    (blockers.missing_fields?.length || 0) > 0 ||
    (blockers.cross_lane_blockers?.length || 0) > 0
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-slate-500 uppercase">Workflow</div>
        <details className="relative">
          <summary className="text-[11px] text-slate-400 hover:text-slate-700 cursor-pointer list-none">advanced ▾</summary>
          <div className="absolute right-0 top-5 bg-white border border-slate-300 rounded shadow-lg z-10 py-1 w-44">
            {states.map(s => (
              <button
                key={s}
                onClick={() => onForceState(s)}
                disabled={s === currentState}
                className="block w-full text-left px-3 py-1 text-xs hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400">
                Force → {s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </details>
      </div>

      {/* Stepper */}
      <ol className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
        {states.map((s, idx) => {
          const isCurrent = s === currentState;
          const isPast    = idx < currentIdx;
          return (
            <li key={s} className="flex items-center gap-1 flex-shrink-0">
              <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${
                isCurrent ? 'bg-amber-100 ring-2 ring-amber-400' :
                isPast    ? 'bg-green-50' :
                'bg-slate-50'
              }`}>
                <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center ${
                  isCurrent ? 'bg-amber-500 text-white' :
                  isPast    ? 'bg-green-500 text-white' :
                  'bg-slate-300 text-slate-600'
                }`}>
                  {isPast ? '✓' : idx + 1}
                </span>
                <span className={`text-[11px] ${colorOf(s)}`}>
                  {s.replace(/_/g, ' ')}
                </span>
              </div>
              {idx < states.length - 1 && (
                <span className="text-slate-300">→</span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Save & advance button */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onSaveAndAdvance}
          disabled={busy}
          className={`px-3 py-1.5 rounded font-medium text-sm ${
            blocked
              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
              : 'bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50'
          }`}
          title={blocked ? 'Resolve blockers below first' : 'Save fields and advance to the highest reachable state'}>
          {busy ? 'Saving…' : '💾 Save & advance'}
        </button>
        {dirty && <span className="text-xs text-amber-700">unsaved changes</span>}
        {nextState && nextState !== currentState && (
          <span className="text-xs text-slate-500">
            next: <strong>{nextState.replace(/_/g, ' ')}</strong>
          </span>
        )}
        {currentState === itemDef.doneState && (
          <span className="text-xs text-green-700 font-medium">✓ task complete</span>
        )}
      </div>
    </div>
  );
}
