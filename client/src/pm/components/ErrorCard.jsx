// ────────────────────────────────────────────────────────────────────────────
// ErrorCard — the one card used everywhere the team hits an error.
//
// Renders a catalogue `entry` ({ title, meaning, whatToDo, owner, severity })
// with who-fixes-it + severity badges, an optional "jump to tab" action, and a
// "Report it" escape hatch. Same component for bills, quote editor, convert /
// generate, and the global safety net — so the team sees one consistent pattern.
//
// Props:
//   entry     — { title, meaning, whatToDo, owner, severity, code? }  (required)
//   tab,tabLabel,onJump — optional: show "→ Open <tabLabel> tab"
//   onReport  — optional: () => void  shows the "Report it" button
//   detail    — optional: raw technical message (collapsible "More detail")
// ────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { OWNERS, SEVERITIES } from '../utils/errorCatalogue';

const TONE = {
  emerald: 'bg-emerald-100 text-emerald-800',
  amber:   'bg-amber-100 text-amber-800',
  rose:    'bg-rose-100 text-rose-800',
  slate:   'bg-slate-100 text-slate-700',
};

function Badge({ tone, children }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${TONE[tone] || TONE.slate}`}>
      {children}
    </span>
  );
}

export default function ErrorCard({ entry, tab, tabLabel, onJump, onReport, detail }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!entry) return null;

  const owner = OWNERS[entry.owner] || OWNERS.rep;
  const sev = SEVERITIES[entry.severity] || SEVERITIES.flag;

  return (
    <li className="bg-white border border-slate-200 rounded p-2.5 text-xs">
      <div className="flex items-center gap-1.5 mb-1">
        <Badge tone={owner.tone}>{owner.badge}</Badge>
        <Badge tone={sev.tone}>{sev.label}</Badge>
        {entry.code && (
          <span className="ml-auto font-mono text-[9px] text-slate-400">{entry.code}</span>
        )}
      </div>

      <div className="font-semibold text-slate-900">{entry.title}</div>

      {entry.meaning && (
        <div className="text-slate-500 mt-0.5">{entry.meaning}</div>
      )}

      {entry.whatToDo && (
        <div className="mt-1.5 text-slate-700">
          <span className="font-semibold text-emerald-700">What to do: </span>
          {entry.whatToDo}
        </div>
      )}

      <div className="flex items-center gap-3 mt-2">
        {tab && onJump && (
          <button type="button" onClick={() => onJump(tab)}
            className="text-[11px] text-blue-700 hover:underline">
            → Open {tabLabel} tab
          </button>
        )}
        {detail && (
          <button type="button" onClick={() => setShowDetail(v => !v)}
            className="text-[11px] text-slate-500 hover:underline">
            {showDetail ? 'Hide detail' : 'More detail'}
          </button>
        )}
        {onReport && (
          <button type="button" onClick={onReport}
            className="ml-auto text-[11px] text-rose-600 hover:underline">
            Report it
          </button>
        )}
      </div>

      {showDetail && detail && (
        <pre className="mt-1.5 p-1.5 bg-slate-50 border border-slate-200 rounded text-[10px] text-slate-600 whitespace-pre-wrap break-words">
          {detail}
        </pre>
      )}
    </li>
  );
}
