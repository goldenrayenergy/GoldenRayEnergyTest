// Page — First year monthly bill comparison (Phase H4)
//
// Side-by-side bar chart of old (retail) vs new (post-install) monthly
// bills, with savings highlight. Sources from d.financial.monthly which
// the engine already computes (gen, use, import, export, old_bill,
// new_bill, savings).

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$ } from '../proposalData.js';

export function pageBillComparison(d, sectionNum, sectionsTotal) {
  const months = d.financial?.monthly;
  if (!months || months.length === 0) return '';

  // Chart geometry
  const W = 720, H = 230;
  const PAD = { left: 36, right: 12, top: 14, bottom: 30 };
  const PLOT_W = W - PAD.left - PAD.right;
  const PLOT_H = H - PAD.top - PAD.bottom;

  const yMax = Math.max(...months.map(m => Math.max(m.old_bill, m.new_bill)), 1);
  const yNice = niceMax(yMax);
  const yFor = v => PAD.top + PLOT_H - (Math.max(0, v) / yNice) * PLOT_H;

  // Each month gets a slot wide enough for 2 bars + spacing
  const slotW = PLOT_W / months.length;
  const barW = Math.min(12, slotW * 0.32);

  const yTicks = [0, yNice / 4, yNice / 2, (3 * yNice) / 4, yNice];
  const yTickEls = yTicks.map(v => `
    <line x1="${PAD.left}" y1="${yFor(v)}" x2="${PAD.left + PLOT_W}" y2="${yFor(v)}"
          stroke="#E5E7EB" stroke-width="0.5" stroke-dasharray="2,2"/>
    <text x="${PAD.left - 5}" y="${yFor(v) + 3}" font-size="8" fill="#5C6470" text-anchor="end">${fmt$(v)}</text>
  `).join('');

  const bars = months.map((m, i) => {
    const cx = PAD.left + slotW * (i + 0.5);
    const oldX = cx - barW - 1;
    const newX = cx + 1;
    const oldH = PLOT_H - (yFor(m.old_bill) - PAD.top);
    const newH = PLOT_H - (yFor(m.new_bill) - PAD.top);
    const monthLabel = m.month?.slice?.(0, 3) || `M${i + 1}`;
    return `
      <g>
        <!-- Old bill (red) -->
        <rect x="${oldX}" y="${yFor(m.old_bill)}" width="${barW}" height="${oldH}"
              fill="#FCA5A5" stroke="#DC2626" stroke-width="0.6" rx="1.5"/>
        <!-- New bill (green) -->
        <rect x="${newX}" y="${yFor(m.new_bill)}" width="${barW}" height="${newH}"
              fill="#86EFAC" stroke="#16A34A" stroke-width="0.6" rx="1.5"/>
        <!-- Month label -->
        <text x="${cx}" y="${H - 14}" font-size="8.5" fill="#5C6470" text-anchor="middle">${monthLabel}</text>
        <!-- Savings ribbon above -->
        <text x="${cx}" y="${yFor(Math.max(m.old_bill, m.new_bill)) - 4}" font-size="7.5"
              fill="#16A34A" text-anchor="middle" font-weight="700">${fmt$(m.savings).replace('$', '+$')}</text>
      </g>`;
  }).join('');

  const totalOld = months.reduce((s, m) => s + m.old_bill, 0);
  const totalNew = months.reduce((s, m) => s + m.new_bill, 0);
  const totalSavings = totalOld - totalNew;
  const bestMonth = months.reduce((best, m) => m.savings > best.savings ? m : best, months[0]);
  const worstMonth = months.reduce((worst, m) => m.savings < worst.savings ? m : worst, months[0]);
  const avgMonthly = totalSavings / months.length;

  return `<section class="page">
    ${pageHead(d, 'First year — monthly bill comparison')}

    <div class="page-content-grow">
      <p style="font-size:11px;color:#5C6470;margin:0 0 12px">
        Side-by-side view of what your power bill looks like month by month — what you'd
        pay <b>without</b> solar versus what you'll pay <b>with</b> it. The green ribbon
        above each pair is the saving that month.
      </p>

      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:6px;padding:10px">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
          ${yTickEls}
          ${bars}
          <line x1="${PAD.left}" y1="${yFor(0)}" x2="${PAD.left + PLOT_W}" y2="${yFor(0)}"
                stroke="#0B0F1A" stroke-width="0.8"/>
          <text x="${PAD.left - 30}" y="${PAD.top + PLOT_H / 2}" font-size="8" fill="#5C6470"
                transform="rotate(-90 ${PAD.left - 30} ${PAD.top + PLOT_H / 2})">Monthly bill (NZ\$ inc GST)</text>
        </svg>
        <div style="margin-top:8px;display:flex;gap:20px;font-size:10px;color:#5C6470;justify-content:center">
          <span><span style="display:inline-block;width:12px;height:7px;background:#FCA5A5;border:1px solid #DC2626;vertical-align:middle;margin-right:4px"></span>Old bill (without solar)</span>
          <span><span style="display:inline-block;width:12px;height:7px;background:#86EFAC;border:1px solid #16A34A;vertical-align:middle;margin-right:4px"></span>New bill (with solar)</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-top:14px">
        <div style="background:#F0FDF4;border-left:3px solid #16A34A;padding:10px 12px;border-radius:4px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#166534;font-weight:700;margin-bottom:3px">
            Total saved (Yr 1)
          </div>
          <div style="font-size:16px;font-weight:800;color:#14532D">${fmt$(totalSavings)}</div>
        </div>
        <div style="background:#F8FAFC;border-left:3px solid #5C6470;padding:10px 12px;border-radius:4px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#5C6470;font-weight:700;margin-bottom:3px">
            Average monthly saving
          </div>
          <div style="font-size:16px;font-weight:800;color:#0B0F1A">${fmt$(avgMonthly)}</div>
        </div>
        <div style="background:#FEF3C7;border-left:3px solid #D97706;padding:10px 12px;border-radius:4px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#78350F;font-weight:700;margin-bottom:3px">
            Biggest saving month
          </div>
          <div style="font-size:14px;font-weight:800;color:#78350F">${bestMonth.month}</div>
          <div style="font-size:11px;font-weight:700;color:#78350F">${fmt$(bestMonth.savings)}</div>
        </div>
        <div style="background:#F1F5F9;border-left:3px solid #475569;padding:10px 12px;border-radius:4px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#334155;font-weight:700;margin-bottom:3px">
            Smallest saving month
          </div>
          <div style="font-size:14px;font-weight:800;color:#1E293B">${worstMonth.month}</div>
          <div style="font-size:11px;font-weight:700;color:#1E293B">${fmt$(worstMonth.savings)}</div>
        </div>
      </div>

      <p style="font-size:10px;color:#6B7280;margin-top:18px;font-style:italic;line-height:1.5">
        Uses the Expected financial scenario. Conservative + Optimistic versions are on
        the Financial outlook page. Detailed table of generation, consumption, import,
        export, and bills per month appears on the next page.
      </p>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

function niceMax(v) {
  // Round up to a "nice" upper bound: 50, 100, 200, 250, 500, 1000…
  const steps = [50, 100, 200, 250, 500, 750, 1000, 1500, 2000, 3000, 5000];
  for (const s of steps) if (s >= v) return s;
  return Math.ceil(v / 1000) * 1000;
}
