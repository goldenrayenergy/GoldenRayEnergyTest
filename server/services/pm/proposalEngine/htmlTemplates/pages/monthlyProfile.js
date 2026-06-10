// Page — Year-1 monthly profile (uses Expected scenario)

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$, fmtNum } from '../proposalData.js';

export function pageMonthlyProfile(d, sectionNum, sectionsTotal) {
  const months = d.financial.monthly;
  const yr1 = d.financial.yr1;

  const rows = months.map(m => `
    <tr>
      <td>${m.month}</td>
      <td class="num">${fmtNum(m.gen_kwh)}</td>
      <td class="num">${fmtNum(m.use_kwh)}</td>
      <td class="num">${fmtNum(m.imported_kwh)}</td>
      <td class="num">${fmtNum(m.exported_kwh)}</td>
      <td class="num">${fmt$(m.old_bill)}</td>
      <td class="num">${fmt$(m.new_bill)}</td>
      <td class="num" style="color:#16A34A;font-weight:700">${fmt$(m.savings)}</td>
    </tr>`).join('');

  const totalGen = months.reduce((s, m) => s + m.gen_kwh, 0);
  const totalUse = months.reduce((s, m) => s + m.use_kwh, 0);
  const totalImp = months.reduce((s, m) => s + m.imported_kwh, 0);
  const totalExp = months.reduce((s, m) => s + m.exported_kwh, 0);
  const totalOldBill = months.reduce((s, m) => s + m.old_bill, 0);
  const totalNewBill = months.reduce((s, m) => s + m.new_bill, 0);
  const totalSavings = months.reduce((s, m) => s + m.savings, 0);

  return `<section class="page">
    ${pageHead(d, 'Year-1 monthly breakdown')}

    <div class="page-content-grow">
      <h2>What this looks like month by month</h2>
      <p>These numbers use the <b>Expected</b> scenario. Generation peaks in summer
      (Dec–Feb in NZ), and bills are highest in winter (Jun–Aug). Battery use shifts daytime
      solar to evenings so very little gets imported on a typical day.</p>

      <table class="tight">
        <thead><tr>
          <th>Month</th>
          <th class="num">Solar gen (kWh)</th>
          <th class="num">You used (kWh)</th>
          <th class="num">Imported (kWh)</th>
          <th class="num">Exported (kWh)</th>
          <th class="num">Old bill</th>
          <th class="num">New bill</th>
          <th class="num">Savings</th>
        </tr></thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td><b>Year total</b></td>
            <td class="num">${fmtNum(totalGen)}</td>
            <td class="num">${fmtNum(totalUse)}</td>
            <td class="num">${fmtNum(totalImp)}</td>
            <td class="num">${fmtNum(totalExp)}</td>
            <td class="num">${fmt$(totalOldBill)}</td>
            <td class="num">${fmt$(totalNewBill)}</td>
            <td class="num" style="color:#16A34A">${fmt$(totalSavings)}</td>
          </tr>
        </tbody>
      </table>

      <h3 style="margin-top:14px">Year-1 summary</h3>
      <div class="grid4">
        <div class="card kpi"><div class="lbl">Annual generation</div><div class="val">${fmtNum(yr1.generation_kwh)}</div><div class="sub">kWh / year</div></div>
        <div class="card kpi"><div class="lbl">Self-consumed</div><div class="val">${fmtNum(yr1.self_consumed_kwh)}</div><div class="sub">${yr1.self_consume_pct}% of generation</div></div>
        <div class="card kpi"><div class="lbl">Exported</div><div class="val">${fmtNum(yr1.exported_kwh)}</div><div class="sub">${yr1.export_pct}% sold back</div></div>
        <div class="card kpi"><div class="lbl">Coverage</div><div class="val">${yr1.coverage_pct}%</div><div class="sub">of your old bill eliminated</div></div>
      </div>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
