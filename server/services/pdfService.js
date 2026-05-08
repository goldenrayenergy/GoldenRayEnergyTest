// PDF Generation Service using Puppeteer.
// Falls back to raw HTML if Puppeteer can't launch in this environment.
//
// If proposal.lineItems is populated, the PDF includes an itemised
// Bill of Materials section. Otherwise it falls back to the legacy
// bag-of-numbers summary so existing flows keep working.

const GST_RATE = 0.15;
const fmt = n => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

export async function generateProposalPDF(proposal) {
  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    const html = buildProposalHTML(proposal);
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });

    await browser.close();
    return pdf;
  } catch (err) {
    console.warn('Puppeteer not available, returning HTML fallback');
    return Buffer.from(buildProposalHTML(proposal));
  }
}

function buildItemsTable(items) {
  if (!items || items.length === 0) return '';

  const rows = items.map(it => {
    const cost = Number(it.unit_cost_nzd) || 0;
    const margin = Number(it.margin_pct) || 0;
    const unitSellExcl = +(cost * (1 + margin / 100)).toFixed(2);
    const unitSellIncl = +(unitSellExcl * (1 + GST_RATE)).toFixed(2);
    const lineTotalIncl = +(unitSellIncl * it.qty).toFixed(2);
    return `<tr>
      <td class="bom-name">${escape(it.name || '')}${it.sku ? ` <span class="bom-sku">· ${escape(it.sku)}</span>` : ''}</td>
      <td class="bom-qty">${it.qty}</td>
      <td class="bom-unit">${fmt(unitSellIncl)}</td>
      <td class="bom-line">${fmt(lineTotalIncl)}</td>
    </tr>`;
  }).join('');

  // Roll-up totals
  const sellExcl = items.reduce((s, it) => {
    const cost = Number(it.unit_cost_nzd) || 0;
    const margin = Number(it.margin_pct) || 0;
    return s + (cost * (1 + margin / 100) * it.qty);
  }, 0);
  const gst = +(sellExcl * GST_RATE).toFixed(2);
  const sellIncl = +(sellExcl + gst).toFixed(2);

  return `
    <h2 class="bom-title">Bill of Materials</h2>
    <table class="bom">
      <thead>
        <tr>
          <th class="bom-name">Item</th>
          <th class="bom-qty">Qty</th>
          <th class="bom-unit">Unit (incl GST)</th>
          <th class="bom-line">Line Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="bom-subtotal">
          <td colspan="3">Sub-total (excl GST)</td>
          <td>${fmt(sellExcl)}</td>
        </tr>
        <tr class="bom-subtotal">
          <td colspan="3">GST 15%</td>
          <td>${fmt(gst)}</td>
        </tr>
        <tr class="bom-grandtotal">
          <td colspan="3">TOTAL (incl GST)</td>
          <td>${fmt(sellIncl)}</td>
        </tr>
      </tfoot>
    </table>`;
}

// Minimal HTML escape — proposals data comes from the DB but caller-supplied
// product names occasionally contain quote chars (e.g. "5kW Hybrid Inverter").
function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function buildProposalHTML(p) {
  const itemsTable = buildItemsTable(p.lineItems);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family:'Segoe UI',sans-serif; }
  body { padding:40px; color:#111; }
  .header { display:flex; justify-content:space-between; border-bottom:3px solid #f59e0b; padding-bottom:12px; margin-bottom:20px; }
  .brand { font-size:24px; font-weight:800; color:#f59e0b; }
  .grid { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:12px; margin:16px 0; }
  .stat { background:#f8f9fa; border-radius:8px; padding:16px; text-align:center; }
  .stat .val { font-size:22px; font-weight:700; margin-top:4px; }
  .stat .lbl { font-size:10px; color:#888; text-transform:uppercase; }
  .green { color:#059669; }
  table { width:100%; border-collapse:collapse; margin:16px 0; }
  td { padding:8px 0; border-bottom:1px solid #eee; font-size:13px; }
  .total td { border-top:2px solid #f59e0b; font-weight:800; font-size:16px; }
  .prelim-banner { background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:16px; color:#92400e; }
  .prelim-banner .label { font-weight:800; font-size:13px; letter-spacing:0.05em; text-transform:uppercase; }
  .prelim-banner .body { font-size:11px; margin-top:4px; line-height:1.5; }
  .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); font-size:120px; font-weight:900; color:#f59e0b; opacity:0.1; pointer-events:none; z-index:-1; }

  /* Bill of Materials section — only rendered when line items exist */
  .bom-title { font-size:14px; font-weight:800; color:#111; margin:24px 0 8px; padding-bottom:6px; border-bottom:2px solid #f59e0b; letter-spacing:0.04em; text-transform:uppercase; }
  table.bom { width:100%; border-collapse:collapse; }
  table.bom th { font-size:9px; color:#888; text-transform:uppercase; letter-spacing:0.05em; text-align:left; padding:8px 6px; border-bottom:2px solid #e5e7eb; background:#fafafa; font-weight:700; }
  table.bom td { font-size:11px; padding:7px 6px; border-bottom:1px solid #f3f4f6; }
  table.bom .bom-name { width:55%; }
  table.bom .bom-qty,
  table.bom .bom-unit,
  table.bom .bom-line { text-align:right; }
  table.bom .bom-name .bom-sku { color:#9ca3af; font-family:monospace; font-size:10px; }
  table.bom tfoot td { border:none; padding:6px; font-size:11px; }
  table.bom tfoot .bom-subtotal td { color:#6b7280; text-align:right; }
  table.bom tfoot .bom-subtotal td:last-child { color:#111; font-weight:700; }
  table.bom tfoot .bom-grandtotal td { font-size:14px; font-weight:800; color:#f59e0b; padding-top:10px; border-top:2px solid #f59e0b; text-align:right; }
</style></head><body>
  ${p.mode === 'preliminary' ? `<div class="watermark">PRELIMINARY</div>` : ''}
  <div class="header"><div><div class="brand">GoldenRay Energy</div><div style="font-size:11px;color:#888">hello@goldenrayenergy.co.nz | +64 21 839 356</div></div>
  <div style="text-align:right;font-size:11px;color:#999">${p.mode === 'preliminary' ? 'PRELIMINARY ESTIMATE' : 'SOLAR QUOTE'}<br>${new Date().toLocaleDateString('en-NZ')}</div></div>
  ${p.mode === 'preliminary' ? `
    <div class="prelim-banner">
      <div class="label">⚠ Preliminary estimate — site visit pending</div>
      <div class="body">Numbers below are calculated from your self-reported electricity bill and our standard NZ irradiance model. A site visit is required to confirm roof orientation, shading, structural fit, and switchboard capacity. <strong>Final pricing may shift up to ±15%</strong> after the visit.</div>
    </div>` : ''}
  <div style="background:#f8f9fa;border-radius:8px;padding:14px;margin-bottom:16px"><div style="font-size:18px;font-weight:700">${escape(p.name || 'Customer')}</div><div style="font-size:12px;color:#666">${escape(p.email || '')} | ${escape(p.location || 'New Zealand')}</div></div>
  <div class="grid">
    <div class="stat"><div class="lbl">System</div><div class="val">${p.system_size_kw}kW</div></div>
    <div class="stat"><div class="lbl">Panels</div><div class="val">${p.panel_count}</div></div>
    <div class="stat"><div class="lbl">Total Cost</div><div class="val">${fmt(p.total_cost)}</div></div>
    <div class="stat"><div class="lbl">Payback</div><div class="val">${p.payback_years}yr</div></div>
  </div>
  <div class="grid" style="background:#f0fdf4;border-radius:8px;padding:14px">
    <div style="text-align:center"><div style="font-size:18px;font-weight:700" class="green">${fmt(p.monthly_savings)}</div><div style="font-size:9px;color:#666">Monthly Savings</div></div>
    <div style="text-align:center"><div style="font-size:18px;font-weight:700" class="green">${fmt(p.annual_savings)}</div><div style="font-size:9px;color:#666">Annual Savings</div></div>
    <div style="text-align:center"><div style="font-size:18px;font-weight:700" class="green">${p.co2_tons_year}t</div><div style="font-size:9px;color:#666">CO₂ Saved/Yr</div></div>
    <div style="text-align:center"><div style="font-size:18px;font-weight:700" class="green">${p.roi_percent}%</div><div style="font-size:9px;color:#666">ROI</div></div>
  </div>
  ${itemsTable}
  <p style="text-align:center;margin-top:30px;color:#999;font-size:10px">Quote valid for 30 days. GoldenRay Energy Ltd, Auckland, New Zealand.</p>
</body></html>`;
}
