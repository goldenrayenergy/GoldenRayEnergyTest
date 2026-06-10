// ────────────────────────────────────────────────────────────────────────────
// Proposal generator — customer email composer.
//
// Wraps the existing emailService.send() with proposal-specific subjects,
// HTML body, and PDF attachment. Inherits the dev-mode redirect-to-test-mailbox
// behaviour from emailService (so dev sends never reach real customers).
//
// Adds a DRY-RUN layer on top: when RESEND_DRY_RUN=1 OR the caller passes
// dry_run=true, this returns a description object WITHOUT actually calling
// the underlying email service. Useful for UI preview + manual triage.
// ────────────────────────────────────────────────────────────────────────────

import * as emailService from '../emailService.js';

// Test seam — overridden in route tests so no real network calls happen.
let _sendFn = null;
export function __setEmailSenderForTests(fn) { _sendFn = fn; }
async function send(payload) {
  if (_sendFn) return _sendFn(payload);
  // emailService exports `send` at module level via internal closure;
  // we use the public-facing `sendCustom` if available, else call directly.
  if (typeof emailService.send === 'function') return emailService.send(payload);
  if (typeof emailService.sendCustom === 'function') return emailService.sendCustom(payload);
  // Fallback: invoke the module's exported `send` shape
  if (emailService.default?.send) return emailService.default.send(payload);
  throw new Error('emailService.send not found');
}

const fmt$ = n => '$' + Math.round(n || 0).toLocaleString('en-NZ');

function customerSubject(d) {
  return `Your Goldenray solar proposal — ${d.system.kw} kW · ${d.meta.quote_ref}`;
}

function customerHtml(d) {
  const expected = d.scenarios?.summary?.find?.(s => s.key === 'expected') || {};
  const c = d.meta.consultant;
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:auto;color:#0B0F1A">
  <div style="background:linear-gradient(135deg,#F5A623,#FF6A00);color:#fff;padding:22px 28px;border-radius:10px 10px 0 0">
    <h1 style="margin:0;font-size:20px;font-weight:800">☀️ Goldenray Energy NZ</h1>
    <p style="margin:6px 0 0;font-size:13px;opacity:0.95">Your solar proposal is ready</p>
  </div>
  <div style="padding:24px 28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px">
    <p>Kia ora ${d.customer.name},</p>
    <p>Thank you again for the conversation. Attached is your full <b>${d.system.kw} kW</b> solar proposal
    for ${d.customer.address_one_line}. Reference: <b>${d.meta.quote_ref}</b>.</p>

    <div style="background:#fffbed;border:1px solid #F5A623;border-radius:8px;padding:14px;margin:18px 0">
      <div style="font-size:11px;color:#92400e;font-weight:700;letter-spacing:.4px;text-transform:uppercase">Headline (Expected scenario)</div>
      <div style="margin-top:6px"><b>Year-1 savings:</b> ${fmt$(expected.yr1_savings)}</div>
      <div><b>Payback:</b> ${expected.payback_yrs} years</div>
      <div><b>30-year net savings:</b> ${fmt$(expected.lifetime_net_savings)}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:6px;font-style:italic">
        Three scenarios shown in full on page 4 of the proposal.
      </div>
    </div>

    <p>The proposal is valid until <b>${d.meta.valid_until}</b>. Page 5 sets out what's included,
    page 4 shows three different financial scenarios so you can plan with a realistic range, and the final
    page is a digital signature block — sign on any device and reply with the signed PDF to lock in the install.</p>

    <p>If you have any questions, reply to this email or call me directly.</p>

    <p style="margin-top:18px">Ngā mihi,<br/>
      <b>${c.name}</b><br/>
      ${c.title} · Goldenray Energy NZ<br/>
      ${c.phone} · ${c.email}
    </p>

    <p style="color:#9ca3af;font-size:10px;border-top:1px solid #f3f4f6;padding-top:12px;margin-top:24px">
      Goldenray Energy NZ Ltd · Auckland, New Zealand · Quote ${d.meta.quote_ref} ·
      Generated ${d.meta.quote_date}
    </p>
  </div>
</div>`;
}

export async function sendCustomerProposalEmail({
  proposalData,                // `d` from buildProposalData
  customerPdfBuffer,           // attached as PDF
  to,                          // override recipient (defaults to spec customer.email)
  cc, bcc, dry_run = false,
}) {
  const d = proposalData;
  const recipient = to || d.customer.email;
  if (!recipient) throw new Error('No recipient: provide `to` or customer.email in spec.');

  const subject = customerSubject(d);
  const html = customerHtml(d);
  const attachmentName = `${d.meta.quote_ref}-proposal.pdf`;

  const wouldSend = {
    to: recipient,
    cc: cc || null,
    bcc: bcc || null,
    subject,
    attachment: { filename: attachmentName, size_bytes: customerPdfBuffer?.length || 0 },
  };

  if (dry_run || process.env.RESEND_DRY_RUN === '1') {
    return { ok: true, dry_run: true, would_send: wouldSend, provider_message_id: null };
  }

  const result = await send({
    to: recipient,
    cc, bcc,
    subject,
    html,
    attachments: customerPdfBuffer
      ? [{ filename: attachmentName, content: customerPdfBuffer.toString('base64') }]
      : undefined,
  });

  return {
    ok: true,
    dry_run: false,
    would_send: wouldSend,
    provider_message_id: result?.id || result?.data?.id || null,
  };
}
