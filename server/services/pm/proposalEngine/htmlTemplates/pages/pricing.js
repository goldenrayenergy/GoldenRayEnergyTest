// Page — Pricing & investment

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$ } from '../proposalData.js';

export function pagePricing(d, sectionNum, sectionsTotal) {
  const p = d.pricing;

  return `<section class="page">
    ${pageHead(d, 'Your investment')}

    <div class="page-content-grow">
      <h2>Investment summary</h2>

      <table>
        <thead><tr><th>Line</th><th class="num">Amount (NZD)</th></tr></thead>
        <tbody>
          <tr><td>List price ex GST</td><td class="num">${fmt$(p.list_ex_gst)}</td></tr>
          <tr><td>GST (15%)</td><td class="num">${fmt$(p.list_inc_gst - p.list_ex_gst)}</td></tr>
          <tr><td><b>List price inc GST</b></td><td class="num"><b>${fmt$(p.list_inc_gst)}</b></td></tr>
          ${p.discount_inc_gst > 0 ? `
          <tr><td style="color:#16A34A">Discount applied (${p.discount_pct_of_list}% off list)</td>
              <td class="num" style="color:#16A34A">−${fmt$(p.discount_inc_gst)}</td></tr>` : ''}
          <tr class="total-row"><td><b>Your price inc GST · installed</b></td>
              <td class="num"><b>${fmt$(p.customer_inc_gst)}</b></td></tr>
        </tbody>
      </table>

      <h3 style="margin-top:14px">What's included</h3>
      <div class="grid2">
        <div class="card">
          <h4>Equipment</h4>
          <p>• All solar panels, inverter${d.system.battery_sku ? ', battery + BMS' : ''}, smart meter<br/>
          • Mounting kit + rails (Hopergy tin kit)<br/>
          • Cabling, conduit, isolators, surge protection<br/>
          • AS/NZS 4777-compliant labels + earthing</p>
        </div>
        <div class="card">
          <h4>Labour &amp; commissioning</h4>
          <p>• Installation crew (${d.system.kw < 8 ? '1-2 days' : d.system.kw <= 12 ? '2-3 days' : '3-4 days'})<br/>
          ${d.system.battery_sku ? '• Battery installation premium (BMS commissioning + training)<br/>' : ''}
          • Site supervisor + travel + logistics<br/>
          • SolarWeb cloud monitoring setup + customer training</p>
        </div>
        <div class="card">
          <h4>Compliance &amp; certification</h4>
          <p>• System design &amp; engineering certificate<br/>
          • Independent electrical inspection + Record of Inspection (ROI)<br/>
          • Certificate of Compliance (CoC)<br/>
          • Distributed Generation application to network operator</p>
        </div>
        <div class="card">
          <h4>Warranties</h4>
          <p>• Panel: ${d.warranties.panel}<br/>
          • Inverter: ${d.warranties.inverter}<br/>
          ${d.warranties.battery ? `• Battery: ${d.warranties.battery}<br/>` : ''}
          • Smart meter: ${d.warranties.smart_meter} · Racking/BoS: ${d.warranties.racking_bos}<br/>
          • Goldenray workmanship: ${d.warranties.workmanship}</p>
        </div>
      </div>

      <div class="disclaimer">All prices in New Zealand Dollars (NZD), inclusive of 15% GST where stated.
      Valid until ${d.meta.valid_until} (${d.meta.valid_days} days from issue). Pricing reflects current catalogue
      and supplier costs; spec changes will trigger a fresh quote. ${p.discount_inc_gst > 0 && p.floor_status === 'below_floor'
        ? '<b>Discount above standard threshold — applied with owner approval.</b>' : ''}</div>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
