// ────────────────────────────────────────────────────────────────────────────
// referrals routes — Phase 3 of Step-5 What-Next CTA rebuild (2026-08-22)
//
// Two auth zones:
//   1. Customer-facing (share-token authed): GET /status, POST /generate.
//      A customer who completed a quote has a projects_v2.share_token — that
//      unguessable UUID authorises them to view/generate THEIR referral code.
//      No login, no OTP. Same auth model as /p/:token (magic-link viewer).
//
//   2. Admin (session authed): GET /admin, POST /admin/:id/*.
//      All admin endpoints sit after `router.use(authenticate)` so they
//      require a valid portal session. Same pattern as /api/finance.
//
// Attribution middleware lives NOT here but in leadService.js where the
// enquiry row is created — attribution is a side-effect of quote submission,
// not a standalone endpoint.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';
import {
  generateOrGetActiveCode,
  getReferralStatus,
  adminApproveBlockedFraud,
  adminMarkPaid,
  adminCancel,
  adminMarkInstallComplete,
} from '../services/referralService.js';
import { sendReferralCreditUnlockedEmail } from '../services/emailService.js';

const router = Router();

// ─── share-token authentication (customer-facing) ────────────────────────
// Resolves ?token=<uuid> to a contact_id + owner name via projects_v2.
// Returns null if the token doesn't match any project — callers should
// 404 in that case (same shape as /p/:token 404).
async function resolveShareToken(token) {
  if (!token || typeof token !== 'string') return null;
  const { data, error } = await supabaseAdmin
    .from('projects_v2')
    .select(`
      id,
      contact_id,
      contacts:contact_id ( id, name )
    `)
    .eq('share_token', token)
    .maybeSingle();
  if (error || !data || !data.contact_id) return null;
  return {
    projectId:   data.id,
    contactId:   data.contact_id,
    ownerName:   data.contacts?.name || 'Refer',
  };
}


// ─── PUBLIC: GET /api/referrals/status?token=UUID ────────────────────────
// Customer opens the "Refer a friend" panel on Step 5. Returns their
// active code (creates one lazily if this is their first click) + stats
// (successful count, pending vs paid credit, cap-usage counter).
router.get('/status', async (req, res) => {
  try {
    const token = req.query.token;
    const auth = await resolveShareToken(token);
    if (!auth) return res.status(404).json({ error: 'Referral token not recognised.' });

    const result = await getReferralStatus(supabaseAdmin, {
      contactId: auth.contactId,
      ownerName: auth.ownerName,
    });
    if (result.error) {
      console.error('[referrals.status] service error:', result.error?.message || result.error);
      return res.status(500).json({ error: 'Could not load your referral status.' });
    }
    res.json(result.data);
  } catch (e) {
    console.error('[referrals.status] threw:', e.message);
    res.status(500).json({ error: 'Could not load your referral status.' });
  }
});


// ─── PUBLIC: POST /api/referrals/generate  { token: UUID } ───────────────
// Idempotent — repeated calls return the same existing active code.
// Kept as a separate endpoint (not just piggyback on /status) so future
// UX can offer a "regenerate" button that revokes + recreates.
router.post('/generate', async (req, res) => {
  try {
    const token = req.body?.token;
    const auth = await resolveShareToken(token);
    if (!auth) return res.status(404).json({ error: 'Referral token not recognised.' });

    const result = await generateOrGetActiveCode(supabaseAdmin, {
      contactId: auth.contactId,
      ownerName: auth.ownerName,
    });
    if (result.error) {
      console.error('[referrals.generate] service error:', result.error?.message || result.error);
      return res.status(500).json({ error: 'Could not create referral code.' });
    }
    res.status(201).json({ code: result.data });
  } catch (e) {
    console.error('[referrals.generate] threw:', e.message);
    res.status(500).json({ error: 'Could not create referral code.' });
  }
});


// ─── Everything below this line requires portal auth ─────────────────────
router.use(authenticate);


// ─── ADMIN: GET /api/referrals/admin?status=... ──────────────────────────
// Portal referrals page. Lists all referrals, filterable by status +
// referrer + date range. Includes referrer + referee contact info via
// join so the UI doesn't need N+1 queries.
router.get('/admin', async (req, res) => {
  try {
    const status = req.query.status;
    const limit  = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    let query = supabaseAdmin
      .from('referrals')
      .select(`
        id,
        status,
        credit_amount_referrer,
        credit_amount_referred,
        credit_unlocked_at,
        credit_expires_at,
        credit_paid_at,
        credit_paid_method,
        credit_paid_reference,
        fraud_check,
        notes,
        created_at,
        updated_at,
        referrer:referrer_contact_id ( id, name, email, phone ),
        referred:referred_contact_id ( id, name, email, phone ),
        enquiry:referred_enquiry_id ( id, address, chosen_tier_id, tier_price ),
        project:referred_project_id ( id, code, status )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      console.error('[referrals.admin.list] error:', error.message);
      return res.status(500).json({ error: 'Could not load referrals.' });
    }
    res.json({ referrals: data });
  } catch (e) {
    console.error('[referrals.admin.list] threw:', e.message);
    res.status(500).json({ error: 'Could not load referrals.' });
  }
});


// ─── ADMIN: POST /api/referrals/admin/:id/approve-fraud ──────────────────
// Override a 'blocked_fraud_check' status → 'attributed'. Admin has manually
// verified the referral is legitimate (e.g. adult child previously on
// parent's phone plan).
router.post('/admin/:id/approve-fraud', async (req, res) => {
  try {
    const result = await adminApproveBlockedFraud(supabaseAdmin, {
      referralId:  req.params.id,
      adminUserId: req.user?.id,
      note:        req.body?.note,
    });
    if (result.error) {
      return res.status(400).json({ error: result.error.message || 'Could not approve referral.' });
    }
    res.json({ referral: result.data });
  } catch (e) {
    console.error('[referrals.admin.approve-fraud] threw:', e.message);
    res.status(500).json({ error: 'Could not approve referral.' });
  }
});


// ─── ADMIN: POST /api/referrals/admin/:id/mark-install-complete ─────────
// Manually unlock a referral's credit. Used when the PM tool hasn't yet
// been wired to fire the projects_v2.status='completed' trigger (see
// referralService.unlockReferralOnProjectComplete for the automated path).
// On success, fires sendReferralCreditUnlockedEmail to the referrer
// (non-blocking — email failure never rolls back the DB update).
router.post('/admin/:id/mark-install-complete', async (req, res) => {
  try {
    const result = await adminMarkInstallComplete(supabaseAdmin, {
      referralId:  req.params.id,
      adminUserId: req.user?.id,
    });
    if (result.error) {
      return res.status(400).json({ error: result.error.message || 'Could not unlock credit.' });
    }

    // Fire-and-forget notification email. The credit is already unlocked
    // in the DB — the email is just the customer-facing notification.
    const referrer = result.data.referrer;
    if (referrer?.email) {
      Promise.resolve().then(async () => {
        try {
          await sendReferralCreditUnlockedEmail({
            referrerName:  referrer.name,
            referrerEmail: referrer.email,
            creditCents:   result.data.credit_amount_referrer,
            expiresAt:     result.data.credit_expires_at,
          });
        } catch (e) {
          console.error('[referrals.mark-install-complete] email failed (non-fatal):', e?.message || e);
        }
      }).catch(err => console.error('[referrals.mark-install-complete] email dispatch threw:', err?.message || err));
    }

    res.json({ referral: { id: result.data.id, status: 'install_complete', credit_expires_at: result.data.credit_expires_at } });
  } catch (e) {
    console.error('[referrals.admin.mark-install-complete] threw:', e.message);
    res.status(500).json({ error: 'Could not unlock credit.' });
  }
});


// ─── ADMIN: POST /api/referrals/admin/:id/mark-paid ──────────────────────
// Admin has mailed the cheque / done the bank transfer. Requires status =
// 'install_complete' (credit unlocked but not yet paid).
router.post('/admin/:id/mark-paid', async (req, res) => {
  try {
    const { method, reference, note } = req.body || {};
    const result = await adminMarkPaid(supabaseAdmin, {
      referralId:  req.params.id,
      adminUserId: req.user?.id,
      method, reference, note,
    });
    if (result.error) {
      return res.status(400).json({ error: result.error.message || 'Could not mark paid.' });
    }
    res.json({ referral: result.data });
  } catch (e) {
    console.error('[referrals.admin.mark-paid] threw:', e.message);
    res.status(500).json({ error: 'Could not mark paid.' });
  }
});


// ─── ADMIN: POST /api/referrals/admin/:id/cancel ─────────────────────────
// Hard stop — referrer withdrew consent, dispute resolved against, etc.
router.post('/admin/:id/cancel', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = await adminCancel(supabaseAdmin, {
      referralId:  req.params.id,
      adminUserId: req.user?.id,
      reason,
    });
    if (result.error) {
      return res.status(400).json({ error: result.error.message || 'Could not cancel referral.' });
    }
    res.json({ referral: result.data });
  } catch (e) {
    console.error('[referrals.admin.cancel] threw:', e.message);
    res.status(500).json({ error: 'Could not cancel referral.' });
  }
});

export default router;
