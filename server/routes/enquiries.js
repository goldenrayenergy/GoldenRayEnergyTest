import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { calculateSolar } from '../services/calcService.js';

const router = Router();
router.use(authenticate);

const deriveSystemType = (e) => {
  if (e.installation_type === 'commercial') return 'on-grid';
  if (e.installation_type === 'off-grid')   return 'off-grid';
  if (e.installation_type === 'ppa')        return 'ppa';
  return e.battery_option === 'with-battery' ? 'hybrid' : 'on-grid';
};

// List — newest first, slim columns for the inbox table
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('website_enquiries')
      .select('id, created_at, first_name, last_name, email, phone, address, installation_type, battery_option, monthly_bill, system_size_kw, total_cost, monthly_savings, payback_years, roi_percent, lead_score, status')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Detail — returns raw row + a freshly-computed full calculation for display
router.get('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('website_enquiries')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;

    const calculation = data.monthly_bill
      ? calculateSolar({
          monthlyBill: data.monthly_bill,
          electricityRate: 0.32,
          systemType: deriveSystemType(data),
          batteryOption: data.battery_option,
        })
      : null;

    res.json({ enquiry: data, calculation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update status (new → contacted → qualified → won / lost)
router.patch('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const { data, error } = await supabaseAdmin
      .from('website_enquiries')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Bills + Analysis tab data ──────────────────────────────────────────────
// Returns the bill_analyses row + bill_uploads rows linked to this enquiry's
// contact. The wizard's Step-3 capture creates the contact; the bill analyzer
// then writes bill_analyses with contact_id pointing back to it. We join via
// contact_id rather than enquiry_id because that's the link the analyzer sets.
router.get('/:id/bills-analysis', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // 1. Find the contact linked to this enquiry (by email — same-session join)
    const { data: enq, error: enqErr } = await supabaseAdmin
      .from('website_enquiries')
      .select('id, email, first_name, last_name')
      .eq('id', req.params.id)
      .single();
    if (enqErr) throw enqErr;

    // 2. Find any contact rows that match this email (most recent first)
    const { data: contacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('email', enq.email)
      .order('created_at', { ascending: false })
      .limit(5);
    const contactIds = (contacts || []).map(c => c.id);

    if (contactIds.length === 0) {
      return res.json({ analyses: [], bill_uploads: [] });
    }

    // 3. Pull all bill_analyses for those contacts, newest first
    const { data: analyses, error: anErr } = await supabaseAdmin
      .from('bill_analyses')
      .select('id, contact_id, created_at, bills_uploaded, months_covered, annual_kwh, annual_spend_nzd, effective_rate_nzd, retailer, plan_name, region, postcode, recommended_system_kw, recommended_battery_kwh, recommended_package_slug, switch_recommended, switch_to_retailer, switch_to_plan, switch_annual_saving, review_required, review_reasons, region_resolved_from, scenarios, patterns, status')
      .in('contact_id', contactIds)
      .order('created_at', { ascending: false })
      .limit(10);
    if (anErr) throw anErr;

    const analysisIds = (analyses || []).map(a => a.id);
    let uploads = [];
    if (analysisIds.length) {
      const { data: ups, error: upErr } = await supabaseAdmin
        .from('bill_uploads')
        .select('id, analysis_id, file_name, file_size_bytes, file_storage_path, file_mime_type, retailer, plan_name, period_start, period_end, days_in_period, kwh_total, fixed_charge_nzd, variable_charge_nzd, gst_nzd, total_nzd, service_address, icp_number, network_distributor, parse_errors, ocr_confidence, parse_method')
        .in('analysis_id', analysisIds)
        .order('period_end', { ascending: false });
      if (upErr) console.warn('bill_uploads fetch failed:', upErr.message);
      uploads = ups || [];
    }

    res.json({ analyses: analyses || [], bill_uploads: uploads });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Mark a bill analysis as sales-verified ─────────────────────────────────
// Clears review_required after a sales rep has confirmed the analysis is OK
// (or fixed the underlying issue). Releases the customer-facing recommendation
// so future requests on this analysis return clean projections instead of
// the "we're verifying" screen.
router.patch('/bill-analyses/:analysisId/verify', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('bill_analyses')
      .update({
        review_required: false,
        review_reasons:  [{ code: 'sales_verified', severity: 'info', verified_by: req.user?.email || 'sales', verified_at: new Date().toISOString() }],
      })
      .eq('id', req.params.analysisId)
      .select('id, review_required')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Signed URL for a stored bill PDF/image ─────────────────────────────────
// 15-minute TTL; sales clicks "View PDF" in the Bills + Analysis tab and the
// portal redirects to this URL.
router.get('/bill-uploads/:uploadId/signed-url', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data: row, error } = await supabaseAdmin
      .from('bill_uploads')
      .select('file_storage_path, file_mime_type, file_name')
      .eq('id', req.params.uploadId)
      .single();
    if (error) throw error;
    if (!row?.file_storage_path) return res.status(404).json({ error: 'No stored file for this upload.' });

    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from('customer-bills')
      .createSignedUrl(row.file_storage_path, 60 * 15);
    if (sErr) throw sErr;

    res.json({ url: signed.signedUrl, mime_type: row.file_mime_type, file_name: row.file_name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Counts for portal filters (Review flag) ────────────────────────────────
router.get('/_counts/review-required', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { count, error } = await supabaseAdmin
      .from('bill_analyses')
      .select('id', { count: 'exact', head: true })
      .eq('review_required', true);
    if (error) throw error;
    res.json({ count: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
