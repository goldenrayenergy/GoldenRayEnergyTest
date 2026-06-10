// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm/quotes routes (MVP1_001 proposal generator)
//
// Day-4 scope: CRUD + discount workflow + validate endpoint.
//   POST   /                    — create quote (rep)
//   GET    /                    — list quotes (filterable)
//   GET    /:id                 — get quote + current version
//   PATCH  /:id/spec            — update spec (creates new version)
//   POST   /:id/validate        — run engine on current spec
//   POST   /:id/discount-request — rep raises below-floor discount request
//   POST   /:id/discount-approve — admin approves / modifies / rejects
//   DELETE /:id                  — withdraw (soft delete via status flip)
//
// Generate / email / sign / deposit endpoints land in Day 5 (separate file).
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { supabaseAdmin as supabaseFromConfig } from '../../config/supabase.js';
import { runEngine } from '../../services/pm/proposalEngine/index.js';
import { runThreeScenarios } from '../../services/pm/proposalEngine/financialModel.js';
import { getCachedCatalogue } from '../../services/pm/proposalEngine/catalogue/cachedDbLoader.js';

// Tiny seam so behaviour tests can inject a stub Supabase client. Production
// path is unchanged — `sb()` always resolves to the real config export.
let _supabaseAdmin = supabaseFromConfig;
export function __setSupabaseForTests(client) { _supabaseAdmin = client; }
const sb = () => _supabaseAdmin;

const router = Router();
router.use(authenticate);

// ── Helpers ────────────────────────────────────────────────────────────────

function surnameOf(fullName) {
  return (fullName || '').toString().split(/\s+/).filter(Boolean).slice(-1)[0]
    || 'CUSTOMER';
}

async function nextQuoteRef(contactName, year) {
  const surname = surnameOf(contactName).toUpperCase().replace(/[^A-Z]/g, '') || 'CUSTOMER';
  const prefix = `PR-${surname}-${year}-`;
  const { data, error } = await sb()
    .from('quotes')
    .select('quote_ref')
    .ilike('quote_ref', `${prefix}%`)
    .order('quote_ref', { ascending: false })
    .limit(1);
  if (error) throw error;
  let n = 1;
  if (data?.length) {
    const tail = data[0].quote_ref.slice(prefix.length);
    const parsed = parseInt(tail, 10);
    if (Number.isFinite(parsed)) n = parsed + 1;
  }
  return `${prefix}${String(n).padStart(3, '0')}`;
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

async function getCurrentVersion(quote_id) {
  const { data, error } = await sb()
    .from('quote_versions')
    .select('*')
    .eq('quote_id', quote_id)
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Recompute margin status + scenarios from a spec, against the LIVE Supabase
// products catalogue (with field aliasing). Pure: no DB writes.
//
// Catalogue is cached 60s — invalidated by admin CSV import.
//
// Single-tier: returns { ok, engine, scenarios }.
// Multi-tier:  returns { ok, engine, tier_scenarios: [per-tier scenarios] }.
async function evaluateSpec(spec) {
  let catalogue = null;
  try { catalogue = await getCachedCatalogue(sb()); }
  catch (e) {
    // Fall back to JS catalogue if DB query fails — engine still runs
    console.warn('evaluateSpec: catalogue load failed, falling back to JS defaults:', e.message);
  }
  const options = catalogue ? { catalogue } : {};
  const engine = runEngine(spec, options);
  if (!engine.ok) return { ok: false, engine };
  if (engine.is_multi_tier) {
    const tier_scenarios = engine.tiers.map((tierResult, i) => {
      const tierSpec = spec.tiers[i];
      const effectiveSpec = {
        ...spec,
        system: { ...spec.system, ...(tierSpec.system_overrides || {}) },
        pricing: tierSpec.pricing || spec.pricing,
        cost_overrides: tierSpec.cost_overrides || {},
      };
      return runThreeScenarios(effectiveSpec, tierResult.cost, {}, options);
    });
    return { ok: true, engine, tier_scenarios };
  }
  const scenarios = runThreeScenarios(spec, engine.cost, {}, options);
  return { ok: true, engine, scenarios };
}

// ────────────────────────────────────────────────────────────────────────────
// POST /  — create new quote (sales rep, sales_mgr, proposal_mgr, admin)
// ────────────────────────────────────────────────────────────────────────────
router.post('/', authorize('admin', 'sales_mgr', 'sales_exec', 'proposal_mgr'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const { contact_id, spec, stage = 'stage_1_estimate',
            final_mode = true, assigned_user_id, bill_analysis_id } = req.body;

    if (!contact_id) return res.status(400).json({ error: 'contact_id is required.' });
    if (!spec || typeof spec !== 'object') return res.status(400).json({ error: 'spec must be an object.' });

    // Resolve the contact for quote_ref generation.
    const { data: contact, error: contactErr } = await sb()
      .from('contacts').select('id, name').eq('id', contact_id).maybeSingle();
    if (contactErr || !contact) return res.status(404).json({ error: 'Contact not found.' });

    // Try to run the engine, but DON'T refuse on config errors at creation time.
    // Reps need to be able to start a quote with a placeholder spec and fill it
    // in via the edit form. The engine gates kick in on PATCH /spec (returns
    // errors but stores nothing) and on POST /generate (refuses to ship).
    let evaluated = await evaluateSpec(spec);

    const year = new Date().getFullYear();
    const quote_ref = await nextQuoteRef(contact.name, year);

    // Insert quote row first (current_version_id NULL — filled below).
    const { data: quote, error: quoteErr } = await sb()
      .from('quotes')
      .insert({
        quote_ref,
        contact_id,
        bill_analysis_id: bill_analysis_id || null,
        status: 'draft',
        stage,
        final_mode,
        current_version_number: 1,
        assigned_user_id: assigned_user_id || req.user.id,
        created_by: req.user.id,
      })
      .select('*')
      .single();
    if (quoteErr) throw quoteErr;

    // Insert initial version (v1, is_current=true). Validator + financial
    // output written only if engine actually ran cleanly. Pricing snapshot
    // stays NULL until generate is run (Day 5).
    const { data: version, error: versionErr } = await sb()
      .from('quote_versions')
      .insert({
        quote_id: quote.id,
        version_number: 1,
        spec,
        validator_output: evaluated.ok ? evaluated.engine.engineering : null,
        financial_model_output: evaluated.ok ? {
          summary: evaluated.scenarios.summary,
          headline: evaluated.scenarios.expected.yr1,
        } : null,
        is_current: true,
      })
      .select('*')
      .single();
    if (versionErr) throw versionErr;

    // Wire current_version_id back.
    await sb().from('quotes')
      .update({ current_version_id: version.id })
      .eq('id', quote.id);

    await writeAudit(req, { quote_id: quote.id, version_id: version.id,
      action: 'quote.created', after: { quote_ref, stage, final_mode } });

    res.status(201).json({
      quote: { ...quote, current_version_id: version.id },
      version,
      engine: evaluated.ok ? {
        can_ship: evaluated.engine.can_ship,
        margin_floor_status: evaluated.engine.cost.margin_floor_status,
        block_reasons: evaluated.engine.block_reasons,
      } : {
        can_ship: false,
        config_errors: evaluated.engine.config_errors,
        note: 'Spec incomplete — fill in the form and Save to run the engine.',
      },
      scenarios: evaluated.ok ? evaluated.scenarios.summary : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /  — list quotes
// ────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    let q = sb()
      .from('quotes')
      .select(`
        id, quote_ref, status, stage, final_mode,
        current_version_id, current_version_number, valid_until,
        contact_id, project_id, assigned_user_id, created_by,
        closed_lost_reason_code, created_at, updated_at,
        contacts:contact_id ( id, name, email, phone )
      `)
      .order('created_at', { ascending: false })
      .limit(500);

    if (req.query.status)     q = q.eq('status', req.query.status);
    if (req.query.stage)      q = q.eq('stage', req.query.stage);
    if (req.query.contact_id) q = q.eq('contact_id', req.query.contact_id);
    if (req.query.mine === '1') q = q.eq('assigned_user_id', req.user.id);
    // P9 — by default hide archived; admin can pass include_archived=1 to see them
    if (req.query.include_archived !== '1' && req.query.status !== 'archived') {
      q = q.neq('status', 'archived');
    }

    const { data, error } = await q;
    if (error) throw error;

    const search = (req.query.search || '').toLowerCase().trim();
    const out = search
      ? data.filter(r =>
          r.quote_ref?.toLowerCase().includes(search) ||
          r.contacts?.name?.toLowerCase().includes(search) ||
          r.contacts?.email?.toLowerCase().includes(search))
      : data;

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:id  — quote + current version
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { data: quote, error: quoteErr } = await sb()
      .from('quotes')
      .select(`*, contacts:contact_id ( id, name, email, phone, street, suburb, city, postcode )`)
      .eq('id', req.params.id)
      .maybeSingle();
    if (quoteErr) throw quoteErr;
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });

    const currentVersion = await getCurrentVersion(quote.id);

    // Pending discount approval (if any) for the UI to surface.
    const { data: pending } = await sb()
      .from('discount_approvals')
      .select('*')
      .eq('quote_id', quote.id)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({ quote, current_version: currentVersion, pending_discount: pending || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:id/versions  — full version history (for revision audit trail)
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id/versions', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await sb()
      .from('quote_versions')
      .select('id, version_number, spec, validator_output, generated_at, generated_by, is_current, superseded_at, customer_pdf_storage_path, created_at')
      .eq('quote_id', req.params.id)
      .order('version_number', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /:id/spec  — replace spec, creates new version
// ────────────────────────────────────────────────────────────────────────────
router.patch('/:id/spec', authorize('admin', 'sales_mgr', 'sales_exec', 'proposal_mgr'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const { spec } = req.body;
    if (!spec || typeof spec !== 'object') return res.status(400).json({ error: 'spec must be an object.' });

    const { data: quote, error: quoteErr } = await sb()
      .from('quotes').select('*').eq('id', req.params.id).maybeSingle();
    if (quoteErr) throw quoteErr;
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });

    if (['sent_to_customer', 'signed', 'counter_signed', 'deposit_received', 'handed_off',
         'expired', 'withdrawn', 'closed_lost'].includes(quote.status)) {
      return res.status(409).json({ error: `Cannot edit spec when quote is ${quote.status}.` });
    }

    const evaluated = await evaluateSpec(spec);
    if (!evaluated.ok) {
      const body = {
        error: 'Spec failed engine validation.',
        config_errors: evaluated.engine.config_errors,
        bom_error: evaluated.engine.bom_error,
        cost_error: evaluated.engine.cost_error,
      };
      // Multi-tier: also flatten per-tier refusals so the UI panel can show
      // [Solar only] customer.address.street required, [Solar + battery] …
      if (evaluated.engine.is_multi_tier && Array.isArray(evaluated.engine.tiers)) {
        body.tier_errors = evaluated.engine.tiers
          .filter(t => t.config_errors || t.bom_error || t.cost_error)
          .map(t => ({
            tier_id: t.tier_id, label: t.label,
            config_errors: t.config_errors,
            bom_error: t.bom_error,
            cost_error: t.cost_error,
          }));
      }
      return res.status(400).json(body);
    }

    const oldCurrent = await getCurrentVersion(quote.id);
    const nextVersionNum = (oldCurrent?.version_number || 0) + 1;

    // Flip old version off-current first to avoid violating the partial unique index.
    if (oldCurrent) {
      await sb().from('quote_versions')
        .update({ is_current: false, superseded_at: new Date().toISOString() })
        .eq('id', oldCurrent.id);
    }

    const { data: newVersion, error: newVErr } = await sb()
      .from('quote_versions')
      .insert({
        quote_id: quote.id,
        version_number: nextVersionNum,
        spec,
        validator_output: evaluated.engine.engineering,
        financial_model_output: {
          summary: evaluated.scenarios.summary,
          headline: evaluated.scenarios.expected.yr1,
        },
        is_current: true,
      })
      .select('*')
      .single();
    if (newVErr) throw newVErr;

    if (oldCurrent) {
      await sb().from('quote_versions')
        .update({ superseded_by_version_id: newVersion.id })
        .eq('id', oldCurrent.id);
    }

    // Revising a sent-back or pending_owner_review quote drops it back to draft.
    const newQuoteStatus = ['pending_owner_review', 'ready_to_generate', 'generated'].includes(quote.status)
      ? 'draft' : quote.status;

    await sb().from('quotes')
      .update({
        current_version_id: newVersion.id,
        current_version_number: nextVersionNum,
        status: newQuoteStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quote.id);

    await writeAudit(req, {
      quote_id: quote.id, version_id: newVersion.id, action: 'spec.changed',
      before: { version_number: oldCurrent?.version_number, status: quote.status },
      after: { version_number: nextVersionNum, status: newQuoteStatus },
    });

    // Build a multi-tier-aware response shape. Client validation panel
    // branches on engine.is_multi_tier to render either a single column or
    // per-tier rows.
    const responsePayload = {
      version: newVersion,
    };
    if (evaluated.engine.is_multi_tier) {
      responsePayload.engine = {
        is_multi_tier: true,
        can_ship_all: evaluated.engine.can_ship_all,
        block_reasons: evaluated.engine.block_reasons,
        recommended_tier_id: evaluated.engine.recommended_tier_id,
        tiers: evaluated.engine.tiers.map((t, i) => ({
          tier_id: t.tier_id,
          label: t.label,
          is_recommended: t.is_recommended,
          is_headline: t.is_headline,
          can_ship: t.can_ship,
          margin_floor_status: t.cost?.margin_floor_status,
          margin_pct: t.cost?.totals?.project_margin_pct,
          customer_inc_gst: t.cost?.totals?.customer_total_inc_gst,
          block_reasons: t.block_reasons || [],
        })),
      };
      responsePayload.tier_scenarios = evaluated.tier_scenarios.map(s => s.summary);
    } else {
      responsePayload.engine = {
        can_ship: evaluated.engine.can_ship,
        margin_floor_status: evaluated.engine.cost.margin_floor_status,
        block_reasons: evaluated.engine.block_reasons,
      };
      responsePayload.scenarios = evaluated.scenarios.summary;
    }
    res.json(responsePayload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /preview-validate  — stateless live preview (P6)
//
// Takes a spec in the body, runs engine + scenarios, returns the same shape
// as PATCH /:id/spec WITHOUT persisting anything. Client debounces this
// endpoint on every form edit so the rep sees Voc / margin / hard-fail
// warnings as they type, not just on Save.
// ────────────────────────────────────────────────────────────────────────────
router.post('/preview-validate', async (req, res) => {
  try {
    const { spec } = req.body || {};
    if (!spec || typeof spec !== 'object') {
      return res.status(400).json({ error: 'spec must be an object.' });
    }
    const evaluated = await evaluateSpec(spec);

    // Build the same response shape as patchSpec — branch on multi-tier
    if (evaluated.engine.is_multi_tier) {
      return res.json({
        engine: {
          is_multi_tier: true,
          can_ship_all: evaluated.engine.can_ship_all || false,
          block_reasons: evaluated.engine.block_reasons || [],
          recommended_tier_id: evaluated.engine.recommended_tier_id,
          // Tier-shape errors (rare: missing tiers[], duplicate ids, etc.) —
          // emitted when ok=false before per-tier loop runs.
          config_errors: evaluated.engine.config_errors,
          tiers: (evaluated.engine.tiers || []).map(t => ({
            tier_id: t.tier_id,
            label: t.label,
            is_recommended: t.is_recommended,
            is_headline: t.is_headline,
            can_ship: t.can_ship,
            // Per-tier refusal info so the UI can guide the rep to fix it
            config_errors: t.config_errors,
            bom_error: t.bom_error,
            cost_error: t.cost_error,
            margin_floor_status: t.cost?.margin_floor_status,
            margin_pct: t.cost?.totals?.project_margin_pct,
            customer_inc_gst: t.cost?.totals?.customer_total_inc_gst,
            hard_fails: t.engineering?.hard_fails || [],
            soft_warnings: t.engineering?.soft_warnings || [],
            block_reasons: t.block_reasons || [],
            cost: {
              lines: t.cost?.lines || [],
              sections: t.cost?.sections || {},
              totals: t.cost?.totals || {},
            },
          })),
        },
        tier_scenarios: evaluated.tier_scenarios?.map(s => s?.summary).filter(Boolean) || [],
        ok: evaluated.ok,
      });
    }

    // Single-tier or config-error path
    return res.json({
      engine: evaluated.ok ? {
        can_ship: evaluated.engine.can_ship,
        margin_floor_status: evaluated.engine.cost?.margin_floor_status,
        block_reasons: evaluated.engine.block_reasons,
        hard_fails: evaluated.engine.engineering?.hard_fails || [],
        soft_warnings: evaluated.engine.engineering?.soft_warnings || [],
        cost: {
          lines: evaluated.engine.cost?.lines || [],
          sections: evaluated.engine.cost?.sections || {},
          totals: evaluated.engine.cost?.totals || {},
        },
      } : {
        can_ship: false,
        // All three refusal types so the UI can guide the fix
        config_errors: evaluated.engine.config_errors,
        bom_error: evaluated.engine.bom_error,
        cost_error: evaluated.engine.cost_error,
      },
      scenarios: evaluated.ok ? evaluated.scenarios.summary : null,
      ok: evaluated.ok,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/validate  — run engine on current spec, return + persist outputs
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/validate', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const current = await getCurrentVersion(req.params.id);
    if (!current) return res.status(404).json({ error: 'No current version found.' });

    const evaluated = await evaluateSpec(current.spec);
    if (!evaluated.ok) {
      return res.status(422).json({
        error: 'Engine refused current spec.',
        config_errors: evaluated.engine.config_errors,
      });
    }

    if (evaluated.engine.is_multi_tier) {
      // Persist per-tier validator + financial summary
      await sb().from('quote_versions').update({
        validator_output: {
          is_multi_tier: true,
          tiers: evaluated.engine.tiers.map(t => ({
            tier_id: t.tier_id,
            label: t.label,
            is_recommended: t.is_recommended,
            engineering: t.engineering,
            can_ship: t.can_ship,
          })),
        },
        financial_model_output: {
          is_multi_tier: true,
          recommended_tier_id: evaluated.engine.recommended_tier_id,
          tiers: evaluated.engine.tiers.map((t, i) => ({
            tier_id: t.tier_id,
            label: t.label,
            is_recommended: t.is_recommended,
            summary: evaluated.tier_scenarios[i].summary,
            headline: evaluated.tier_scenarios[i].expected.yr1,
          })),
        },
      }).eq('id', current.id);

      await writeAudit(req, {
        quote_id: req.params.id, version_id: current.id, action: 'validate.run',
        after: {
          is_multi_tier: true,
          can_ship_all: evaluated.engine.can_ship_all,
          tier_count: evaluated.engine.tiers.length,
          blocked_tiers: evaluated.engine.tiers.filter(t => !t.can_ship).map(t => t.label),
        },
      });
    } else {
      await sb().from('quote_versions').update({
        validator_output: evaluated.engine.engineering,
        financial_model_output: {
          summary: evaluated.scenarios.summary,
          headline: evaluated.scenarios.expected.yr1,
        },
      }).eq('id', current.id);

      await writeAudit(req, {
        quote_id: req.params.id, version_id: current.id, action: 'validate.run',
        after: {
          can_ship: evaluated.engine.can_ship,
          margin_floor_status: evaluated.engine.cost.margin_floor_status,
          hard_fail_count: evaluated.engine.engineering.hard_fails.length,
        },
      });
    }

    res.json({
      engine: evaluated.engine,
      scenarios: evaluated.scenarios,                // single-tier (undefined in multi)
      tier_scenarios: evaluated.tier_scenarios,      // multi-tier (undefined in single)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/discount-request  — sales rep raises below-floor discount
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/discount-request',
  authorize('admin', 'sales_mgr', 'sales_exec', 'proposal_mgr'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const { requested_amount_nzd, reason } = req.body;
    if (!(requested_amount_nzd > 0)) return res.status(400).json({ error: 'requested_amount_nzd must be > 0.' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'reason is required for discount approvals.' });

    const current = await getCurrentVersion(req.params.id);
    if (!current) return res.status(404).json({ error: 'No current version found.' });

    // Compute what margin would be with the requested discount applied.
    const specWithDiscount = JSON.parse(JSON.stringify(current.spec));
    const baseListIncGst = specWithDiscount.pricing?.customer_price_inc_gst || 0;
    specWithDiscount.pricing = {
      ...specWithDiscount.pricing,
      customer_price_inc_gst: Math.max(0, baseListIncGst - requested_amount_nzd),
    };
    const evaluated = await evaluateSpec(specWithDiscount);
    if (!evaluated.ok) {
      return res.status(400).json({ error: 'Spec failed engine validation with requested discount.' });
    }
    const newMarginPct = evaluated.engine.cost.totals.project_margin_pct;

    const { data, error } = await sb()
      .from('discount_approvals')
      .insert({
        quote_id: req.params.id,
        version_id: current.id,
        requested_by: req.user.id,
        requested_amount_nzd,
        reason,
        requested_margin_pct: newMarginPct,
        status: 'pending',
      })
      .select('*').single();
    if (error) throw error;

    await sb().from('quotes')
      .update({ status: 'pending_owner_review', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    await writeAudit(req, {
      quote_id: req.params.id, version_id: current.id, action: 'discount.requested',
      after: { requested_amount_nzd, requested_margin_pct: newMarginPct, reason },
    });

    res.status(201).json({ discount_request: data, projected_margin_pct: newMarginPct });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/discount-approve  — admin decides (admin only)
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/discount-approve', authorize('admin'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const { decision, approved_amount_nzd, admin_notes, discount_request_id } = req.body;

    if (!['approved', 'approved_modified', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approved, approved_modified, or rejected.' });
    }
    if (!discount_request_id) return res.status(400).json({ error: 'discount_request_id is required.' });

    // Pull the request row.
    const { data: request, error: reqErr } = await sb()
      .from('discount_approvals').select('*')
      .eq('id', discount_request_id).maybeSingle();
    if (reqErr) throw reqErr;
    if (!request) return res.status(404).json({ error: 'Discount request not found.' });
    if (request.quote_id !== req.params.id) return res.status(400).json({ error: 'discount_request_id does not belong to this quote.' });
    if (request.status !== 'pending') return res.status(409).json({ error: `Request already ${request.status}.` });

    const finalAmount = decision === 'approved' ? request.requested_amount_nzd
                     : decision === 'approved_modified' ? approved_amount_nzd
                     : null;

    if (decision === 'approved_modified' && !(finalAmount > 0)) {
      return res.status(400).json({ error: 'approved_amount_nzd required for approved_modified.' });
    }

    const updates = {
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: req.user.id,
      decision_notes: admin_notes || null,
    };
    if (finalAmount != null) updates.decided_amount_nzd = finalAmount;

    await sb().from('discount_approvals')
      .update(updates).eq('id', discount_request_id);

    // On approval, apply discount to current spec and flip quote back to ready_to_generate.
    if (decision !== 'rejected') {
      const current = await getCurrentVersion(req.params.id);
      const updatedSpec = JSON.parse(JSON.stringify(current.spec));
      const baseList = updatedSpec.pricing?.customer_price_inc_gst || 0;
      updatedSpec.pricing = {
        ...updatedSpec.pricing,
        customer_price_inc_gst: Math.max(0, baseList - finalAmount),
        discount: {
          applied_nzd: finalAmount,
          owner_approved: true,
          approved_by: req.user.id,
          approved_at: new Date().toISOString(),
          reason: request.reason,
        },
      };

      // Verify engine still accepts the discounted spec.
      const evaluated = await evaluateSpec(updatedSpec);
      if (!evaluated.ok) {
        return res.status(500).json({ error: 'Engine refused the discounted spec — discount blocked.' });
      }

      // Persist the discount onto the current version (in-place — no new version,
      // because this is a finalisation step, not a spec change).
      await sb().from('quote_versions').update({
        spec: updatedSpec,
        validator_output: evaluated.engine.engineering,
        financial_model_output: {
          summary: evaluated.scenarios.summary,
          headline: evaluated.scenarios.expected.yr1,
        },
      }).eq('id', current.id);

      await sb().from('quotes')
        .update({ status: 'ready_to_generate', updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
    } else {
      // Rejected — quote returns to draft.
      await sb().from('quotes')
        .update({ status: 'draft', updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
    }

    await writeAudit(req, {
      quote_id: req.params.id, version_id: request.version_id,
      action: decision === 'rejected' ? 'discount.rejected' : 'discount.approved',
      after: { decision, approved_amount_nzd: finalAmount, admin_notes },
    });

    res.json({ ok: true, decision, approved_amount_nzd: finalAmount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// P9 — POST /:id/archive   — admin soft-archive (status='archived')
//      POST /:id/unarchive — admin restore (status='draft')
//
// Archive hides the quote from default list views but preserves the version
// history, audit log, PDFs, and version snapshots. Recoverable via
// `?include_archived=1` on the list endpoint.
//
// Unarchive restores to 'draft' (a known-safe state). If you need to send
// again, use the existing lifecycle actions to transition.
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/archive', authorize('admin'), async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const reason = (req.body?.reason || '').trim();
    if (reason.length < 10) {
      return res.status(400).json({ error: 'reason is required (min 10 chars).' });
    }
    const { data: quote, error: getErr } = await sb()
      .from('quotes').select('id, status').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    if (quote.status === 'archived') {
      return res.status(409).json({ error: 'Quote is already archived.' });
    }
    const { data: updated, error: upErr } = await sb()
      .from('quotes')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
        archived_by: req.user.id,
        archive_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('id, status, archived_at, archived_by, archive_reason').single();
    if (upErr) throw upErr;
    res.json({ ok: true, quote: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/unarchive', authorize('admin'), async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
    const { data: quote, error: getErr } = await sb()
      .from('quotes').select('id, status').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    if (quote.status !== 'archived') {
      return res.status(409).json({ error: `Quote is not archived (status=${quote.status}).` });
    }
    const { data: updated, error: upErr } = await sb()
      .from('quotes')
      .update({
        status: 'draft',
        archived_at: null,
        archived_by: null,
        archive_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('id, status').single();
    if (upErr) throw upErr;
    res.json({ ok: true, quote: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// DELETE /:id  — soft-delete via status=withdrawn
// ────────────────────────────────────────────────────────────────────────────
router.delete('/:id', authorize('admin', 'sales_mgr', 'sales_exec', 'proposal_mgr'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { data: quote } = await sb()
      .from('quotes').select('id, status').eq('id', req.params.id).maybeSingle();
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    if (['signed', 'counter_signed', 'deposit_received', 'handed_off'].includes(quote.status)) {
      return res.status(409).json({ error: `Cannot withdraw a ${quote.status} quote.` });
    }

    await sb().from('quotes')
      .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    await writeAudit(req, { quote_id: req.params.id, action: 'withdrawn',
      before: { status: quote.status }, after: { status: 'withdrawn' } });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
