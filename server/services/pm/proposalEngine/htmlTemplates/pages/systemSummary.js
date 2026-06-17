// Page — System summary & hardware at a glance
//
// Phase H6 — all hardware-card content derived from spec + catalogue:
// smart meter brand pulled from hardware.smart_meter, monitoring portal
// derived from inverter brand, battery cert reference derived from
// chemistry, Plus-variant claim derived from inverter.is_plus_variant.

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$, fmtNum } from '../proposalData.js';

export function pageSystemSummary(d, sectionNum, sectionsTotal) {
  const exp = d.scenarios.summary.find(s => s.key === 'expected');
  const inverter = d.hardware?.inverter;
  const battery  = d.hardware?.battery;
  const meter    = d.hardware?.smart_meter;

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
        <div class="card kpi"><div class="lbl">Battery</div><div class="val">${d.system.usable_battery_kwh || '—'}${d.system.usable_battery_kwh ? ' kWh' : ''}</div><div class="sub">${battery ? `${battery.brand} ${battery.series} backup` : 'Solar only'}</div></div>
        <div class="card kpi"><div class="lbl">Year-1 generation</div><div class="val">${fmtNum(d.financial.yr1.generation_kwh)}</div><div class="sub">kWh / year (Expected)</div></div>
        <div class="card kpi"><div class="lbl">Year-1 savings</div><div class="val savings">${fmt$(exp.yr1_savings)}</div><div class="sub">vs current bill</div></div>
      </div>

      <p class="small" style="margin-top:14px;color:#5C6470;font-style:italic">
        Full hardware specification — including ${meter ? `the ${meter.brand} ${meter.name?.split(' ').slice(-3).join(' ') || 'smart meter'}` : 'the smart meter'}, ${inverter ? `${inverter.brand} inverter` : 'inverter'}${battery ? `, ${battery.brand} ${battery.series} battery` : ''}, photos, datasheet links, and warranty terms — appears on the next page.
      </p>

      <h3 style="margin-top:14px">Regional yield assumption</h3>
      <p>System sizing uses <b>${d.system.region_label}</b> regional solar yield of
      <b>${d.system.yield_kwh_per_kwp} kWh per kWp per year</b>. The engine applies a regional
      losses factor of <b>${d.system.losses_pct ?? 14}%</b> (covering inverter conversion, soiling,
      temperature, cable losses, and ${d.system.topology === 'parallel' ? '~4% clipping for parallel-string' : 'standard string'} losses) to derive your projected
      generation.</p>

      <h3 style="margin-top:14px">String design</h3>
      <p>${d.system.topology === 'parallel' ? 'Parallel-string' : 'Series-string'} topology with ${d.system.panels_per_string ? `<b>${d.system.string_count}</b> string${d.system.string_count > 1 ? 's' : ''} of <b>${d.system.panels_per_string}</b> panels each` : 'string design confirmed at site survey'}.${inverter?.mppt_count ? ` Inverter has <b>${inverter.mppt_count} MPPT</b> input${inverter.mppt_count > 1 ? 's' : ''}${d.system.topology === 'parallel' ? ` — strings are paralleled in pairs into ${inverter.mppt_count} MPPT feeds` : ` — one string per MPPT`}.` : ''} Voltage + current envelope (Voc cold, Vmp hot, MPPT current) validated against AS/NZS 5033 §3 before this quote was released.</p>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

