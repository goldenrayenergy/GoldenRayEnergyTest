import { Resend } from 'resend';
import env from '../config/env.js';

// ── Configuration ──────────────────────────────────────────────────────────
// During testing the test mailbox is used both as the recipient and the
// reply-to. Resend won't let us send FROM a third-party address (e.g. a
// gmail.com), so we use Resend's built-in test sender until the customer
// domain (goldenrayenergy.co.nz) is verified in their Resend account.
const FROM_NAME      = env.email.fromName || 'GoldenRay Energy';
const FROM_ADDR      = process.env.EMAIL_FROM_ADDRESS  || 'onboarding@resend.dev';
const REPLY_TO       = process.env.EMAIL_REPLY_TO      || 'goldenrayenergy.nz@gmail.com';
const TEST_RECIPIENT = process.env.EMAIL_TEST_RECIPIENT || 'goldenrayenergy.nz@gmail.com';

let _resend = null;
function getClient() {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('⚠️  RESEND_API_KEY not set — emails will be logged to console only');
    _resend = {
      emails: {
        send: async (opts) => {
          console.log('📧 [DEV log-only] Email would send:');
          console.log('    to:           ', opts.to);
          console.log('    subject:      ', opts.subject);
          console.log('    scheduled_at: ', opts.scheduled_at || '(immediate)');
          console.log('    body length:  ', (opts.html || '').length, 'chars');
          return { data: { id: 'dev-' + Date.now() }, error: null };
        },
      },
    };
    return _resend;
  }
  _resend = new Resend(key);
  return _resend;
}

// ── Low-level send ─────────────────────────────────────────────────────────
async function send({ to, subject, html, text, attachments, scheduled_at }) {
  // Hard redirect to the test mailbox while we're in development. Prevents
  // accidentally emailing real customers from a dev environment.
  const dev = (process.env.NODE_ENV || 'development') !== 'production';
  const finalTo = dev ? TEST_RECIPIENT : to;

  const payload = {
    from:    `${FROM_NAME} <${FROM_ADDR}>`,
    to:      Array.isArray(finalTo) ? finalTo : [finalTo],
    reply_to: REPLY_TO,
    subject: dev && to !== TEST_RECIPIENT ? `[DEV → ${Array.isArray(to) ? to.join(',') : to}] ${subject}` : subject,
    html,
    text,
  };
  if (attachments?.length) payload.attachments = attachments;
  if (scheduled_at)        payload.scheduled_at = scheduled_at;

  const { data, error } = await getClient().emails.send(payload);
  if (error) throw new Error(`Resend: ${error.message || JSON.stringify(error)}`);
  return data;
}

// ── Shared template chrome ─────────────────────────────────────────────────
const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });
const COMPANY = {
  name:    'GoldenRay Energy NZ',
  tagline: 'Powering a Sustainable Future',
  phone:   '+64 21 839 356',
  email:   'hello@goldenrayenergy.co.nz',
  city:    'Auckland, New Zealand',
};

const wrap = ({ title, body, footerNote }) => `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:auto;background:#fff;color:#1f2937">
  <div style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 50%,#b45309 100%);color:#fff;padding:22px 28px;border-radius:10px 10px 0 0">
    <h1 style="margin:0;font-size:20px;font-weight:800;letter-spacing:0.3px">☀️ ${COMPANY.name.toUpperCase()}</h1>
    <p style="margin:6px 0 0;opacity:.9;font-size:11px;font-style:italic">${COMPANY.tagline}</p>
    ${title ? `<p style="margin:6px 0 0;opacity:.95;font-size:13px;font-weight:600">${title}</p>` : ''}
  </div>
  <div style="padding:24px 28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px">
    ${body}
    <p style="color:#9ca3af;font-size:11px;margin-top:24px;border-top:1px solid #f3f4f6;padding-top:12px">
      ${COMPANY.name} Ltd · ${COMPANY.city}<br>
      ${COMPANY.email} · ${COMPANY.phone}
      ${footerNote ? `<br><em>${footerNote}</em>` : ''}
    </p>
  </div>
</div>`;

// ── Existing send helpers (kept working, now Resend-backed) ────────────────
export async function sendEmail(opts) { return send(opts); }

export async function sendProposalEmail(proposal) {
  const body = `
    <p>Hi <strong>${proposal.name}</strong>,</p>
    <p style="color:#4b5563;font-size:13px">Here's your personalised solar quote.</p>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:6px 0;color:#6b7280">System size</td><td style="padding:6px 0;text-align:right;font-weight:700">${proposal.system_size_kw} kW</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;border-top:1px solid #e5e7eb">Total cost</td><td style="padding:6px 0;text-align:right;font-weight:700;border-top:1px solid #e5e7eb">${fmt$(proposal.total_cost)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;border-top:1px solid #e5e7eb">Annual savings</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#059669;border-top:1px solid #e5e7eb">${fmt$(proposal.annual_savings)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;border-top:1px solid #e5e7eb">Payback period</td><td style="padding:6px 0;text-align:right;font-weight:700;border-top:1px solid #e5e7eb">${proposal.payback_years} years</td></tr>
      </table>
    </div>
    <p style="font-size:13px">Call us at <strong>${COMPANY.phone}</strong> to discuss next steps.</p>`;
  return send({
    to: proposal.email,
    subject: `Your ${COMPANY.name} solar quote — ${fmt$(proposal.total_cost)}`,
    html: wrap({ body }),
  });
}

export async function sendQuoteEmail(customer, calc, pdfBuffer, fileName) {
  const body = `
    <p style="font-size:14px">Hi <strong>${customer.name || 'there'}</strong>,</p>
    <p style="color:#4b5563;font-size:13px">Thanks for the enquiry. Your detailed quote is attached as a PDF — here is the summary:</p>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:6px 0;color:#6b7280">System size</td><td style="padding:6px 0;text-align:right;font-weight:700">${calc.systemSize} kW (${calc.panels} panels)</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;border-top:1px solid #e5e7eb">Total investment</td><td style="padding:6px 0;text-align:right;font-weight:700;border-top:1px solid #e5e7eb">${fmt$(calc.totalCost)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;border-top:1px solid #e5e7eb">Annual savings</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#059669;border-top:1px solid #e5e7eb">${fmt$(calc.annualSavings)}/yr</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;border-top:1px solid #e5e7eb">Payback period</td><td style="padding:6px 0;text-align:right;font-weight:700;border-top:1px solid #e5e7eb">${calc.paybackYears} years</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;border-top:1px solid #e5e7eb">25-year savings</td><td style="padding:6px 0;text-align:right;font-weight:800;color:#059669;border-top:1px solid #e5e7eb">${fmt$(calc.lifetimeSavings)}</td></tr>
      </table>
    </div>
    <p style="font-size:13px">Ready to take the next step? Call us at <strong>${COMPANY.phone}</strong> or reply to this email.</p>`;
  return send({
    to: customer.email,
    subject: `Your ${COMPANY.name} solar quote — ${fmt$(calc.totalCost)} for ${calc.systemSize} kW`,
    html: wrap({ body, footerNote: 'Quote valid for 30 days. Subject to site survey.' }),
    attachments: pdfBuffer ? [{ filename: fileName, content: pdfBuffer }] : undefined,
  });
}

// ── New: team notification on a fresh website lead ─────────────────────────
// Sent from POST /api/quote/submit after the enquiry/contact/project rows
// land. Notifies the project owner (if assigned) and Aroha (admin).
export async function sendTeamNewLeadEmail({ form, calculation, leadScore, recipients, projectCode }) {
  const customerName = [form.firstName, form.lastName].filter(Boolean).join(' ').trim() || 'New website enquiry';
  const recipientList = (recipients || []).filter(Boolean);
  if (recipientList.length === 0) {
    console.log('No team-notification recipients — skipping');
    return null;
  }
  const detail = (label, value) => value ? `<tr><td style="padding:5px 8px;color:#6b7280;font-size:12px">${label}</td><td style="padding:5px 8px;font-weight:600;font-size:13px">${value}</td></tr>` : '';
  const body = `
    <p style="font-size:14px"><strong style="color:#d97706">New website lead</strong>${projectCode ? ` · Project <code style="background:#fef3c7;padding:2px 6px;border-radius:4px;font-size:12px">${projectCode}</code>` : ''}</p>
    <p style="color:#4b5563;font-size:13px">A new enquiry just came through the website form. Lead score: <strong>${leadScore || '—'} / 100</strong>.</p>
    <div style="background:#f8fafc;border-radius:8px;padding:8px;margin:14px 0">
      <table style="width:100%;border-collapse:collapse">
        ${detail('Name',           customerName)}
        ${detail('Email',          form.email)}
        ${detail('Phone',          form.phone)}
        ${detail('Address',        form.address)}
        ${detail('Monthly bill',   form.monthlyBill ? `$${form.monthlyBill}/mo` : null)}
        ${detail('Installation',   form.installationType)}
        ${detail('Battery',        form.batteryOption)}
        ${detail('Wants callback', form.callToDiscuss === 'yes' ? 'Yes — high priority' : 'No')}
        ${detail('Timeframe',      form.installationTimeframe)}
        ${calculation?.totalCost ? detail('Est. system', `${calculation.systemSize} kW · ${fmt$(calculation.totalCost)}`) : ''}
      </table>
    </div>
    <p style="font-size:13px">Open the project in the portal to qualify the lead and start the follow-up cadence.</p>`;
  return send({
    to: recipientList,
    subject: `[New lead] ${customerName}${form.monthlyBill ? ` — $${form.monthlyBill}/mo bill` : ''}`,
    html: wrap({ title: 'New Website Lead', body }),
  });
}

// ── New: customer follow-up cadence ────────────────────────────────────────
// Three scheduled emails (D+3 / D+7 / D+14) sent via Resend's scheduled_at,
// fired off once a project's quality is first set. Cold leads still get the
// cadence but with softer subject lines.
function customerEmailTemplate(step, { customerName, quality }) {
  const friendly = customerName?.split(' ')[0] || 'there';

  if (step === 1) {
    // D+3
    const subject = quality === 'cold'
      ? `Quick check-in on your solar enquiry, ${friendly}`
      : `${friendly}, here's your savings calculator + next steps`;
    const body = `
      <p style="font-size:14px">Hi <strong>${friendly}</strong>,</p>
      <p style="color:#4b5563;font-size:13px">Thanks again for getting in touch with ${COMPANY.name} about going solar. We wanted to follow up briefly while it's still fresh.</p>
      <p style="color:#4b5563;font-size:13px">Two things that often help homeowners at this stage:</p>
      <ol style="color:#4b5563;font-size:13px;line-height:1.7">
        <li><strong>Run the savings calculator</strong> — it gives you a per-month figure based on your real power bill, with a 25-year projection.</li>
        <li><strong>Look at recent NZ installs</strong> — system sizes, panel counts, and actual customer savings on the case studies page.</li>
      </ol>
      <p style="color:#4b5563;font-size:13px">If you have a question or want a fixed quote, just reply to this email. A specialist will respond personally — usually within a working day.</p>
      <p style="font-size:13px;margin-top:18px">Talk soon,<br><strong>The ${COMPANY.name} team</strong></p>`;
    return { subject, html: wrap({ body }) };
  }

  if (step === 2) {
    // D+7
    const subject = quality === 'cold'
      ? `${friendly}, no rush — but a quick update on solar`
      : `${friendly}, ready for a tailored proposal?`;
    const body = `
      <p style="font-size:14px">Hi <strong>${friendly}</strong>,</p>
      <p style="color:#4b5563;font-size:13px">Following up on your solar enquiry. Many homeowners we work with weigh up two questions at this point:</p>
      <ul style="color:#4b5563;font-size:13px;line-height:1.7">
        <li><strong>What's the upfront cost vs. financed?</strong> — most green-loan options at 1% p.a. or interest-free for 36 months let your bill savings cover the repayments from day one.</li>
        <li><strong>What size system do I actually need?</strong> — based on your roof orientation, monthly usage, and whether you want battery backup, our team can size it precisely.</li>
      </ul>
      <p style="color:#4b5563;font-size:13px">Reply to this email or call <strong>${COMPANY.phone}</strong> and we'll prepare a tailored proposal — no obligation, no pressure.</p>
      <p style="font-size:13px;margin-top:18px">Speak soon,<br><strong>The ${COMPANY.name} team</strong></p>`;
    return { subject, html: wrap({ body }) };
  }

  // D+14 — final touch
  const subject = quality === 'cold'
    ? `${friendly}, last touch from ${COMPANY.name}`
    : `${friendly}, is this still a good time to talk solar?`;
  const body = `
    <p style="font-size:14px">Hi <strong>${friendly}</strong>,</p>
    <p style="color:#4b5563;font-size:13px">This is the last touch in our quick check-in cadence — we don't want to clutter your inbox.</p>
    <p style="color:#4b5563;font-size:13px">If now isn't the right time, no problem at all. We'll be here when you're ready, and the calculator on our site is always available for a quick estimate.</p>
    <p style="color:#4b5563;font-size:13px">If you'd like to keep the conversation going, just reply to this email or call us on <strong>${COMPANY.phone}</strong>. Even a one-line "still thinking" is welcome — that way we know to stay in touch.</p>
    <p style="font-size:13px;margin-top:18px">All the best,<br><strong>The ${COMPANY.name} team</strong></p>`;
  return { subject, html: wrap({ body, footerNote: 'You will not receive further automated emails from this enquiry.' }) };
}

export async function scheduleCustomerCadence({ customerEmail, customerName, quality, projectCode }) {
  if (!customerEmail) {
    console.log('No customer email — skipping cadence');
    return [];
  }
  const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
  const cadence = [{ step: 1, day: 3 }, { step: 2, day: 7 }, { step: 3, day: 14 }];
  const results = [];
  for (const c of cadence) {
    const tpl = customerEmailTemplate(c.step, { customerName, quality });
    try {
      const data = await send({
        to: customerEmail,
        subject: tpl.subject,
        html: tpl.html,
        scheduled_at: days(c.day),
      });
      results.push({ step: c.step, day: c.day, id: data?.id || null });
    } catch (e) {
      console.error(`Cadence step ${c.step} failed:`, e.message);
      results.push({ step: c.step, day: c.day, error: e.message });
    }
  }
  console.log(`📬 Scheduled ${results.filter(r => !r.error).length}/3 follow-up emails for ${customerName} (${projectCode || 'no code'})`);
  return results;
}
