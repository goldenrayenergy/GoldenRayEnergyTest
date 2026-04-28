// PDF Generation Service using Puppeteer
// Falls back to simple HTML if Puppeteer is not available

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

function buildProposalHTML(p) {
  const fmt = n => '$' + Number(n).toLocaleString('en-NZ', { maximumFractionDigits: 0 });
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
</style></head><body>
  <div class="header"><div><div class="brand">GoldenRay Energy</div><div style="font-size:11px;color:#888">hello@goldenrayenergy.co.nz | +64 21 839 356</div></div>
  <div style="text-align:right;font-size:11px;color:#999">SOLAR QUOTE<br>${new Date().toLocaleDateString('en-NZ')}</div></div>
  <div style="background:#f8f9fa;border-radius:8px;padding:14px;margin-bottom:16px"><div style="font-size:18px;font-weight:700">${p.name || 'Customer'}</div><div style="font-size:12px;color:#666">${p.email || ''} | ${p.location || 'New Zealand'}</div></div>
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
  <p style="text-align:center;margin-top:30px;color:#999;font-size:10px">Quote valid for 30 days. GoldenRay Energy Ltd, Auckland, New Zealand.</p>
</body></html>`;
}
