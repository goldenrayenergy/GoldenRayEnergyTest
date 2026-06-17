// Page — The cost of doing nothing
//
// Surfaces the 25-year retail-rate trajectory from bill_analysis.scenarios
// (or derived from annual spend × 7% energy inflation when no analysis on
// file). Designed to anchor the customer's mental model: every year of
// delay is a year of paying full retail.

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

  const noteOnDerived = dn.derived
    ? `<p style="font-size:10px;color:#6B7280;margin-top:8px;font-style:italic">
         Projected from current annual spend with 7% energy inflation (NZ MBIE 10-year trend).
       </p>`
    : `<p style="font-size:10px;color:#6B7280;margin-top:8px;font-style:italic">
         Derived from your last 12 months of billing data + 7% annual rate inflation.
       </p>`;

  return `<section class="page">
    ${pageHead(d, 'The cost of doing nothing')}

    <div class="page-content-grow">
      <p style="font-size:11px;color:#5C6470;margin:0 0 14px">
        Every year you don't install solar is a year you pay full retail rates — at today's prices,
        with retail electricity climbing ~7% per year on the NZ MBIE 10-year trend.
      </p>

      <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:12px 14px;border-radius:4px;margin-bottom:14px">
        <div style="font-size:9.5px;text-transform:uppercase;tracking-wide;color:#7F1D1D;font-weight:700;margin-bottom:4px">
          Cumulative cost over 25 years (doing nothing)
        </div>
        <div style="font-size:24px;font-weight:800;color:#7F1D1D">
          ${fmt$(dn.net_25yr)}
        </div>
        <div style="font-size:11px;color:#7F1D1D;margin-top:2px">
          That's what you'll have paid your retailer in current dollars by Year 25.
        </div>
      </div>

      <h3 style="font-size:13px;margin:18px 0 8px;color:#0B0F1A">Year-by-year trajectory</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <colgroup>
          <col style="width:80px" />
          <col style="width:auto" />
        </colgroup>
        <tbody>
          ${rows}
        </tbody>
      </table>

      ${noteOnDerived}

      <div style="margin-top:16px;padding:10px 12px;background:#F0FDF4;border-left:4px solid #16A34A;border-radius:4px;font-size:11px;color:#14532D">
        <b>Reframe:</b> installing the recommended system means most of that money stays in
        your home — paying off panels and earning credit for export to the grid — instead of
        flowing to a retailer.
      </div>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
