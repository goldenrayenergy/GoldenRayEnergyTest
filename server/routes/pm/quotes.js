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
import { composeThreeTiers, topLevelSystemFromTier }
  from '../../services/pm/proposalEngine/threeTierComposer.js';
import { composeSystem } from '../../services/pm/proposalEngine/systemComposer.js';
import { REGIONS, BMS_RULES, COMPATIBILITY, TIER_STRIP_SETTINGS }
  from '../../services/pm/proposalEngine/data/engineeringRules.js';
import {
  getFinancialSummary, getMarginFloorStatus, getEngineeringOutput,
  getProjectMarginPct, getCanShip,
} from '../../services/pm/proposalEngine/evaluatedShape.js';

// Tiny seam so behaviour tests can inject a stub Supabase client. Production
// path is unchanged — `sb()` always resolves to the real config export.
let _supabaseAdmin = supabaseFromConfig;
export function __setSupabaseForTests(client) { _supabaseAdmin = client; }
const sb = () => _supabaseAdmin;

// Map free-text region/location → REGIONS engine key. Same logic the test
// scripts use; keeps the create endpoint resilient to varying bill-analysis
// region tags.
const REGION_MAP = {
  auckland:      'auckland_vector',
  counties:      'counties_franklin',
  franklin:      'counties_franklin',
  northland:     'northland',
  whangarei:     'northland',
  waikato:       'waikato',
  hamilton:      'waikato',
  bay_of_plenty: 'bop_tauranga',
  bop:           'bop_tauranga',
  tauranga:      'bop_tauranga',
  taranaki:      'taranaki',
  wairarapa:     'taranaki',
  manawatu:      'taranaki',
  palmerston:    'taranaki',
  wellington:    'wellington',
  canterbury:    'canterbury',
  christchurch:  'canterbury',
  otago:         'otago_queenstown',
  queenstown:    'otago_queenstown',
  southland:     'otago_queenstown',
  invercargill:  'otago_queenstown',
  dunedin:       'otago_queenstown',
};
function mapRegionKey(raw) {
  if (!raw) return null;
  const k = String(raw).toLowerCase().replace(/[^a-z]+/g, '_');
  for (const [needle, key] of Object.entries(REGION_MAP)) {
    if (k.includes(needle)) return key;
  }
  return null;
}

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
  const engine = await runEngine(spec, options);
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
    const { contact_id, spec, stage: requestedStage,
            final_mode = true, assigned_user_id, bill_analysis_id,
            mode = 'multi_tier' } = req.body;
    // mode: 'multi_tier' (default — composes 3 tiers for Stage 1 proposal)
    //       'direct_firm' (skip Stage 1 — single-tier Stage 2 firm offer for
    //                     customers who already know what they want)
    if (!['multi_tier', 'direct_firm'].includes(mode)) {
      return res.status(400).json({ error: `mode must be 'multi_tier' or 'direct_firm', got '${mode}'.` });
    }
    // direct_firm always lands at Stage 2; multi_tier defaults to Stage 1.
    const stage = mode === 'direct_firm' ? 'stage_2_firm'
                : (requestedStage || 'stage_1_estimate');

    if (!contact_id) return res.status(400).json({ error: 'contact_id is required.' });
    if (!spec || typeof spec !== 'object') return res.status(400).json({ error: 'spec must be an object.' });

    // Resolve the contact for quote_ref generation.
    const { data: contact, error: contactErr } = await sb()
      .from('contacts').select('id, name, location, street, suburb, city, postcode')
      .eq('id', contact_id).maybeSingle();
    if (contactErr || !contact) return res.status(404).json({ error: 'Contact not found.' });

    // ── Option 4c (b) — Server-side three-tier composition ──────────────
    // The spec sent by the client always has null SKUs. Server fetches the
    // bill analysis (if any) and runs composeThreeTiers to populate every
    // tier + top-level system. Spec is NEVER null in the response.
    //
    // Edge cases handled inside composeThreeTiers:
    //   • bill_analysis_id missing OR analysis row missing OR recommended_kw=0
    //       → all 3 tiers use catalogue-first fallback
    //   • composeSystem fails for one tier (e.g. envelope cliff)
    //       → that tier falls back; others stay engine-picked
    let billAnalysis = null;
    if (bill_analysis_id) {
      const { data: ba } = await sb().from('bill_analyses')
        .select('id, recommended_system_kw, recommended_battery_kwh, region, postcode')
        .eq('id', bill_analysis_id).maybeSingle();
      billAnalysis = ba || null;
    }
    // Determine phase + region. Phase defaults to 1 (residential); rep can
    // change in the System tab if 3ph. Region uses bill-analysis region first,
    // then contact location, then Auckland default.
    const phase = Number(spec.system?.phase) || 1;
    const regionKey = mapRegionKey(billAnalysis?.region) ||
                      mapRegionKey(contact.location)     ||
                      'auckland_vector';
    const region = REGIONS[regionKey] || REGIONS.auckland_vector;
    const sizeMode = spec.tier_strip?.size_mode || TIER_STRIP_SETTINGS.default_size_mode;

    let composeResult = null;
    try {
      const catalogue = await getCachedCatalogue(sb());

      if (mode === 'direct_firm') {
        // ── Direct firm path — skip composeThreeTiers, build single-tier ──
        // Customer already knows what they want (returning customer adding
        // to system, customer who saw a competitor quote, etc.). No spec.tiers
        // array, no Stage 1 PDF, jumps straight to Stage 2 single-tier.
        const targetKwp = Number(billAnalysis?.recommended_system_kw) || 5;
        const targetBatteryKwh = Number(billAnalysis?.recommended_battery_kwh) || null;
        const composed = composeSystem({
          targetDcKwp: targetKwp,
          phase,
          targetBatteryUsableKwh: targetBatteryKwh,
          hasEv: false,
          region,
          catalogue,
          COMPATIBILITY,
          BMS_RULES,
        });
        spec.system = {
          ...(spec.system || {}),
          panel:    composed.panel    || spec.system?.panel,
          inverter: composed.inverter || spec.system?.inverter,
          battery:  composed.battery  || spec.system?.battery || null,
          string_topology: composed.string_design?.topology || 'series',
          string_design: composed.string_design || {
            topology: 'series',
            groups: [{ panels_per_string: composed.panel?.count || 12, string_count: 1 }],
          },
          cable_run_metres_estimate: spec.system?.cable_run_metres_estimate || 24,
          phase,
          smart_meter: spec.system?.smart_meter || { sku: null, phase },
          wattpilot_included: !!composed.wattpilot_included,
        };
        // Explicitly NO spec.tiers — single-tier firm offer.
        delete spec.tiers;
        delete spec.tier_strip;
      } else {
        // ── Default multi-tier path (Stage 1 proposal) ──
        composeResult = composeThreeTiers({
          billAnalysis, phase, region, sizeMode,
          catalogue, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS,
        });
        // Populate spec.tiers + top-level system from the recommended tier.
        spec.tiers = composeResult.tiers;
        spec.tier_strip = { size_mode: composeResult.size_mode };
        const recIdx = Math.max(0, Math.min(composeResult.recommended_index || 0, spec.tiers.length - 1));
        spec.system = topLevelSystemFromTier(spec.tiers[recIdx], spec.system);
        // Carry phase + smart_meter through (composer doesn't touch them)
        spec.system.phase = phase;
        // Sync each tier's pricing.stage with the quote's stage
        for (const t of spec.tiers) t.pricing.stage = stage;
      }
    } catch (e) {
      // Composer failed entirely (DB down, catalogue load error, etc.).
      // Don't refuse the create — store what the client sent + flag.
      console.warn(`[quote-create] composer (${mode}) threw:`, e?.message);
      spec.__composer_error = e?.message || String(e);
    }

    // Canonicalise spec.pricing.stage so it matches the quotes.stage column.
    if (!spec.pricing) spec.pricing = {};
    spec.pricing.stage = stage;

    // Try to run the engine, but DON'T refuse on config errors at creation time.
    // Reps need to be able to start a quote and fill it in via the edit form.
    // The engine gates kick in on PATCH /spec (returns errors but stores nothing)
    // and on POST /generate (refuses to ship).
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
        validator_output: getEngineeringOutput(evaluated),
        financial_model_output: getFinancialSummary(evaluated),
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

    const finSummary = getFinancialSummary(evaluated);
    res.status(201).json({
      quote: { ...quote, current_version_id: version.id },
      version,
      engine: evaluated.ok ? {
        can_ship: getCanShip(evaluated),
        margin_floor_status: getMarginFloorStatus(evaluated),
        block_reasons: evaluated.engine.block_reasons,
      } : {
        can_ship: false,
        config_errors: evaluated.engine.config_errors,
        note: 'Spec incomplete — fill in the form and Save to run the engine.',
      },
      scenarios: finSummary?.summary || null,
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

    // ── Pricing rule (memory: feedback_pricing_always_from_cost_engine) ──
    // Engine list price is computed fresh from BoM × margins + labour +
    // compliance + GST on every render (cost.totals.total_list_inc_gst) — no
    // need to snapshot it into spec.pricing.customer_price_inc_gst.
    //
    // IMPORTANT: spec.pricing.customer_price_inc_gst is the "LOCKED at this
    // customer-pays price" field. When non-null, the cost engine treats the
    // spec as LOCKED mode and the discount.applied_nzd field is IGNORED in
    // favour of an implicit discount = (list - locked). When null (AUTO
    // mode), customer pays list - discount.applied_nzd.
    //
    // OLD behaviour unconditionally wrote customer_price_inc_gst = list, which
    // pinned every quote into LOCKED mode at FULL LIST = no discount possible.
    // This was the "discount disappears after save" bug end users hit. Now we
    // preserve the rep's input: locked stays locked, auto stays auto.
    //
    // Per-tier housekeeping (zero discount on non-recommended tiers) is
    // still needed — discount workflow attaches to the recommended tier only.
    if (evaluated.engine.is_multi_tier && Array.isArray(spec.tiers)) {
      for (let i = 0; i < spec.tiers.length; i++) {
        if (!spec.tiers[i].is_recommended && spec.tiers[i].pricing?.discount?.applied_nzd > 0) {
          spec.tiers[i].pricing.discount = { applied_nzd: 0, owner_approved: false, reason: null };
        }
      }
    }

    // Bug #4 fix — generate-bumped versioning.
    //
    // OLD: every PATCH /spec inserted a brand-new quote_versions row, so a
    // single editing session (Customer → Bills → System → Costs → Pricing →
    // Preferences → Site survey) created 7 versions before the rep ever hit
    // Generate. Versions stopped meaning anything customer-facing.
    //
    // NEW: a version is bumped only when the rep has already generated a PDF
    // from the current version (so editing after the customer has seen v_N
    // creates v_N+1; otherwise saves update v_N in place). v1, v2, v3 = the
    // PDFs the customer actually sees.
    const oldCurrent = await getCurrentVersion(quote.id);
    const alreadyGenerated = !!oldCurrent?.generated_at;

    let newVersion;
    let nextVersionNum = oldCurrent?.version_number || 1;
    let newQuoteStatus = quote.status;

    if (!oldCurrent || !alreadyGenerated) {
      // ── UPDATE IN PLACE — current version hasn't been generated yet ─────
      if (oldCurrent) {
        const { data: updated, error: upErr } = await sb()
          .from('quote_versions')
          .update({
            spec,
            validator_output: getEngineeringOutput(evaluated),
            financial_model_output: getFinancialSummary(evaluated),
            updated_at: new Date().toISOString(),
          })
          .eq('id', oldCurrent.id)
          .select('*')
          .single();
        if (upErr) throw upErr;
        newVersion = updated;
      } else {
        // No current version yet (shouldn't happen for an existing quote, but
        // be defensive — fall back to inserting v1).
        const { data: created, error: insErr } = await sb()
          .from('quote_versions')
          .insert({
            quote_id: quote.id, version_number: 1, spec,
            validator_output: getEngineeringOutput(evaluated),
            financial_model_output: getFinancialSummary(evaluated),
            is_current: true,
          })
          .select('*')
          .single();
        if (insErr) throw insErr;
        newVersion = created;
        nextVersionNum = 1;
      }
    } else {
      // ── BUMP VERSION — current already has a generated PDF the customer saw
      nextVersionNum = oldCurrent.version_number + 1;
      // Flip old version off-current first to avoid violating the partial unique index.
      await sb().from('quote_versions')
        .update({ is_current: false, superseded_at: new Date().toISOString() })
        .eq('id', oldCurrent.id);
      const { data: created, error: newVErr } = await sb()
        .from('quote_versions')
        .insert({
          quote_id: quote.id,
          version_number: nextVersionNum,
          spec,
          validator_output: getEngineeringOutput(evaluated),
          financial_model_output: getFinancialSummary(evaluated),
          is_current: true,
        })
        .select('*')
        .single();
      if (newVErr) throw newVErr;
      newVersion = created;
      await sb().from('quote_versions')
        .update({ superseded_by_version_id: newVersion.id })
        .eq('id', oldCurrent.id);
    }

    // Revising a sent-back or pending_owner_review quote drops it back to draft.
    newQuoteStatus = ['pending_owner_review', 'ready_to_generate', 'generated'].includes(quote.status)
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
      quote_id: quote.id, version_id: newVersion.id,
      action: alreadyGenerated ? 'spec.changed.bumped_version' : 'spec.changed.in_place',
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
        validator_output: getEngineeringOutput(evaluated),
        financial_model_output: getFinancialSummary(evaluated),
      }).eq('id', current.id);

      const aggEngineering = getEngineeringOutput(evaluated);
      await writeAudit(req, {
        quote_id: req.params.id, version_id: current.id, action: 'validate.run',
        after: {
          can_ship: getCanShip(evaluated),
          margin_floor_status: getMarginFloorStatus(evaluated),
          hard_fail_count: aggEngineering?.hard_fails?.length || 0,
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
    // Multi-tier-aware: worst-case (lowest) margin across tiers.
    const newMarginPct = getProjectMarginPct(evaluated);

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
      const approvalFields = {
        applied_nzd: finalAmount,
        owner_approved: true,
        approved_by: req.user.id,
        approved_at: new Date().toISOString(),
        reason: request.reason,
      };
      // Bug #2a multi-tier — discount lives at spec.tiers[i].pricing.discount,
      // NOT spec.pricing.discount, for multi-tier quotes. Without this branch,
      // admin approval silently wrote to top-level only and the tier-level
      // owner_approved stayed false → rep saw "discount still pending" in the
      // lifecycle and had to re-tick the checkbox manually, which then dropped
      // the status back to draft. Mirror the approval to EVERY tier that has a
      // matching applied_nzd > 0 so the spec is consistent.
      //
      // ALSO null out the tier's customer_price_inc_gst so the spec lands in
      // AUTO mode — otherwise the legacy LOCKED-at-list snapshot would make
      // the cost engine ignore the discount entirely.
      if (Array.isArray(updatedSpec.tiers) && updatedSpec.tiers.length > 0) {
        for (const t of updatedSpec.tiers) {
          if (!t.pricing) t.pricing = {};
          const existing = t.pricing.discount || {};
          if (existing.applied_nzd > 0) {
            t.pricing.discount = { ...existing, ...approvalFields };
            t.pricing.customer_price_inc_gst = null;
          }
        }
      }
      // Single-tier path (and as a fallback marker for multi-tier audit) —
      // top-level discount also reflects the approval.
      const baseList = updatedSpec.pricing?.customer_price_inc_gst || 0;
      updatedSpec.pricing = {
        ...updatedSpec.pricing,
        customer_price_inc_gst: Math.max(0, baseList - finalAmount),
        discount: approvalFields,
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
        validator_output: getEngineeringOutput(evaluated),
        financial_model_output: getFinancialSummary(evaluated),
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
// ────────────────────────────────────────────────────────────────────────────
// POST /:id/convert-to-firm  — collapse a Stage 1 multi-tier quote into a
// Stage 2 single-tier firm offer, anchored on the customer's chosen package.
//
// Body: { tier_id?: string }  — defaults to the recommended tier
//
// Reps trigger this after the customer has reviewed the 3-tier proposal and
// said which package they want. The spec is rewritten so:
//   • spec.system    ← top-level + chosen tier's system_overrides merged
//   • spec.pricing   ← chosen tier's pricing + stage flipped to stage_2_firm
//   • spec.cost_overrides ← chosen tier's cost_overrides
//   • spec.tiers / spec.tier_strip removed
//
// Versioning per Bug #4: in-place update if current version hasn't been
// generated yet, otherwise bump to v+1.
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/convert-to-firm',
  authorize('admin', 'sales_mgr', 'sales_exec', 'proposal_mgr'),
  async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { tier_id } = req.body || {};

    const { data: quote, error: qErr } = await sb()
      .from('quotes').select('*').eq('id', req.params.id).maybeSingle();
    if (qErr) throw qErr;
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });

    // Guard — only editable / pre-sent statuses can be converted.
    if (!['draft', 'pending_owner_review', 'ready_to_generate', 'generated'].includes(quote.status)) {
      return res.status(409).json({ error: `Cannot convert when quote is ${quote.status}.` });
    }

    const current = await getCurrentVersion(quote.id);
    if (!current) return res.status(404).json({ error: 'No current version found.' });

    const spec = JSON.parse(JSON.stringify(current.spec));
    if (!Array.isArray(spec.tiers) || spec.tiers.length === 0) {
      return res.status(400).json({ error: 'Quote is already single-tier.' });
    }

    // Find the target tier — explicit id or first recommended, else first.
    const chosen = tier_id
      ? spec.tiers.find(t => t.tier_id === tier_id || t.id === tier_id)
      : (spec.tiers.find(t => t.is_recommended) || spec.tiers[0]);
    if (!chosen) return res.status(400).json({ error: 'Target tier not found in spec.' });

    // Build the collapsed single-tier spec.
    const newSpec = {
      ...spec,
      system: { ...(spec.system || {}), ...(chosen.system_overrides || {}) },
      pricing: {
        ...(spec.pricing || {}),
        ...(chosen.pricing || {}),
        stage: 'stage_2_firm',
      },
      cost_overrides: chosen.cost_overrides || spec.cost_overrides || { labour: [], compliance: [], custom: [] },
    };
    // Carry Wattpilot flag through (it lives on system_overrides for tiers)
    if (chosen.system_overrides?.wattpilot_included != null) {
      newSpec.system.wattpilot_included = chosen.system_overrides.wattpilot_included;
    }
    delete newSpec.tiers;
    delete newSpec.tier_strip;
    // Unlock the spec — the chosen tier's pricing.customer_price_inc_gst was
    // a legacy LOCKED-at-list snapshot from the old PATCH /spec writeback. If
    // we let it survive into the single-tier spec, the cost engine would treat
    // it as a locked customer-pays price = full list = discount IGNORED. Force
    // AUTO mode so the approved discount.applied_nzd is honoured by the engine.
    // Rep can re-lock explicitly via the "Lock at this price" button later.
    newSpec.pricing.customer_price_inc_gst = null;

    // Run the engine on the new single-tier spec to capture validator + financial.
    const evaluated = await evaluateSpec(newSpec);
    if (!evaluated.ok) {
      return res.status(400).json({
        error: 'Collapsed spec failed engine validation.',
        config_errors: evaluated.engine.config_errors,
        bom_error: evaluated.engine.bom_error,
        cost_error: evaluated.engine.cost_error,
      });
    }

    // Persist — bump version if current was already generated, else update in place
    // (matches Bug #4 generate-bumped versioning model).
    const alreadyGenerated = !!current.generated_at;
    let resultVersion;
    let nextVersionNum = current.version_number;

    if (alreadyGenerated) {
      nextVersionNum = current.version_number + 1;
      await sb().from('quote_versions')
        .update({ is_current: false, superseded_at: new Date().toISOString() })
        .eq('id', current.id);
      const { data: inserted, error: insErr } = await sb()
        .from('quote_versions').insert({
          quote_id: quote.id,
          version_number: nextVersionNum,
          spec: newSpec,
          validator_output: getEngineeringOutput(evaluated),
          financial_model_output: getFinancialSummary(evaluated),
          is_current: true,
        })
        .select('*').single();
      if (insErr) throw insErr;
      resultVersion = inserted;
      await sb().from('quote_versions')
        .update({ superseded_by_version_id: inserted.id })
        .eq('id', current.id);
    } else {
      const { data: updated, error: upErr } = await sb()
        .from('quote_versions').update({
          spec: newSpec,
          validator_output: getEngineeringOutput(evaluated),
          financial_model_output: getFinancialSummary(evaluated),
          updated_at: new Date().toISOString(),
        }).eq('id', current.id)
        .select('*').single();
      if (upErr) throw upErr;
      resultVersion = updated;
    }

    // Status — convert always lands in draft so the rep can refine the firm
    // offer (adjust labour overrides, pricing nudges, etc.) before generate.
    await sb().from('quotes').update({
      status: 'draft',
      current_version_id: resultVersion.id,
      current_version_number: nextVersionNum,
      stage: 'stage_2_firm',
      updated_at: new Date().toISOString(),
    }).eq('id', quote.id);

    await writeAudit(req, {
      quote_id: quote.id, version_id: resultVersion.id,
      action: 'stage.converted_to_firm',
      before: {
        stage: spec.pricing?.stage,
        tier_count: spec.tiers.length,
        status: quote.status,
        version_number: current.version_number,
      },
      after: {
        stage: 'stage_2_firm',
        chosen_tier_label: chosen.label || null,
        status: 'draft',
        version_number: nextVersionNum,
      },
    });

    res.json({
      ok: true,
      chosen_tier_label: chosen.label || null,
      version: resultVersion,
      version_bumped: alreadyGenerated,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
