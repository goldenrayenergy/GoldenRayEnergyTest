// Page — Staying on the grid — the 25-year cost
//
// Surfaces the 25-year retail-rate trajectory from bill_analysis.scenarios
// (or derived from annual spend × 7% energy inflation when no analysis on
// file). Frames the cost as the customer's baseline, with a bridge sentence
// pointing forward to the side-by-side comparison on the next page (cash flow).

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$ } from '../proposalData.js';

export function pageDoNothing(d, sectionNum, sectionsTotal) {
  const dn = d.insights?.do_nothing;
  if (!dn) return '';   // no data → page skipped

  const points = dn.trajectory || [];
  const max = Math.max(...points.map(p => p.cum_cost), 1);

  const rows = points.map(p => {
    const widthPct = Math.round((p.cum_cost / max) * 100);
    return `
      <tr>
        <td style="font-weight:600;padding:5px 8px;">Year ${p.year}</td>
        <td style="padding:5px 8px;">
          <div style="position:relative;height:18px;background:#FEE2E2;border-radius:3px;width:${widthPct}%">
            <span style="position:absolute;right:5px;top:1px;font-size:10.5px;color:#7F1D1D;font-weight:700">
              ${fmt$(p.cum_cost)}
            </span>
          </div>
        </td>
      </tr>`;
  }).join('');

  return `<section class="page">
    ${pageHead(d, 'Staying on the grid — the 25-year cost')}

    <div class="page-content-grow">
      <p style="font-size:11px;color:#5C6470;margin:0 0 14px;line-height:1.5">
        If you continue purchasing all your electricity from the grid, your costs will rise each
        year as retail tariffs increase. Using MBIE's 10-year retail electricity trend
        (7% per annum), the figures below project the cumulative cost of remaining on retail
        electricity over the next 25 years. The next page sets this against the comparable position
        with your solar system installed, so you can see the two financial paths side by side.
      </p>

      <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:12px 14px;border-radius:4px;margin-bottom:14px">
        <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;color:#7F1D1D;font-weight:700;margin-bottom:4px">
          Cumulative retail electricity cost — 25 years
        </div>
        <div style="font-size:24px;font-weight:800;color:#7F1D1D">
          ${fmt$(dn.net_25yr)}
        </div>
        <div style="font-size:11px;color:#7F1D1D;margin-top:2px">
          This is the total you would pay your retailer over the next 25 years if no solar
          system were installed, with each year's bill grown at 7% per annum to reflect
          projected retail tariff inflation.
        </div>
      </div>

      <h3 style="font-size:13px;margin:18px 0 8px;color:#0B0F1A">Cumulative cost, year by year</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <colgroup>
          <col style="width:80px" />
          <col style="width:auto" />
        </colgroup>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <p style="font-size:10px;color:#6B7280;margin-top:8px;font-style:italic">
        Calculated from your most recent 12 months of billing data, increased by 7% per year
        (MBIE 10-year trend).
      </p>

      <div style="margin-top:16px;padding:10px 12px;background:#F0FDF4;border-left:4px solid #16A34A;border-radius:4px;font-size:11px;color:#14532D;line-height:1.5">
        On the next page you will see how installing the recommended solar system reshapes this
        picture — converting most of this future expense into long-term savings, with a positive
        net return by Year 25.
      </div>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
