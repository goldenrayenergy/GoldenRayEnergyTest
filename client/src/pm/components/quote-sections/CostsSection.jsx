import { useEffect, useState } from 'react';
import { SectionHeading } from './_shared';
import { useAuth } from '../../../context/AuthContext';
import { pmCatalogueAPI } from '../../services/pmQuotesApi';

// ────────────────────────────────────────────────────────────────────────────
// CostsSection (P7)
//
// Renders every line item the engine produced (Hardware / BoS / Labour /
// Compliance / Custom) with a rolling P&L at the bottom. Editable scope per
// locked rules:
//
//   • Hardware               — read-only (catalogue-driven)
//   • BoS + Labour + Compliance — qty + cost editable for any rep; margin admin-only
//   • Custom add-on lines    — fully editable; category dropdown routes the line
//
// Per the cost-visibility memory:
//   • Internal unit cost columns hidden by default
//   • Admin only sees a "Show internal costs" toggle that reveals them
//   • Margin % edits require a reason text (audit-logged) — admin-only
//
// In multi-tier mode the QuoteFormPage wraps spec/update so the edits go to
// the active tier's cost_overrides / custom array automatically.
// ────────────────────────────────────────────────────────────────────────────

const fmt$ = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-NZ');
const fmt$2 = n => '$' + (Number(n) || 0).toFixed(2);
const fmtPct = n => (Number(n) || 0).toFixed(1) + '%';

const CUSTOM_CATEGORIES = [
  { value: 'labour',     label: 'Labour' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'hardware',   label: 'Hardware (rare — usually catalogue-driven)' },
  { value: 'bos',        label: 'BoS (rare — usually catalogue-driven)' },
  { value: 'other',      label: 'Other (rolls into labour subtotal)' },
];

export default function CostsSection({ spec, update, engineSnapshot, quote }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [showInternal, setShowInternal] = useState(false);

  // P8.6 — Cost-picker catalogue (active labour + compliance rate-card rows)
  const [pickerOptions, setPickerOptions] = useState({ labour: [], compliance: [] });
  useEffect(() => {
    let cancelled = false;
    pmCatalogueAPI.costPicker()
      .then(r => { if (!cancelled) setPickerOptions(r.data || { labour: [], compliance: [] }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Engine result for the active tier (already tier-scoped by QuoteFormPage)
  const engine = engineSnapshot?.engine;
  let lines = [];
  let sections = {};
  let totals = {};
  if (engine?.is_multi_tier) {
    // QuoteFormPage's sectionViewSpec already merged the active tier;
    // for engine readback we need to pick the right tier.
    // The form passes engineSnapshot from the LATEST preview, which has
    // ALL tiers in engine.tiers[]. Pick the headline tier as the default view.
    // (TODO: have the form pass activeTierIdx so we read the actual edited tier.)
    const headlineTier = engine.tiers.find(t => t.is_headline) || engine.tiers[0];
    lines = headlineTier?.cost?.lines || [];
    sections = headlineTier?.cost?.sections || {};
    totals = headlineTier?.cost?.totals || {};
  } else if (engine?.cost) {
    lines = engine.cost.lines || [];
    sections = engine.cost.sections || {};
    totals = engine.cost.totals || {};
  }

  const hwLines = lines.filter(l => l.group === 'hardware');
  const bosLines = lines.filter(l => l.group === 'bos');
  const labourLines = lines.filter(l => l.group === 'labour');
  const complianceLines = lines.filter(l => l.group === 'compliance');
  const customLinesFromOverrides = spec.cost_overrides?.custom || [];

  // ── Mutation helpers ────────────────────────────────────────────────────
  function upsertLabourOverride(sku, patch) {
    update(s => {
      const co = s.cost_overrides || { labour: [], compliance: [], custom: [] };
      const labour = [...(co.labour || [])];
      const idx = labour.findIndex(o => o.sku === sku);
      if (idx >= 0) labour[idx] = { ...labour[idx], ...patch };
      else labour.push({ sku, ...patch });
      return { ...s, cost_overrides: { ...co, labour } };
    });
  }
  // P8.7 — BoS overlay (rep can override qty / cost; admin can override margin).
  function upsertBosOverride(sku, patch) {
    update(s => {
      const co = s.cost_overrides || { labour: [], compliance: [], custom: [] };
      const bos = [...(co.bos || [])];
      const idx = bos.findIndex(o => o.sku === sku);
      if (idx >= 0) bos[idx] = { ...bos[idx], ...patch };
      else bos.push({ sku, ...patch });
      return { ...s, cost_overrides: { ...co, bos } };
    });
  }
  function upsertComplianceOverride(sku, patch) {
    update(s => {
      const co = s.cost_overrides || { labour: [], compliance: [], custom: [] };
      const compliance = [...(co.compliance || [])];
      const idx = compliance.findIndex(o => o.sku === sku);
      if (idx >= 0) compliance[idx] = { ...compliance[idx], ...patch };
      else compliance.push({ sku, ...patch });
      return { ...s, cost_overrides: { ...co, compliance } };
    });
  }
  function updateCustomLine(idx, patch) {
    update(s => {
      const co = s.cost_overrides || { labour: [], compliance: [], custom: [] };
      const custom = [...(co.custom || [])];
      custom[idx] = { ...custom[idx], ...patch };
      return { ...s, cost_overrides: { ...co, custom } };
    });
  }
  function addCustomLine() {
    update(s => {
      const co = s.cost_overrides || { labour: [], compliance: [], custom: [] };
      const custom = [...(co.custom || []), {
        name: '', qty: 1, cost_nzd: 0, margin_pct: 30, category: 'labour',
      }];
      return { ...s, cost_overrides: { ...co, custom } };
    });
  }
  // P8.6 — adds a pre-filled line from the labour/compliance rate-card
  function addLineFromCatalogue(row, kind) {
    update(s => {
      const co = s.cost_overrides || { labour: [], compliance: [], custom: [] };
      const custom = [...(co.custom || []), {
        sku: row.sku,
        name: row.name,
        qty: Number(row.default_qty) || 1,
        cost_nzd: Number(row.cost_nzd) || 0,
        margin_pct: Number(row.margin_pct) || 30,
        category: kind,        // 'labour' | 'compliance'
        source: 'catalogue',   // marker for audit + future filtering
      }];
      return { ...s, cost_overrides: { ...co, custom } };
    });
  }
  function removeCustomLine(idx) {
    update(s => {
      const co = s.cost_overrides || { labour: [], compliance: [], custom: [] };
      const custom = (co.custom || []).filter((_, i) => i !== idx);
      return { ...s, cost_overrides: { ...co, custom } };
    });
  }

  const showCostCol = isAdmin && showInternal;

  // Floor status colour for P&L
  const floor = totals.project_margin_pct >= 12 ? 'healthy'
              : totals.project_margin_pct >= 10 ? 'amber'
              : 'below_floor';
  const floorClass =
    floor === 'healthy'     ? 'text-emerald-700' :
    floor === 'amber'       ? 'text-amber-700' :
                              'text-rose-700';

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Costs — Hardware · BoS · Labour · Compliance"
        subtitle="Every line item the engine produced. Hardware comes from the catalogue (read-only). BoS, Labour, and Compliance are editable per quote (margin admin-only). Add one-off charges in the Custom section." />

      {isAdmin && (
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 px-3 py-2 rounded">
          <input
            type="checkbox"
            checked={showInternal}
            onChange={e => setShowInternal(e.target.checked)}
            className="rounded border-slate-300 text-amber-500 focus:ring-amber-500"
          />
          Show internal costs <span className="text-slate-500">(unit cost + margin %)</span>
          <span className="ml-2 text-rose-700 font-semibold">⚠ Hide before screen-sharing with customers</span>
        </label>
      )}

      {lines.length === 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-md p-4 text-sm text-slate-500">
          Save changes (or wait for live preview) to populate the cost lines.
        </div>
      )}

      {lines.length > 0 && (<>
        <LineBlock
          title="Hardware"
          lines={hwLines}
          subtotal={sections.major_hardware}
          showCostCol={showCostCol}
          editable={false}
        />
        <LineBlock
          title="Balance of System"
          lines={bosLines}
          subtotal={sections.bos}
          showCostCol={showCostCol}
          editable
          isAdmin={isAdmin}
          onLineEdit={(line, patch) => upsertBosOverride(line.sku, patch)}
          overrideMap={Object.fromEntries((spec.cost_overrides?.bos || []).map(o => [o.sku, o]))}
        />
        <LineBlock
          title="Labour"
          lines={labourLines}
          subtotal={sections.labour}
          showCostCol={showCostCol}
          editable
          isAdmin={isAdmin}
          onLineEdit={(line, patch) => upsertLabourOverride(line.sku, patch)}
          overrideMap={Object.fromEntries((spec.cost_overrides?.labour || []).map(o => [o.sku, o]))}
        />
        <LineBlock
          title="Compliance"
          lines={complianceLines}
          subtotal={sections.compliance}
          showCostCol={showCostCol}
          editable
          isAdmin={isAdmin}
          onLineEdit={(line, patch) => upsertComplianceOverride(line.sku, patch)}
          overrideMap={Object.fromEntries((spec.cost_overrides?.compliance || []).map(o => [o.sku, o]))}
        />

        <CustomLines
          lines={customLinesFromOverrides}
          showCostCol={showCostCol}
          isAdmin={isAdmin}
          onAdd={addCustomLine}
          onAddFromCatalogue={addLineFromCatalogue}
          pickerOptions={pickerOptions}
          onUpdate={updateCustomLine}
          onRemove={removeCustomLine}
        />

        {/* Rolling P&L */}
        <div className="bg-slate-900 text-white rounded-lg p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-300 mb-2">
            Rolling P&amp;L (active tier)
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {showCostCol && (
              <Stat label="Total cost ex GST" val={fmt$(totals.total_cost_ex_gst)} />
            )}
            <Stat label="Customer ex GST" val={fmt$(totals.customer_total_ex_gst)} />
            <Stat label="Customer inc GST" val={fmt$(totals.customer_total_inc_gst)} bold />
            {showCostCol && (
              <Stat label="Project profit ex GST" val={fmt$(totals.profit_ex_gst)} />
            )}
            <Stat
              label="Project margin"
              val={<span className={`${floorClass} font-semibold`}>{fmtPct(totals.project_margin_pct)}</span>}
              sub={`floor: ${floor.replace('_', ' ')}`}
            />
          </dl>
          {!showCostCol && (
            <p className="text-[10px] text-slate-400 mt-2">
              Internal cost + profit hidden. Admin can toggle "Show internal costs" above.
            </p>
          )}
        </div>
      </>)}
    </div>
  );
}

// ── Block of line items ──────────────────────────────────────────────────
function LineBlock({ title, lines, subtotal, showCostCol, editable, isAdmin, onLineEdit, overrideMap = {} }) {
  if (!lines || lines.length === 0) return null;
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <div className="text-xs text-slate-600">
          Subtotal sell: <b>{fmt$(subtotal?.sell_ex_gst)}</b>
          {showCostCol && <> · cost <b>{fmt$(subtotal?.cost)}</b> · margin <b>{fmt$(subtotal?.margin_dollar)}</b></>}
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium text-slate-600 w-2/5">Item</th>
            <th className="text-right px-3 py-1.5 font-medium text-slate-600">Qty</th>
            {showCostCol && <th className="text-right px-3 py-1.5 font-medium text-slate-600">Unit cost</th>}
            {showCostCol && <th className="text-right px-3 py-1.5 font-medium text-slate-600">Margin %</th>}
            <th className="text-right px-3 py-1.5 font-medium text-slate-600">Sell ex GST</th>
            <th className="text-right px-3 py-1.5 font-medium text-slate-600">Line total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(line => {
            const ov = overrideMap[line.sku];
            const isOverridden = !!ov;
            return (
              <tr key={line.sku} className={isOverridden ? 'bg-amber-50/40' : ''}>
                <td className="px-3 py-1.5">
                  <div className="text-slate-900">{line.name || line.sku}</div>
                  <div className="text-[10px] font-mono text-slate-400">{line.sku}</div>
                  {isOverridden && (
                    <div className="text-[10px] text-amber-700 mt-0.5">
                      ✎ overridden{ov.override_reason ? ` — ${ov.override_reason}` : ''}
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {editable ? (
                    <input
                      type="number"
                      value={ov?.qty ?? line.qty}
                      onChange={e => onLineEdit(line, { qty: Number(e.target.value) })}
                      className="w-16 text-right border border-slate-300 rounded px-1 py-0.5 text-xs focus:border-amber-500 outline-none"
                      min={0}
                    />
                  ) : line.qty}
                </td>
                {showCostCol && (
                  <td className="px-3 py-1.5 text-right">
                    {editable ? (
                      <input
                        type="number"
                        value={ov?.cost_nzd ?? line.unit_cost}
                        onChange={e => onLineEdit(line, { cost_nzd: Number(e.target.value) })}
                        step="0.01"
                        className="w-20 text-right border border-slate-300 rounded px-1 py-0.5 text-xs focus:border-amber-500 outline-none"
                      />
                    ) : fmt$2(line.unit_cost)}
                  </td>
                )}
                {showCostCol && (
                  <td className="px-3 py-1.5 text-right">
                    {editable && isAdmin ? (
                      <input
                        type="number"
                        value={ov?.margin_pct ?? line.margin_pct}
                        onChange={e => {
                          const reason = window.prompt(
                            'Margin override requires a reason (audit-logged). Why are you changing this?'
                          );
                          if (reason && reason.length >= 10) {
                            onLineEdit(line, { margin_pct: Number(e.target.value), override_reason: reason });
                          }
                        }}
                        className="w-14 text-right border border-slate-300 rounded px-1 py-0.5 text-xs focus:border-rose-500 outline-none"
                        min={0}
                        max={200}
                      />
                    ) : (
                      <span className={editable && !isAdmin ? 'text-slate-400 cursor-not-allowed' : ''}>
                        {(ov?.margin_pct ?? line.margin_pct).toFixed?.(0) ?? line.margin_pct}%
                      </span>
                    )}
                  </td>
                )}
                <td className="px-3 py-1.5 text-right text-slate-700">{fmt$2(line.sell_ex_gst)}</td>
                <td className="px-3 py-1.5 text-right font-medium text-slate-900">{fmt$(line.sell_ex_gst)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Custom add-on lines ──────────────────────────────────────────────────
function CustomLines({ lines, showCostCol, isAdmin, onAdd, onAddFromCatalogue, pickerOptions, onUpdate, onRemove }) {
  const labourOpts     = pickerOptions?.labour     || [];
  const complianceOpts = pickerOptions?.compliance || [];
  const hasCatalogue   = labourOpts.length > 0 || complianceOpts.length > 0;

  function handlePick(e) {
    const v = e.target.value;          // "labour:LAB-INS-7KW" or "compliance:CMP-ESC"
    if (!v) return;
    const [kind, sku] = v.split(':');
    const pool = kind === 'labour' ? labourOpts : complianceOpts;
    const row = pool.find(r => r.sku === sku);
    if (row && onAddFromCatalogue) onAddFromCatalogue(row, kind);
    e.target.value = '';               // reset so the same SKU can be picked again
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Custom one-off lines</h3>
        <div className="flex items-center gap-2">
          {hasCatalogue && (
            <select
              defaultValue=""
              onChange={handlePick}
              className="text-xs px-2 py-1 border border-slate-300 rounded bg-white focus:border-amber-500 outline-none">
              <option value="">+ Pick from catalogue…</option>
              {labourOpts.length > 0 && (
                <optgroup label="Labour">
                  {labourOpts.map(r => (
                    <option key={r.sku} value={`labour:${r.sku}`}>
                      {r.sku} · {r.name}{showCostCol ? ` — $${Math.round(Number(r.cost_nzd))}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {complianceOpts.length > 0 && (
                <optgroup label="Compliance">
                  {complianceOpts.map(r => (
                    <option key={r.sku} value={`compliance:${r.sku}`}>
                      {r.sku} · {r.name}{showCostCol ? ` — $${Math.round(Number(r.cost_nzd))}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          <button onClick={onAdd}
                  className="text-xs px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded font-medium">
            + Blank line
          </button>
        </div>
      </div>
      {lines.length === 0 ? (
        <div className="px-4 py-3 text-xs text-slate-500">
          No custom add-on lines. Pick from the catalogue dropdown above, or use Blank line for one-off charges
          (rural surcharges, weekend premiums, custom enclosures, etc.).
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium text-slate-600">Name</th>
              <th className="text-left px-3 py-1.5 font-medium text-slate-600">Category</th>
              <th className="text-right px-3 py-1.5 font-medium text-slate-600">Qty</th>
              {showCostCol && <th className="text-right px-3 py-1.5 font-medium text-slate-600">Unit cost</th>}
              {showCostCol && <th className="text-right px-3 py-1.5 font-medium text-slate-600">Margin %</th>}
              <th className="px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td className="px-3 py-1.5">
                  {l.sku && (
                    <div className="text-[10px] font-mono text-slate-400 mb-0.5">
                      {l.sku}{l.source === 'catalogue' ? ' · catalogue' : ''}
                    </div>
                  )}
                  <input
                    type="text"
                    value={l.name || ''}
                    onChange={e => onUpdate(idx, { name: e.target.value })}
                    placeholder="e.g., Rural access surcharge"
                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:border-amber-500 outline-none"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={l.category || 'labour'}
                    onChange={e => onUpdate(idx, { category: e.target.value })}
                    className="border border-slate-300 rounded px-2 py-1 text-xs bg-white focus:border-amber-500 outline-none">
                    {CUSTOM_CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input
                    type="number"
                    value={l.qty ?? 1}
                    onChange={e => onUpdate(idx, { qty: Number(e.target.value) })}
                    className="w-16 text-right border border-slate-300 rounded px-1 py-0.5 text-xs focus:border-amber-500 outline-none"
                    min={0}
                  />
                </td>
                {showCostCol && (
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      value={l.cost_nzd ?? 0}
                      onChange={e => onUpdate(idx, { cost_nzd: Number(e.target.value) })}
                      step="0.01"
                      className="w-20 text-right border border-slate-300 rounded px-1 py-0.5 text-xs focus:border-amber-500 outline-none"
                    />
                  </td>
                )}
                {showCostCol && (
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      disabled={!isAdmin}
                      value={l.margin_pct ?? 30}
                      onChange={e => isAdmin && onUpdate(idx, { margin_pct: Number(e.target.value) })}
                      className="w-14 text-right border border-slate-300 rounded px-1 py-0.5 text-xs focus:border-amber-500 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                      min={0}
                      max={200}
                    />
                  </td>
                )}
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => onRemove(idx)} title="Remove this line"
                          className="text-slate-400 hover:text-rose-600 text-xs">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, val, sub, bold }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={'text-lg ' + (bold ? 'font-bold' : 'font-semibold')}>{val}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
