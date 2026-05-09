// ────────────────────────────────────────────────────────────────────────────
// PM Tool — Proposal generation service.
//
// Reusable engine that builds Stage 1 and Stage 2 proposal HTML + PDFs from
// project data + bill_analysis + company_settings + financing_options. Pure
// data-in / Buffer-out: no DB writes, no route concerns.
//
// Two public functions:
//   buildStage1ProposalHTML(input) → HTML string
//   buildStage2ProposalHTML(input) → HTML string
//   renderProposalPDF(html)        → Buffer (A4 PDF)
//
// Plus a helper to fetch all the inputs in one call:
//   getProposalInputs(projectId, stage) → { customer, bill, system, bom,
//                                            pricing, scenarios, settings,
//                                            financing, terms, vpp }
//
// In Phase B this gets wired to /api/pm/proposals/:id/pdf and the customer
// magic-link viewer page. For now it lives standalone — mirrors the
// content of the standalone sample scripts but pulls everything from DB.
// ────────────────────────────────────────────────────────────────────────────

import puppeteer from 'puppeteer';
import { supabaseAdmin } from '../../config/supabase.js';

const fmt$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-NZ');

// ── Pricing math ──────────────────────────────────────────────────────────
function pmt(principal, annualRatePct, years) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0 || n === 0) return n > 0 ? principal / n : 0;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// 25-year scenario projection
function buildScenarios(annualSpend, mid_price) {
  const years = 25, inflation = 0.05, degradation = 0.005;
  let doNothing = 0, solarBattery = 0, solarOnly = 0;
  for (let y = 1; y <= years; y++) {
    doNothing    += annualSpend * Math.pow(1 + inflation, y - 1);
    const offset85 = 0.85 * (1 - degradation * (y - 1));
    const offset55 = 0.55 * (1 - degradation * (y - 1));
    solarBattery += annualSpend * (1 - offset85) * Math.pow(1 + inflation, y - 1);
    solarOnly    += annualSpend * (1 - offset55) * Math.pow(1 + inflation, y - 1);
  }
  solarBattery += mid_price;
  const solarOnlyUpfront = Math.max(mid_price * 0.7, 25000);
  solarOnly += solarOnlyUpfront;
  return {
    do_nothing_25yr_cost:     Math.round(doNothing),
    solar_battery_25yr_cost:  Math.round(solarBattery),
    solar_only_25yr_cost:     Math.round(solarOnly),
    net_25yr_savings:         Math.round(doNothing - solarBattery),
    annual_savings_year1:     Math.round(annualSpend * 0.85),
  };
}

// ── Public: fetch all inputs ──────────────────────────────────────────────
export async function getProposalInputs(projectId, stage = 1) {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // 1. Project + customer
  const { data: project, error: projErr } = await supabaseAdmin
    .from('projects_v2')
    .select(`*, contacts:contact_id ( id, name, email, phone, street, suburb, city, postcode )`)
    .eq('id', projectId)
    .single();
  if (projErr) throw projErr;

  // 2. Bill analysis (if linked)
  let bill = null;
  if (project.bill_analysis_id) {
    const { data: ba } = await supabaseAdmin
      .from('bill_analyses').select('*').eq('id', project.bill_analysis_id).single();
    bill = ba;
  }
  // Fallback: try by contact_id
  if (!bill && project.contact_id) {
    const { data: ba } = await supabaseAdmin
      .from('bill_analyses').select('*').eq('contact_id', project.contact_id).order('created_at', { ascending: false }).limit(1);
    bill = ba?.[0] || null;
  }

  // 3. Company settings
  const { data: settings } = await supabaseAdmin.from('company_settings').select('*').eq('id', 1).single();

  // 4. Financing options
  const { data: financing } = await supabaseAdmin
    .from('financing_options').select('*').eq('is_active', true)
    .order('display_order', { ascending: true });

  // 5. Current T&Cs
  const { data: terms } = await supabaseAdmin
    .from('proposal_terms').select('*').eq('is_current', true).single();

  return { project, bill, settings, financing: financing || [], terms };
}

// ── Build Stage 1 HTML ────────────────────────────────────────────────────
export function buildStage1ProposalHTML({ project, bill, settings, financing, terms }, opts = {}) {
  const proposal = {
    number:         opts.proposalNumber || `PR-STAGE1-${new Date().getFullYear()}-${String(project.code || project.id).slice(-4)}`,
    date:           new Date().toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' }),
    validity_days:  settings?.proposal_validity_days_stage1 || 14,
    valid_until:    new Date(Date.now() + (settings?.proposal_validity_days_stage1 || 14) * 86400000).toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' }),
  };

  const annualKwh   = Number(bill?.annual_kwh || 0);
  const annualSpend = Number(bill?.annual_spend_nzd || 0);
  const monthlySpend= Math.round(annualSpend / 12);

  // Default pricing range (Stage 1 is always a range)
  const midPrice = Number(project.estimated_value_nzd || 50000);
  const lowPrice = Math.round(midPrice * 0.92);
  const highPrice= Math.round(midPrice * 1.08);

  const scenarios = buildScenarios(annualSpend, midPrice);

  // Financing rows with computed monthly payment
  const financingRows = financing.map(f => ({
    name: f.name, bank: f.bank, term_years: f.term_years, max: f.max_amount_nzd,
    notes: f.notes,
    monthly: f.base_rate_pct === 0 ? null : Math.round(pmt(midPrice, f.base_rate_pct, f.term_years)),
    is_cash: !f.bank,
  }));

  // Cost-of-waiting (monthly savings lost while not installed)
  const monthlySavings = Math.round(monthlySpend * 0.85);

  // Carbon
  const annualCo2Kg = Math.round(annualKwh * 0.098 * 0.85);
  const totalCo2T   = Math.round(annualCo2Kg * 25 / 1000);
  const carsOffRoad = Math.round(totalCo2T / 4.6);
  const kauriTrees  = Math.round((annualCo2Kg * 25) / 25);

  const customer = project.contacts || {};

  return renderHTML({
    proposal, customer, project, bill, settings, terms,
    scenarios, midPrice, lowPrice, highPrice,
    monthlySpend, monthlySavings,
    financingRows, annualCo2Kg, totalCo2T, carsOffRoad, kauriTrees,
    stage: 1,
  });
}

// ── Build Stage 2 HTML (locked) ──────────────────────────────────────────
export function buildStage2ProposalHTML({ project, bill, settings, financing, terms }, opts = {}) {
  // Stage 2 = Stage 1 layout but with single locked price + T&Cs inline + signature block.
  // For now we reuse the Stage 1 renderer with stage:2 flag — the renderer
  // adapts: hides range, shows locked, adds T&Cs page, adds signature.
  const proposal = {
    number:        opts.proposalNumber || `PR-STAGE2-${new Date().getFullYear()}-${String(project.code || project.id).slice(-4)}`,
    number_v1:     opts.priorProposalNumber,
    date:          new Date().toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' }),
    validity_days: settings?.proposal_validity_days_stage2 || 30,
    valid_until:   new Date(Date.now() + (settings?.proposal_validity_days_stage2 || 30) * 86400000).toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' }),
  };

  const annualSpend = Number(bill?.annual_spend_nzd || 0);
  const lockedPrice = Number(project.estimated_value_nzd || 50000);
  const lockedExcl  = +(lockedPrice / 1.15).toFixed(2);
  const gst         = +(lockedPrice - lockedExcl).toFixed(2);
  const scenarios   = buildScenarios(annualSpend, lockedPrice);
  const customer    = project.contacts || {};
  const depositPct  = Number(settings?.default_deposit_pct || 30);
  const progressPct = Number(settings?.default_progress_pct || 35);
  const finalPct    = 100 - depositPct - progressPct;

  return renderHTML({
    proposal, customer, project, bill, settings, terms,
    scenarios, lockedPrice, lockedExcl, gst,
    deposit: Math.round(lockedPrice * depositPct / 100),
    progress: Math.round(lockedPrice * progressPct / 100),
    final:   Math.round(lockedPrice * finalPct / 100),
    stage: 2,
  });
}

// ── Renderer (shared template, branches on stage) ─────────────────────────
function renderHTML(ctx) {
  const { stage, proposal, customer, project, bill, settings, terms, scenarios } = ctx;
  const isStage2 = stage === 2;

  const stageBanner = isStage2
    ? `<div class="stage-banner emerald"><div class="label">STAGE 2 — FINAL PROPOSAL · LOCKED PRICING</div><div class="text">Site visited. Distributor approved. Sign &amp; pay deposit to schedule install.</div></div>`
    : `<div class="stage-banner blue"><div class="label">STAGE 1 — INDICATIVE PROPOSAL</div><div class="text">Pricing shown as range. Final pricing locked after on-site visit.</div></div>`;

  const investBlock = isStage2
    ? `<div class="invest emerald">
         <div class="lbl">Total locked price (incl. GST)</div>
         <div class="price">${fmt$(ctx.lockedPrice)}</div>
         <div class="breakdown">
           <div>Excl. GST<br><strong>${fmt$(ctx.lockedExcl)}</strong></div>
           <div>GST (15%)<br><strong>${fmt$(ctx.gst)}</strong></div>
           <div>Year-1 savings<br><strong>${fmt$(scenarios.annual_savings_year1)}</strong></div>
         </div>
       </div>`
    : `<div class="invest amber">
         <div class="lbl">Indicative range (Stage 1)</div>
         <div class="range">${fmt$(ctx.lowPrice)} – ${fmt$(ctx.highPrice)}</div>
         <div class="note">All-inclusive: solar + battery + install + NZ compliance + 5-year workmanship warranty. GST inclusive. Locked at Stage 2.</div>
         ${ctx.financingRows && ctx.financingRows.length > 0 ? `
         <div class="financing">
           ${ctx.financingRows.map(f => `
             <div class="opt">
               <div class="lbl">${f.is_cash ? 'Pay in cash' : f.name}</div>
               <div class="price">${f.is_cash ? fmt$(ctx.midPrice) : f.monthly ? fmt$(f.monthly) + '/mo' : '—'}</div>
               <div class="sub">${f.is_cash ? 'single payment' : `${f.term_years} years`}</div>
             </div>
           `).join('')}
         </div>` : ''}
       </div>`;

  const signatureBlock = isStage2 ? `
    <h2>Acceptance &amp; Signatures</h2>
    <div class="signature">
      <p style="font-size: 10.5px; margin-bottom: 6px;">By signing below, you accept this proposal (${proposal.number}) and authorise ${settings?.legal_name || 'Goldenray Energy NZ Ltd'} to proceed.</p>
      <div class="sig-grid">
        <div class="sig-block">
          <div class="sig-label">Customer signature</div>
          <div class="sig-line"></div>
          <div class="sig-name">${customer.name || ''}</div>
        </div>
        <div class="sig-block">
          <div class="sig-label">${settings?.legal_name || 'Goldenray Energy NZ Ltd'}</div>
          <div class="sig-line"></div>
          <div class="sig-name">${settings?.signer_name || ''}, ${settings?.signer_title || ''}</div>
        </div>
      </div>
    </div>
    <div class="deposit">
      <h3>Deposit &amp; payment schedule</h3>
      <div class="row">
        <div><strong>Deposit</strong></div><div><strong>${fmt$(ctx.deposit)}</strong> within 7 days of acceptance</div>
        <div>Progress</div><div>${fmt$(ctx.progress)} on materials delivery</div>
        <div>Final</div><div>${fmt$(ctx.final)} on commissioning</div>
      </div>
      <p style="font-size: 10.5px; margin-top: 10px;">
        <strong>Bank:</strong> ${settings?.bank_name || ''} · <strong>Account:</strong> ${settings?.bank_account_number || ''}<br>
        <strong>Reference:</strong> ${proposal.number} · <strong>Particulars:</strong> ${(customer.name || '').split(' ').slice(-1)[0]}
      </p>
    </div>` : '';

  const termsBlock = isStage2 && terms ? `
    <h2>Terms &amp; Conditions (v${terms.version})</h2>
    ${(terms.terms_json || []).map(t => `<div class="terms-section"><div class="h">${t.title}</div><div class="b">${t.body}</div></div>`).join('')}` : '';

  return `
<!doctype html>
<html><head><meta charset="utf-8"><title>${proposal.number} — ${customer.name || ''}</title>
<style>${BASE_CSS}</style>
</head><body>

<div class="page">
  <div class="topbar ${isStage2 ? 'emerald' : 'amber'}">
    <div>
      <div class="brand">${(settings?.trading_name || 'GOLDENRAY ENERGY NZ').toUpperCase()}</div>
    </div>
    <div class="right">
      <div><strong>${proposal.number}</strong></div>
      <div>${proposal.date}</div>
      <div>Valid until ${proposal.valid_until}</div>
      ${isStage2 && proposal.number_v1 ? `<div class="small">Supersedes ${proposal.number_v1}</div>` : ''}
    </div>
  </div>

  ${stageBanner}

  <h1>${isStage2 ? 'Final ' : ''}Solar + Battery Proposal</h1>
  <p style="color: #4b5563; margin-bottom: 12px;">Prepared for <strong>${customer.name || ''}</strong> at ${project.address || ''}, ${project.suburb || ''}, ${project.city || ''}.</p>

  <div class="meta">
    <div class="box">
      <div class="lbl">Customer</div>
      <div class="val">${customer.name || ''}</div>
      <div class="small">${customer.email || ''} · ${customer.phone || ''}</div>
    </div>
    <div class="box">
      <div class="lbl">Site</div>
      <div class="val">${project.address || ''}</div>
      <div class="small">${project.suburb || ''}, ${project.city || ''} ${project.postcode || ''}</div>
    </div>
  </div>

  <h2>Your recommended system</h2>
  <div class="system-hero">
    <div class="stat"><div class="num">${project.system_size_kw || '—'}</div><div class="unit">kW solar</div><div class="lbl">${project.panel_count || '—'} panels</div></div>
    <div class="stat"><div class="num">${project.battery_kwh || '—'}</div><div class="unit">kWh battery</div><div class="lbl">stored backup</div></div>
    <div class="stat"><div class="num">${scenarios.annual_savings_year1 ? fmt$(scenarios.annual_savings_year1) : '—'}</div><div class="unit">/year</div><div class="lbl">Year 1 savings</div></div>
    <div class="stat"><div class="num">${scenarios.net_25yr_savings ? fmt$(scenarios.net_25yr_savings) : '—'}</div><div class="unit">25 yrs</div><div class="lbl">cumulative savings</div></div>
  </div>

  ${investBlock}

  ${termsBlock}

  ${signatureBlock}

  <div class="footer">
    <div>${settings?.legal_name || 'Goldenray Energy NZ Ltd'} · ${customer.name || ''} · ${proposal.number}</div>
    <div>Generated by PM tool</div>
  </div>
</div>

</body></html>`;
}

// ── Shared CSS (extracted from sample scripts) ────────────────────────────
const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
         color: #1a1a1a; line-height: 1.45; margin: 0; padding: 0; font-size: 11.5px; }
  .page { padding: 28px 36px; }
  .stage-banner, .system-hero, .invest, .meta, .signature, .deposit, .terms-section
    { page-break-inside: avoid; break-inside: avoid; }
  h2, h3 { page-break-after: avoid; break-after: avoid; }
  .topbar { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 3px solid; padding-bottom: 12px; margin-bottom: 16px; }
  .topbar.amber   { border-color: #f59e0b; }
  .topbar.emerald { border-color: #10b981; }
  .brand { font-weight: 800; font-size: 16px; letter-spacing: 0.5px; }
  .right { text-align: right; font-size: 9.5px; color: #555; }
  h1 { font-size: 22px; margin: 4px 0 6px; font-weight: 700; }
  h2 { font-size: 14px; margin: 16px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 12px 0 5px; color: #4b5563; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  .stage-banner { padding: 10px 14px; margin-bottom: 12px; border-radius: 6px; border: 1.5px solid; }
  .stage-banner.blue    { background: #eff6ff; border-color: #93c5fd; }
  .stage-banner.emerald { background: #ecfdf5; border-color: #6ee7b7; }
  .stage-banner .label { font-weight: 800; font-size: 11px; letter-spacing: 0.5px; }
  .stage-banner.blue    .label { color: #1e40af; }
  .stage-banner.emerald .label { color: #065f46; }
  .stage-banner .text { font-size: 10.5px; }
  .stage-banner.blue    .text { color: #1e3a8a; }
  .stage-banner.emerald .text { color: #065f46; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .meta .box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 10px 12px; }
  .meta .box .lbl { font-size: 9px; color: #6b7280; text-transform: uppercase; }
  .meta .box .val { font-size: 11.5px; font-weight: 600; margin-top: 1px; }
  .system-hero { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 14px; }
  .stat { background: #fffbeb; border: 1.5px solid #fcd34d; border-radius: 6px; padding: 9px 10px; text-align: center; }
  .stat .num   { font-size: 20px; font-weight: 800; color: #92400e; line-height: 1; }
  .stat .unit  { font-size: 9.5px; color: #92400e; margin-top: 1px; }
  .stat .lbl   { font-size: 9px; color: #78716c; text-transform: uppercase; margin-top: 3px; }
  .invest { border-radius: 8px; padding: 14px 18px; margin: 10px 0; }
  .invest.amber   { background: linear-gradient(180deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; }
  .invest.emerald { background: linear-gradient(180deg, #d1fae5 0%, #a7f3d0 100%); border: 2px solid #10b981; text-align: center; }
  .invest .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .invest.amber   .lbl { color: #78716c; }
  .invest.emerald .lbl { color: #065f46; }
  .invest .range { font-size: 24px; font-weight: 800; color: #78350f; margin: 3px 0; }
  .invest .price { font-size: 36px; font-weight: 800; color: #064e3b; line-height: 1.1; margin: 6px 0; }
  .invest .breakdown { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px;
                       padding-top: 12px; border-top: 1px solid #6ee7b7; font-size: 10px; }
  .financing { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px;
               padding-top: 10px; border-top: 1px solid #fbbf24; }
  .financing .opt { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 5px; padding: 8px; text-align: center; }
  .financing .opt .lbl  { font-size: 9px; color: #78716c; text-transform: uppercase; }
  .financing .opt .price { font-size: 16px; font-weight: 800; color: #78350f; margin: 3px 0 1px; }
  .financing .opt .sub   { font-size: 9px; color: #78716c; }
  .terms-section { margin-bottom: 10px; }
  .terms-section .h { font-size: 10.5px; font-weight: 800; color: #1f2937; margin-bottom: 4px; }
  .terms-section .b { font-size: 10px; color: #4b5563; line-height: 1.5; }
  .signature { background: #f9fafb; border: 2px solid #1f2937; border-radius: 6px; padding: 14px 18px; margin: 14px 0; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 10px; }
  .sig-block { padding: 10px; }
  .sig-line { border-bottom: 1px solid #1f2937; margin-bottom: 4px; height: 36px; }
  .sig-label { font-size: 9px; color: #6b7280; text-transform: uppercase; }
  .sig-name  { font-weight: 600; font-size: 10px; margin-top: 2px; }
  .deposit { background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 6px; padding: 14px 18px; margin: 12px 0; }
  .deposit .row { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; font-size: 10.5px; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 8px; margin-top: 12px;
            display: flex; justify-content: space-between; font-size: 9px; color: #6b7280; }
  .small { font-size: 9.5px; color: #6b7280; }
`;

// ── Public: render PDF from HTML ──────────────────────────────────────────
let _browser = null;
async function getBrowser() {
  if (_browser) return _browser;
  _browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  return _browser;
}

export async function renderProposalPDF(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const buffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await page.close();
  return buffer;
}

export async function shutdownBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}
