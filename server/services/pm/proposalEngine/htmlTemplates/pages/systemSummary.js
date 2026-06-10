// Page — System summary & hardware at a glance

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$, fmtNum } from '../proposalData.js';

export function pageSystemSummary(d, sectionNum, sectionsTotal) {
  const exp = d.scenarios.summary.find(s => s.key === 'expected');
  return `<section class="page">
    ${pageHead(d, 'Your system at a glance')}

    <div class="page-content-grow">
      <div class="customer-strip">
        <div>
          <div class="name">${d.customer.name}</div>
          <div class="addr">${d.customer.address_one_line}${d.customer.icp ? ' · ICP ' + d.customer.icp : ''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#5C6470">Quote ${d.meta.quote_ref}</div>
          <div style="font-size:11px;color:#5C6470">${d.meta.quote_date}</div>
        </div>
      </div>

      <h2>What we're installing</h2>
      <div class="grid4">
        <div class="card kpi"><div class="lbl">System size</div><div class="val">${d.system.kw} kW</div><div class="sub">${d.system.panels} × ${d.system.panel_watts}W panels</div></div>
        <div class="card kpi"><div class="lbl">Battery</div><div class="val">${d.system.usable_battery_kwh || '—'}${d.system.usable_battery_kwh ? ' kWh' : ''}</div><div class="sub">${d.system.battery_sku ? 'Hybrid backup ready' : 'Solar only'}</div></div>
        <div class="card kpi"><div class="lbl">Year-1 generation</div><div class="val">${fmtNum(d.financial.yr1.generation_kwh)}</div><div class="sub">kWh / year (Expected)</div></div>
        <div class="card kpi"><div class="lbl">Year-1 savings</div><div class="val savings">${fmt$(exp.yr1_savings)}</div><div class="sub">vs current bill</div></div>
      </div>

      <h2 style="margin-top:14px">Hardware specification</h2>
      <div class="grid2">
        ${hardwareCard('Solar panels', `${d.system.panels} × ${d.system.panel_name}`,
            [`Total capacity ${d.system.kw} kW`, `${d.system.topology === 'parallel' ? 'Parallel-string' : 'Series-string'} topology`,
             `${d.system.panels_per_string ? d.system.panels_per_string + ' panels per string × ' + d.system.string_count + ' strings' : 'String design TBC at site survey'}`])}
        ${hardwareCard('Inverter', d.system.inverter_name,
            ['AS/NZS 4777.2:2020 certified', 'Wi-Fi monitoring via SolarWeb',
             d.system.battery_sku ? 'Battery-ready Plus variant' : 'Hybrid-ready upgrade available'])}
        ${d.system.battery_sku
          ? hardwareCard('Battery', d.system.battery_label,
              ['LFP (LiFePO₄) chemistry', 'Whole-home backup with auto-changeover',
               'AS/NZS 5139:2019 compliant'])
          : ''}
        ${hardwareCard('Smart meter + monitoring', 'Fronius Smart Meter + SolarWeb cloud portal',
            ['Per-circuit consumption tracking', 'Export limiting + buyback optimisation',
             'Available 24/7 on phone + web'])}
      </div>

      <h3 style="margin-top:14px">Regional yield assumption</h3>
      <p>System sizing uses <b>${d.system.region_label}</b> regional solar yield of
      <b>${d.system.yield_kwh_per_kwp} kWh per kWp per year</b> (NIWA-derived). This already includes a
      performance ratio (PR ≈ 0.80) that accounts for inverter losses, soiling, temperature, and standard
      cabling losses. No additional system losses are applied on top.</p>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

function hardwareCard(title, name, bullets) {
  return `<div class="comp-card">
    <div class="specs">
      <b>${title}</b>
      <div style="font-weight:700;color:#0B0F1A;margin-bottom:4px">${name}</div>
      ${bullets.map(b => `<div>• ${b}</div>`).join('')}
    </div>
    <div class="comp-img">image</div>
  </div>`;
}
