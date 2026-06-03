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
export async function sendTeamNewLeadEmail({ form, calculation, leadScore, recipients, projectCode, reviewFlag }) {
  const customerName = [form.firstName, form.lastName].filter(Boolean).join(' ').trim() || 'New website enquiry';
  const recipientList = (recipients || []).filter(Boolean);
  if (recipientList.length === 0) {
    console.log('No team-notification recipients — skipping');
    return null;
  }
  const detail = (label, value) => value ? `<tr><td style="padding:5px 8px;color:#6b7280;font-size:12px">${label}</td><td style="padding:5px 8px;font-weight:600;font-size:13px">${value}</td></tr>` : '';

  // ── Review-required block — appended above the normal lead summary ──
  // Fires when the bill analysis engine flagged the customer's upload
  // (parse_suspect, multi-address, low field confidence, etc.). Sales
  // walks into the "first call within 1 hour" task already knowing what
  // to verify with the customer instead of quoting blindly.
  // Portal base URL for deep-links. Honors PORTAL_BASE_URL env so the email
  // works in prod (Vercel) AND local dev (vite at localhost:5173).
  const portalBase = process.env.PORTAL_BASE_URL || 'https://www.goldenrayenergy.co.nz';
  const enquiryDeepLink = reviewFlag?.enquiry_id
    ? `${portalBase}/portal/enquiries/${reviewFlag.enquiry_id}?tab=bills`
    : null;

  const reviewBlock = reviewFlag?.review_required ? `
    <div style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:6px;padding:14px 16px;margin:0 0 18px 0">
      <div style="font-size:13px;font-weight:800;color:#991b1b;margin-bottom:6px">🚨 REVIEW REQUIRED — verify bills before quoting</div>
      <div style="font-size:12px;color:#7f1d1d;margin-bottom:8px">The bill analysis engine flagged this customer's upload. The customer was told a specialist would call within 24 hours <strong>instead of</strong> seeing an auto-generated savings projection — so they have no specific number in their head yet. Use this call to verify and quote honestly.</div>
      <div style="font-size:12px;font-weight:700;color:#7f1d1d;margin-bottom:4px">What to verify:</div>
      <ul style="font-size:12px;color:#7f1d1d;margin:0;padding-left:18px;line-height:1.55">
        ${(reviewFlag.review_reasons || []).map(r => `<li><strong>[${r.severity || 'warn'}]</strong> ${r.code || ''}${r.message ? ` — ${r.message}` : (r.reason ? ` — ${r.reason}` : '')}</li>`).join('')}
      </ul>
      ${enquiryDeepLink ? `<div style="margin-top:10px"><a href="${enquiryDeepLink}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;font-weight:700;font-size:12px;padding:8px 14px;border-radius:6px">Open Bills + Analysis →</a></div>` : ''}
      ${reviewFlag.analysis_id && !enquiryDeepLink ? `<div style="font-size:11px;color:#7f1d1d;margin-top:8px">Bill Analysis ID: <code style="background:#fee2e2;padding:1px 5px;border-radius:3px">${reviewFlag.analysis_id}</code></div>` : ''}
    </div>
  ` : '';

  const body = `
    ${reviewBlock}
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
  const subjectPrefix = reviewFlag?.review_required ? '[🚨 REVIEW NEEDED] ' : '[New lead] ';
  return send({
    to: recipientList,
    subject: `${subjectPrefix}${customerName}${form.monthlyBill ? ` — $${form.monthlyBill}/mo bill` : ''}`,
    html: wrap({ title: reviewFlag?.review_required ? 'Lead — Review Required' : 'New Website Lead', body }),
  });
}

// ── New: customer acknowledgment email at form submit ─────────────────────
// Fires immediately when a website form is submitted. Confirms the enquiry
// arrived and sets expectations: the team will call within 24 hours. Closes
// the "did my form even submit?" loop that costs the most leads.
export async function sendCustomerAckEmail({ form, projectCode, ownerName }) {
  if (!form?.email) {
    console.log('No customer email — skipping ack email');
    return null;
  }
  const friendly = (form.firstName || form.lastName) ? [form.firstName, form.lastName].filter(Boolean).join(' ').trim() : 'there';
  const monthlyBillStr = form.monthlyBill ? `$${form.monthlyBill}/month` : null;
  const body = `
    <p style="font-size:14px">Kia ora <strong>${friendly}</strong>,</p>
    <p style="color:#4b5563;font-size:13px">Thanks for reaching out to ${COMPANY.name}. We've received your solar enquiry${projectCode ? ` (reference <code style="background:#fef3c7;padding:1px 5px;border-radius:3px">${projectCode}</code>)` : ''} and a specialist will be in touch within <strong>one business day</strong>.</p>
    <div style="background:#f8fafc;border-radius:8px;padding:14px;margin:14px 0">
      <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Your enquiry</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        ${form.address      ? `<tr><td style="padding:3px 0;color:#6b7280">Address</td><td style="padding:3px 0;font-weight:600;text-align:right">${form.address}</td></tr>` : ''}
        ${monthlyBillStr    ? `<tr><td style="padding:3px 0;color:#6b7280">Monthly bill</td><td style="padding:3px 0;font-weight:600;text-align:right">${monthlyBillStr}</td></tr>` : ''}
        ${form.installationType ? `<tr><td style="padding:3px 0;color:#6b7280">Installation</td><td style="padding:3px 0;font-weight:600;text-align:right">${form.installationType}</td></tr>` : ''}
        ${form.batteryOption    ? `<tr><td style="padding:3px 0;color:#6b7280">Battery</td><td style="padding:3px 0;font-weight:600;text-align:right">${form.batteryOption}</td></tr>` : ''}
        ${form.installationTimeframe ? `<tr><td style="padding:3px 0;color:#6b7280">Timeframe</td><td style="padding:3px 0;font-weight:600;text-align:right">${form.installationTimeframe}</td></tr>` : ''}
      </table>
    </div>
    <p style="color:#4b5563;font-size:13px"><strong>What happens next</strong></p>
    <ol style="color:#4b5563;font-size:13px;line-height:1.7;padding-left:18px;margin:8px 0">
      <li>${ownerName || 'A solar specialist'} reviews your details and calls you within 24 hours</li>
      <li>We discuss your goals and book a free site assessment</li>
      <li>You receive a tailored proposal with system size, costs, and savings</li>
    </ol>
    <p style="color:#4b5563;font-size:13px">In the meantime, you can reply to this email with any questions or call us on <strong>${COMPANY.phone}</strong>.</p>
    <p style="font-size:13px;margin-top:18px">Talk soon,<br><strong>The ${COMPANY.name} team</strong></p>`;
  return send({
    to: form.email,
    subject: `We've received your solar enquiry, ${friendly} — we'll call within 24 hours`,
    html: wrap({ body, footerNote: 'Please add this address to your contacts so future emails from us land in your inbox.' }),
  });
}

// ── New: courtesy "we're closing your enquiry" when marked Lost/Disqualified ─
// Sent once when sub_status is set to lost or disqualified. Polite close-out
// so the customer doesn't think we ghosted them.
export async function sendCourtesyCloseEmail({ customerEmail, customerName, projectCode, reason }) {
  if (!customerEmail) return null;
  const friendly = customerName?.split(' ')[0] || 'there';
  const body = `
    <p style="font-size:14px">Hi <strong>${friendly}</strong>,</p>
    <p style="color:#4b5563;font-size:13px">We're closing your solar enquiry${projectCode ? ` (${projectCode})` : ''} for now. ${reason || 'No further action needed on your side.'}</p>
    <p style="color:#4b5563;font-size:13px">If circumstances change — different home, new timeframe, more info needed — get in touch any time. The savings calculator on our website is always available, and we'd be happy to revisit.</p>
    <p style="color:#4b5563;font-size:13px">Thanks for considering ${COMPANY.name}.</p>
    <p style="font-size:13px;margin-top:18px">All the best,<br><strong>The ${COMPANY.name} team</strong></p>`;
  return send({
    to: customerEmail,
    subject: `Closing your ${COMPANY.name} enquiry`,
    html: wrap({ body, footerNote: 'You will not receive further automated emails from this enquiry.' }),
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

// ── New: cancel scheduled Resend emails ────────────────────────────────────
// Resend's DELETE /emails/:id cancels a scheduled email if it hasn't been
// dispatched yet. Used when a project is marked Lost or Disqualified so
// nurture emails don't keep firing at someone who told us "no thanks".
export async function cancelScheduledEmails(emailIds = []) {
  if (!emailIds.length) return { cancelled: 0, failed: 0 };
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`📭 [DEV log-only] Would cancel ${emailIds.length} scheduled email(s)`);
    return { cancelled: emailIds.length, failed: 0 };
  }
  let cancelled = 0, failed = 0;
  for (const id of emailIds) {
    if (!id) continue;
    try {
      const r = await fetch(`https://api.resend.com/emails/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.ok) cancelled++; else failed++;
    } catch (e) {
      console.error(`Cancel email ${id} failed:`, e.message);
      failed++;
    }
  }
  console.log(`📭 Cancelled ${cancelled}/${emailIds.length} scheduled emails (${failed} failed)`);
  return { cancelled, failed };
}

// ── Bail-out follow-up (Track 4 / Deploy #2) ──────────────────────────────
// Sent ~24h after a Pattern-B partial enquiry was captured at Step 3 and
// the visitor never returned to finish the wizard. Dispatched by the
// standalone server/scripts/send-bail-followups.js job; idempotency is
// guarded by website_enquiries.bail_followup_sent_at (migration 027).
//
// Three content variants based on what we learned about the visitor:
//   • analysis present + clean         — share the real findings
//   • analysis present + review_flag   — soft "we're still verifying" tone
//   • no analysis (bailed before run)  — generic "easy to pick up" prompt
//
// Tone is intentionally low-pressure. The customer chose to leave; nudging
// hard burns goodwill. The CTA is "see what we found" not "buy now".
export async function sendBailFollowupEmail({ enquiry, analysis, resumeUrl }) {
  if (!enquiry?.email) {
    console.log('Bail-followup: no email on enquiry, skipping');
    return null;
  }

  const firstName = (enquiry.first_name || '').trim() || 'there';
  const fullName  = [enquiry.first_name, enquiry.last_name].filter(Boolean).join(' ').trim() || 'there';

  // CTA destination — prefers a resume URL with enquiry context, else falls
  // back to a fresh /get-quote start.
  const cta = resumeUrl || 'https://www.goldenrayenergy.co.nz/get-quote';

  // ── Choose body variant ──
  let intro, findingsBlock, subject;

  if (analysis && !analysis.review_required) {
    // CLEAN ANALYSIS — share the real numbers (but no precise install $)
    const a   = analysis;
    const sys = a.recommended_system_kw ? `${a.recommended_system_kw} kW solar` : 'a solar system';
    const bat = a.recommended_battery_kwh && a.recommended_battery_kwh > 0
      ? ` with a ${a.recommended_battery_kwh} kWh battery`
      : '';
    const annualKwh   = a.annual_kwh ? a.annual_kwh.toLocaleString('en-NZ') : null;
    const annualSpend = a.annual_spend_nzd ? fmt$(a.annual_spend_nzd) : null;

    subject = `Hi ${firstName} — your solar analysis is ready 🌞`;
    intro = `<p style="font-size:14px">Hi ${firstName},</p>
      <p style="font-size:14px;color:#374151;line-height:1.6">
        You started a solar quote with us yesterday and didn't quite finish — no worries,
        the analysis we ran on your bills is saved and ready when you are.
      </p>`;
    findingsBlock = `
      <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;padding:16px 18px;margin:18px 0">
        <p style="font-size:12px;font-weight:800;color:#92400e;margin:0 0 8px 0;text-transform:uppercase;letter-spacing:0.5px">What we found from your bills</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#1f2937">
          ${annualKwh   ? `<tr><td style="padding:4px 0;color:#6b7280">Your annual usage</td><td style="padding:4px 0;text-align:right;font-weight:700">${annualKwh} kWh</td></tr>` : ''}
          ${annualSpend ? `<tr><td style="padding:4px 0;color:#6b7280">Your annual power bill</td><td style="padding:4px 0;text-align:right;font-weight:700">${annualSpend}</td></tr>` : ''}
          <tr><td style="padding:4px 0;color:#6b7280">Recommended system</td><td style="padding:4px 0;text-align:right;font-weight:700">${sys}${bat}</td></tr>
        </table>
      </div>
      <p style="font-size:13px;color:#374151;line-height:1.55">
        Want the full picture — 25-year savings, payback period, panel layout, and three system options?
        It's one more step.
      </p>`;
  } else if (analysis && analysis.review_required) {
    // REVIEW REQUIRED — soft tone, specialist will help
    subject = `Hi ${firstName} — let's pick up where you left off`;
    intro = `<p style="font-size:14px">Hi ${firstName},</p>
      <p style="font-size:14px;color:#374151;line-height:1.6">
        You started a solar quote with us yesterday. We received your bills and our analysis
        spotted a couple of things we'd like to verify with you in person before we put a
        recommendation in writing.
      </p>`;
    findingsBlock = `
      <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;padding:16px 18px;margin:18px 0">
        <p style="font-size:13px;color:#92400e;margin:0;line-height:1.55">
          When you're ready, finish the form and a specialist will call within 24 hours to
          walk through your bills and quote honestly — no auto-generated savings number that
          could be off by thousands.
        </p>
      </div>`;
  } else {
    // NO ANALYSIS — visitor bailed before/during projection
    subject = `Hi ${firstName} — finish your solar quote in 60 seconds`;
    intro = `<p style="font-size:14px">Hi ${firstName},</p>
      <p style="font-size:14px;color:#374151;line-height:1.6">
        You started a solar quote with us yesterday and didn't quite finish. It only takes
        about a minute to pick up where you left off, and we'll have a tailored quote ready
        within 24 hours.
      </p>`;
    findingsBlock = `
      <div style="background:#f1f5f9;border-left:4px solid #64748b;border-radius:6px;padding:14px 18px;margin:18px 0">
        <p style="font-size:12px;font-weight:700;color:#475569;margin:0 0 6px 0">Why bother?</p>
        <ul style="font-size:13px;color:#1f2937;margin:0;padding-left:18px;line-height:1.6">
          <li>Most NZ homes with solar save <strong>$1,500–$3,500</strong> per year</li>
          <li>Payback is typically <strong>6–8 years</strong>, and panels last 25+</li>
          <li>Power prices are up 23% over the last 5 years — solar locks in your rate</li>
        </ul>
      </div>`;
  }

  const ctaBlock = `
    <div style="text-align:center;margin:22px 0">
      <a href="${cta}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:14px 28px;border-radius:8px;box-shadow:0 4px 12px rgba(245,158,11,0.3)">
        ${analysis && !analysis.review_required ? 'See my full savings →' : 'Finish my quote →'}
      </a>
    </div>`;

  const closing = `
    <p style="font-size:13px;color:#374151;line-height:1.55">
      Not interested anymore? No problem — just ignore this email and we won't follow up again.
    </p>
    <p style="font-size:13px;color:#374151;margin-top:18px">
      Ngā mihi,<br>
      <strong>Eric and the GoldenRay team</strong><br>
      <span style="color:#9ca3af;font-size:11px">${COMPANY.phone} · ${COMPANY.email}</span>
    </p>`;

  const body = intro + findingsBlock + ctaBlock + closing;

  return send({
    to:      enquiry.email,
    subject,
    html:    wrap({ title: 'Your solar quote — picking up where you left off', body }),
  });
}
