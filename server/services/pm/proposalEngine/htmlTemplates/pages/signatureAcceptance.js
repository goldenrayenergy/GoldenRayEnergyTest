// Page — Sign & lock in your install
//
// The acceptance page. Customer prints + signs + scans back, OR fills in
// fields digitally in Acrobat (flat HTML/PDF for now; AcroForm fields can be
// added in a later pdf-lib post-processing pass if needed). Goldenray
// counter-signature block at the bottom.

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$ } from '../proposalData.js';

export function pageSignatureAcceptance(d, sectionNum, sectionsTotal) {
  const consultant = d.meta?.consultant || {};
  const sys = d.system || {};
  const bat = d.hardware?.battery || null;
  const inv = d.hardware?.inverter || {};

  const signatureLineStyle = 'display:block;border-bottom:1.2px solid #0B0F1A;height:30px;background:#fafbfc;border-radius:3px 3px 0 0;padding:6px 8px;font-size:10px;color:#5C6470;font-style:italic';

  return `<section class="page">
    ${pageHead(d, 'Sign & lock in your install')}

    <div class="page-content-grow">
      <h2 style="margin:0 0 8px;font-size:18px;color:#0B0F1A">Sign & lock in your install</h2>

      <p style="font-size:9.5px;color:#5C6470;margin:0 0 12px;line-height:1.5">
        This proposal is ready to sign. Print + sign + scan back, or open this PDF in Adobe Acrobat
        Reader and type your details directly. Email the signed copy to
        <b>${consultant.email || 'reddy@goldenrayenergy.com'}</b> to lock in your install.
      </p>

      <!-- System summary tile -->
      <div style="background:#fff7ed;border:1.5px solid #FF6A00;border-radius:8px;padding:10px 14px;margin-bottom:8px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#92400e;font-weight:800;margin-bottom:5px">System you're accepting</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:10px;color:#0B0F1A">
          <div><b>Customer:</b> ${d.customer.name}</div>
          <div><b>Quote ref:</b> ${d.meta.quote_ref}</div>
          <div style="grid-column:1 / span 2"><b>Install address:</b> ${d.customer.address_one_line}${d.customer.icp ? ' · ICP ' + d.customer.icp : ''}</div>
          <div style="grid-column:1 / span 2"><b>System:</b> ${sys.kw || '—'} kW · ${sys.panels || '—'} × ${d.hardware?.panel?.brand || 'Phono'} ${sys.panel_watts || 595}W · ${inv.brand || 'Fronius'} ${inv.name?.split(' ').slice(0,3).join(' ') || ''}</div>
          ${bat ? `<div style="grid-column:1 / span 2"><b>Battery:</b> ${bat.brand} ${bat.series} ${bat.total_usable_kwh} kWh (${bat.module_count} × ${bat.module_kwh} kWh modules + 1 BMS+BCU)</div>` : ''}
        </div>
      </div>

      <!-- Price tile -->
      <div style="background:#fef3c7;border:1.5px solid #F5A623;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#92400e;font-weight:800">Total Installed Price · incl GST · turnkey</div>
        <div style="text-align:right">
          <span style="font-size:22px;font-weight:900;color:#0B0F1A;letter-spacing:-0.5px">NZ${fmt$(d.pricing.customer_inc_gst)}</span>
          <span style="font-size:9px;color:#92400e;margin-left:4px">incl GST</span>
        </div>
      </div>

      <!-- Customer acceptance -->
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#5C6470;font-weight:800;margin-bottom:4px">Customer acceptance</div>
      <p style="font-size:9.5px;color:#0B0F1A;margin:0 0 10px;line-height:1.5">
        By signing below I confirm I have read and accept the Terms &amp; Conditions and the Sales &amp; Installation Agreement schedules.
        I authorise Goldenray to proceed with the pre-install site survey and lock the firm ${d.meta.stage === 'stage_1_estimate' ? 'Stage 2 price' : 'install date'}.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
        <tr>
          <td style="width:120px;font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:6px 8px 6px 0;vertical-align:middle">Full legal name</td>
          <td style="padding:0 0 8px"><span style="${signatureLineStyle}"></span></td>
        </tr>
        <tr>
          <td style="font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:6px 8px 6px 0;vertical-align:middle">Install address</td>
          <td style="padding:0 0 8px"><span style="${signatureLineStyle}">${d.customer.address_one_line || ''}</span></td>
        </tr>
        <tr>
          <td style="font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:6px 8px 6px 0;vertical-align:middle">Email</td>
          <td style="padding:0 0 8px"><span style="${signatureLineStyle}">${d.customer.email || ''}</span></td>
        </tr>
        <tr>
          <td style="font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:6px 8px 6px 0;vertical-align:middle">Date signed</td>
          <td style="padding:0 0 8px"><span style="${signatureLineStyle}"></span></td>
        </tr>
        <tr>
          <td style="font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:6px 8px 6px 0;vertical-align:top">Signature</td>
          <td style="padding:0 0 8px">
            <span style="display:block;border:1.5px solid #0B0F1A;height:55px;background:#fafbfc;border-radius:4px;padding:6px 8px;font-size:9.5px;color:#9CA3AF;font-style:italic">
              Sign here ✎
            </span>
          </td>
        </tr>
        <tr>
          <td style="font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:8px 8px 0 0;vertical-align:top">T&amp;Cs</td>
          <td style="padding:8px 0 0">
            <span style="font-size:10px;color:#0B0F1A">
              <span style="display:inline-block;width:11px;height:11px;border:1.5px solid #0B0F1A;border-radius:2px;vertical-align:middle;margin-right:6px"></span>
              I have read and accept the T&amp;Cs and the Sales &amp; Installation Agreement.
            </span>
          </td>
        </tr>
      </table>

      <!-- Goldenray counter-signature -->
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#5C6470;font-weight:800;margin:14px 0 4px">Goldenray Energy NZ — Counter-signature</div>
      <p style="font-size:9px;color:#5C6470;margin:0 0 8px;line-height:1.4">
        Counter-signed by Goldenray on receipt to confirm acceptance of the customer's signed proposal.
      </p>

      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="width:120px;font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:6px 8px 6px 0;vertical-align:middle">Name</td>
          <td style="padding:0 0 8px"><span style="${signatureLineStyle}">${consultant.name || 'Rajeshwar Reddy'}</span></td>
        </tr>
        <tr>
          <td style="font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:6px 8px 6px 0;vertical-align:middle">Title</td>
          <td style="padding:0 0 8px"><span style="${signatureLineStyle}">${consultant.title || 'Senior Solar Consultant'}</span></td>
        </tr>
        <tr>
          <td style="font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:6px 8px 6px 0;vertical-align:middle">Date received</td>
          <td style="padding:0 0 8px"><span style="${signatureLineStyle}"></span></td>
        </tr>
        <tr>
          <td style="font-size:9.5px;font-weight:700;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;padding:6px 8px 6px 0;vertical-align:top">Signature</td>
          <td style="padding:0 0 8px">
            <span style="display:block;border:1.5px solid #0B0F1A;height:50px;background:#fafbfc;border-radius:4px;padding:6px 8px;font-size:9.5px;color:#9CA3AF;font-style:italic">
              Sign here ✎
            </span>
          </td>
        </tr>
      </table>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
