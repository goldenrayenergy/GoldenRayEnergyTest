import nodemailer from 'nodemailer';
import env from '../config/env.js';

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  if (env.email.sendgridKey) {
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net', port: 587, secure: false,
      auth: { user: 'apikey', pass: env.email.sendgridKey },
    });
  } else if (env.smtp.host) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host, port: env.smtp.port, secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  } else {
    console.warn('No email service configured — emails will be logged only');
    transporter = { sendMail: async (opts) => { console.log('📧 Email (dev):', opts.to, opts.subject); return { messageId: 'dev-' + Date.now() }; } };
  }
  return transporter;
}

export async function sendProposalEmail(proposal) {
  const t = getTransporter();
  const fmt = n => '$' + Number(n).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

  return t.sendMail({
    from: `"${env.email.fromName}" <${env.email.from}>`,
    to: proposal.email,
    subject: `Your Goldenray Energy NZ Solar Quote - ${fmt(proposal.total_cost)}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
      <div style="background:#f59e0b;color:#fff;padding:20px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:20px">☀️ GOLDENRAY ENERGY NZ</h1>
        <p style="margin:4px 0 0;opacity:.85;font-size:12px;font-style:italic">Powering a Sustainable Future</p>
      </div>
      <div style="padding:20px;border:1px solid #eee;border-top:0;border-radius:0 0 8px 8px">
        <p>Hi ${proposal.name},</p>
        <p>Here's your personalized solar quote:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border-bottom:1px solid #eee">System Size</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:700">${proposal.system_size_kw}kW</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee">Total Cost</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:700">${fmt(proposal.total_cost)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee">Annual Savings</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:700;color:#059669">${fmt(proposal.annual_savings)}</td></tr>
          <tr><td style="padding:8px">Payback Period</td><td style="padding:8px;font-weight:700">${proposal.payback_years} years</td></tr>
        </table>
        <p>Call us at <strong>+64 21 839 356</strong> to get started.</p>
        <p style="color:#888;font-size:12px">Goldenray Energy NZ Ltd, Auckland, New Zealand</p>
      </div>
    </div>`,
  });
}

export async function sendEmail({ to, subject, html, text, attachments }) {
  const t = getTransporter();
  return t.sendMail({
    from: `"${env.email.fromName}" <${env.email.from}>`,
    to, subject, html, text, attachments,
  });
}

export async function sendQuoteEmail(customer, calc, pdfBuffer, fileName) {
  const fmt = n => '$' + Number(n).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

  return sendEmail({
    to: customer.email,
    subject: `Your Goldenray Energy NZ Solar Quote — ${fmt(calc.totalCost)} for ${calc.systemSize}kW System`,
    html: `<div style="font-family:'Segoe UI',sans-serif;max-width:620px;margin:auto;background:#fff">
      <div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;padding:24px 28px;border-radius:10px 10px 0 0">
        <h1 style="margin:0;font-size:22px;font-weight:800">☀️ GOLDENRAY ENERGY NZ</h1>
        <p style="margin:6px 0 0;opacity:.9;font-size:12px;font-style:italic">Powering a Sustainable Future</p>
        <p style="margin:6px 0 0;opacity:.85;font-size:13px">Your Personalized Solar Quote</p>
      </div>
      <div style="padding:24px 28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px">
        <p style="font-size:14px">Hi <strong>${customer.name || 'there'}</strong>,</p>
        <p style="color:#4b5563;font-size:13px">Thank you for your interest in solar energy! Please find your detailed quote attached as a PDF. Here's a quick summary:</p>

        <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">System Size</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:13px">${calc.systemSize} kW (${calc.panels} panels)</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">Total Investment</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:13px;border-top:1px solid #e5e7eb">${fmt(calc.totalCost)}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">Annual Savings</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:13px;color:#059669;border-top:1px solid #e5e7eb">${fmt(calc.annualSavings)}/yr</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">Payback Period</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:13px;border-top:1px solid #e5e7eb">${calc.paybackYears} years</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">25-Year Savings</td><td style="padding:6px 0;text-align:right;font-weight:800;font-size:14px;color:#059669;border-top:1px solid #e5e7eb">${fmt(calc.lifetimeSavings)}</td></tr>
          </table>
        </div>

        <p style="color:#4b5563;font-size:13px">📎 <strong>Your full detailed quote is attached as a PDF</strong> — it includes complete cost breakdown, 25-year savings projection, and environmental impact analysis.</p>

        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;margin:16px 0;text-align:center">
          <div style="font-size:11px;color:#065f46;font-weight:600">You could save</div>
          <div style="font-size:24px;font-weight:900;color:#059669">${fmt(calc.lifetimeSavings)}</div>
          <div style="font-size:11px;color:#065f46">over 25 years with solar</div>
        </div>

        <p style="font-size:13px">Ready to take the next step? Call us at <strong>+64 21 839 356</strong> or reply to this email.</p>
        <p style="color:#9ca3af;font-size:11px;margin-top:20px;border-top:1px solid #f3f4f6;padding-top:12px">Goldenray Energy NZ Ltd | Auckland, New Zealand<br>hello@goldenrayenergy.co.nz | +64 21 839 356<br><em>Quote valid for 30 days. Subject to site survey.</em></p>
      </div>
    </div>`,
    attachments: pdfBuffer ? [{
      filename: fileName,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }] : undefined,
  });
}
