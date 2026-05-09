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

const router = Router();

router.use('/projects', projectsRoutes);

// Artifacts sit under each project: /api/pm/projects/:id/artifacts/...
// Mounted as a separate router with mergeParams so :id is visible.
router.use('/projects/:id/artifacts', artifactsRoutes);

// Owner Dashboard — single endpoint returning all 7 zones
router.use('/owner', ownerRoutes);

router.get('/health', (req, res) => res.json({ status: 'ok', tool: 'pm', phase: 'A.3' }));

export default router;
