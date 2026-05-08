// ── State machine UI ──
// Renders the task's state pipeline as a horizontal pill row, with a
// "Move to next" button that triggers the appropriate transition.

const STATE_COLORS = {
  not_started:        'bg-slate-200 text-slate-600',
  attempted:          'bg-blue-100 text-blue-800',
  reached:            'bg-blue-100 text-blue-800',
  qualified:          'bg-blue-100 text-blue-800',
  drafting:           'bg-blue-100 text-blue-800',
  drafted:            'bg-blue-100 text-blue-800',
  reviewing:          'bg-blue-100 text-blue-800',
  approved:           'bg-emerald-100 text-emerald-800',
  signed:             'bg-emerald-100 text-emerald-800',
  signed_off:         'bg-emerald-100 text-emerald-800',
  customer_signed:    'bg-emerald-100 text-emerald-800',
  counter_signed:     'bg-emerald-100 text-emerald-800',
  scheduled:          'bg-blue-100 text-blue-800',
  on_site:            'bg-blue-100 text-blue-800',
  review:             'bg-blue-100 text-blue-800',
  in_progress:        'bg-blue-100 text-blue-800',
  partial:            'bg-amber-100 text-amber-800',
  complete:           'bg-emerald-100 text-emerald-800',
  submitted:          'bg-amber-100 text-amber-800',
  awaiting:           'bg-amber-100 text-amber-800',
  awaiting_survey:    'bg-amber-100 text-amber-800',
  awaiting_signature: 'bg-amber-100 text-amber-800',
  sent:               'bg-amber-100 text-amber-800',
  sent_to_customer:   'bg-amber-100 text-amber-800',
  viewed:             'bg-emerald-100 text-emerald-800',
  invoiced:           'bg-amber-100 text-amber-800',
  received:           'bg-emerald-100 text-emerald-800',
  reconciled:         'bg-emerald-100 text-emerald-800',
  rejected:           'bg-red-100 text-red-800',
  done:               'bg-green-200 text-green-900 font-semibold',
};

const colorOf = (s) => STATE_COLORS[s] || 'bg-slate-100 text-slate-700';

export default function StateMachineControl({ itemDef, currentState, onTransition, busy }) {
  const states = itemDef.states || [];
  const allowedNext = (itemDef.transitions?.[currentState] || []);

  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Workflow</div>

      {/* Pill row */}
      <div className="flex flex-wrap gap-1 mb-3">
        {states.map((s, idx) => {
          const isCurrent = s === currentState;
          const isPast    = states.indexOf(currentState) > idx;
          return (
            <span
              key={s}
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                isCurrent ? colorOf(s) + ' ring-2 ring-offset-1 ring-amber-400' :
                isPast    ? 'bg-green-50 text-green-700 line-through' :
                'bg-slate-50 text-slate-400'
              }`}>
              {s.replace(/_/g, ' ')}
            </span>
          );
        })}
      </div>

      {/* Transition buttons */}
      {allowedNext.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {allowedNext.map(s => (
            <button
              key={s}
              onClick={() => onTransition(s)}
              disabled={busy}
              className={`text-xs px-2.5 py-1 rounded font-medium border ${
                s === itemDef.doneState
                  ? 'bg-green-600 hover:bg-green-700 border-green-700 text-white disabled:opacity-50'
                  : 'border-slate-300 hover:bg-slate-50 text-slate-700 disabled:opacity-50'
              }`}>
              → {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 italic">No further transitions from this state.</p>
      )}
    </div>
  );
}
