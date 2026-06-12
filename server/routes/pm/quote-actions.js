// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm/quotes/:id/* lifecycle action routes
//
// Day-5 scope: generate / email / sign / counter-sign / deposit / audit-log /
// pdf download. Picks up where Day-4 (CRUD + discount workflow) leaves off.
//
//   POST   /:id/generate           — engine → PDFs → storage → version row update
//   POST   /:id/email              — fetch PDF → send via Resend → log
//   POST   /:id/sign               — accept signed PDF upload, flip status=signed
//   POST   /:id/counter-sign       — admin counter-sign, flip to counter_signed
//   POST   /:id/deposit            — mark deposit received + optional handoff to projects_v2
//   GET    /:id/audit-log          — append-only history
//   GET    /:id/pdf                — signed URL for the customer PDF (or sales console)
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { supabaseAdmin as supabaseFromConfig } from '../../config/supabase.js';
import { runEngine } from '../../services/pm/proposalEngine/index.js';
import { runThreeScenarios } from '../../services/pm/proposalEngine/financialModel.js';
import { getCachedCatalogue } from '../../services/pm/proposalEngine/catalogue/cachedDbLoader.js';
import { renderProposalPdfs } from '../../services/pm/proposalEngine/renderPdf.js';
import { buildProposalData } from '../../services/pm/proposalEngine/htmlTemplates/proposalData.js';
import * as quoteStorage from '../../services/pm/quoteStorageService.js';
import { sendCustomerProposalEmail } from '../../services/pm/quoteEmailService.js';

// Test seam — matches the pattern used in quotes.js
let _supabaseAdmin = supabaseFromConfig;
export function __setSupabaseForTests(client) { _supabaseAdmin = client; }
const sb = () => _supabaseAdmin;

const router = Router();
router.use(authenticate);

// ── Helpers ────────────────────────────────────────────────────────────────
async function getCurrentVersion(quote_id) {
  const { data, error } = await sb()
    .from('quote_versions').select('*')
    .eq('quote_id', quote_id).eq('is_current', true).maybeSingle();
  if (error) throw error;
  return data;
}

async function writeAudit(req, { quote_id, version_id, action, before, after, metadata }) {
  if (!sb()) return;
  try {
    await sb().from('quote_audit_log').insert({
      quote_id,
      version_id: version_id || null,
      actor_user_id: req?.user?.id || null,
      actor_role: req?.user?.role || null,
      action,
      before: before || null,
      after: after || null,
      metadata: {
        ip: req?.ip,
        user_agent: req?.headers?.['user-agent']?.slice(0, 500),
        ...(metadata || {}),
      },
    });
  } catch (e) {
    console.error('quote_audit_log write failed (non-fatal):', e.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/generate  — engine → PDFs → upload
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/generate',
  authorize('admin', 'sales_mgr', 'sales_exec', 'proposal_mgr'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const t0 = Date.now();

    const { data: quote, error: qErr } = await sb()
      .from('quotes')
      .select(`*, contacts:contact_id ( id, name, email, phone, street, suburb, city, postcode )`)
      .eq('id', req.params.id).maybeSingle();
    if (qErr) throw qErr;
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });

    const current = await getCurrentVersion(quote.id);
    if (!current) return res.status(404).json({ error: 'No current version found.' });

    if (!['draft', 'ready_to_generate', 'generated'].includes(quote.status)) {
      return res.status(409).json({ error: `Cannot generate when quote is ${quote.status}.` });
    }

    // Re-run engine on the current spec (the source of truth), against
    // the live Supabase products catalogue.
    let engineOptions = {};
    try { engineOptions = { catalogue: await getCachedCatalogue(sb()) }; }
    catch (e) { console.warn('quote-actions /generate: catalogue load failed:', e.message); }
    const engine = await runEngine(current.spec, engineOptions);
    if (!engine.ok) {
      return res.status(422).json({ error: 'Engine refused current spec.',
        config_errors: engine.config_errors });
    }
    if (!engine.can_ship) {
      return res.status(409).json({ error: 'Quote cannot ship.', block_reasons: engine.block_reasons });
    }

    const scenarios = runThreeScenarios(current.spec, engine.cost, {}, engineOptions);

    // Build PDFs
    const rendered = await renderProposalPdfs({
      spec: current.spec, costResult: engine.cost, scenarios,
      engineering: engine.engineering, bom: engine.bom,
      options: { quote_ref: quote.quote_ref, quote_date: new Date().toISOString() },
    });

    // Upload to storage
    const customerUpload = await quoteStorage.uploadQuotePdf({
      quote_id: quote.id, version_number: current.version_number,
      kind: 'customer', buffer: rendered.customer_pdf,
    });
    const salesUpload = await quoteStorage.uploadQuotePdf({
      quote_id: quote.id, version_number: current.version_number,
      kind: 'sales-console', buffer: rendered.sales_console_pdf,
    });

    // Compute pricing snapshot (frozen at generation time per design)
    const pricingSnapshot = {
      lines: engine.cost.lines,
      sections: engine.cost.sections,
      totals: engine.cost.totals,
      margin_floor_status: engine.cost.margin_floor_status,
      discount: current.spec.pricing?.discount || null,
      gst_rate: engine.cost.gst_rate,
      computed_at: new Date().toISOString(),
    };

    await sb().from('quote_versions').update({
      pricing_snapshot: pricingSnapshot,
      validator_output: engine.engineering,
      financial_model_output: {
        summary: scenarios.summary,
        headline: scenarios.expected.yr1,
        yearly: scenarios.expected.yearly,
      },
      customer_pdf_storage_path: customerUpload.storage_path,
      customer_pdf_size_bytes: customerUpload.size_bytes,
      customer_pdf_sha256: customerUpload.sha256,
      internal_onepager_pdf_storage_path: salesUpload.storage_path,
      internal_onepager_pdf_size_bytes: salesUpload.size_bytes,
      internal_onepager_pdf_sha256: salesUpload.sha256,
      engine_version: engine.versions.engine_version,
      warranty_terms_version: engine.versions.warranty_terms_version,
      catalogue_version: engine.versions.catalogue_version,
      standards_version_json: engine.engineering.standards_referenced,
      generated_at: new Date().toISOString(),
      generated_by: req.user.id,
    }).eq('id', current.id);

    await sb().from('quotes').update({
      status: 'generated',
      updated_at: new Date().toISOString(),
    }).eq('id', quote.id);

    // Log every PDF generation attempt for audit.
    await sb().from('quote_run_log').insert({
      quote_id: quote.id,
      version_id: current.id,
      ran_by: req.user.id,
      run_kind: 'generate',
      duration_ms: Date.now() - t0,
      spec_sha256: engine.spec_sha256,
      catalogue_version: engine.versions.catalogue_version,
      engine_version: engine.versions.engine_version,
      validation_status: engine.engineering.soft_warnings.length > 0
        ? 'passed_with_soft_warnings' : 'passed',
      outputs: {
        customer_pdf: { storage_path: customerUpload.storage_path, sha256: customerUpload.sha256, size_bytes: customerUpload.size_bytes },
        sales_console_pdf: { storage_path: salesUpload.storage_path, sha256: salesUpload.sha256, size_bytes: salesUpload.size_bytes },
      },
    }).then(() => {}).catch(() => {});  // non-fatal

    await writeAudit(req, {
      quote_id: quote.id, version_id: current.id, action: 'pdf.generated',
      after: { customer_sha256: customerUpload.sha256, duration_ms: Date.now() - t0 },
    });

    res.json({
      ok: true,
      quote_id: quote.id,
      version_id: current.id,
      version_number: current.version_number,
      customer_pdf: customerUpload,
      sales_console_pdf: salesUpload,
      duration_ms: Date.now() - t0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/email  — email customer with PDF attachment
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/email',
  authorize('admin', 'sales_mgr', 'sales_exec', 'proposal_mgr'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { to, cc, bcc, dry_run } = req.body || {};
    const dryRun = dry_run === true || req.query.dry_run === 'true';

    const { data: quote } = await sb()
      .from('quotes')
      .select(`*, contacts:contact_id ( id, name, email )`)
      .eq('id', req.params.id).maybeSingle();
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });

    if (!['generated', 'sent_to_customer'].includes(quote.status)) {
      return res.status(409).json({ error: `Cannot email when quote is ${quote.status}. Generate the PDF first.` });
    }

    const current = await getCurrentVersion(quote.id);
    if (!current?.customer_pdf_storage_path) {
      return res.status(404).json({ error: 'No generated customer PDF for current version.' });
    }

    // Build proposalData (so the email body has the same numbers as the PDF)
    let engineOptions = {};
    try { engineOptions = { catalogue: await getCachedCatalogue(sb()) }; }
    catch (e) { console.warn('quote-actions /email: catalogue load failed:', e.message); }
    const engine = await runEngine(current.spec, engineOptions);
    if (!engine.ok) return res.status(422).json({ error: 'Engine refused current spec on re-evaluation.' });
    const scenarios = runThreeScenarios(current.spec, engine.cost, {}, engineOptions);
    const proposalData = buildProposalData({
      spec: current.spec, costResult: engine.cost, scenarios,
      engineering: engine.engineering, bom: engine.bom,
      options: { quote_ref: quote.quote_ref, quote_date: new Date().toISOString() },
    });

    // Fetch PDF from storage (only needed for real send — dry-run doesn't attach).
    const customerPdfBuffer = dryRun
      ? Buffer.alloc(0)
      : await quoteStorage.downloadQuotePdf(current.customer_pdf_storage_path);

    const sendResult = await sendCustomerProposalEmail({
      proposalData,
      customerPdfBuffer,
      to: to || quote.contacts?.email || current.spec.customer?.email,
      cc, bcc,
      dry_run: dryRun,
    });

    // Log every email attempt (real or dry-run).
    await sb().from('quote_email_log').insert({
      quote_id: quote.id,
      version_id: current.id,
      sent_to_email: sendResult.would_send.to,
      cc_emails: sendResult.would_send.cc ? [].concat(sendResult.would_send.cc) : null,
      bcc_emails: sendResult.would_send.bcc ? [].concat(sendResult.would_send.bcc) : null,
      subject: sendResult.would_send.subject,
      attachment_storage_paths: [current.customer_pdf_storage_path],
      resend_message_id: sendResult.provider_message_id,
      sent_by: req.user.id,
      send_status: sendResult.dry_run ? 'sent' : 'sent',
      dry_run: sendResult.dry_run,
    }).then(() => {}).catch(() => {});

    if (!dryRun) {
      await sb().from('quotes').update({
        status: 'sent_to_customer',
        valid_until: new Date(Date.now() + 14 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', quote.id);
    }

    await writeAudit(req, {
      quote_id: quote.id, version_id: current.id,
      action: dryRun ? 'email.dry_run' : 'email.sent',
      after: sendResult.would_send,
    });

    res.json({
      ok: true,
      dry_run: sendResult.dry_run,
      would_send: sendResult.would_send,
      provider_message_id: sendResult.provider_message_id,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/sign  — customer signed PDF returned (rep uploads)
// Body: { signed_pdf_base64: '...', signed_at: '...', signer_name: '...' }
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/sign',
  authorize('admin', 'sales_mgr', 'sales_exec', 'proposal_mgr'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { signed_pdf_base64, signed_at, signer_name } = req.body || {};
    if (!signed_pdf_base64) return res.status(400).json({ error: 'signed_pdf_base64 required.' });

    const { data: quote } = await sb()
      .from('quotes').select('*').eq('id', req.params.id).maybeSingle();
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    if (!['sent_to_customer', 'generated'].includes(quote.status)) {
      return res.status(409).json({ error: `Cannot mark signed when quote is ${quote.status}.` });
    }

    const current = await getCurrentVersion(quote.id);
    if (!current) return res.status(404).json({ error: 'No current version found.' });

    const buffer = Buffer.from(signed_pdf_base64, 'base64');
    if (buffer.length < 100) return res.status(400).json({ error: 'signed_pdf_base64 looks invalid.' });

    const upload = await quoteStorage.uploadQuotePdf({
      quote_id: quote.id, version_number: current.version_number,
      kind: 'signed-customer', buffer,
    });

    await sb().from('quote_versions').update({
      signed_pdf_storage_path: upload.storage_path,
      signed_pdf_size_bytes: upload.size_bytes,
      signed_pdf_sha256: upload.sha256,
      signed_at: signed_at || new Date().toISOString(),
      signer_name: signer_name || null,
    }).eq('id', current.id);

    await sb().from('quotes').update({
      status: 'signed',
      updated_at: new Date().toISOString(),
    }).eq('id', quote.id);

    await writeAudit(req, {
      quote_id: quote.id, version_id: current.id, action: 'customer.signed',
      after: { signed_pdf_sha256: upload.sha256, signed_at, signer_name },
    });

    res.json({ ok: true, signed_pdf: upload });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/counter-sign  — Goldenray side signs (admin only)
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/counter-sign', authorize('admin'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { counter_signed_pdf_base64, counter_signer_name } = req.body || {};

    const { data: quote } = await sb()
      .from('quotes').select('*').eq('id', req.params.id).maybeSingle();
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    if (quote.status !== 'signed') {
      return res.status(409).json({ error: `Cannot counter-sign when quote is ${quote.status}. Customer must sign first.` });
    }

    const current = await getCurrentVersion(quote.id);
    if (!current) return res.status(404).json({ error: 'No current version found.' });

    let upload = null;
    if (counter_signed_pdf_base64) {
      const buffer = Buffer.from(counter_signed_pdf_base64, 'base64');
      upload = await quoteStorage.uploadQuotePdf({
        quote_id: quote.id, version_number: current.version_number,
        kind: 'counter-signed', buffer,
      });
    }

    const updates = {
      counter_signed_at: new Date().toISOString(),
      counter_signed_by: req.user.id,
      counter_signer_name: counter_signer_name || null,
    };
    if (upload) {
      updates.counter_signed_pdf_storage_path = upload.storage_path;
      updates.counter_signed_pdf_size_bytes = upload.size_bytes;
      updates.counter_signed_pdf_sha256 = upload.sha256;
    }
    await sb().from('quote_versions').update(updates).eq('id', current.id);

    await sb().from('quotes').update({
      status: 'counter_signed',
      updated_at: new Date().toISOString(),
    }).eq('id', quote.id);

    await writeAudit(req, {
      quote_id: quote.id, version_id: current.id, action: 'counter_signed',
      after: { counter_signer_name, sha256: upload?.sha256 },
    });

    res.json({ ok: true, counter_signed_pdf: upload });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/deposit  — deposit landed, optional handoff to projects_v2
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/deposit',
  authorize('admin', 'sales_mgr', 'sales_exec', 'proposal_mgr'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { deposit_amount_nzd, deposit_reference, deposit_received_at,
            handoff_to_pm = false, project_overrides } = req.body || {};
    if (!(deposit_amount_nzd > 0)) return res.status(400).json({ error: 'deposit_amount_nzd > 0 required.' });

    const { data: quote } = await sb()
      .from('quotes').select('*').eq('id', req.params.id).maybeSingle();
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    if (!['counter_signed', 'signed'].includes(quote.status)) {
      return res.status(409).json({ error: `Cannot record deposit when quote is ${quote.status}.` });
    }

    const updates = {
      deposit_amount_nzd,
      deposit_reference: deposit_reference || null,
      deposit_received_at: deposit_received_at || new Date().toISOString(),
      status: handoff_to_pm ? 'handed_off' : 'deposit_received',
      updated_at: new Date().toISOString(),
    };

    // Optional handoff: create projects_v2 row + link.
    let createdProjectId = null;
    if (handoff_to_pm) {
      const current = await getCurrentVersion(quote.id);
      const spec = current.spec;
      const insertRow = {
        contact_id: quote.contact_id,
        address: spec.customer?.address?.street || null,
        suburb: spec.customer?.address?.suburb || null,
        city: spec.customer?.address?.city || null,
        region: spec.customer?.address?.region || null,
        postcode: spec.customer?.address?.postcode || null,
        project_type: 'residential_rooftop',
        system_size_kw: +(spec.system.panel.count * 0.595).toFixed(2),  // approximate; real value computed at quote time
        battery_kwh: spec.system?.battery?.module_count
          ? +(spec.system.battery.module_count * 2.76).toFixed(2) : null,
        panel_count: spec.system.panel.count,
        primary_owner_id: req.user.id,
        ...(project_overrides || {}),
      };
      const { data: project, error: pErr } = await sb()
        .from('projects_v2').insert(insertRow).select('id').single();
      if (pErr) throw pErr;
      createdProjectId = project.id;
      updates.project_id = project.id;
    }

    await sb().from('quotes').update(updates).eq('id', quote.id);

    await writeAudit(req, {
      quote_id: quote.id, action: handoff_to_pm ? 'handoff.to_pm' : 'deposit.received',
      after: { deposit_amount_nzd, deposit_reference,
               project_id: createdProjectId || quote.project_id || null },
    });

    res.json({ ok: true, project_id: createdProjectId || quote.project_id, status: updates.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:id/audit-log  — append-only history for the UI timeline
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id/audit-log', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await sb()
      .from('quote_audit_log')
      .select('id, version_id, actor_user_id, actor_role, action, before, after, metadata, occurred_at')
      .eq('quote_id', req.params.id)
      .order('occurred_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:id/pdf?kind=customer|sales-console|signed-customer|counter-signed&version=N
//   Returns a short-lived signed URL for download.
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const kind = req.query.kind || 'customer';
    const versionN = req.query.version ? parseInt(req.query.version, 10) : null;

    let q = sb().from('quote_versions').select('*').eq('quote_id', req.params.id);
    q = versionN ? q.eq('version_number', versionN) : q.eq('is_current', true);
    const { data: version, error } = await q.maybeSingle();
    if (error) throw error;
    if (!version) return res.status(404).json({ error: 'Version not found.' });

    const pathField = {
      'customer': 'customer_pdf_storage_path',
      'sales-console': 'internal_onepager_pdf_storage_path',
      'signed-customer': 'signed_pdf_storage_path',
      'counter-signed': 'counter_signed_pdf_storage_path',
    }[kind];
    if (!pathField) return res.status(400).json({ error: 'Invalid kind.' });

    const storagePath = version[pathField];
    if (!storagePath) return res.status(404).json({ error: `No ${kind} PDF for this version.` });

    const url = await quoteStorage.getInternalSignedUrl(storagePath);
    res.json({ url, ttl_sec: 3600, kind, version_number: version.version_number });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
