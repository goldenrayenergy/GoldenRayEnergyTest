// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm namespace index
//
// Mounts all PM-tool routes under a single /api/pm prefix. Phase A only
// contains projects; phases B+ will add proposals, artifacts, payments, etc.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import projectsRoutes from './projects.js';

const router = Router();

router.use('/projects', projectsRoutes);

router.get('/health', (req, res) => res.json({ status: 'ok', tool: 'pm', phase: 'A' }));

export default router;
