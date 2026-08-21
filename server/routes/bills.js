// POC bill-extraction route.
//
// Standalone from /api/bill-analysis: no DB writes, no side effects (no
// enquiries created, no emails sent, no tasks raised). Just runs the same
// regex parser and returns the extracted fields for the POC UI to render.
//
// Mounted at POST /api/poc/bill/extract (see routes/poc/index.js).

import { Router } from 'express';
import multer from 'multer';
import { parseBillPdf } from '../services/billOcrService.js';

const router = Router();

// In-memory single-file upload, 10 MB cap (bigger than any NZ retailer bill).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

router.post('/extract', upload.single('bill'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Attach a PDF as "bill".' });
    }
    if (!req.file.mimetype?.includes('pdf')) {
      return res.status(400).json({
        error: `POC only accepts text-PDF bills. Got: ${req.file.mimetype}. Image / photo bills need the LLM+vision path which is out of scope for the POC.`,
      });
    }

    const parsed = await parseBillPdf(req.file.buffer, { fileName: req.file.originalname });

    // Project down to the fields the POC UI needs — full parser output is
    // ~50 fields and contains debugging cruft (raw_extracted_fields etc.).
    return res.json({
      file: {
        name: req.file.originalname,
        size_bytes: req.file.size,
      },
      retailer:       parsed.retailer || null,
      plan_name:      parsed.plan_name || null,
      period_start:   parsed.period_start || null,
      period_end:     parsed.period_end || null,
      days_in_period: parsed.days_in_period || null,

      account_holder:   parsed.account_holder || null,
      service_address:  parsed.service_address || null,
      service_postcode: parsed.service_postcode || null,
      icp_number:       parsed.icp_number || null,

      kwh_total:     parsed.kwh_total ?? null,
      kwh_peak:      parsed.kwh_peak ?? null,
      kwh_off_peak:  parsed.kwh_off_peak ?? null,
      kwh_exported:  parsed.kwh_exported ?? null,

      fixed_charge_nzd:    parsed.fixed_charge_nzd ?? null,
      variable_charge_nzd: parsed.variable_charge_nzd ?? null,
      export_credit_nzd:   parsed.export_credit_nzd ?? null,
      gst_nzd:             parsed.gst_nzd ?? null,
      total_nzd:           parsed.total_nzd ?? null,

      tariff_components: parsed.tariff_components || null,

      ocr_confidence:   parsed.ocr_confidence ?? 0,
      field_confidence: parsed.field_confidence || {},
      parse_method:     parsed.parse_method,
      parse_errors:     parsed.parse_errors || [],
      parse_warnings:   parsed.parse_warnings || [],
    });
  } catch (e) {
    console.error('[poc/bill] extract failed:', e);
    return res.status(500).json({ error: e.message || 'Bill extraction failed.' });
  }
});

export default router;
