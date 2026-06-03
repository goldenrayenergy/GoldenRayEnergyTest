// ════════════════════════════════════════════════════════════════════════════
// send-bail-followups.js — Track 4 / Deploy #2
//
// Daily job that emails customers who started the wizard, were captured at
// Step 3 (status='partial'), and never came back to finish. Sends them a
// "your solar analysis is ready — finish your quote" email approximately
// 24 hours after the partial enquiry was created.
//
// SCHEDULING
//   • Designed to be run by Render Cron Job (or any external scheduler) on
//     a daily cadence — recommended 09:00 NZ time so the customer sees it
//     during waking hours of their second day of consideration.
//   • Safe to run more than once per day. Idempotency is enforced by the
//     atomic UPDATE ... WHERE bail_followup_sent_at IS NULL guard, so even
//     simultaneous runs from multiple workers cannot double-send.
//
// USAGE
//   node server/scripts/send-bail-followups.js            # real run
//   node server/scripts/send-bail-followups.js --dry-run  # report only
//   node server/scripts/send-bail-followups.js --max=5    # cap batch size
//   node server/scripts/send-bail-followups.js --min-age-hours=24
//   node server/scripts/send-bail-followups.js --max-age-hours=168
//
// EXIT CODES
//   0 — completed cleanly (zero or more emails sent successfully)
//   1 — fatal error (DB connection lost, etc.) — see stderr
//
// The script never throws on a single failed email — it logs the failure,
// leaves bail_followup_sent_at NULL on that row (so it'll be retried the
// next day), and continues with the rest of the batch.
// ════════════════════════════════════════════════════════════════════════════

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const { supabaseAdmin } = await import('../config/supabase.js');
const { sendBailFollowupEmail } = await import('../services/emailService.js');

// ── CLI flags ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit === `--${name}`) return true;
  return hit.slice(`--${name}=`.length);
};

const DRY_RUN       = !!flag('dry-run');
const MAX_BATCH     = parseInt(flag('max', '50'), 10);
const MIN_AGE_HOURS = parseFloat(flag('min-age-hours', '24'));
const MAX_AGE_HOURS = parseFloat(flag('max-age-hours', '168'));   // 7 days
const VERBOSE       = !!flag('verbose');

if (!supabaseAdmin) {
  console.error('❌ Supabase service-role key not configured — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const now = new Date();
const minCreatedAt = new Date(now.getTime() - MIN_AGE_HOURS * 3600 * 1000).toISOString();
const maxCreatedAt = new Date(now.getTime() - MAX_AGE_HOURS * 3600 * 1000).toISOString();

console.log('━'.repeat(72));
console.log(`Bail-out follow-up job · ${now.toISOString()}`);
console.log(`Mode:        ${DRY_RUN ? '🧪 DRY RUN (no emails, no DB writes)' : '📨 LIVE'}`);
console.log(`Age window:  ${MIN_AGE_HOURS}h – ${MAX_AGE_HOURS}h (created between ${maxCreatedAt} and ${minCreatedAt})`);
console.log(`Batch cap:   ${MAX_BATCH}`);
console.log('━'.repeat(72));

// ── 1. Find eligible partial enquiries ─────────────────────────────────────
// status='partial' AND created >MIN_AGE_HOURS ago AND <MAX_AGE_HOURS ago AND
// follow-up not yet sent. The MAX_AGE_HOURS upper bound prevents back-dated
// spam if the job hasn't run for a week — older bail-outs are written off
// rather than emailed cold.
const { data: candidates, error: qErr } = await supabaseAdmin
  .from('website_enquiries')
  .select('id, created_at, first_name, last_name, email, phone, monthly_bill, installation_timeframe, utm_source')
  .eq('status', 'partial')
  .is('bail_followup_sent_at', null)
  .lte('created_at', minCreatedAt)
  .gte('created_at', maxCreatedAt)
  .order('created_at', { ascending: true })
  .limit(MAX_BATCH);

if (qErr) {
  console.error('❌ Candidate query failed:', qErr.message);
  process.exit(1);
}

if (!candidates || candidates.length === 0) {
  console.log('✓ No eligible partial enquiries — nothing to send.');
  process.exit(0);
}

console.log(`Found ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}:`);
if (VERBOSE) {
  candidates.forEach(c => {
    const age = ((now - new Date(c.created_at)) / 3600 / 1000).toFixed(1);
    console.log(`  • ${c.email || '(no email)'} · ${c.first_name || ''} ${c.last_name || ''} · ${age}h old · ${c.utm_source || 'direct'}`);
  });
}

// ── 2. For each candidate, look up linked bill_analysis (if any) ───────────
// The analyzer writes contact_id from the Step-3 partial. We join via
// contact email (the most reliable link — there can be multiple contacts
// from re-submissions). Take the latest analysis for that contact.
async function findLatestAnalysis(email) {
  if (!email) return null;
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(5);
  const contactIds = (contacts || []).map(c => c.id);
  if (contactIds.length === 0) return null;
  const { data: analyses } = await supabaseAdmin
    .from('bill_analyses')
    .select('id, annual_kwh, annual_spend_nzd, recommended_system_kw, recommended_battery_kwh, recommended_package_slug, review_required, review_reasons, retailer, plan_name')
    .in('contact_id', contactIds)
    .order('created_at', { ascending: false })
    .limit(1);
  return analyses?.[0] || null;
}

// ── 3. Send + mark for each candidate ──────────────────────────────────────
let sent = 0, skipped = 0, failed = 0;
for (const enquiry of candidates) {
  if (!enquiry.email) {
    console.log(`  ⏭️  ${enquiry.id.slice(0, 8)} — no email on file, skipping`);
    skipped++;
    continue;
  }

  let analysis = null;
  try {
    analysis = await findLatestAnalysis(enquiry.email);
  } catch (e) {
    console.warn(`  ⚠️  ${enquiry.id.slice(0, 8)} — analysis lookup failed (non-fatal): ${e.message}`);
  }
  const variant = !analysis ? 'no-analysis'
                : analysis.review_required ? 'review-required'
                : 'clean';

  if (DRY_RUN) {
    console.log(`  🧪 ${enquiry.id.slice(0, 8)} → ${enquiry.email} · variant=${variant} · would send`);
    sent++;
    continue;
  }

  // ── Atomic claim: only proceed if we can flip bail_followup_sent_at from
  //    NULL → now() in a single UPDATE. If another worker beat us to it
  //    the UPDATE returns 0 rows and we skip. This is the idempotency core.
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('website_enquiries')
    .update({ bail_followup_sent_at: claimedAt })
    .eq('id', enquiry.id)
    .is('bail_followup_sent_at', null)
    .select('id')
    .maybeSingle();

  if (claimErr) {
    console.error(`  ❌ ${enquiry.id.slice(0, 8)} — claim failed: ${claimErr.message}`);
    failed++;
    continue;
  }
  if (!claimed) {
    console.log(`  ⏭️  ${enquiry.id.slice(0, 8)} — already claimed by another run, skipping`);
    skipped++;
    continue;
  }

  // ── Send the email. On failure, ROLL BACK the claim so tomorrow's run
  //    retries. (Without this rollback an SMTP outage would burn the
  //    customer's only chance at a follow-up.)
  try {
    const result = await sendBailFollowupEmail({
      enquiry,
      analysis,
      resumeUrl: 'https://www.goldenrayenergy.co.nz/get-quote',
    });
    console.log(`  ✅ ${enquiry.id.slice(0, 8)} → ${enquiry.email} · variant=${variant} · resend_id=${result?.id || '—'}`);
    sent++;
  } catch (e) {
    console.error(`  ❌ ${enquiry.id.slice(0, 8)} → ${enquiry.email} · send failed: ${e.message}`);
    // Roll back the claim so the next run retries this row
    await supabaseAdmin
      .from('website_enquiries')
      .update({ bail_followup_sent_at: null })
      .eq('id', enquiry.id)
      .eq('bail_followup_sent_at', claimedAt);
    failed++;
  }
}

// ── 4. Summary ─────────────────────────────────────────────────────────────
console.log('━'.repeat(72));
console.log(`Done. Sent: ${sent} · Skipped: ${skipped} · Failed: ${failed}${DRY_RUN ? ' (dry-run, no DB writes)' : ''}`);
console.log('━'.repeat(72));

process.exit(0);
