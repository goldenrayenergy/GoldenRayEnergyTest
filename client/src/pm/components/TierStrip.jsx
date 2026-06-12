import { useId } from 'react';

// ────────────────────────────────────────────────────────────────────────────
// TierStrip — chips for each tier at the top of the QuoteFormPage.
//
// Props:
//   tiers          : array of { tier_id?, label, pricing, is_recommended,
//                               source, engine_warnings }
//   activeIndex    : currently-edited tier index
//   stage          : spec.pricing.stage  ('stage_1_estimate' | 'stage_2_firm')
//   sizeMode       : 'same_size' | 'tiered_sizes' (Option 4c)
//   canRecompose   : boolean — true when bills exist and can be recomposed
//   recomposing    : boolean — true while a recompose call is in flight
//   onPickActive   : (newIdx) => void
//   onRename       : (idx, newLabel) => void
//   onMarkRec      : (idx) => void   — radio: only one can be recommended
//   onAdd          : () => void      — disabled when length === 3
//   onDelete       : (idx) => void   — disabled when length === 1
//   onSizeModeChange : (newMode) => void  — Option 4c
//   onRecompose    : () => void      — Option 4c
//
// Visual rules:
//   • Active tier has bold ring + amber accent
//   • Recommended tier shows ★ in label
//   • Per-tier badge shows source: Engine pick / Partial / Override / Empty
// ────────────────────────────────────────────────────────────────────────────
export default function TierStrip({
  tiers, activeIndex, stage, sizeMode = 'same_size',
  canRecompose = false, recomposing = false,
  onPickActive, onRename, onMarkRec, onAdd, onDelete,
  onSizeModeChange, onRecompose,
}) {
  const ribbonWord = stage === 'stage_2_firm' ? 'SELECTED' : 'RECOMMENDED';
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Tiers ({tiers.length}/3)
        </h3>
        <div className="text-xs text-slate-500">
          Click a tier to edit it. ★ marks the {ribbonWord.toLowerCase()} tier.
        </div>
      </div>

      {/* Option 4c — size mode toggle + recompose */}
      <div className="flex items-center justify-between mb-3 px-2 py-2 bg-slate-50 border border-slate-200 rounded text-xs flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-700">Tier sizing mode:</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="size-mode" value="same_size"
                   checked={sizeMode === 'same_size'}
                   onChange={() => onSizeModeChange?.('same_size')}
                   className="text-amber-500" />
            <span>Same kW (battery / features differ)</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="size-mode" value="tiered_sizes"
                   checked={sizeMode === 'tiered_sizes'}
                   onChange={() => onSizeModeChange?.('tiered_sizes')}
                   className="text-amber-500" />
            <span>Different kW (starter / right-size / future-proof)</span>
          </label>
        </div>
        {onRecompose && (
          <button
            type="button"
            onClick={onRecompose}
            disabled={!canRecompose || recomposing}
            className="text-xs px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!canRecompose ? 'Bill analysis needed to recompose' : 'Re-run engine for all 3 tiers from bills'}>
            {recomposing ? 'Recomposing…' : 'Recompose from bills'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {tiers.map((t, idx) => (
          <TierCard
            key={t.tier_id || idx}
            tier={t}
            idx={idx}
            isActive={idx === activeIndex}
            ribbonWord={ribbonWord}
            canDelete={tiers.length > 1}
            onPickActive={() => onPickActive(idx)}
            onRename={(newLabel) => onRename(idx, newLabel)}
            onMarkRec={() => onMarkRec(idx)}
            onDelete={() => onDelete(idx)}
          />
        ))}
        {tiers.length < 3 && (
          <button
            type="button"
            onClick={onAdd}
            className="border-2 border-dashed border-slate-300 rounded-lg p-3 text-sm text-slate-500 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50 transition-colors flex items-center justify-center gap-2 min-h-[88px]"
          >
            + Add tier
          </button>
        )}
      </div>
    </div>
  );
}

// Option 4c — source badge styling per tier state
const SOURCE_BADGES = {
  engine_auto:    { label: 'Engine pick',     className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  engine_partial: { label: 'Partial — warnings', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  rep_override:   { label: 'Manual override', className: 'bg-sky-100 text-sky-800 border-sky-300' },
  empty:          { label: 'Empty',           className: 'bg-slate-100 text-slate-600 border-slate-300' },
};

function TierCard({
  tier, idx, isActive, ribbonWord, canDelete,
  onPickActive, onRename, onMarkRec, onDelete,
}) {
  const renameId = useId();
  const rec = tier.is_recommended === true;
  const price = tier.pricing?.customer_price_inc_gst;
  const source = tier.source || 'empty';
  const badge = SOURCE_BADGES[source] || SOURCE_BADGES.empty;
  const warnings = tier.engine_warnings || [];

  return (
    <div
      onClick={onPickActive}
      className={
        'relative cursor-pointer rounded-lg p-3 border transition-all ' +
        (isActive
          ? 'border-amber-500 ring-2 ring-amber-400/40 bg-amber-50/60'
          : 'border-slate-200 hover:border-slate-300 bg-white')
      }
    >
      {rec && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded uppercase tracking-wider">
          ★ {ribbonWord}
        </span>
      )}

      <div className="flex items-start justify-between gap-2">
        <label htmlFor={renameId}
               onClick={e => e.stopPropagation()}
               className="flex-1 group">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 mb-0.5 group-focus-within:text-amber-600">
            ✎ Tier name (click to edit)
          </span>
          <input
            id={renameId}
            type="text"
            value={tier.label || ''}
            onChange={e => onRename(e.target.value)}
            onClick={e => e.stopPropagation()}
            className="w-full bg-white border border-slate-200 rounded text-sm font-semibold text-slate-900 outline-none hover:border-amber-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 px-2 py-1"
            placeholder={`Tier ${idx + 1}`}
          />
        </label>
        {canDelete && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            title="Delete this tier"
            className="mt-4 text-slate-400 hover:text-rose-600 text-xs px-1 self-start"
          >
            ✕
          </button>
        )}
      </div>

      {/* Option 4c — source badge */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${badge.className}`}>
          {badge.label}
        </span>
        {warnings.length > 0 && (
          <span className="text-[9px] text-amber-700"
                title={warnings.map(w => w.message).join('\n')}>
            ⚠ {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="text-lg font-bold text-slate-900 mt-2">
        {price ? `$${Math.round(price).toLocaleString('en-NZ')}` : '$—'}
        <span className="text-xs font-normal text-slate-500 ml-1">inc GST</span>
      </div>

      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
        <input
          type="radio"
          name="recommended-tier"
          checked={rec}
          onChange={(e) => { e.stopPropagation(); onMarkRec(); }}
          onClick={(e) => e.stopPropagation()}
          className="text-amber-500 focus:ring-amber-500"
        />
        Mark as {ribbonWord.toLowerCase()}
      </label>
    </div>
  );
}
