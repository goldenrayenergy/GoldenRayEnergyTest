// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm namespace index
//
// Mounts all PM-tool routes under a single /api/pm prefix. Phase A only
// contains projects; phases B+ will add proposals, artifacts, payments, etc.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import projectsRoutes from './projects.js';
import artifactsRoutes from './artifacts.js';
import ownerRoutes from './owner.js';
import adminRoutes from './admin.js';
import adminImportRoutes from './admin-import.js';
import adminCatalogueImportRoutes from './admin-catalogue-import.js';
import polygonOverridesRoutes from './polygon-overrides.js';
import proposalRoutes from './proposals.js';
import qrCodesRoutes from './qr-codes.js';
import quotesRoutes from './quotes.js';
import quoteActionsRoutes from './quote-actions.js';
import designsRoutes from './designs.js';
import contactsLookupRoutes from './contacts.js';
import catalogueRoutes from './catalogue.js';
import proposalEngineRoutes from './proposal-engine.js';
import errorReportsRoutes from './error-reports.js';

const router = Router();

router.use('/projects', projectsRoutes);

// Artifacts sit under each project: /api/pm/projects/:id/artifacts/...
// Mounted as a separate router with mergeParams so :id is visible.
router.use('/projects/:id/artifacts', artifactsRoutes);

// Proposal PDF generator (B-2): GET /api/pm/projects/:id/proposal-pdf?stage=1|2
router.use('/projects', proposalRoutes);

// Owner Dashboard — single endpoint returning all 7 zones
router.use('/owner', ownerRoutes);

// Admin config — company_settings, financing_options, proposal_terms
router.use('/admin', adminRoutes);
router.use('/admin/polygon-overrides', polygonOverridesRoutes);
// Admin data import — supplier setup workbook (writes suppliers/products/
// compatibility/region_defaults/cost_defaults from a single xlsx upload).
router.use('/admin', adminImportRoutes);

// P8 — Catalogue CSV import (labour + compliance rate-cards).
// POST /api/pm/admin/catalogue/import/{labour|compliance}, GET /imports, /template/:kind
router.use('/admin/catalogue', adminCatalogueImportRoutes);

// QR-code campaign management — list / create / patch + PNG/SVG downloads
router.use('/admin/qr-codes', qrCodesRoutes);

// MVP1_001 proposal generator — quotes CRUD + discount workflow.
// /api/pm/quotes — create / list / get / patch-spec / validate / discount
router.use('/quotes', quotesRoutes);

// Contact-scoped lookups for the quotes form (Day 7 — Path A bill prefill).
router.use('/contacts', contactsLookupRoutes);

// MVP1_002 lifecycle actions — generate / email / sign / counter-sign /
// deposit / audit-log / pdf download. Sits on the SAME /quotes prefix; Express
// merges the two routers, with CRUD routes from quotesRoutes resolved first.
router.use('/quotes', quoteActionsRoutes);

// Phase 3a (design tool) — GET/PUT /api/pm/quotes/:id/design. Sits on the same
// /quotes prefix as quotesRoutes + quoteActionsRoutes; Express merges.
router.use('/quotes', designsRoutes);

// MVP1_003 — products catalogue dropdown options (panels / inverters / batteries /
// BMS / smart meters / EV chargers) from live products table with field aliasing.
router.use('/catalogue', catalogueRoutes);

// Option 2 — engine-side recommendations (string layout etc.) reading the live
// catalogue with current mppt_v_min / Voc / Vmp values.
router.use('/proposal-engine', proposalEngineRoutes);

// "Report it" backend — store/dedup error reports + dashboard list + resolve.
router.use('/error-reports', errorReportsRoutes);

router.get('/health', (req, res) => res.json({ status: 'ok', tool: 'pm', phase: 'A.4' }));

export default router;
