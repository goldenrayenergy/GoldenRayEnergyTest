// POC router — aggregates all /api/poc/* sub-routes.
//
// This is a proof-of-concept for the new public quote flow (bill upload →
// map confirm → roof geometry → auto-designed 3-tier proposal). Kept
// deliberately separate from /api/bill-analysis and /api/quote so it can
// evolve independently and never touch production traffic paths.

import { Router } from 'express';
import billRoutes from './bill.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ ok: true, scope: 'poc' }));

router.use('/bill', billRoutes);

export default router;
