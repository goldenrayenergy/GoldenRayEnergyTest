// Page — Formal Quotation
//
// The "what you're buying" summary — pulled out of the proposal pages so a
// customer scanning the back pages immediately sees the system config + the
// full hardware bundle + the all-inclusive turnkey price. Sits right before
// the signature page.

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$ } from '../proposalData.js';

export function pageFormalQuotation(d, sectionNum, sectionsTotal) {
  const sys = d.system || {};
  const inv = d.hardware?.inverter || {};
  const bat = d.hardware?.battery || null;
  const meter = d.hardware?.smart_meter || {};
  const finalMode = d.meta?.final_mode === true;

  const systemHeadline = `${sys.kw || '—'} kW ${d.hardware?.panel?.brand || 'Phono Solar'} (${sys.panels || '—'} × ${sys.panel_watts || 595}W panels)`;
  const inverterHeadline = inv.name || `${inv.brand || 'Fronius'} ${inv.ac_kw ? inv.ac_kw + ' kW' : ''} hybrid inverter`;
  const batteryHeadline = bat
    ? `${bat.brand} ${bat.series} ${bat.total_usable_kwh} kWh (${bat.module_count} × ${bat.module_kwh} kWh modules + 1 BMS+BCU)`
    : 'No battery — solar only';

  return `<section class="page">
    ${pageHead(d, 'Formal Quotation')}

    <div class="page-content-grow">
      <h2 style="margin:0 0 10px;font-size:18px;color:#0B0F1A">Goldenray Energy NZ™ — Formal Quotation</h2>

      <div class="customer-strip" style="margin-bottom:14px">
        <div>
          <div class="name">${d.customer.name}</div>
          <div class="addr">${d.customer.address_one_line}${d.customer.icp ? ' · ICP ' + d.customer.icp : ''}</div>
        </div>
        <div style="text-align:right;font-size:10.5px;color:#5C6470">
          <b>Ref ${d.meta.quote_ref}</b><br/>
          Issued ${d.meta.quote_date}<br/>
          Valid ${d.meta.valid_days || 30} days
        </div>
      </div>

      <h3 style="font-size:12.5px;margin:0 0 4px;color:#0B0F1A">
        ${finalMode ? 'Your installation' : 'Recommended configuration'} —
        ${inv.brand || 'Fronius'} ${inv.name ? inv.name.split(' ').slice(0,3).join(' ') : ''}${bat ? ` + ${bat.brand} ${bat.series} ${bat.total_usable_kwh} kWh` : ''}
      </h3>
      <p style="font-size:10.5px;margin:0 0 12px;color:#0B0F1A;line-height:1.5">
        <b>${systemHeadline}${sys.string_design && sys.string_design.groups ? ` in ${sys.string_design.groups[0].string_count} string${sys.string_design.groups[0].string_count > 1 ? 's' : ''} of ${sys.string_design.groups[0].panels_per_string}, ${sys.topology === 'parallel' ? 'paralleled' : 'series-connected'}` : ''}</b>
        · ${inverterHeadline}${bat ? ` · ${batteryHeadline}` : ''}<br/>
        ${bat ? 'Backup: supports selected essential circuits depending on battery state-of-charge and load demand · ' : ''}grid-connected · ${sys.phase === 3 ? 'three-phase' : 'single-phase'} · DC + AC design per SLD page.
      </p>

      <h3 style="font-size:11.5px;margin:0 0 4px;color:#0B0F1A">What's included — Professional installation bundle</h3>
      <p style="font-size:10px;color:#5C6470;margin:0 0 6px">
        Your installed price is an all-inclusive bundle. We don't itemise individual material costs because the value you're buying is the complete, certified system — not a parts list.
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div style="border:1px solid #D9DCE1;border-radius:8px;padding:10px 12px;background:#fff">
          <div style="font-size:10px;font-weight:800;color:#0B0F1A;letter-spacing:.3px;text-transform:uppercase;margin-bottom:6px">Solar hardware</div>
          <ul style="margin:0;padding-left:16px;font-size:9.5px;line-height:1.55;color:#0B0F1A">
            <li>${sys.panels || '—'} × ${d.hardware?.panel?.brand || 'Phono Solar'} ${sys.panel_watts || 595}W ${d.hardware?.panel?.name?.split(' ').slice(-2).join(' ') || 'Draco Bifacial N-TOPCon'} solar panels</li>
            <li>${inverterHeadline}</li>
            ${bat ? `<li>${batteryHeadline}</li>` : ''}
            ${sys.topology === 'parallel' ? `<li>String combiner box + DC string fuses (parallel-string topology)</li>` : ''}
            <li>Aluminium racking system + EPDM roof seals</li>
            <li>40A IP66 lockable DC isolators (rooftop + inverter input)</li>
            <li>Genuine MC4 connectors</li>
            <li>Type II DC and AC surge protection devices</li>
            <li>${meter.brand || 'Fronius'} Smart Meter ${meter.amps || '63A'}-${sys.phase === 3 ? '3' : '1'} (${sys.phase === 3 ? 'three' : 'single'}-phase, bidirectional)</li>
            <li>Earthing and bonding materials</li>
            <li>UV-rated conduit, cable clips and warning labels</li>
          </ul>
        </div>
        <div style="border:1px solid #D9DCE1;border-radius:8px;padding:10px 12px;background:#fff">
          <div style="font-size:10px;font-weight:800;color:#0B0F1A;letter-spacing:.3px;text-transform:uppercase;margin-bottom:6px">Electrical materials</div>
          <ul style="margin:0;padding-left:16px;font-size:9.5px;line-height:1.55;color:#0B0F1A">
            <li>${sys.phase === 3 ? '63A IP66 lockable 3-phase' : '63A IP66 lockable'} AC isolator</li>
            <li>50A solar main circuit breaker</li>
            <li>RCBO protection <em style="color:#92400e">(only when recommended by site electrician)</em></li>
            <li>16 mm² TPS AC cable</li>
            <li>Solarflex PV-SF 2×6mm² + Earth UV-resistant double-insulated solar cable compliant with AS/NZS 5033</li>
            <li>Switchboard solar integration hardware</li>
            ${bat ? `<li>Backup loads protection wiring (if applicable)</li>` : ''}
          </ul>
        </div>
      </div>

      <table class="tight" style="width:100%;border-collapse:collapse;font-size:10px;margin-top:6px">
        <thead>
          <tr style="background:#F7F8FA"><th style="text-align:left;padding:6px 8px;border:1px solid #E5E7EB;width:140px">Service / Coverage</th><th style="text-align:left;padding:6px 8px;border:1px solid #E5E7EB">Included</th></tr>
        </thead>
        <tbody>
          <tr><td style="padding:5px 8px;border:1px solid #E5E7EB"><b>Installation labour</b></td><td style="padding:5px 8px;border:1px solid #E5E7EB">Certified electrician + working-at-heights install crew, scaffolding, safe-work plan, site clean-up</td></tr>
          <tr><td style="padding:5px 8px;border:1px solid #E5E7EB"><b>Compliance &amp; certification</b></td><td style="padding:5px 8px;border:1px solid #E5E7EB">Certificate of Compliance (CoC), independent Electrical Inspection &amp; Record of Inspection (ROI), Distributed Generation (DG) application lodged with your network operator</td></tr>
          <tr><td style="padding:5px 8px;border:1px solid #E5E7EB"><b>Commissioning</b></td><td style="padding:5px 8px;border:1px solid #E5E7EB">System activation, monitoring portal setup, customer-portal provisioning, day-1 performance check</td></tr>
          <tr><td style="padding:5px 8px;border:1px solid #E5E7EB"><b>Aftercare (year 1)</b></td><td style="padding:5px 8px;border:1px solid #E5E7EB">Remote monitoring, warranty-claim coordination, dedicated point of contact</td></tr>
          <tr><td style="padding:5px 8px;border:1px solid #E5E7EB"><b>Warranties</b></td><td style="padding:5px 8px;border:1px solid #E5E7EB"><b>15-yr panel product + 30-yr linear performance to 87.4%</b> · ${inv.brand || 'Fronius'} inverter <b>10 + 5 yr</b> (free auto-extension via monitoring portal at commissioning)${bat ? ` · ${bat.brand} ${bat.series} battery 10-yr @ ≥${bat.brand === 'Fronius' ? 70 : 60}% SOH` : ''} · smart meter 5-yr · racking + BoS 2-yr · Goldenray workmanship 10-yr cap</td></tr>
          <tr><td style="padding:5px 8px;border:1px solid #E5E7EB"><b>Taxes</b></td><td style="padding:5px 8px;border:1px solid #E5E7EB">GST (15%) included in every figure below</td></tr>
        </tbody>
      </table>

      <div style="margin-top:14px;padding:16px;text-align:center;background:linear-gradient(135deg,#fff7ed,#fef3c7);border:2.5px solid #F5A623;border-radius:10px">
        <div style="font-size:10px;font-weight:800;color:#92400e;letter-spacing:.5px;text-transform:uppercase">Total Installed Price · incl GST · turnkey</div>
        <div style="font-size:34px;font-weight:900;color:#0B0F1A;margin-top:4px;letter-spacing:-1px">NZ${fmt$(d.pricing.customer_inc_gst)}</div>
        <div style="font-size:10.5px;color:#5C6470;margin-top:2px">All labour, installation, compliance &amp; aftercare bundled</div>
        ${d.meta.stage === 'stage_1_estimate' ? `
        <div style="margin-top:8px;font-size:9.5px;color:#92400e;font-style:italic;line-height:1.4">
          <b>Final price is locked at Stage 2</b> after the on-site survey confirms roof, switchboard and site access — no surprises after that.
        </div>` : `
        <div style="margin-top:8px;font-size:9.5px;color:#92400e;font-style:italic;line-height:1.4">
          <b>Firm offer — Stage 2.</b> Site survey complete, price locked subject to T&Cs.
        </div>`}
      </div>

      <p style="font-size:9.5px;color:#5C6470;margin-top:10px;line-height:1.45">
        Price assumes single-storey installation on tiled or long-run roofing; if the site visit reveals harder access (multi-storey, asbestos cladding, significant tree shading or switchboard remediation), a Change Order may apply. No deposit required to accept this proposal. Deposit (20%) is invoiced only after Stage 2 final price is signed.
      </p>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
