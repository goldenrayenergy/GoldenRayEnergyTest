// ────────────────────────────────────────────────────────────────────────────
// referralService — Phase 3 of Step-5 What-Next CTA rebuild (2026-08-22)
//
// Owner decisions encoded here (mirror migration 043 comment header):
//   1. Symmetric $250 credit both sides                → REFERRAL_CREDIT_CENTS
//   2. Both unlock at friend's install-complete        → unlockReferralOnProjectComplete()
//   3. Cheque payout, admin-processed                  → adminMarkPaid()
//   4. 6-month expiry from unlock                      → expireStaleReferrals()
//   5. Max 5 successful referrals per year per contact → enforceReferralCap()
//   6. Fraud check: block if referred email OR phone matches referrer's
//      contact record. Address matching deferred to a follow-up (contacts
//      table stores only coarse `location`).
//
// Shape:
//   - generateOrGetActiveCode()  → customer clicks "Refer a friend" on Step 5
//   - getReferralStatus()        → customer refreshes their referral panel
//   - attributeReferral()        → friend submits quote with ?ref=CODE
//   - unlockReferralOnProjectComplete() → project status flips to 'completed'
//   - adminApproveBlockedFraud() → admin overrides a blocked_fraud_check
//   - adminMarkPaid()            → admin has mailed the cheque
//   - expireStaleReferrals()     → nightly job — 6-month expiry sweep
//
// All functions take supabase (usually supabaseAdmin) and any query
// params — they return { data, error } shapes for the routes to unwrap.
// ────────────────────────────────────────────────────────────────────────────

// Owner policy — $250 NZD each side, symmetric.
export const REFERRAL_CREDIT_CENTS = 25000;

// 6-month credit expiry from unlock. NZ business day math not required —
// calendar months. UTC computation is fine since the display layer
// converts to Pacific/Auckland for the customer.
export const CREDIT_EXPIRY_MONTHS = 6;

// Cap: 5 successful referrals per rolling 12-month window. Enforced at
// attribution time (before we insert the referrals row).
export const REFERRAL_CAP_COUNT = 5;
export const REFERRAL_CAP_WINDOW_MONTHS = 12;

// Safe alphabet for the 4-char random suffix. No 0/O/1/I/L to avoid
// mis-transcription over phone or handwriting.
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ─── Code generation ────────────────────────────────────────────────────

// Slug the referrer's name to 4-6 uppercase alphanumeric chars.
// "Sarah Smith" → "SARAH". "Rāhui" → "RHUI" (strips diacritics).
// Falls back to "REFER" if the name is unusable.
function slugFromName(name) {
  if (typeof name !== 'string') return 'REFER';
  const stripped = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')     // strip combining diacritics
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (stripped.length === 0) return 'REFER';
  // Prefer the first word (typically first name). If that's too short,
  // take up to 6 chars of the whole thing.
  const firstWord = stripped.slice(0, 6);
  return firstWord.length >= 3 ? firstWord : stripped.slice(0, 6);
}

// Cryptographic random suffix from safe alphabet. Node's crypto is
// available in the server runtime (no need for a shim).
async function randomSuffix(len = 4) {
  const { randomBytes } = await import('node:crypto');
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
  }
  return out;
}

// Build a candidate code + retry on the astronomically-unlikely uniqueness
// collision. 31^4 ~= 923K possible suffixes per slug, so with 1000
// customers and unique slugs we're at ~0.1% collision probability. Loop is
// just a safety net.
async function generateUniqueCode(supabase, ownerName) {
  const slug = slugFromName(ownerName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = await randomSuffix(4);
    const code = `${slug}-${suffix}`;
    const { data: existing } = await supabase
      .from('referral_codes')
      .select('id')
      .eq('code', code)
      .maybeSingle();
    if (!existing) return code;
  }
  throw new Error('Failed to generate a unique referral code after 5 attempts');
}


// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Return the active referral code for a contact, creating one if needed.
 * Idempotent — safe to call every time the customer opens the Refer-a-friend
 * panel. Uses the partial unique index `idx_referral_codes_active_per_owner`
 * to guarantee at most one active code per contact.
 */
export async function generateOrGetActiveCode(supabase, { contactId, ownerName }) {
  if (!contactId) throw new Error('contactId required');

  // Fast path — existing active code
  const { data: existing, error: readErr } = await supabase
    .from('referral_codes')
    .select('id, code, created_at')
    .eq('owner_contact_id', contactId)
    .is('revoked_at', null)
    .maybeSingle();
  if (readErr) return { error: readErr };
  if (existing) return { data: existing };

  // No active code → generate one
  const code = await generateUniqueCode(supabase, ownerName || 'Refer');
  const { data: inserted, error: insertErr } = await supabase
    .from('referral_codes')
    .insert({ code, owner_contact_id: contactId })
    .select('id, code, created_at')
    .single();
  if (insertErr) {
    // If a concurrent insert beat us to it (rare — customer opening the
    // panel from two tabs simultaneously), the partial-unique-index will
    // reject. Re-read and return whatever's there.
    if (insertErr.code === '23505') {
      const { data: nowExists } = await supabase
        .from('referral_codes')
        .select('id, code, created_at')
        .eq('owner_contact_id', contactId)
        .is('revoked_at', null)
        .single();
      if (nowExists) return { data: nowExists };
    }
    return { error: insertErr };
  }
  return { data: inserted };
}

/**
 * Snapshot the customer's referral state for the "Refer a friend" panel.
 * Returns their active code + counts + credit totals across all their
 * historical referrals.
 */
export async function getReferralStatus(supabase, { contactId, ownerName }) {
  // Get-or-create the active code first (so first-time viewers see a code
  // immediately, matching the "click Refer → panel opens with your link"
  // UX).
  const codeResult = await generateOrGetActiveCode(supabase, { contactId, ownerName });
  if (codeResult.error) return { error: codeResult.error };

  const { data: rows, error: rowsErr } = await supabase
    .from('referrals')
    .select('status, credit_amount_referrer, credit_paid_at, credit_expires_at, created_at')
    .eq('referrer_contact_id', contactId)
    .order('created_at', { ascending: false });
  if (rowsErr) return { error: rowsErr };

  const now = Date.now();
  const stats = {
    total: rows.length,
    // Successful = ever reached install_complete or beyond
    successful: rows.filter(r => ['install_complete', 'credit_paid', 'expired'].includes(r.status)).length,
    pending_credit_cents: rows
      .filter(r => r.status === 'install_complete'
        && (!r.credit_expires_at || new Date(r.credit_expires_at).getTime() > now))
      .reduce((s, r) => s + (r.credit_amount_referrer || 0), 0),
    paid_credit_cents: rows
      .filter(r => r.status === 'credit_paid')
      .reduce((s, r) => s + (r.credit_amount_referrer || 0), 0),
    // Cap tracker — count only referrals inside the 12-month rolling window
    // that ARE credit-worthy (fraud-blocked ones don't burn a slot).
    used_in_window: countReferralsInCapWindow(rows, now),
    cap: REFERRAL_CAP_COUNT,
  };

  return { data: { code: codeResult.data, stats } };
}

// Helper: count referrals inside the 12-month rolling window that count
// against the cap. Called from both getReferralStatus (display) and
// attributeReferral (enforcement) — keep the definition in one place so
// display and enforcement never drift.
function countReferralsInCapWindow(rows, now = Date.now()) {
  const windowStart = now - REFERRAL_CAP_WINDOW_MONTHS * 30 * 24 * 60 * 60 * 1000;
  return rows.filter(r =>
    ['install_complete', 'credit_paid'].includes(r.status)
    && new Date(r.created_at).getTime() > windowStart
  ).length;
}


/**
 * Normalize an email for comparison (lowercase + trim). Two emails are
 * considered "same" if their normalized forms match. Doesn't do gmail-dot
 * squashing or plus-tag stripping — that would be user-friendly for
 * legitimate distinct-inbox usage but weakens the fraud check. Deliberate
 * trade.
 */
function normEmail(e) {
  return typeof e === 'string' ? e.trim().toLowerCase() : '';
}

/**
 * Normalize a phone for comparison — digits only. Loses country code
 * disambiguation ("021 xxx" vs "+64 21 xxx" would both become "021xxx" vs
 * "6421xxx" — different). We further compare last-9-digits to catch this.
 */
function normPhone(p) {
  if (typeof p !== 'string') return '';
  const digits = p.replace(/\D/g, '');
  // Compare on last 9 digits so +64-prefix vs 0-prefix vs no-prefix all
  // hash the same. NZ mobile numbers are 9 digits after country code.
  return digits.slice(-9);
}

/**
 * Fraud check — compare referrer contact vs referred enquiry. Returns
 * a fraud_check jsonb + a boolean pass/fail.
 */
function runFraudCheck({ referrerContact, referredEnquiry }) {
  const matched = [];
  const refEmail = normEmail(referrerContact?.email);
  const refPhone = normPhone(referrerContact?.phone);
  const friendEmail = normEmail(referredEnquiry?.email);
  const friendPhone = normPhone(referredEnquiry?.phone);

  if (refEmail && refEmail === friendEmail) matched.push('email');
  if (refPhone && refPhone === friendPhone) matched.push('phone');
  // NB: address matching deferred — contacts.location is coarse and
  // website_enquiries.address is free-text. Post-MVP: geocode both and
  // compare within a small radius, OR normalise both to Google Place
  // ID at capture time.

  return {
    passed: matched.length === 0,
    check: {
      checked_at: new Date().toISOString(),
      result: matched.length === 0 ? 'pass' : 'block',
      matched_fields: matched,
      // Never store raw email/phone in the fraud_check blob — leak-risk
      // and duplicative (both are already on their source rows). If admin
      // needs to see the specific values they join to contacts / enquiries.
    },
  };
}


/**
 * Attribute a referral. Called from POST /api/quote/submit-with-design
 * AFTER the enquiry row is created, IF the payload included a ref code.
 *
 * Flow:
 *   1. Look up referral_codes by code (only active, non-revoked).
 *   2. If not found or owner missing → return { attributed: false, reason }.
 *   3. Enforce cap (count successful referrals in last 12 months).
 *   4. Run fraud check (compare emails/phones).
 *   5. Insert referrals row with status = 'attributed' | 'blocked_fraud_check'.
 *
 * Always non-throwing at the network level — errors are logged and
 * returned in the result, so a failed attribution NEVER blocks the
 * customer's actual quote submission from completing.
 */
export async function attributeReferral(supabase, { referralCodeText, enquiryId, contactId }) {
  if (!referralCodeText || typeof referralCodeText !== 'string') {
    return { attributed: false, reason: 'no_code' };
  }
  if (!enquiryId) {
    return { attributed: false, reason: 'no_enquiry_id' };
  }

  // 1. Look up code
  const { data: codeRow, error: codeErr } = await supabase
    .from('referral_codes')
    .select('id, owner_contact_id')
    .eq('code', referralCodeText)
    .is('revoked_at', null)
    .maybeSingle();
  if (codeErr) return { attributed: false, reason: 'code_lookup_error', error: codeErr };
  if (!codeRow) return { attributed: false, reason: 'code_not_found' };
  if (!codeRow.owner_contact_id) return { attributed: false, reason: 'code_owner_missing' };

  // 2. Enforce cap — count successful referrals in the window
  const { data: existingReferrals, error: capErr } = await supabase
    .from('referrals')
    .select('status, created_at')
    .eq('referrer_contact_id', codeRow.owner_contact_id);
  if (capErr) return { attributed: false, reason: 'cap_check_error', error: capErr };

  const used = countReferralsInCapWindow(existingReferrals || []);
  if (used >= REFERRAL_CAP_COUNT) {
    return {
      attributed: false,
      reason: 'cap_reached',
      used, cap: REFERRAL_CAP_COUNT,
    };
  }

  // 3. Fetch referrer contact for fraud check
  const { data: referrerContact, error: refErr } = await supabase
    .from('contacts')
    .select('id, email, phone')
    .eq('id', codeRow.owner_contact_id)
    .maybeSingle();
  if (refErr) return { attributed: false, reason: 'referrer_lookup_error', error: refErr };

  // 4. Fetch referred enquiry for fraud check
  const { data: referredEnquiry, error: enqErr } = await supabase
    .from('website_enquiries')
    .select('email, phone')
    .eq('id', enquiryId)
    .maybeSingle();
  if (enqErr) return { attributed: false, reason: 'enquiry_lookup_error', error: enqErr };

  // 5. Fraud check
  const fraud = runFraudCheck({ referrerContact, referredEnquiry });

  // 6. Insert referrals row (deduped by uniq_referral_code_enquiry constraint)
  const insertPayload = {
    referral_code_id:    codeRow.id,
    referrer_contact_id: codeRow.owner_contact_id,
    referred_contact_id: contactId || null,
    referred_enquiry_id: enquiryId,
    status:              fraud.passed ? 'attributed' : 'blocked_fraud_check',
    fraud_check:         fraud.check,
    credit_amount_referrer: REFERRAL_CREDIT_CENTS,
    credit_amount_referred: REFERRAL_CREDIT_CENTS,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('referrals')
    .insert(insertPayload)
    .select('id, status')
    .single();
  if (insertErr) {
    if (insertErr.code === '23505') {
      return { attributed: false, reason: 'already_attributed' };
    }
    return { attributed: false, reason: 'insert_error', error: insertErr };
  }

  return {
    attributed: true,
    id:         inserted.id,
    status:     inserted.status,
    passed_fraud_check: fraud.passed,
  };
}


// ─── Install-complete trigger ────────────────────────────────────────────

/**
 * Unlock referral credits for a project that just completed. Called from
 * the code path that flips projects_v2.status to 'completed' (PM tool
 * integration — not yet wired as of Phase 3 shipment; use
 * adminMarkInstallComplete below for manual owner-driven unlocks in the
 * meantime). Idempotent — safe to call multiple times.
 */
export async function unlockReferralOnProjectComplete(supabase, { projectId }) {
  if (!projectId) return { updated: 0 };

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + CREDIT_EXPIRY_MONTHS);

  const { data, error } = await supabase
    .from('referrals')
    .update({
      status:             'install_complete',
      credit_unlocked_at: now.toISOString(),
      credit_expires_at:  expiresAt.toISOString(),
    })
    .eq('referred_project_id', projectId)
    .eq('status', 'attributed')
    .select('id, referrer_contact_id, referred_contact_id, credit_amount_referrer, credit_amount_referred');

  if (error) return { error };
  return { updated: data?.length || 0, rows: data || [] };
}


/**
 * Admin manually marks a single referral as install-complete → unlocks
 * credit. Used when the PM tool hasn't yet propagated the project status
 * change, or for projects created outside the PM tool. Requires the
 * referral to currently be in 'attributed' state.
 */
export async function adminMarkInstallComplete(supabase, { referralId, adminUserId }) {
  if (!referralId) return { error: { message: 'referralId required' } };

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + CREDIT_EXPIRY_MONTHS);

  const { data, error } = await supabase
    .from('referrals')
    .update({
      status:             'install_complete',
      credit_unlocked_at: now.toISOString(),
      credit_expires_at:  expiresAt.toISOString(),
    })
    .eq('id', referralId)
    .eq('status', 'attributed')
    .select(`
      id,
      referrer_contact_id,
      credit_amount_referrer,
      credit_expires_at,
      referrer:referrer_contact_id ( id, name, email )
    `)
    .maybeSingle();
  if (error) return { error };
  if (!data) return { error: { message: 'Referral not found or not in attributed state' } };
  return { data };
}


// ─── Admin actions ───────────────────────────────────────────────────────

/**
 * Admin overrides a 'blocked_fraud_check' status → back to 'attributed'.
 * Used when admin has manually verified that a flagged referral is
 * legitimate (same-household referral that IS ok, e.g. parents referring
 * adult children who now live independently but were on their phone plan).
 */
export async function adminApproveBlockedFraud(supabase, { referralId, adminUserId, note }) {
  const { data, error } = await supabase
    .from('referrals')
    .update({
      status: 'attributed',
      notes:  note || 'Admin approved after fraud-check block',
    })
    .eq('id', referralId)
    .eq('status', 'blocked_fraud_check')
    .select('id, status')
    .maybeSingle();
  if (error) return { error };
  if (!data) return { error: { message: 'Referral not found or not in blocked_fraud_check state' } };
  // Best-effort audit: stamp who did it. Column doesn't exist as a top-
  // level "approved_by" — captured via notes for MVP. TODO: add
  // approved_by_user_id column in a future migration if audit needs it.
  return { data };
}

/**
 * Admin marks a referral as paid. Requires the referral to be in
 * 'install_complete' state (credit unlocked but not yet paid).
 */
export async function adminMarkPaid(supabase, { referralId, adminUserId, method, reference, note }) {
  if (!referralId) return { error: { message: 'referralId required' } };
  const allowedMethods = ['cheque', 'bank_transfer', 'cash', 'other'];
  if (method && !allowedMethods.includes(method)) {
    return { error: { message: `method must be one of ${allowedMethods.join(', ')}` } };
  }

  const { data, error } = await supabase
    .from('referrals')
    .update({
      status:                'credit_paid',
      credit_paid_at:        new Date().toISOString(),
      credit_paid_method:    method || 'cheque',
      credit_paid_reference: reference || null,
      credit_paid_by_user_id: adminUserId || null,
      notes:                 note || null,
    })
    .eq('id', referralId)
    .eq('status', 'install_complete')
    .select('id, status, credit_paid_at')
    .maybeSingle();
  if (error) return { error };
  if (!data) return { error: { message: 'Referral not found or not in install_complete state (credit not yet unlocked)' } };
  return { data };
}

/**
 * Admin cancel — hard stop. Used when the referrer withdraws consent,
 * or when a dispute is resolved against the referral.
 */
export async function adminCancel(supabase, { referralId, reason, adminUserId }) {
  const { data, error } = await supabase
    .from('referrals')
    .update({
      status: 'cancelled',
      notes:  reason || 'Admin cancelled',
    })
    .eq('id', referralId)
    .not('status', 'in', '(credit_paid,cancelled,expired)')
    .select('id, status')
    .maybeSingle();
  if (error) return { error };
  if (!data) return { error: { message: 'Referral not found or already in terminal state' } };
  return { data };
}

/**
 * Nightly sweep — mark install_complete referrals whose credit_expires_at
 * has passed as 'expired'. Called from a cron/scheduled task. Returns the
 * number of rows expired.
 */
export async function expireStaleReferrals(supabase) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('referrals')
    .update({ status: 'expired' })
    .lt('credit_expires_at', now)
    .eq('status', 'install_complete')
    .select('id');
  if (error) return { error };
  return { expired: data?.length || 0 };
}
