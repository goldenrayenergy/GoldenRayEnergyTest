// ────────────────────────────────────────────────────────────────────────────
// Troubleshooting — the searchable Error Playbook, generated from the single
// catalogue source so it never drifts from the inline cards the team sees.
// The team's "go look it up" reference: every warning/error, what it means,
// what to do, and who fixes it.
// ────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { CATALOGUE, OWNERS, SEVERITIES } from '../utils/errorCatalogue';

const AREAS = [
  { key: 'all',     label: 'All' },
  { key: 'bill',    label: 'Bill analysis' },
  { key: 'quote',   label: 'Quote build' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'sales',   label: 'Sales & lifecycle' },
  { key: 'system',  label: 'System' },
];

const OWNER_FILTERS = [
  { key: 'all',   label: 'Anyone' },
  { key: 'rep',   label: 'You (rep)' },
  { key: 'admin', label: 'Admin' },
  { key: 'dev',   label: 'Dev' },
];

const TONE = {
  emerald: 'bg-emerald-100 text-emerald-800',
  amber:   'bg-amber-100 text-amber-800',
  rose:    'bg-rose-100 text-rose-800',
  slate:   'bg-slate-100 text-slate-700',
};

function Badge({ tone, children }) {
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${TONE[tone] || TONE.slate}`}>{children}</span>;
}

export default function TroubleshootingPage() {
  const [q, setQ] = useState('');
  const [area, setArea] = useState('all');
  const [owner, setOwner] = useState('all');

  const all = useMemo(
    () => Object.entries(CATALOGUE).map(([code, e]) => ({ code, ...e })),
    []
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(e => {
      if (area !== 'all' && e.area !== area) return false;
      if (owner !== 'all' && e.owner !== owner) return false;
      if (!needle) return true;
      return [e.code, e.title, e.meaning, e.whatToDo].filter(Boolean)
        .some(s => s.toLowerCase().includes(needle));
    });
  }, [all, q, area, owner]);

  // Group the filtered results by area for display.
  const groups = useMemo(() => {
    const byArea = {};
    for (const e of filtered) (byArea[e.area] = byArea[e.area] || []).push(e);
    return AREAS.filter(a => a.key !== 'all' && byArea[a.key]?.length)
      .map(a => ({ ...a, items: byArea[a.key] }));
  }, [filtered]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-slate-900">Troubleshooting</h1>
        <span className="text-xs text-slate-500">{filtered.length} of {all.length}</span>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Every warning the system can show, in plain English — what it means, what to do, and who
        fixes it. Same guidance you see inline; this is the place to look one up.
      </p>

      {/* Search + filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4 space-y-3">
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search — e.g. “double count”, “site survey”, “discount”…"
          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          {AREAS.map(a => (
            <button key={a.key} type="button" onClick={() => setArea(a.key)}
              className={`text-xs px-2.5 py-1 rounded-full border ${area === a.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
              {a.label}
            </button>
          ))}
          <span className="w-px bg-slate-200 mx-1" />
          {OWNER_FILTERS.map(o => (
            <button key={o.key} type="button" onClick={() => setOwner(o.key)}
              className={`text-xs px-2.5 py-1 rounded-full border ${owner === o.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-4 text-[11px] text-slate-500 items-center">
        <span>Who fixes it:</span>
        <Badge tone={OWNERS.rep.tone}>{OWNERS.rep.badge}</Badge> you ·
        <Badge tone={OWNERS.admin.tone}>{OWNERS.admin.badge}</Badge> admin ·
        <Badge tone={OWNERS.dev.tone}>{OWNERS.dev.badge}</Badge> dev
        <span className="ml-3">Severity:</span>
        <Badge tone={SEVERITIES.block.tone}>{SEVERITIES.block.label}</Badge>
        <Badge tone={SEVERITIES.flag.tone}>{SEVERITIES.flag.label}</Badge>
        <Badge tone={SEVERITIES.info.tone}>{SEVERITIES.info.label}</Badge>
      </div>

      {groups.length === 0 && (
        <div className="text-sm text-slate-500 italic py-8 text-center">
          Nothing matches “{q}”. Try a different word, or clear the filters.
        </div>
      )}

      {groups.map(g => (
        <div key={g.key} className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{g.label}</h2>
          <ul className="space-y-2">
            {g.items.map(e => {
              const owner = OWNERS[e.owner] || OWNERS.rep;
              const sev = SEVERITIES[e.severity] || SEVERITIES.flag;
              return (
                <li key={e.code} className="bg-white border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge tone={owner.tone}>{owner.badge}</Badge>
                    <Badge tone={sev.tone}>{sev.label}</Badge>
                    <span className="ml-auto font-mono text-[9px] text-slate-400">{e.code}</span>
                  </div>
                  <div className="font-semibold text-sm text-slate-900">{e.title}</div>
                  {e.meaning && <div className="text-xs text-slate-500 mt-0.5">{e.meaning}</div>}
                  {e.whatToDo && (
                    <div className="text-xs text-slate-700 mt-1.5">
                      <span className="font-semibold text-emerald-700">What to do: </span>{e.whatToDo}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
