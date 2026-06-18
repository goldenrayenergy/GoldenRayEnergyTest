// Page — 25-year cash flow (Expected scenario)
//
// Year-by-year cumulative net position. Starts negative (upfront cost),
// crosses zero at payback year, finishes deeply positive. Visualised as
// a horizontal bar chart per year — width proportional to |cumulative|.

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$ } from '../proposalData.js';

export function pageCashFlowWaterfall(d, sectionNum, sectionsTotal) {
  const cf = d.insights?.cash_flow;
  if (!cf || !cf.points || cf.points.length === 0) return '';

  // Sample yearly milestones so the page doesn't drown in 25-30 rows
  const milestones = [1, 2, 3, 5, 7, 10, 13, 16, 20, 25];
  const visible = cf.points.filter(p => milestones.includes(p.year));

  // Two scales: negative bars left of centre, positive right
  const maxAbs = Math.max(...visible.map(p => Math.abs(p.cumulative)), 1);

  const rows = visible.map(p => {
    const isPositive = p.cumulative >= 0;
    const widthPct = Math.round((Math.abs(p.cumulative) / maxAbs) * 50);  // each side max 50%
    const bar = isPositive
      ? `<div style="position:relative;height:18px">
           <div style="position:absolute;left:50%;top:0;height:100%;width:${widthPct}%;background:#86EFAC;border-radius:0 3px 3px 0"></div>
           <span style="position:absolute;left:calc(50% + ${widthPct}% + 6px);top:1px;font-size:10.5px;color:#14532D;font-weight:700;white-space:nowrap">
             ${fmt$(p.cumulative)}
           </span>
         </div>`
      : `<div style="position:relative;height:18px">
           <div style="position:absolute;right:50%;top:0;height:100%;width:${widthPct}%;background:#FECACA;border-radius:3px 0 0 3px"></div>
           <span style="position:absolute;right:calc(50% + ${widthPct}% + 6px);top:1px;font-size:10.5px;color:#7F1D1D;font-weight:700;white-space:nowrap">
             ${fmt$(p.cumulative)}
           </span>
         </div>`;
    return `
      <tr>
        <td style="font-weight:600;padding:5px 8px;width:60px;color:#0B0F1A">Yr ${p.year}</td>
        <td style="padding:5px 0;border-left:1px dashed #E5E7EB;border-right:1px dashed #E5E7EB">
          ${bar}
        </td>
        <td style="padding:5px 8px;width:75px;text-align:right;font-size:10px;color:#5C6470;font-variant-numeric:tabular-nums">
          ${p.net_annual >= 0 ? '+' : ''}${fmt$(p.net_annual)}/yr
        </td>
      </tr>`;
  }).join('');

  return `<section class="page">
    ${pageHead(d, '25-year cash flow — your installation')}

    <div class="page-content-grow">
      <p style="font-size:11px;color:#5C6470;margin:0 0 14px">
        This is your bank balance attributable to the solar system, year by year. It starts
        deeply negative at install (the upfront cost), crosses zero at <b>payback</b>
        (Year ${cf.payback_year || '—'}), and finishes deeply positive by Year 25.
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:11px 13px;border-radius:4px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#7F1D1D;font-weight:700;margin-bottom:3px">
            Upfront cost
          </div>
          <div style="font-size:18px;font-weight:800;color:#7F1D1D">
            ${fmt$(cf.upfront_cost)}
          </div>
        </div>
        <div style="background:#F0FDF4;border-left:4px solid #16A34A;padding:11px 13px;border-radius:4px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#14532D;font-weight:700;margin-bottom:3px">
            Net position by Year 25
          </div>
          <div style="font-size:18px;font-weight:800;color:#14532D">
            ${fmt$(cf.final_cumulative)}
          </div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <tbody>${rows}</tbody>
      </table>

      <div style="margin-top:12px;display:flex;align-items:center;gap:14px;font-size:10px;color:#5C6470;border-top:1px dashed #E5E7EB;padding-top:8px">
        <span style="display:flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:12px;height:10px;background:#FECACA;border-radius:1px"></span>
          Cumulative position (still recovering investment)
        </span>
        <span style="display:flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:12px;height:10px;background:#86EFAC;border-radius:1px"></span>
          Cumulative position (after payback)
        </span>
      </div>

      <p style="font-size:10px;color:#6B7280;margin-top:14px;font-style:italic">
        Uses the Expected scenario (yield + degradation + tariff inflation + buyback decline curve).
        Conservative + Optimistic outcomes are on the Financial outlook page.
      </p>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
