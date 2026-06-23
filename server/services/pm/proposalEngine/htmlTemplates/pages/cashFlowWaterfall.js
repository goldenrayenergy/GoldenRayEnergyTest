// Page — Your 25-year financial position
//
// Side-by-side comparison of two financial paths:
//   • LEFT  — cumulative retail spend if you stayed on the grid (red)
//   • RIGHT — cumulative net position with the solar system installed
//             (amber while still recovering investment, green after payback)
//
// The gap between the two final values at Year 25 is the customer's full
// "Combined 25-year value created" figure shown in the top card.
//
// Both trajectories are computed in proposalData.js → buildInsights → cash_flow.
// dn_cumulative is always negative and growing; cumulative starts at
// −upfront_cost and rises (negative through payback, then positive).

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$ } from '../proposalData.js';

export function pageCashFlowWaterfall(d, sectionNum, sectionsTotal) {
  const cf = d.insights?.cash_flow;
  if (!cf || !cf.points || cf.points.length === 0) return '';

  // Pick milestone years that tell the story without crowding the page.
  // Include the payback year (rounded) so the "crossover to positive" moment
  // is visible.
  const paybackYear = cf.payback_year || null;
  const milestones = new Set([1, 5, 10, 15, 20, 25]);
  if (paybackYear) milestones.add(paybackYear);
  const visible = cf.points.filter(p => milestones.has(p.year))
                            .sort((a, b) => a.year - b.year);

  // Shared scale across both columns so the visual relationship is honest.
  const maxAbs = Math.max(
    ...visible.map(p => Math.abs(p.dn_cumulative || 0)),
    ...visible.map(p => Math.abs(p.cumulative || 0)),
    1
  );

  const rows = visible.map(p => {
    const isPayback = paybackYear && p.year === paybackYear;
    const yearLabel = isPayback ? `Yr ${p.year} ↺` : `Yr ${p.year}`;

    // Left column — without-solar bar (always negative, grows leftward)
    const dnPct = Math.round((Math.abs(p.dn_cumulative) / maxAbs) * 100);
    const dnBar = `
      <div style="position:relative;height:18px">
        <div style="position:absolute;right:0;top:0;height:100%;width:${dnPct}%;
                    background:#FECACA;border-left:2px solid #DC2626;border-radius:3px 0 0 3px"></div>
        <span style="position:absolute;right:calc(${dnPct}% + 6px);top:1px;font-size:10px;color:#7F1D1D;font-weight:700;white-space:nowrap">
          ${fmt$(p.dn_cumulative)}
        </span>
      </div>`;

    // Right column — with-solar bar
    //   negative side → amber (still recovering investment)
    //   positive side → green (net gain post-payback)
    const widthPct = Math.round((Math.abs(p.cumulative) / maxAbs) * 100);
    const isPositive = p.cumulative >= 0;
    const solarBar = isPositive
      ? `<div style="position:relative;height:18px">
           <div style="position:absolute;left:0;top:0;height:100%;width:${widthPct}%;
                       background:#86EFAC;border-right:2px solid #16A34A;border-radius:0 3px 3px 0"></div>
           <span style="position:absolute;left:calc(${widthPct}% + 6px);top:1px;font-size:10px;color:#14532D;font-weight:700;white-space:nowrap">
             +${fmt$(p.cumulative)}
           </span>
         </div>`
      : `<div style="position:relative;height:18px">
           <div style="position:absolute;left:0;top:0;height:100%;width:${widthPct}%;
                       background:#FED7AA;border-right:2px solid #D97706;border-radius:0 3px 3px 0"></div>
           <span style="position:absolute;left:calc(${widthPct}% + 6px);top:1px;font-size:10px;color:#92400E;font-weight:700;white-space:nowrap">
             ${fmt$(p.cumulative)}
           </span>
         </div>`;

    return `
      <tr${isPayback ? ' style="background:#FFFBEB"' : ''}>
        <td style="font-weight:700;padding:5px 8px;width:62px;color:#0B0F1A;font-size:10.5px">${yearLabel}</td>
        <td style="padding:5px 6px 5px 0;width:46%">${dnBar}</td>
        <td style="padding:5px 0 5px 6px;width:46%;border-left:1px dashed #CBD5E1">${solarBar}</td>
      </tr>`;
  }).join('');

  const totalBenefit = cf.total_benefit_25yr || 0;

  return `<section class="page">
    ${pageHead(d, 'Your 25-year financial position')}

    <div class="page-content-grow">
      <p style="font-size:11px;color:#5C6470;margin:0 0 14px;line-height:1.5">
        This chart compares two financial paths over 25 years. The
        <b style="color:#7F1D1D">red trajectory on the left</b> shows your cumulative retail
        electricity cost if you stayed on the grid — the same trajectory as the previous page.
        The trajectory on the right shows your cumulative position with the recommended solar
        system installed: it begins negative because of the upfront investment, returns to zero
        at <b>payback (Year ${paybackYear || '—'})</b>, and continues upward as savings
        accumulate. The total distance between the two paths at Year 25 is your full 25-year
        benefit from going solar.
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:11px 13px;border-radius:4px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#7F1D1D;font-weight:700;margin-bottom:3px">
            Upfront investment
          </div>
          <div style="font-size:17px;font-weight:800;color:#7F1D1D">
            ${fmt$(cf.upfront_cost)}
          </div>
          <div style="font-size:10px;color:#7F1D1D;margin-top:2px">Customer total inc GST</div>
        </div>
        <div style="background:#F0FDF4;border-left:4px solid #16A34A;padding:11px 13px;border-radius:4px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#14532D;font-weight:700;margin-bottom:3px">
            Net position at Year 25
          </div>
          <div style="font-size:17px;font-weight:800;color:#14532D">
            +${fmt$(cf.final_cumulative)}
          </div>
          <div style="font-size:10px;color:#14532D;margin-top:2px">With solar installed</div>
        </div>
        <div style="background:#FFF7ED;border-left:4px solid #FF6A00;padding:11px 13px;border-radius:4px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#92400E;font-weight:700;margin-bottom:3px">
            Combined 25-year value created
          </div>
          <div style="font-size:17px;font-weight:800;color:#9A3412">
            ${fmt$(totalBenefit)}
          </div>
          <div style="font-size:10px;color:#92400E;margin-top:2px">Avoided retail + net gain</div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <thead>
          <tr style="border-bottom:1.5px solid #CBD5E1">
            <th style="text-align:left;padding:4px 8px;font-size:9px;color:#5C6470;text-transform:uppercase;letter-spacing:.5px;width:62px"></th>
            <th style="text-align:left;padding:4px 8px;font-size:9px;color:#7F1D1D;text-transform:uppercase;letter-spacing:.5px;font-weight:800">
              Without solar — cumulative retail cost
            </th>
            <th style="text-align:left;padding:4px 8px;font-size:9px;color:#14532D;text-transform:uppercase;letter-spacing:.5px;font-weight:800;border-left:1px dashed #CBD5E1">
              With solar — your cumulative position
            </th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;gap:14px;font-size:10px;color:#5C6470;border-top:1px dashed #E5E7EB;padding-top:8px">
        <span style="display:flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:12px;height:10px;background:#FECACA;border:1px solid #DC2626;border-radius:1px"></span>
          Cumulative retail cost if you stayed on the grid
        </span>
        <span style="display:flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:12px;height:10px;background:#FED7AA;border:1px solid #D97706;border-radius:1px"></span>
          Your position while recovering the upfront investment
        </span>
        <span style="display:flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:12px;height:10px;background:#86EFAC;border:1px solid #16A34A;border-radius:1px"></span>
          Your position after payback — accumulating net gain
        </span>
      </div>

      <p style="font-size:10px;color:#6B7280;margin-top:14px;font-style:italic;line-height:1.5">
        All figures reflect the Expected scenario, which accounts for system yield, panel
        degradation, retail tariff inflation, and the gradual decline in feed-in (buyback) rates.
        Conservative and Optimistic projections are shown on the Financial Outlook page.
      </p>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
