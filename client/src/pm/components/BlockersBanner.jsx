// ── BlockersBanner ──
// Renders at the top of the ItemPanel work surface when the task can't
// advance to its next state. Two reasons surfaced separately:
//   - cross-lane blockers: upstream tasks in OTHER lanes must complete
//   - missing fields: form fields required at the next state aren't filled
//
// Cross-lane blockers are clickable so the user can jump to the upstream
// task. Missing fields scroll into view.

const LANE_LABELS = {
  sales: 'Sales',
  engineering: 'Engineering',
  compliance: 'Compliance',
  operations: 'Operations',
  finance: 'Finance',
};

export default function BlockersBanner({ blockers, onJumpToTask }) {
  if (!blockers) return null;
  const xLane    = blockers.cross_lane_blockers || [];
  const missingF = blockers.missing_fields || [];
  if (xLane.length === 0 && missingF.length === 0) return null;

  const next = blockers.next_state ? blockers.next_state.replace(/_/g, ' ') : 'next state';

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm">
      <div className="font-semibold text-amber-900 mb-1.5">
        ⏳ Waiting to advance to <em>{next}</em>
      </div>

      {xLane.length > 0 && (
        <div className="mb-2">
          <div className="text-xs font-medium text-amber-800 mb-1">Upstream tasks not done:</div>
          <ul className="space-y-1">
            {xLane.map(b => (
              <li key={`${b.lane}.${b.item}`}>
                <button
                  onClick={() => onJumpToTask?.(b.lane, b.item)}
                  className="text-xs text-amber-900 hover:underline">
                  ▸ {LANE_LABELS[b.lane] || b.lane} · {b.item.replace(/_/g, ' ')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {missingF.length > 0 && (
        <div>
          <div className="text-xs font-medium text-amber-800 mb-1">Required fields:</div>
          <ul className="text-xs text-amber-900 list-disc list-inside space-y-0.5">
            {missingF.map(f => (
              <li key={f.key}><strong>{f.label || f.key}</strong></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
