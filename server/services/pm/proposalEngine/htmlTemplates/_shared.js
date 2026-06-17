// ────────────────────────────────────────────────────────────────────────────
// Shared HTML chrome — CSS, brand mark, page header/footer.
//
// Extracted from mockups/3-quote-sample-krishna/build-krishna-proposal.js
// (lines 603–744 of CSS, 769–793 of head/foot). Kept identical so visual
// parity with the v2 Krishna PDF is preserved.
// ────────────────────────────────────────────────────────────────────────────

export const PROPOSAL_CSS = `
  @page { size: A4; margin: 14mm 12mm 16mm 12mm }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#0B0F1A;font-size:11px;line-height:1.5}
  h1{font-size:24px;margin:0 0 6px;letter-spacing:-0.5px}
  h2{font-size:15px;margin:0 0 8px;color:#0B0F1A;border-bottom:2px solid #F5A623;padding-bottom:4px;letter-spacing:-0.2px}
  h3{font-size:11px;margin:8px 0 4px;color:#5C6470;text-transform:uppercase;letter-spacing:.6px;font-weight:700}
  h4{font-size:11px;margin:6px 0 3px;color:#0B0F1A}
  p{margin:4px 0}
  small,.small{font-size:9.5px;color:#5C6470}

  .page{min-height:262mm;display:flex;flex-direction:column;page-break-after:always;page-break-inside:avoid}
  .page:last-child{page-break-after:auto}
  .page > .page-footer{margin-top:auto}
  .page-content-grow{flex:1 1 auto}

  .page-head{display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;margin-bottom:12px;border-bottom:2px solid #F5A623;gap:14px}
  .brand{display:flex;align-items:center;gap:9px}
  .brand img.logo-img{height:54px;width:auto;display:block;object-fit:contain}
  .brand .logo-fallback{width:38px;height:38px;border-radius:8px;background:linear-gradient(135deg,#F5A623,#FF6A00);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;box-shadow:0 2px 6px rgba(245,166,35,.4)}
  .head-meta{text-align:right;font-size:9px;color:#5C6470}
  .head-meta b{color:#0B0F1A}
  .cover-logo{display:flex;justify-content:center;margin:6px 0 4px}
  .cover-logo img{height:140px;width:auto;object-fit:contain}

  .page-footer{font-size:8.5px;color:#9CA3AF;display:flex;justify-content:space-between;border-top:1px solid #E5E7EB;padding-top:5px;margin-top:10px}

  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .card{border:1px solid #D9DCE1;border-radius:8px;padding:11px 13px;background:#fff}
  .card.kpi{text-align:center;background:linear-gradient(180deg,#fff,#fffbed)}
  .card .lbl{font-size:9px;color:#5C6470;text-transform:uppercase;letter-spacing:.4px;font-weight:600}
  .card .val{font-size:22px;font-weight:900;letter-spacing:-0.7px;color:#0B0F1A;margin-top:2px;line-height:1.05}
  .card .val.savings{color:#16A34A}
  .card .val.amber{color:#F5A623}
  .card .sub{font-size:8.5px;color:#9CA3AF;margin-top:2px}

  table{width:100%;border-collapse:collapse;margin:4px 0;font-size:10px}
  th,td{border-bottom:1px solid #E5E7EB;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#F7F8FA;font-weight:700;font-size:9.5px;text-transform:uppercase;letter-spacing:.4px;color:#5C6470}
  table.tight th, table.tight td{padding:3px 5px;font-size:9px}
  table.tight th{font-size:8.5px}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .total-row td{font-weight:800;border-top:2px solid #0B0F1A;background:#fffbed}

  .customer-strip{padding:9px 13px;background:#F7F8FA;border-left:4px solid #F5A623;border-radius:4px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px}
  .customer-strip .name{font-size:13px;font-weight:800}
  .customer-strip .addr{font-size:10px;color:#5C6470}

  .pill{display:inline-block;padding:1.5px 7px;border-radius:999px;font-size:9px;font-weight:700;background:#fef3c7;color:#92400e}

  .cover-strip{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
  .cover-strip .blk{border:1px solid #D9DCE1;border-radius:8px;padding:10px 12px;background:#fff}
  .cover-strip .blk h3{margin:0 0 6px}
  .cover-strip .blk .line{font-size:10.5px;margin:2px 0}
  .cover-strip .blk b{color:#0B0F1A}

  /* Welcome letter */
  .welcome-card{border:1px solid #D9DCE1;border-radius:10px;padding:18px 22px;background:linear-gradient(180deg,#fffbed,#fff);margin-top:12px}
  .welcome-card .greeting{font-size:14px;font-weight:800;color:#0B0F1A;margin-bottom:8px}
  .welcome-card p{font-size:11px;line-height:1.6;margin:6px 0}
  .sig-name{margin-top:14px;font-size:11px}
  .sig-name b{display:block;font-size:13px;color:#FF6A00}

  /* Three-scenario table — credibility page */
  .scenario-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
  .scenario-col{border:1.5px solid #D9DCE1;border-radius:10px;padding:14px;background:#fff;text-align:center;display:flex;flex-direction:column}
  .scenario-col.expected{border-color:#FF6A00;border-width:2.5px;background:#fff7ed;position:relative}
  .scenario-col .ribbon{position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:#FF6A00;color:#fff;font-size:9px;font-weight:900;padding:2px 10px;border-radius:4px;letter-spacing:.5px}
  .scenario-col .scenario-name{font-size:14px;font-weight:900;letter-spacing:-0.3px}
  .scenario-col.expected .scenario-name{color:#FF6A00}
  .scenario-col .scenario-desc{font-size:9px;color:#5C6470;margin-top:2px;line-height:1.4;min-height:34px}
  .scenario-col .metric{margin-top:10px;padding-top:8px;border-top:1px solid #E5E7EB}
  .scenario-col .metric-lbl{font-size:8.5px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.4px;font-weight:700}
  .scenario-col .metric-val{font-size:16px;font-weight:800;letter-spacing:-0.3px;color:#0B0F1A;margin-top:2px}
  .scenario-col.expected .metric-val{color:#92400e}
  .scenario-col .metric-val.big{font-size:22px}
  .scenario-col .scenario-assumes{font-size:8.5px;color:#5C6470;margin-top:10px;padding-top:8px;border-top:1px dashed #E5E7EB;line-height:1.5}

  /* Internal sales console — single page */
  .sales-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .pl-table th{background:#0B0F1A;color:#fff}
  .pl-table .total-row td{background:#fef3c7;color:#0B0F1A}
  .floor-healthy{color:#16A34A;font-weight:800}
  .floor-amber{color:#F5A623;font-weight:800}
  .floor-below{color:#DC2626;font-weight:800}

  /* Hardware rows */
  .comp-card{display:grid;grid-template-columns:1fr 90px;gap:10px;border:1px solid #D9DCE1;border-radius:8px;padding:10px 12px;background:#fff;min-height:110px}
  .comp-card .specs{font-size:9.5px;line-height:1.55}
  .comp-card .specs b{display:block;font-size:11px;color:#0B0F1A;margin-bottom:3px}
  .comp-img{background:#F7F8FA;border:1px solid #E5E7EB;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#9CA3AF;text-align:center;padding:4px}

  /* Disclaimer */
  .disclaimer{font-size:8.5px;color:#9CA3AF;font-style:italic;line-height:1.45;margin-top:10px}

  /* Signature block */
  .sig{border:1.5px solid #0B0F1A;border-radius:8px;padding:14px;margin-top:14px}
  .sig-row{display:grid;grid-template-columns:80px 1fr 80px 140px;gap:10px;align-items:end;margin-top:14px}
  .sig-line{border-bottom:1px solid #0B0F1A;height:22px}
  .sig-label{font-size:10px;color:#5C6470;font-weight:600}

  .terms p{font-size:10px;margin:4px 0}
  .terms h4{margin-top:8px}
  .terms ol li{font-size:10px;margin:2px 0}

  /* Phase H5 — How-it-works grid (4 scenario cards w/ icons) */
  .hiw-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .hiw{border:1px solid #D9DCE1;border-radius:8px;padding:10px;background:#fff}
  .hiw .hiw-title{font-size:10.5px;font-weight:700;color:#0B0F1A;margin-bottom:6px;text-align:center}
  .hiw-diagram{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9px;text-align:center}
  .hiw-node{padding:4px;border:1px solid #E5E7EB;border-radius:6px;background:#fff}
  .hiw-node .icon{font-size:18px;color:#F5A623;display:block;margin-bottom:1px}
  .hiw-node .lbl{font-size:8.5px;font-weight:700;color:#0B0F1A;letter-spacing:.3px}
  .hiw-arrows{font-size:8px;color:#9CA3AF;text-align:center;margin-top:4px;font-style:italic}

  /* Phase H5 — Flow-legend for stacked daily flow charts */
  .flow-legend{display:flex;gap:14px;font-size:9px;color:#5C6470;margin-bottom:8px;flex-wrap:wrap}
  .flow-legend span{display:flex;align-items:center;gap:3px}
  .flow-legend .sw{width:10px;height:10px;border-radius:2px;display:inline-block}
`;

export function brandMark(d) {
  const logo = d.meta.logo_data_uri;
  return logo
    ? `<img class="logo-img" src="${logo}" alt="Goldenray Energy NZ" />`
    : `<div class="logo-fallback">G</div>`;
}

export function pageHead(d, label) {
  return `<div class="page-head">
    <div class="brand">${brandMark(d)}</div>
    <div class="head-meta">
      <div style="font-size:11px;font-weight:800;color:#0B0F1A">${label}</div>
      <div>Ref ${d.meta.quote_ref} · ${d.customer.surname} · ${d.meta.quote_date}</div>
    </div>
  </div>`;
}

export function pageFoot(d, sectionNum, sectionsTotal) {
  const c = d.meta.consultant;
  return `<div class="page-footer">
    <span>Goldenray Energy NZ™ · ${c.name} · ${c.phone} · ${c.office} · ${c.email}</span>
    <span>Section ${sectionNum} of ${sectionsTotal}</span>
  </div>`;
}
