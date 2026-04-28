// Detailed Quote PDF Generator
// Generates a professional multi-section PDF with full savings breakdown

export async function generateQuotePDF(customer, calc) {
  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const html = buildQuoteHTML(customer, calc);
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    });
    await browser.close();
    return pdf;
  } catch (err) {
    console.warn('Puppeteer not available, returning HTML buffer');
    return Buffer.from(buildQuoteHTML(customer, calc));
  }
}

function buildQuoteHTML(c, q) {
  const fmt = n => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });
  const date = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const validUntil = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });

  // 25-year projection data
  const years = [1, 5, 10, 15, 20, 25];
  const elecInflation = 0.05; // 5% annual electricity inflation
  const projections = years.map(y => {
    const traditionalCumulative = Array.from({ length: y }, (_, i) => q.traditionalCost * Math.pow(1 + elecInflation, i)).reduce((a, b) => a + b, 0);
    const solarCumulative = q.totalCost + (q.traditionalCost - q.annualSavings) * y;
    const netSavings = traditionalCumulative - solarCumulative;
    return { year: y, traditional: Math.round(traditionalCumulative), solar: Math.round(solarCumulative), savings: Math.round(netSavings) };
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',sans-serif; color:#1a1a1a; font-size:12px; line-height:1.5; }
  .page { padding:0; }

  /* Header */
  .header { background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%); color:#fff; padding:28px 32px; display:flex; justify-content:space-between; align-items:center; }
  .brand { font-size:26px; font-weight:900; letter-spacing:-0.5px; }
  .brand span { opacity:0.85; font-weight:400; font-size:14px; display:block; margin-top:2px; }
  .quote-badge { background:rgba(255,255,255,0.2); border-radius:8px; padding:10px 16px; text-align:right; }
  .quote-badge div:first-child { font-size:10px; opacity:0.8; text-transform:uppercase; letter-spacing:1px; }
  .quote-badge div:last-child { font-size:14px; font-weight:700; }

  /* Content */
  .content { padding:24px 32px; }

  /* Customer Info */
  .customer-bar { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:16px 20px; margin-bottom:20px; display:flex; justify-content:space-between; }
  .customer-bar .name { font-size:16px; font-weight:700; }
  .customer-bar .detail { font-size:11px; color:#64748b; margin-top:2px; }

  /* Section */
  .section { margin-bottom:20px; }
  .section-title { font-size:13px; font-weight:800; color:#1e293b; text-transform:uppercase; letter-spacing:0.5px; padding-bottom:6px; border-bottom:2px solid #f59e0b; margin-bottom:12px; display:flex; align-items:center; gap:6px; }

  /* Stats Grid */
  .stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px; }
  .stat-card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:14px; text-align:center; }
  .stat-card .label { font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; }
  .stat-card .value { font-size:20px; font-weight:800; margin-top:4px; color:#1e293b; }
  .stat-card.highlight { background:linear-gradient(135deg,#f0fdf4,#dcfce7); border-color:#86efac; }
  .stat-card.highlight .value { color:#059669; }
  .stat-card.amber { background:linear-gradient(135deg,#fffbeb,#fef3c7); border-color:#fcd34d; }
  .stat-card.amber .value { color:#d97706; }

  /* Table */
  table { width:100%; border-collapse:collapse; }
  table th { background:#f1f5f9; padding:8px 12px; text-align:left; font-size:10px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.3px; }
  table td { padding:8px 12px; border-bottom:1px solid #f1f5f9; font-size:11px; }
  table tr:last-child td { border-bottom:none; }
  .total-row { background:#1e293b; color:#fff; }
  .total-row td { font-weight:800; font-size:13px; padding:10px 12px; border:none; }

  /* Savings comparison */
  .comparison { display:grid; grid-template-columns:1fr 60px 1fr; gap:0; align-items:center; margin:16px 0; }
  .comp-box { border-radius:10px; padding:16px; text-align:center; }
  .comp-traditional { background:#fef2f2; border:1px solid #fca5a5; }
  .comp-solar { background:#f0fdf4; border:1px solid #86efac; }
  .comp-vs { text-align:center; font-size:11px; font-weight:800; color:#94a3b8; }
  .comp-box .amount { font-size:22px; font-weight:900; }
  .comp-box .sublabel { font-size:9px; color:#64748b; margin-top:2px; }
  .comp-traditional .amount { color:#dc2626; }
  .comp-solar .amount { color:#059669; }

  /* Projection table */
  .proj-table th { background:#f59e0b; color:#fff; }
  .proj-table td { text-align:center; }
  .savings-cell { color:#059669; font-weight:700; }

  /* Environmental */
  .env-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .env-card { background:linear-gradient(135deg,#f0fdf4,#ecfdf5); border:1px solid #a7f3d0; border-radius:10px; padding:14px; text-align:center; }
  .env-card .icon { font-size:24px; margin-bottom:4px; }
  .env-card .val { font-size:18px; font-weight:800; color:#059669; }
  .env-card .lbl { font-size:9px; color:#64748b; margin-top:2px; }

  /* Footer */
  .footer { background:#1e293b; color:#94a3b8; padding:16px 32px; font-size:9px; display:flex; justify-content:space-between; margin-top:20px; }
  .footer a { color:#f59e0b; text-decoration:none; }

  /* Page break helper */
  .page-break { page-break-before:always; }
</style></head><body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div>
      <div class="brand">☀️ GOLDENRAY ENERGY NZ<span>Powering a Sustainable Future</span></div>
    </div>
    <div class="quote-badge">
      <div>Solar Quote</div>
      <div>${date}</div>
    </div>
  </div>

  <div class="content">

    <!-- CUSTOMER -->
    <div class="customer-bar">
      <div>
        <div class="name">${c.name || 'Valued Customer'}</div>
        <div class="detail">${[c.email, c.phone, c.location].filter(Boolean).join(' | ')}</div>
      </div>
      <div style="text-align:right">
        <div class="detail">Quote Reference: GR-${Date.now().toString(36).toUpperCase()}</div>
        <div class="detail">Valid Until: ${validUntil}</div>
      </div>
    </div>

    <!-- SYSTEM OVERVIEW -->
    <div class="section">
      <div class="section-title">⚡ System Overview</div>
      <div class="stats-grid">
        <div class="stat-card amber"><div class="label">System Size</div><div class="value">${q.systemSize} kW</div></div>
        <div class="stat-card"><div class="label">Solar Panels</div><div class="value">${q.panels}</div></div>
        <div class="stat-card"><div class="label">Annual Output</div><div class="value">${Number(q.annualKwh).toLocaleString()} kWh</div></div>
        <div class="stat-card"><div class="label">${q.batteryKwh > 0 ? 'Battery' : 'System Type'}</div><div class="value">${q.batteryKwh > 0 ? q.batteryKwh + ' kWh' : (c.systemType || 'On-Grid')}</div></div>
      </div>
    </div>

    <!-- COST BREAKDOWN -->
    <div class="section">
      <div class="section-title">💰 Detailed Cost Breakdown</div>
      <table>
        <thead><tr><th>Item</th><th>Details</th><th style="text-align:right">Cost (NZD)</th></tr></thead>
        <tbody>
          <tr><td><strong>Solar Panels</strong></td><td>${q.panels} × ${Math.round(q.panelCost / q.panels)}/panel (${q.systemSize} kW system)</td><td style="text-align:right">${fmt(q.panelCost)}</td></tr>
          <tr><td><strong>Inverter</strong></td><td>Grid-tie inverter for ${q.systemSize} kW system</td><td style="text-align:right">${fmt(q.inverterCost)}</td></tr>
          <tr><td><strong>Installation & Labour</strong></td><td>Professional installation, electrical work, mounting</td><td style="text-align:right">${fmt(q.laborCost)}</td></tr>
          ${q.batteryKwh > 0 ? `<tr><td><strong>Battery Storage</strong></td><td>${q.batteryKwh} kWh lithium battery pack</td><td style="text-align:right">${fmt(q.batteryCost)}</td></tr>` : ''}
          <tr><td><strong>Margin</strong></td><td>Business overheads, warranty coverage</td><td style="text-align:right">${fmt(q.markup)}</td></tr>
          <tr><td><strong>GST (15%)</strong></td><td>Goods & Services Tax</td><td style="text-align:right">${fmt(q.tax)}</td></tr>
        </tbody>
        <tfoot><tr class="total-row"><td colspan="2">TOTAL INVESTMENT</td><td style="text-align:right">${fmt(q.totalCost)}</td></tr></tfoot>
      </table>
    </div>

    <!-- SAVINGS vs TRADITIONAL -->
    <div class="section">
      <div class="section-title">📊 Solar vs Traditional Electricity — Annual Comparison</div>
      <div class="comparison">
        <div class="comp-box comp-traditional">
          <div style="font-size:10px;font-weight:700;color:#991b1b;margin-bottom:4px">❌ WITHOUT SOLAR</div>
          <div class="amount">${fmt(q.traditionalCost)}</div>
          <div class="sublabel">Annual electricity cost</div>
          <div style="font-size:10px;color:#991b1b;margin-top:8px;font-weight:600">25-year cost: ${fmt(q.traditionalCost * 25)}</div>
          <div style="font-size:9px;color:#dc2626;margin-top:2px">+ rising ~5% every year</div>
        </div>
        <div class="comp-vs">VS</div>
        <div class="comp-box comp-solar">
          <div style="font-size:10px;font-weight:700;color:#065f46;margin-bottom:4px">✅ WITH SOLAR</div>
          <div class="amount">${fmt(q.traditionalCost - q.annualSavings)}</div>
          <div class="sublabel">Remaining annual cost</div>
          <div style="font-size:10px;color:#059669;margin-top:8px;font-weight:600">You save ${fmt(q.annualSavings)}/year</div>
          <div style="font-size:9px;color:#059669;margin-top:2px">${q.costReduction}% reduction</div>
        </div>
      </div>

      <!-- Detailed savings breakdown -->
      <table style="margin-top:10px">
        <thead><tr><th>Savings Metric</th><th style="text-align:right">Value</th><th>How It's Calculated</th></tr></thead>
        <tbody>
          <tr><td>Current Monthly Bill</td><td style="text-align:right;font-weight:700">${fmt(c.monthlyBill || q.traditionalCost / 12)}</td><td style="color:#64748b">Your current electricity spend</td></tr>
          <tr><td>Monthly Savings with Solar</td><td style="text-align:right;font-weight:700;color:#059669">${fmt(q.monthlySavings)}</td><td style="color:#64748b">~85% of current bill offset by solar</td></tr>
          <tr><td>Annual Savings</td><td style="text-align:right;font-weight:700;color:#059669">${fmt(q.annualSavings)}</td><td style="color:#64748b">Monthly savings × 12 months</td></tr>
          <tr><td>Payback Period</td><td style="text-align:right;font-weight:700;color:#d97706">${q.paybackYears} years</td><td style="color:#64748b">Total cost ÷ annual savings</td></tr>
          <tr><td>Return on Investment</td><td style="text-align:right;font-weight:700;color:#059669">${q.roi}%</td><td style="color:#64748b">(25yr savings − cost) ÷ cost × 100</td></tr>
          <tr><td>25-Year Lifetime Savings</td><td style="text-align:right;font-weight:700;color:#059669">${fmt(q.lifetimeSavings)}</td><td style="color:#64748b">Annual savings × 25 year panel lifespan</td></tr>
          <tr><td>Net Profit (after system cost)</td><td style="text-align:right;font-weight:700;color:#059669">${fmt(q.lifetimeSavings - q.totalCost)}</td><td style="color:#64748b">Lifetime savings − total investment</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 25-YEAR PROJECTION -->
    <div class="section" style="page-break-before:auto">
      <div class="section-title">📈 25-Year Cost Projection</div>
      <p style="font-size:10px;color:#64748b;margin-bottom:10px">Assuming 5% annual electricity price inflation (NZ average). Solar locks in your energy costs from day one.</p>
      <table class="proj-table">
        <thead><tr><th>Year</th><th>Traditional Electricity (Cumulative)</th><th>Solar System (Cumulative)</th><th>Net Savings</th></tr></thead>
        <tbody>
          ${projections.map(p => `<tr>
            <td style="text-align:center;font-weight:700">Year ${p.year}</td>
            <td style="text-align:center;color:#dc2626">${fmt(p.traditional)}</td>
            <td style="text-align:center;color:#2563eb">${fmt(p.solar)}</td>
            <td class="savings-cell" style="text-align:center">${p.savings > 0 ? fmt(p.savings) : '-' + fmt(Math.abs(p.savings))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <!-- ENVIRONMENTAL IMPACT -->
    <div class="section">
      <div class="section-title">🌿 Environmental Impact</div>
      <div class="env-grid">
        <div class="env-card">
          <div class="icon">🏭</div>
          <div class="val">${q.co2TonsYear}t</div>
          <div class="lbl">CO₂ Reduced Per Year</div>
          <div style="font-size:9px;color:#059669;margin-top:4px">Lifetime: ${q.lifetimeCo2} tonnes</div>
        </div>
        <div class="env-card">
          <div class="icon">🌳</div>
          <div class="val">${q.treesEquivalent}</div>
          <div class="lbl">Equivalent Trees Planted</div>
          <div style="font-size:9px;color:#059669;margin-top:4px">Every single year</div>
        </div>
        <div class="env-card">
          <div class="icon">⚡</div>
          <div class="val">${Number(q.annualKwh).toLocaleString()}</div>
          <div class="lbl">Clean kWh Generated/Year</div>
          <div style="font-size:9px;color:#059669;margin-top:4px">100% renewable energy</div>
        </div>
      </div>
    </div>

    <!-- WHAT'S INCLUDED -->
    <div class="section">
      <div class="section-title">✅ What's Included</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">
        ${['Premium tier-1 solar panels (25-year warranty)', 'Grid-tie inverter with monitoring', 'Professional roof mounting system', 'Full electrical installation & wiring', 'Council consent & inspection', 'System commissioning & testing', 'Smart energy monitoring app', '10-year workmanship guarantee', 'Free system health check (Year 1)', 'Post-install support & training'].map(item =>
          `<div style="display:flex;align-items:center;gap:6px;padding:4px 0"><span style="color:#059669;font-weight:700">✓</span>${item}</div>`
        ).join('')}
      </div>
    </div>

  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div>
      <strong style="color:#f59e0b">Goldenray Energy NZ Ltd</strong><br>
      Level 3, 45 Queen St, Auckland, New Zealand<br>
      <a href="mailto:hello@goldenrayenergy.co.nz">hello@goldenrayenergy.co.nz</a> | +64 21 839 356
    </div>
    <div style="text-align:right">
      Quote generated: ${date}<br>
      Valid until: ${validUntil}<br>
      Subject to site survey & final assessment
    </div>
  </div>

</div>
</body></html>`;
}
