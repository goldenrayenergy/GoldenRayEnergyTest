// ────────────────────────────────────────────────────────────────────────────
// Internal sales console — single-page P&L for the sales rep / owner.
// NOT customer-facing. Includes margin %, hardware blended margin, and the
// margin-floor status that's hidden from the customer PDF.
// Per project memory: cost table cols = Tier / Major HW / BoS / Labour /
// Subtotal / Discount / Final / HW Margin $ / HW Margin % / HW Cost.
//
// P4.5: multi-tier mode emits a side-by-side tier P&L table at the top.
// ────────────────────────────────────────────────────────────────────────────

import { PROPOSAL_CSS, brandMark } from './_shared.js';
import { fmt$, fmtPct } from './proposalData.js';

// ────────────────────────────────────────────────────────────────────────────
// Multi-tier sales console — one row per tier with Krishna-style columns.
//
// Signature: buildMultiTierSalesConsole(d, engineResult)
//   • d            — output of buildMultiTierProposalData (carries d.tiers)
//   • engineResult — full runEngine output (multi-tier)
// ────────────────────────────────────────────────────────────────────────────
export function buildMultiTierSalesConsole(d, engineResult) {
  const tiers = engineResult.tiers || [];
  const recId = engineResult.recommended_tier_id;

  // Row per tier matching Krishna's column locked rule.
  const tierRow = (t) => {
    const c = t.cost?.totals || {};
    const sections = t.cost?.sections || {};
    const isRec = t.tier_id === recId;
    const floor = t.cost?.margin_floor_status;
    const floorClass = floor === 'healthy' ? 'floor-healthy'
                    : floor === 'amber'   ? 'floor-amber'
                    : 'floor-below';
    return `<tr style="${isRec ? 'background:#fff7ed;font-weight:600' : ''}">
      <td>${isRec ? '★ ' : ''}${t.label}</td>
      <td class="num">${fmt$(sections.major_hardware?.cost)}</td>
      <td class="num">${fmt$(sections.bos?.cost)}</td>
      <td class="num">${fmt$((sections.labour?.cost || 0) + (sections.compliance?.cost || 0))}</td>
      <td class="num">${fmt$(c.total_list_inc_gst)}</td>
      <td class="num">${fmt$(c.discount_applied_inc_gst || 0)}</td>
      <td class="num"><b>${fmt$(c.customer_total_inc_gst)}</b></td>
      <td class="num">${fmt$(sections.major_hardware?.margin_dollar)}</td>
      <td class="num">${fmtPct(c.hw_blended_margin_pct || 0)}</td>
      <td class="num">${fmt$(sections.major_hardware?.cost)}</td>
      <td class="num"><b class="${floorClass}">${fmtPct(c.project_margin_pct || 0)}</b></td>
      <td><b class="${floorClass}">${floor}</b></td>
    </tr>`;
  };

  const engineeringRow = (t) => {
    const e = t.engineering || {};
    const isRec = t.tier_id === recId;
    return `<tr style="${isRec ? 'background:#fff7ed' : ''}">
      <td>${isRec ? '★ ' : ''}${t.label}</td>
      <td class="num">${e.passes?.length || 0}</td>
      <td class="num">${e.soft_warnings?.length || 0}</td>
      <td class="num"><b style="${e.hard_fails?.length ? 'color:#DC2626' : ''}">${e.hard_fails?.length || 0}</b></td>
      <td class="num">${e.unverified?.length || 0}</td>
      <td>${t.can_ship ? '<b style="color:#16A34A">✓ ship-ready</b>' : '<b style="color:#DC2626">✗ blocked</b>'}</td>
    </tr>`;
  };

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Sales console — ${d.meta.quote_ref} (3-tier)</title>
<style>${PROPOSAL_CSS}</style>
<style>
  .sc-banner{background:#0B0F1A;color:#fff;padding:12px 14px;border-radius:6px;display:flex;justify-content:space-between;margin-bottom:14px}
  .sc-banner .ttl{font-size:14px;font-weight:900}
  .sc-banner .meta{font-size:10px;text-align:right;color:#9CA3AF}
  .floor-healthy{color:#16A34A}
  .floor-amber{color:#F5A623}
  .floor-below{color:#DC2626}
  table.tight th,table.tight td{font-size:9px;padding:5px 6px}
</style>
</head><body>

<div class="sc-banner">
  <div>
    <div class="ttl">INTERNAL SALES CONSOLE — ${d.meta.quote_ref} (3-tier)</div>
    <div style="font-size:10px;color:#9CA3AF">Customer: ${d.customer.name} · ${d.customer.address_one_line}</div>
  </div>
  <div class="meta">
    <div>Generated ${d.meta.quote_date}</div>
    <div>Tiers: ${tiers.length} · Recommended: <b style="color:#FF6A00">${d.recommended_tier_label}</b></div>
    <div><b style="color:#fff">DO NOT share with customer</b></div>
  </div>
</div>

<h3>Tier P&amp;L comparison (Krishna-format columns)</h3>
<table class="tight">
  <thead><tr>
    <th>Tier</th>
    <th class="num">Major HW</th>
    <th class="num">BoS</th>
    <th class="num">Lab+Cmpl</th>
    <th class="num">Subtotal</th>
    <th class="num">Discount</th>
    <th class="num">Final (inc GST)</th>
    <th class="num">HW Margin $</th>
    <th class="num">HW Margin %</th>
    <th class="num">HW Cost</th>
    <th class="num">Project Margin %</th>
    <th>Floor</th>
  </tr></thead>
  <tbody>
    ${tiers.map(tierRow).join('')}
  </tbody>
</table>

<h3 style="margin-top:14px">Engineering check per tier</h3>
<table class="tight">
  <thead><tr>
    <th>Tier</th>
    <th class="num">Passes</th>
    <th class="num">Soft warnings</th>
    <th class="num">Hard fails</th>
    <th class="num">Unverified</th>
    <th>Status</th>
  </tr></thead>
  <tbody>
    ${tiers.map(engineeringRow).join('')}
  </tbody>
</table>

<h3 style="margin-top:14px">Hard-fail detail (any tier)</h3>
${tiers.flatMap(t => (t.engineering?.hard_fails || []).map(hf =>
  `<div class="amber-banner" style="background:#FEE2E2;border-color:#DC2626;color:#991B1B">[${t.label}] <b>${hf.rule}:</b> ${hf.message}</div>`
)).join('') || '<div style="font-size:11px;color:#5C6470">No hard fails on any tier. ✓</div>'}

<div class="disclaimer" style="margin-top:14px">
  Generated by proposal engine — multi-tier mode (${tiers.length} tiers) ·
  DO NOT include in customer PDF · INTERNAL USE ONLY
</div>

</body></html>`;
}

export function buildSalesConsole(d, costResult) {
  const p = d.pricing;
  const cost = costResult;

  const floorClass = p.floor_status === 'healthy' ? 'floor-healthy'
                  : p.floor_status === 'amber' ? 'floor-amber'
                  : 'floor-below';

  const hardwareLines = cost.lines.filter(l => l.group === 'hardware');
  const bosLines = cost.lines.filter(l => l.group === 'bos');
  const labourLines = cost.lines.filter(l => l.group === 'labour');
  const complianceLines = cost.lines.filter(l => l.group === 'compliance');

  const lineRow = (l) => `
    <tr>
      <td>${l.sku}</td>
      <td>${l.name}</td>
      <td class="num">${l.qty}</td>
      <td class="num">${fmt$(l.unit_cost)}</td>
      <td class="num">${fmt$(l.line_cost)}</td>
      <td class="num">${l.margin_pct}%</td>
      <td class="num">${fmt$(l.sell_ex_gst)}</td>
      <td class="num">${fmt$(l.margin_dollar)}</td>
    </tr>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Sales console — ${d.meta.quote_ref}</title>
<style>${PROPOSAL_CSS}</style>
<style>
  .sc-banner{background:#0B0F1A;color:#fff;padding:12px 14px;border-radius:6px;display:flex;justify-content:space-between;margin-bottom:14px}
  .sc-banner .ttl{font-size:14px;font-weight:900}
  .sc-banner .meta{font-size:10px;text-align:right;color:#9CA3AF}
  .danger-banner{background:#FEE2E2;border-left:4px solid #DC2626;padding:10px 14px;color:#991B1B;font-size:11px;font-weight:700;border-radius:4px;margin-bottom:10px}
  .ok-banner{background:#DCFCE7;border-left:4px solid #16A34A;padding:10px 14px;color:#166534;font-size:11px;font-weight:700;border-radius:4px;margin-bottom:10px}
  .amber-banner{background:#FEF3C7;border-left:4px solid #F5A623;padding:10px 14px;color:#92400e;font-size:11px;font-weight:700;border-radius:4px;margin-bottom:10px}
</style>
</head><body>

<div class="sc-banner">
  <div>
    <div class="ttl">INTERNAL SALES CONSOLE — ${d.meta.quote_ref}</div>
    <div style="font-size:10px;color:#9CA3AF">Customer: ${d.customer.name} · ${d.customer.address_one_line}</div>
  </div>
  <div class="meta">
    <div>Generated ${d.meta.quote_date}</div>
    <div>Spec hash: <code>${(costResult.spec_sha256 || '').slice(0, 12) || 'n/a'}…</code></div>
    <div><b style="color:#fff">DO NOT share with customer</b></div>
  </div>
</div>

${p.floor_status === 'below_floor' ? `
  <div class="danger-banner">
    🛑 MARGIN BELOW FLOOR — owner approval required before generating customer PDF.
    Project margin ${fmtPct(p.margin_pct)} below 10% floor.
  </div>` : p.floor_status === 'amber' ? `
  <div class="amber-banner">
    ⚠ Margin in amber zone (${fmtPct(p.margin_pct)}). Above 10% floor but below 12% healthy threshold.
  </div>` : `
  <div class="ok-banner">
    ✓ Margin healthy at ${fmtPct(p.margin_pct)}.
  </div>`}

<div class="sales-grid">
  <div class="card">
    <h3>P&amp;L summary</h3>
    <table class="tight pl-table">
      <tr><th>Section</th><th class="num">Cost</th><th class="num">Sell ex GST</th><th class="num">Margin $</th></tr>
      <tr><td>Major hardware</td><td class="num">${fmt$(cost.sections.major_hardware.cost)}</td><td class="num">${fmt$(cost.sections.major_hardware.sell_ex_gst)}</td><td class="num">${fmt$(cost.sections.major_hardware.margin_dollar)}</td></tr>
      <tr><td>BoS</td><td class="num">${fmt$(cost.sections.bos.cost)}</td><td class="num">${fmt$(cost.sections.bos.sell_ex_gst)}</td><td class="num">${fmt$(cost.sections.bos.margin_dollar)}</td></tr>
      <tr><td>Labour</td><td class="num">${fmt$(cost.sections.labour.cost)}</td><td class="num">${fmt$(cost.sections.labour.sell_ex_gst)}</td><td class="num">$0</td></tr>
      <tr><td>Compliance</td><td class="num">${fmt$(cost.sections.compliance.cost)}</td><td class="num">${fmt$(cost.sections.compliance.sell_ex_gst)}</td><td class="num">$0</td></tr>
      <tr class="total-row"><td><b>Total ex GST</b></td><td class="num"><b>${fmt$(p.cost_ex_gst)}</b></td><td class="num"><b>${fmt$(p.list_ex_gst)}</b></td><td class="num"><b>${fmt$(p.list_ex_gst - p.cost_ex_gst)}</b></td></tr>
    </table>
  </div>

  <div class="card">
    <h3>Pricing &amp; margin</h3>
    <table class="tight">
      <tr><td>List inc GST</td><td class="num">${fmt$(p.list_inc_gst)}</td></tr>
      <tr><td>Discount applied</td><td class="num">${fmt$(p.discount_inc_gst)} (${p.discount_pct_of_list}%)</td></tr>
      <tr><td>Customer inc GST</td><td class="num"><b>${fmt$(p.customer_inc_gst)}</b></td></tr>
      <tr><td>Customer ex GST</td><td class="num">${fmt$(p.customer_ex_gst)}</td></tr>
      <tr><td>Project profit ex GST</td><td class="num"><b>${fmt$(p.profit_ex_gst)}</b></td></tr>
      <tr><td>Project margin %</td><td class="num"><b class="${floorClass}">${fmtPct(p.margin_pct)}</b></td></tr>
      <tr><td>HW blended margin %</td><td class="num">${fmtPct(cost.totals.hw_blended_margin_pct)}</td></tr>
      <tr><td>Floor status</td><td class="num"><b class="${floorClass}">${p.floor_status}</b></td></tr>
    </table>
  </div>
</div>

<h3 style="margin-top:14px">Engineering checks</h3>
<div class="grid3">
  <div class="card">
    <h4 style="color:#16A34A">✓ Passes (${d.engineering.passes.length})</h4>
    <ul style="font-size:9.5px;padding-left:14px;margin:4px 0">
      ${d.engineering.passes.map(p => `<li><b>${p.rule}:</b> ${p.message}</li>`).join('')}
    </ul>
  </div>
  <div class="card">
    <h4 style="color:#F5A623">⚠ Soft warnings (${d.engineering.soft_warnings.length})</h4>
    <ul style="font-size:9.5px;padding-left:14px;margin:4px 0">
      ${d.engineering.soft_warnings.length === 0 ? '<li>None</li>' : d.engineering.soft_warnings.map(w => `<li><b>${w.rule}:</b> ${w.message}</li>`).join('')}
    </ul>
  </div>
  <div class="card">
    <h4 style="color:#DC2626">✗ Hard fails (${d.engineering.hard_fails.length})</h4>
    <ul style="font-size:9.5px;padding-left:14px;margin:4px 0">
      ${d.engineering.hard_fails.length === 0 ? '<li>None — cleared to ship.</li>' : d.engineering.hard_fails.map(f => `<li><b>${f.rule}:</b> ${f.message}</li>`).join('')}
    </ul>
  </div>
</div>

<h3 style="margin-top:14px">Full BoM + cost breakdown</h3>

<h4>Major hardware</h4>
<table class="tight">
  <tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Line cost</th><th class="num">Margin</th><th class="num">Sell ex GST</th><th class="num">Margin $</th></tr>
  ${hardwareLines.map(lineRow).join('')}
</table>

<h4>BoS</h4>
<table class="tight">
  <tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Line cost</th><th class="num">Margin</th><th class="num">Sell ex GST</th><th class="num">Margin $</th></tr>
  ${bosLines.map(lineRow).join('')}
</table>

<h4>Labour (no markup — sell = cost)</h4>
<table class="tight">
  <tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Line cost</th><th class="num">Margin</th><th class="num">Sell ex GST</th><th class="num">Margin $</th></tr>
  ${labourLines.map(lineRow).join('')}
</table>

<h4>Compliance (no markup)</h4>
<table class="tight">
  <tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Line cost</th><th class="num">Margin</th><th class="num">Sell ex GST</th><th class="num">Margin $</th></tr>
  ${complianceLines.map(lineRow).join('')}
</table>

<h3 style="margin-top:14px">Three-scenario sensitivity</h3>
<table class="tight">
  <tr><th>Scenario</th><th class="num">Yr1 save</th><th class="num">Payback</th><th class="num">30-yr net</th><th class="num">ROI</th><th class="num">IRR</th><th class="num">NPV @5%</th></tr>
  ${d.scenarios.summary.map(s => `
    <tr style="${s.key === 'expected' ? 'background:#fff7ed;font-weight:700' : ''}">
      <td>${s.label}${s.key === 'expected' ? ' (Expected)' : ''}</td>
      <td class="num">${fmt$(s.yr1_savings)}</td>
      <td class="num">${s.payback_yrs} yrs</td>
      <td class="num">${fmt$(s.lifetime_net_savings)}</td>
      <td class="num">${s.total_roi_pct}%</td>
      <td class="num">${s.irr_pct}%</td>
      <td class="num">${fmt$(s.npv_5pct)}</td>
    </tr>`).join('')}
</table>

<div class="disclaimer" style="margin-top:14px">
  Generated by proposal engine v1.0.0 · Catalogue ${costResult.catalogue_version || 'n/a'} ·
  Engineering validator v${d.engineering.validator_version} ·
  DO NOT include in customer PDF · INTERNAL USE ONLY
</div>

</body></html>`;
}
