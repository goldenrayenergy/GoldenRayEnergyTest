// Page 1 — Cover & welcome letter
// Headline number comes from Expected scenario (never Optimistic).

import { pageFoot } from '../_shared.js';
import { fmt$, fmtNum } from '../proposalData.js';

export function pageCover(d, sectionNum, sectionsTotal) {
  const c = d.meta.consultant;
  const headlineSavings = d.scenarios.summary.find(s => s.key === 'expected').yr1_savings;
  const headlinePayback = d.scenarios.summary.find(s => s.key === 'expected').payback_yrs;

  return `<section class="page">
    <div style="text-align:center;margin-top:24px">
      <div style="font-size:11px;color:#5C6470;text-transform:uppercase;letter-spacing:.6px;font-weight:700">Solar Energy System Proposal — prepared for</div>
      <h1 style="font-size:30px;margin:4px 0 0">${d.customer.name}</h1>
      <div style="font-size:12px;color:#5C6470;margin-top:1px">${d.customer.address_one_line}</div>
    </div>

    <div class="cover-strip">
      <div class="blk">
        <h3>Prepared by</h3>
        <div class="line"><b>${c.name}</b></div>
        <div class="line">${c.title}</div>
        <div class="line">${c.phone}</div>
        <div class="line">${c.email}</div>
      </div>
      <div class="blk">
        <h3>Quote details</h3>
        <div class="line">Quote ref: <b>${d.meta.quote_ref}</b></div>
        <div class="line">Issued: <b>${d.meta.quote_date}</b></div>
        <div class="line">Valid until: <b>${d.meta.valid_until}</b> (${d.meta.valid_days} days)</div>
        <div class="line">Stage: <b>${d.meta.stage === 'stage_2_firm' ? '2 — Firm offer' : '1 — Initial estimate'}</b></div>
      </div>
    </div>

    <div class="welcome-card" style="margin-top:18px">
      <div class="greeting">Welcome to Your Solar Journey ☀️</div>
      <p><b>Empowering your home with clean, cost-effective energy.</b></p>
      <p>Thank you for choosing Goldenray. We've analysed your annual consumption of <b>${fmtNum(d.bills.annual_kwh)} kWh</b> at an effective rate of <b>${(d.bills.blended_rate_per_kwh * 100).toFixed(1)} c/kWh</b>, and this proposal sets out the system we recommend: <b>${d.system.kw} kW ${d.system.panel_brand} paired with ${d.system.inverter_name}${d.system.battery_label ? ' and ' + d.system.battery_label : ''}</b>.</p>
      <p>Based on the <b>Expected</b> projection, your year-1 savings work out to roughly <b>${fmt$(headlineSavings)}</b>, with payback around <b>${headlinePayback} years</b>. We show three scenarios on page 6 so you can see the full range — not just the best case.</p>
      <p>A digital signature page is provided at the end — sign on any device and return it to lock in the install.</p>
      <div class="sig-name">
        <b>${c.name}</b>
        ${c.title} · Goldenray Energy NZ™
      </div>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
