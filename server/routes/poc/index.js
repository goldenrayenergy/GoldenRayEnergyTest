// POC router — aggregates all /api/poc/* sub-routes.
//
// This is a proof-of-concept for the new public quote flow (bill upload →
// map confirm → roof geometry → auto-designed 3-tier proposal). Kept
// deliberately separate from /api/bill-analysis and /api/quote so it can
// evolve independently and never touch production traffic paths.

import { Router } from 'express';
import billRoutes from './bill.js';
import roofRoutes, { aerialRouter } from './roof.js';
import placesRoutes from './places.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ ok: true, scope: 'poc' }));

router.use('/bill',   billRoutes);
router.use('/roof',   roofRoutes);
router.use('/aerial', aerialRouter);  // Google Static Maps + LINZ tiles
router.use('/places', placesRoutes);  // Places API (New) autocomplete + details

export default router;
