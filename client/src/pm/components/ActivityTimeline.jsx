import { fmtDateTime } from '../../utils/format';

// Append-only event feed for a single task (lane + item_key).
// Renders state changes, field edits, file uploads, comments — all interleaved.

const EVENT_LABELS = {
  state_changed:      (p) => `Workflow advanced: ${p?.from?.replace(/_/g,' ')} → ${p?.to?.replace(/_/g,' ')}`,
  field_edited:       (p) => `Updated: ${(p?.keys || []).join(', ')}`,
  file_uploaded:      (p) => `Uploaded ${p?.original_name || 'file'}`,
  file_deleted:       (p) => `Deleted ${p?.original_name || 'file'}`,
  gate_check_passed:  ()  => 'Cross-lane gate passed ✓',
  gate_check_blocked: (p) => `Blocked by: ${(p?.blockers || []).map(b => `${b.lane}.${b.item}`).join(', ')}`,
  comment_added:      (p) => `Commented: "${(p?.body_preview || '').slice(0, 80)}${p?.body_preview?.length > 80 ? '…' : ''}"`,
  task_reopened:      (p) => `🔓 Task reopened from done → ${p?.to?.replace(/_/g,' ')}`,
  lane_completed:     (p) => `🎉 Lane "${p?.lane}" auto-completed (all gate-keepers ✓)`,
  lane_reopened:      (p) => `Lane "${p?.lane}" reopened (a gate-keeper was unchecked)`,
};

const EVENT_DOTS = {
  state_changed:      'bg-blue-500',
  field_edited:       'bg-slate-400',
  file_uploaded:      'bg-amber-500',
  file_deleted:       'bg-red-400',
  gate_check_passed:  'bg-green-500',
  gate_check_blocked: 'bg-red-500',
  comment_added:      'bg-purple-500',
  task_reopened:      'bg-orange-500',
  lane_completed:     'bg-green-600',
  lane_reopened:      'bg-orange-400',
};

export default function ActivityTimeline({ events }) {
  if (!events || events.length === 0) {
    return <p className="text-sm text-slate-400 italic">No activity yet.</p>;
  }

  return (
    <ol className="relative border-l-2 border-slate-200 pl-4 space-y-3">
      {events.map(ev => {
        const label = EVENT_LABELS[ev.event_type]?.(ev.payload) || ev.event_type;
        const dot   = EVENT_DOTS[ev.event_type] || 'bg-slate-300';
        return (
          <li key={ev.id} className="relative">
            <span className={`absolute -left-[22px] top-1 w-3 h-3 rounded-full ring-2 ring-white ${dot}`} />
            <div className="text-xs text-slate-700">{label}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {fmtDateTime(ev.occurred_at)}
              {ev.actor_user_id && <span> · {ev.actor_user_id.slice(0, 8)}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
