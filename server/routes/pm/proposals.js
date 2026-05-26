// ────────────────────────────────────────────────────────────────────────────
// PM Tool — proposal PDF endpoint (Phase B-2).
//
// GET /api/pm/projects/:id/proposal-pdf?stage=1|2
//   Returns a Goldenray-branded PDF proposal for the project. Reuses the
//   existing pm/proposalService which already knows how to:
//     1. Pull project + linked bill_analysis + admin settings + financing + T&Cs
//     2. Build the HTML proposal (Stage 1 = preliminary, Stage 2 = post-site-visit)
//     3. Render to PDF via Puppeteer
//
//   stage=1 (default) — preliminary proposal — pre-site-visit, system + cost ranges
//   stage=2           — final proposal — post-site-visit, locked spec + price
//
//   Returns the PDF inline (no DB write yet). A follow-up phase can persist
//   the buffer to Supabase Storage + capture a public URL for the magic-link
//   viewer.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';
import {
  getProposalInputs,
  buildStage1ProposalHTML,
  buildStage2ProposalHTML,
  renderProposalPDF,
} from '../../services/pm/proposalService.js';

const router = Router();
router.use(authenticate);

router.get('/:id/proposal-pdf', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const projectId = req.params.id;
    const stage     = req.query.stage === '2' ? 2 : 1;

    // 1. Gather inputs (project, bill, settings, financing, terms)
    const inputs = await getProposalInputs(projectId, stage);
    if (!inputs?.project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    // 2. Build HTML for the requested stage
    const html = stage === 2
      ? buildStage2ProposalHTML(inputs)
      : buildStage1ProposalHTML(inputs);

    // 3. Render to PDF buffer via Puppeteer
    const pdf = await renderProposalPDF(html);

    // 4. Stream back as a download
    const code  = inputs.project.code || projectId.slice(0, 8);
    const name  = (inputs.project.contacts?.name || 'customer').replace(/\s+/g, '-');
    const file  = `Goldenray-Proposal-${code}-Stage${stage}-${name}.pdf`;
    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Length',      pdf.length);
    res.send(pdf);
  } catch (e) {
    console.error('PM proposal PDF generation failed:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
