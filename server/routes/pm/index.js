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
import proposalRoutes from './proposals.js';
import qrCodesRoutes from './qr-codes.js';

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
// Admin data import — supplier setup workbook (writes suppliers/products/
// compatibility/region_defaults/cost_defaults from a single xlsx upload).
router.use('/admin', adminImportRoutes);

// QR-code campaign management — list / create / patch + PNG/SVG downloads
router.use('/admin/qr-codes', qrCodesRoutes);

router.get('/health', (req, res) => res.json({ status: 'ok', tool: 'pm', phase: 'A.4' }));

export default router;
