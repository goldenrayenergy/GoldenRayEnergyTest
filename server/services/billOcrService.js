// Power-bill OCR + parsing for the bill-analysis feature.
//
// Strategy:
//   1. Extract text from PDF via pdf-parse (most NZ retailer bills are
//      text-PDFs, not scanned images — we get clean text directly).
//   2. Detect which retailer issued the bill from text fingerprints.
//   3. Route to a retailer-specific parser. Each parser is a small
//      object with match() + parse() and lives in RETAILERS below.
//   4. If no retailer matches, fall back to generic parser that pulls
//      what it can with permissive regex.
//
// Output shape (matches bill_uploads schema):
//   {
//     retailer, plan_name,
//     period_start, period_end, days_in_period,
//     kwh_total, kwh_peak, kwh_off_peak, kwh_exported,
//     fixed_charge_nzd, variable_charge_nzd,
//     export_credit_nzd, gst_nzd, total_nzd,
//     ocr_confidence,                    // 0.0–1.0
//     ocr_text_excerpt,                  // first 4000 chars for debugging
//     parse_errors: [{ field, reason }]  // warnings, not fatal errors
//   }

import { PDFParse } from 'pdf-parse';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ OCR FALLBACK — currently OFF by default                              ║
// ║                                                                      ║
// ║ Why: pdf-parse bundles pdfjs-dist@5.4.296 (latest available release  ║
// ║      of pdf-parse, 2.4.5). pdf-to-png-converter bundles 5.7.284.     ║
// ║      Both set GlobalWorkerOptions when loaded — once pdf-parse has   ║
// ║      run, the worker URL is pinned to 5.4.296 and any subsequent    ║
// ║      pdf-to-png-converter call throws:                               ║
// ║        "API version 5.7.284 does not match Worker version 5.4.296"   ║
// ║                                                                      ║
// ║ This is a structural lib-vs-lib conflict, not solvable with options. ║
// ║                                                                      ║
// ║ Unblock paths (each ~half-day):                                      ║
// ║   (a) wait for pdf-parse to upgrade to pdfjs 5.7.x                   ║
// ║   (b) replace pdf-parse with a 5.7-compatible text-extractor         ║
// ║   (c) shell out to Poppler `pdftoppm` + Tesseract CLI                ║
// ║   (d) use cloud OCR (AWS Textract / Google Document AI)              ║
// ║                                                                      ║
// ║ Set env var `OCR_ENABLED=true` to try the in-process path anyway     ║
// ║ once you've taken one of the above mitigations.                      ║
// ║                                                                      ║
// ║ User-facing fallback when OCR is off: the wizard automatically       ║
// ║ surfaces the manual-entry table (Door D) — customers paste from      ║
// ║ their spreadsheet, ROI runs cleanly.                                 ║
// ║                                                                      ║
// ║ Local patch note: if pdf-to-png-converter is reinstalled, re-apply   ║
// ║ the Windows-path fix at node_modules/pdf-to-png-converter/out/       ║
// ║ normalizePath.js (replace platform sep with `/`).                    ║
// ╚══════════════════════════════════════════════════════════════════════╝
const OCR_ENABLED = process.env.OCR_ENABLED === 'true';

let _pdfToPng = null;
let _tesseract = null;
async function _loadOcr() {
  if (!_pdfToPng)  _pdfToPng  = (await import('pdf-to-png-converter')).pdfToPng;
  if (!_tesseract) _tesseract = await import('tesseract.js');
  return { pdfToPng: _pdfToPng, tesseract: _tesseract };
}

// Heuristic: when the text-layer extraction returns less than this many chars
// of usable text, assume the PDF is image-only.
const TEXT_FALLBACK_THRESHOLD = 600;

// Cap pages per PDF to keep latency bounded. Most NZ retailer bills are
// 1-3 pages; the meaningful data is on page 2.
const MAX_OCR_PAGES = 4;

// ── Public entry point: image OCR (for camera-captured bill photos) ──────
//
// Mobile camera capture flow: customer snaps a photo of their bill, we OCR
// the image directly with Tesseract.js, then feed the extracted text into
// the same retailer-detection + parsing pipeline as PDF bills.
//
// NOTE: this path does NOT trigger the pdfjs version conflict that disables
// the pdf-to-png OCR fallback — we feed raw image bytes straight to Tesseract,
// no pdfjs involvement. So image OCR works regardless of OCR_ENABLED.
export async function parseBillImage(buffer, { fileName, mimeType } = {}) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty image buffer');
  }

  // Sanity-check the bytes actually look like an image before invoking Tesseract.
  // Tesseract throws an UNCATCHABLE worker-thread error if you feed it a PDF
  // (or other non-image bytes), which crashes the Node process on Windows.
  // Cheap guard: check magic bytes for the formats we accept.
  const isImage = (
    (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF)            ||  // JPEG
    (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) || // PNG
    (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) || // RIFF/WebP
    (buffer.slice(4, 12).toString() === 'ftypheic' || buffer.slice(4, 12).toString() === 'ftypheix')   // HEIC
  );
  if (!isImage) {
    return makeEmptyBill({
      ocr_text_excerpt: '',
      ocr_confidence:   0,
      parse_method:     'failed',
      parse_errors:     [{ field: 'all', reason: `File does not appear to be an image (magic bytes: ${buffer.slice(0, 4).toString('hex')}). Only JPEG/PNG/WebP/HEIC are supported.` }],
      file_name:        fileName || null,
      file_size_bytes:  buffer.length,
    });
  }

  // Run Tesseract on the image bytes directly
  let text = '';
  let tessConfidence = 0;
  try {
    const tesseract = await import('tesseract.js');
    const worker = await tesseract.createWorker('eng', undefined, { logger: () => {} });
    try {
      const { data } = await worker.recognize(buffer);
      text = data.text || '';
      tessConfidence = (data.confidence || 0) / 100;   // tesseract reports 0-100
    } finally {
      await worker.terminate();
    }
  } catch (e) {
    return makeEmptyBill({
      ocr_text_excerpt: '',
      ocr_confidence:   0,
      parse_method:     'failed',
      parse_errors:     [{ field: 'all', reason: `Image OCR failed: ${e.message}` }],
      file_name:        fileName || null,
      file_size_bytes:  buffer.length,
    });
  }

  if (!text.trim()) {
    return makeEmptyBill({
      ocr_text_excerpt: '',
      ocr_confidence:   0,
      parse_method:     'failed',
      parse_errors:     [{ field: 'all', reason: 'Image OCR returned no text. Photo may be blurry, low-resolution, or poorly lit.' }],
      file_name:        fileName || null,
      file_size_bytes:  buffer.length,
    });
  }

  // Re-use the same retailer detection + parsing as PDFs
  const retailer = RETAILERS.find(r => r.match(text)) || GENERIC;
  let parsed;
  try {
    parsed = retailer.parse(text);
  } catch (e) {
    parsed = { parse_errors: [{ field: 'all', reason: `Parser threw: ${e.message}` }] };
  }

  // Cross-retailer extraction + validators — same path as parseBillPdf
  const enriched = enrichWithCrossRetailerFields(parsed, text);
  const parse_warnings = runCrossFieldValidators(enriched);

  // Lower-bound confidence by Tesseract's own confidence so the review gate
  // catches blurry/dark photos. A "100% complete" parse from a 30%-confidence
  // OCR is still suspect.
  const completenessConf = estimateConfidence(enriched);
  const combinedConfidence = Math.min(completenessConf, tessConfidence);

  return {
    ...makeEmptyBill(),
    ...enriched,
    retailer:            enriched.retailer || retailer.name,
    ocr_text_excerpt:    text.slice(0, 4000),
    ocr_text_full:       text,
    ocr_confidence:      +combinedConfidence.toFixed(3),
    field_confidence:    computeFieldConfidence(enriched),
    parse_method:        'image_ocr',
    parse_errors:        enriched.parse_errors || [],
    parse_warnings,
    parse_suspect:       parse_warnings.some(w => w.suspect === true),
    raw_extracted_fields: {
      ...(enriched.raw_extracted_fields || {}),
      _tesseract_confidence: +tessConfidence.toFixed(3),
      _mime_type:            mimeType || null,
    },
    file_name:           fileName || null,
    file_size_bytes:     buffer.length,
  };
}

// ── Public entry point ────────────────────────────────────────────────────

export async function parseBillPdf(buffer, { fileName } = {}) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty PDF buffer');
  }

  // ── Stage 1: text-layer extraction (fast path — works for true-text PDFs) ──
  let text;
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    text = result.text || '';
  } catch (e) {
    text = '';
  }

  let parseMethod = 'text';

  // ── Stage 2: OCR fallback for image-only PDFs ──
  // Triggered when (a) text layer is empty/sparse OR (b) text exists but
  // can't even identify the retailer (suggests it's just headers + footers
  // while the body is image data). Gated behind OCR_ENABLED env var — see
  // the big comment block at the top of this file for the why.
  const trimmed = text.trim();
  const needsOcr = trimmed.length < TEXT_FALLBACK_THRESHOLD
                || !RETAILERS.some(r => r.match(trimmed));

  if (needsOcr && OCR_ENABLED) {
    try {
      const ocrText = await _ocrFallback(buffer);
      if (ocrText.length > trimmed.length * 1.5 && ocrText.length > 400) {
        text = ocrText;
        parseMethod = 'ocr';
      }
    } catch (e) {
      // OCR is best-effort — don't crash if it fails, fall back to whatever
      // text-layer extraction managed. The wizard surfaces the manual-entry
      // table when the resulting confidence is low.
      console.warn(`OCR fallback failed for ${fileName || 'PDF'}: ${e.message}`);
    }
  }

  if (!text.trim()) {
    return makeEmptyBill({
      ocr_text_excerpt: '',
      ocr_confidence:   0,
      parse_method:     'failed',
      parse_errors:     [{ field: 'all', reason: 'No text could be extracted (PDF may be empty, corrupted, or fully image-based at low resolution).' }],
      file_name:        fileName || null,
      file_size_bytes:  buffer.length,
    });
  }

  // ── Stage 3: retailer detection + per-retailer parsing ──
  const retailer = RETAILERS.find(r => r.match(text)) || GENERIC;

  let parsed;
  try {
    parsed = retailer.parse(text);
  } catch (e) {
    parsed = { parse_errors: [{ field: 'all', reason: `Parser threw: ${e.message}` }] };
  }

  // ── Stage 4: cross-retailer field extraction + cross-field validators ──
  // Same logic runs from parseBillText() and parseBillImage() — extracted to
  // shared helpers so the validator gate fires regardless of upload format.
  const enriched = enrichWithCrossRetailerFields(parsed, text);
  const parse_warnings = runCrossFieldValidators(enriched);

  return {
    ...makeEmptyBill(),
    ...enriched,
    retailer:            enriched.retailer || retailer.name,
    ocr_text_excerpt:    text.slice(0, 4000),
    ocr_text_full:       text,                       // promoted in migration 025
    ocr_confidence:      estimateConfidence(enriched),
    field_confidence:    computeFieldConfidence(enriched),
    parse_method:        parseMethod,                // 'text' | 'ocr'
    parse_errors:        enriched.parse_errors || [],
    parse_warnings,
    parse_suspect:       parse_warnings.some(w => w.suspect === true),
    raw_extracted_fields: enriched.raw_extracted_fields || {},
    file_name:           fileName || null,
    file_size_bytes:     buffer.length,
  };
}

// ── OCR helper — render PDF pages to PNG, run Tesseract, concat text ──────
async function _ocrFallback(buffer) {
  const { pdfToPng, tesseract } = await _loadOcr();

  // 1. Render pages to in-memory PNG buffers. viewportScale 2 (~144 DPI) is
  //    the standard accuracy/speed sweet spot for typed-text bills.
  const pngPages = await pdfToPng(buffer, {
    viewportScale:   2.0,
    disableFontFace: false,
    useSystemFonts:  false,
    enableXfa:       false,
    outputFolder:    undefined,
    pagesToProcess:  Array.from({ length: MAX_OCR_PAGES }, (_, i) => i + 1),
  });

  if (!pngPages?.length) return '';

  // 2. OCR each page through one shared Tesseract worker — saves the ~1.5s
  //    English-model warmup per page.
  const worker = await tesseract.createWorker('eng', undefined, { logger: () => {} });
  const parts = [];
  try {
    for (const page of pngPages) {
      const { data } = await worker.recognize(page.content);
      parts.push(data.text);
    }
  } finally {
    await worker.terminate();
  }
  return parts.join('\n\n--- page break ---\n\n');
}

// ── Confidence heuristic — how complete is the parsed result? ─────────────

function estimateConfidence(p) {
  const required = ['period_start', 'period_end', 'kwh_total', 'total_nzd'];
  const optional = ['fixed_charge_nzd', 'variable_charge_nzd', 'gst_nzd', 'plan_name'];
  let score = 0;
  let max = 0;
  for (const f of required) { max += 0.20; if (p[f] != null) score += 0.20; }
  for (const f of optional) { max += 0.05; if (p[f] != null) score += 0.05; }
  // Penalty per parse_error
  const errorPenalty = (p.parse_errors || []).length * 0.05;
  return Math.max(0, Math.min(1, +(score - errorPenalty).toFixed(3)));
}

function makeEmptyBill(overrides = {}) {
  return {
    retailer: null,
    plan_name: null,
    period_start: null,
    period_end: null,
    days_in_period: null,
    kwh_total: null,
    kwh_peak: null,
    kwh_off_peak: null,
    kwh_exported: null,
    fixed_charge_nzd: null,
    variable_charge_nzd: null,
    export_credit_nzd: null,
    gst_nzd: null,
    total_nzd: null,
    annual_kwh_rolling: null,
    // ── v2 (migration 025) fields ──
    service_address: null,
    service_postcode: null,           // 4-digit NZ postcode (drives region resolution)
    icp_number: null,                 // NZ Installation Control Point
    network_distributor: null,        // Vector / Counties / Powerco / etc.
    tariff_components: [],            // per-rate breakdown if TOU/free-hours plan
    payment_date: null,
    due_date: null,
    raw_extracted_fields: {},         // catch-all for fields no current consumer asks for
    ocr_text_full: '',                // full text — supersedes ocr_text_excerpt for new code
    field_confidence: {},             // per-field 0.0-1.0 confidence
    parse_method: null,               // 'text' | 'ocr' | 'failed'
    bill_type: 'single_rate',         // single_rate | multi_rate | tou | free_hours | dual_fuel
    rate_rows: { fixed: 0, variable: 0 },  // # of rate-rows found per category
    // ── existing fields kept for back-compat ──
    ocr_confidence: 0,
    ocr_text_excerpt: '',
    parse_errors: [],
    parse_warnings: [],
    parse_suspect: false,
    ...overrides,
  };
}

// ── Shared parsing helpers ────────────────────────────────────────────────

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };

// Parse date from various NZ-common formats: "1 Jul 2025", "01/07/2025", "2025-07-01"
function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  // ISO YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // "1 Jul 2025" or "1st July 2025"
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const day = String(parseInt(m[1])).padStart(2, '0');
    const month = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, '0')}-${day}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (m) return `${m[3]}-${String(parseInt(m[2])).padStart(2, '0')}-${String(parseInt(m[1])).padStart(2, '0')}`;
  return null;
}

function pickFirst(text, regexes) {
  for (const re of regexes) {
    const m = text.match(re);
    if (m) return m;
  }
  return null;
}

function parseNum(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

function daysBetween(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr + 'T00:00:00Z');
  const end   = new Date(endStr   + 'T00:00:00Z');
  if (isNaN(start) || isNaN(end)) return null;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

// ── Cross-retailer extractors (v2 — migration 025) ────────────────────────
//
// These run on the raw text after the retailer-specific parser, so they
// populate fields the retailer parsers don't extract today (address, ICP,
// distributor). They're conservative: extract only if a high-confidence
// pattern matches, else leave null.

// NZ ICP format: 10-15 alphanumeric chars, sometimes with hyphens.
// Reference: Electricity Authority ICP standard.
function extractICP(text) {
  if (!text) return null;
  const m = text.match(/\b(?:ICP(?:\s+Number|\s+No\.?|\s*#)?[\s:]*|installation\s+control\s+point[\s:]*)([0-9A-Z]{7,15}(?:-?[0-9A-Z]{1,3})?)/i);
  if (m) return m[1].toUpperCase();
  // Fallback: a standalone 10-13 digit string near an "ICP" keyword on the same line
  const m2 = text.match(/ICP[^\n]{0,40}?([0-9]{10,13})/i);
  if (m2) return m2[1];
  return null;
}

// Extract service / supply address. Look for labelled sections first, then
// fall back to "X Street, Suburb, City PostCode" pattern near the top.
function extractServiceAddress(text) {
  if (!text) return null;
  // Labelled sections — covers most retailers' explicit "Service address:" labels
  const labelled = text.match(
    /(?:Service|Supply|Site|Premises?|Property|Connection)\s+address[\s:]+\s*([^\n]{8,200})/i
  );
  if (labelled) return labelled[1].trim().replace(/\s+/g, ' ').slice(0, 300);
  // Pulse Energy format: "Detailed invoice for: 356 UPPER QUEEN STREET, PUKEKOHE"
  const pulseStyle = text.match(/Detailed\s+invoice\s+for[\s:]+\s*([^\n]{8,200})/i);
  if (pulseStyle) return pulseStyle[1].trim().replace(/\s+/g, ' ').slice(0, 300);
  // Mercury / Contact / Genesis sometimes use "for the period ... at <address>"
  const periodAtStyle = text.match(/for\s+the\s+period[\s\S]{0,80}?at[\s:]+\s*([^\n]{8,200})/i);
  if (periodAtStyle) return periodAtStyle[1].trim().replace(/\s+/g, ' ').slice(0, 300);
  // Fallback: a line that looks like a NZ postal address (ends with 4-digit postcode)
  const generic = text.match(/^([0-9A-Za-z\/].{8,150}?,\s*[A-Za-z][A-Za-z\s]+(?:,\s*[A-Za-z][A-Za-z\s]+)?\s+\d{4})\s*$/m);
  if (generic) return generic[1].trim().replace(/\s+/g, ' ').slice(0, 300);
  // Last-ditch: a free-standing line of the form "<NUMBER> <STREETNAME>, <SUBURB> <POSTCODE>"
  // (Pulse mailing address style — no comma between street and suburb)
  const looseNz = text.match(/^(\d+[A-Za-z]?\/?\d*\s+[A-Z][A-Z\s']+\s+(?:ROAD|RD|STREET|ST|AVENUE|AVE|DRIVE|DR|LANE|LN|PLACE|PL|COURT|CT|HIGHWAY|HWY|TERRACE|TER|CRESCENT|CRES|WAY|CLOSE)[\s,]+[A-Z][A-Z\s']+\s+\d{4})$/im);
  if (looseNz) return looseNz[1].trim().replace(/\s+/g, ' ').slice(0, 300);
  return null;
}

// NZ postcodes are 4-digit. Pull from the address if present.
function extractPostcode(address) {
  if (!address) return null;
  const m = String(address).match(/\b(\d{4})\b(?!\d)/);
  return m ? m[1] : null;
}

// Network distributor — usually printed on the bill as the lines-company name.
// EA-registered EDBs in NZ that customers actually see on bills:
const DISTRIBUTORS = [
  { name: 'Vector',          regex: /\bvector\b/i },
  // Counties Energy (rebranded 2018 from Counties Power); Pulse + some retailers
  // still print the old name in plan titles. Match both → canonical "Counties Energy".
  { name: 'Counties Energy', regex: /\bcounties\s+(?:energy|power)\b/i },
  { name: 'Northpower',      regex: /\bnorthpower\b/i },
  { name: 'WEL Networks',    regex: /\bwel\s+networks\b/i },
  { name: 'Powerco',         regex: /\bpowerco\b/i },
  { name: 'Wellington Electricity', regex: /\bwellington\s+electricity\b/i },
  { name: 'Unison',          regex: /\bunison\b/i },
  { name: 'Aurora Energy',   regex: /\baurora\s+energy\b/i },
  { name: 'Orion',           regex: /\borion\b.*\bnetwork/i },
  { name: 'Top Energy',      regex: /\btop\s+energy\b/i },
  { name: 'Network Tasman',  regex: /\bnetwork\s+tasman\b/i },
  { name: 'Buller Electricity', regex: /\bbuller\s+electricity\b/i },
  { name: 'EA Networks',     regex: /\bea\s+networks\b/i },
  { name: 'MainPower',       regex: /\bmainpower\b/i },
  { name: 'Marlborough Lines', regex: /\bmarlborough\s+lines\b/i },
  { name: 'Nelson Electricity', regex: /\bnelson\s+electricity\b/i },
  { name: 'Network Waitaki', regex: /\bnetwork\s+waitaki\b/i },
  { name: 'OtagoNet',        regex: /\botagonet\b/i },
  { name: 'PowerNet',        regex: /\bpowernet\b/i },
  { name: 'The Lines Company', regex: /\bthe\s+lines\s+company\b/i },
  { name: 'Westpower',       regex: /\bwestpower\b/i },
];
function extractDistributor(text) {
  if (!text) return null;
  for (const d of DISTRIBUTORS) {
    if (d.regex.test(text)) return d.name;
  }
  return null;
}

// ── Per-field confidence (rule 3.15, 13.1) ────────────────────────────────
//
// Each field gets a 0.0-1.0 confidence based on:
//   - Whether the value is present (null → 0)
//   - Whether the source pattern was high-precision (labelled) vs heuristic
//   - Whether the value passed sanity bounds
//
// We don't have per-field provenance in the existing parsers (they just
// regex + assign), so this is a coarse approximation. Future work: parsers
// could return { value, source, confidence } per field. For now, infer from
// presence + value reasonableness.

function fieldConfidenceFor(field, value, parsed) {
  if (value == null || value === '') return 0;

  // Field-specific sanity bounds. Values that fall inside the realistic NZ
  // residential range get 1.0; values outside get 0.5 (present but suspect).
  switch (field) {
    case 'period_start':
    case 'period_end': {
      // Must be a valid ISO date in the last 30 years
      const d = new Date(value + 'T00:00:00Z');
      if (isNaN(d)) return 0;
      const ageDays = (Date.now() - d.getTime()) / 86400000;
      return ageDays >= 0 && ageDays <= 365 * 30 ? 1.0 : 0.4;
    }
    case 'days_in_period':
      return value > 0 && value <= 95 ? 1.0 : 0.4;
    case 'kwh_total':
      return value >= 0 && value <= 20000 ? 1.0 : 0.4;
    case 'total_nzd':
      return value >= 0 && value <= 50000 ? 1.0 : 0.4;
    case 'gst_nzd': {
      const preTax = (parsed.fixed_charge_nzd || 0) + (parsed.variable_charge_nzd || 0);
      if (preTax > 0 && value > 0) {
        const expected = preTax * 0.15;
        const drift = Math.abs(value - expected) / preTax;
        return drift < 0.01 ? 1.0 : drift < 0.03 ? 0.7 : 0.3;
      }
      return value > 0 ? 0.7 : 0;
    }
    case 'fixed_charge_nzd':
    case 'variable_charge_nzd':
      return value >= 0 && value <= 5000 ? 1.0 : 0.4;
    case 'icp_number':
      return /^[0-9A-Z]{10,15}(-[0-9A-Z]{1,3})?$/.test(String(value)) ? 1.0 : 0.5;
    case 'service_postcode':
      return /^\d{4}$/.test(String(value)) ? 1.0 : 0.3;
    case 'service_address':
      return String(value).length >= 8 && /\d/.test(String(value)) ? 0.8 : 0.4;
    case 'network_distributor':
      return DISTRIBUTORS.some(d => d.name === value) ? 1.0 : 0.5;
    case 'retailer':
    case 'plan_name':
      return 1.0;
    default:
      return value != null ? 0.7 : 0;
  }
}

function computeFieldConfidence(parsed) {
  const fields = [
    'retailer', 'plan_name',
    'period_start', 'period_end', 'days_in_period',
    'kwh_total', 'kwh_peak', 'kwh_off_peak', 'kwh_exported',
    'fixed_charge_nzd', 'variable_charge_nzd', 'export_credit_nzd', 'gst_nzd', 'total_nzd',
    'service_address', 'service_postcode', 'icp_number', 'network_distributor',
  ];
  const out = {};
  for (const f of fields) {
    out[f] = +fieldConfidenceFor(f, parsed[f], parsed).toFixed(3);
  }
  return out;
}

// ── Shared cross-field validators (v2 — was inline in parseBillText, now ──
// shared so parseBillPdf + parseBillImage also run them). Returns an array
// of `{field, code, reason, suspect}`. Suspect:true entries trip the review
// gate in billAnalysisService.computeReviewGate.
function runCrossFieldValidators(parsed) {
  const parse_warnings = [];

  // (1) kWh-vs-total: kWh × 25¢/kWh blended should be ≥ 30% of bill total
  if (parsed.kwh_total != null && parsed.total_nzd != null && parsed.total_nzd > 0) {
    const impliedSpendFromKwh = parsed.kwh_total * 0.25;
    const ratio = impliedSpendFromKwh / parsed.total_nzd;
    if (ratio < 0.30) {
      parse_warnings.push({
        field: 'kwh_total',
        code:  'kwh_low_vs_total',
        reason: `kWh (${parsed.kwh_total}) looks low vs total ($${parsed.total_nzd}). At ~25¢/kWh blended this would be ~$${impliedSpendFromKwh.toFixed(0)} — only ${(ratio*100).toFixed(0)}% of the bill. Likely a multi-rate row was missed.`,
        suspect: true,
      });
    }
  }

  // (2) Extrapolation-vs-rolling: bill's own annual total vs our extrapolation
  if (parsed.kwh_total && parsed.annual_kwh_rolling && parsed.days_in_period) {
    const extrapolated = parsed.kwh_total * (365 / parsed.days_in_period);
    if (extrapolated > parsed.annual_kwh_rolling * 1.8) {
      parse_warnings.push({
        field: 'kwh_total',
        code:  'kwh_double_count_suspect',
        reason: `kWh extrapolated to ~${Math.round(extrapolated)}/yr but bill says rolling 365 days = ${parsed.annual_kwh_rolling}. Possible double-count.`,
        suspect: true,
      });
    }
  }

  // (3) Line items must sum to total within $1 (rules 4.5, 4.6, 4.10)
  if (parsed.total_nzd != null) {
    const fixed = parsed.fixed_charge_nzd    || 0;
    const variable = parsed.variable_charge_nzd || 0;
    const gst = parsed.gst_nzd               || 0;
    const exportCred = parsed.export_credit_nzd || 0;
    const sumInclGst = fixed + variable + gst - exportCred;
    const sumExclGst = fixed + variable        - exportCred;
    const driftA = Math.abs(sumInclGst - parsed.total_nzd);
    const driftB = Math.abs(sumExclGst - parsed.total_nzd);
    if (driftA > 1 && driftB > 1 && (fixed > 0 || variable > 0)) {
      parse_warnings.push({
        field: 'total_nzd',
        code:  'line_items_dont_sum',
        reason: `Line items don't sum to total. Fixed $${fixed.toFixed(2)} + Variable $${variable.toFixed(2)} ${gst ? `+ GST $${gst.toFixed(2)} ` : ''}${exportCred ? `− Export $${exportCred.toFixed(2)} ` : ''}= $${sumInclGst.toFixed(2)}, but bill total is $${parsed.total_nzd.toFixed(2)} (drift $${driftA.toFixed(2)}).`,
        suspect: true,
      });
    }
  }

  // (4) GST must be ~15% of pre-tax subtotal (rule 4.6)
  if (parsed.gst_nzd != null && parsed.gst_nzd > 0) {
    const preTax = (parsed.fixed_charge_nzd || 0) + (parsed.variable_charge_nzd || 0);
    if (preTax > 0) {
      const expected = preTax * 0.15;
      const drift = Math.abs(parsed.gst_nzd - expected);
      const tol = Math.max(0.5, preTax * 0.01);
      if (drift > tol) {
        parse_warnings.push({
          field: 'gst_nzd',
          code:  'gst_not_15pct',
          reason: `GST $${parsed.gst_nzd.toFixed(2)} ≠ 15% of pre-tax $${preTax.toFixed(2)} (expected ~$${expected.toFixed(2)}, drift $${drift.toFixed(2)}). Parser may be missing a variable-charge component.`,
          suspect: true,
        });
      }
    }
  }

  // (5) Billing dates: end > start, stated days match computed days (rules 4.2, 4.3)
  if (parsed.period_start && parsed.period_end) {
    const start = new Date(parsed.period_start + 'T00:00:00Z');
    const end   = new Date(parsed.period_end   + 'T00:00:00Z');
    if (!isNaN(start) && !isNaN(end)) {
      if (end <= start) {
        parse_warnings.push({
          field: 'period_end',
          code:  'end_before_start',
          reason: `Billing end ${parsed.period_end} is not after start ${parsed.period_start}.`,
          suspect: true,
        });
      }
      if (parsed.days_in_period) {
        const computed = Math.round((end - start) / 86400000) + 1;
        if (Math.abs(computed - parsed.days_in_period) > 1) {
          parse_warnings.push({
            field: 'days_in_period',
            code:  'days_mismatch',
            reason: `Stated days_in_period=${parsed.days_in_period} but ${parsed.period_start} → ${parsed.period_end} = ${computed} days.`,
            suspect: true,
          });
        }
      }
    }
  }

  // (6) Non-negative invariants (rules 4.4, 4.5)
  for (const [field, value] of Object.entries({
    kwh_total: parsed.kwh_total, kwh_peak: parsed.kwh_peak,
    kwh_off_peak: parsed.kwh_off_peak, kwh_exported: parsed.kwh_exported,
    fixed_charge_nzd: parsed.fixed_charge_nzd, variable_charge_nzd: parsed.variable_charge_nzd,
    gst_nzd: parsed.gst_nzd, total_nzd: parsed.total_nzd,
  })) {
    if (value != null && value < 0) {
      parse_warnings.push({
        field, code: 'negative_value',
        reason: `${field} is negative (${value}) — should never be < 0.`,
        suspect: true,
      });
    }
  }

  // (7) Bill-type-aware structural checks
  switch (parsed.bill_type) {
    case 'multi_rate': {
      const rows = parsed.rate_rows || { fixed: 0, variable: 0 };
      if (rows.fixed >= 2 && rows.variable < 2) {
        parse_warnings.push({
          field: 'rate_rows', code: 'multi_rate_variable_undercount',
          reason: `Detected ${rows.fixed} fixed-charge rows but only ${rows.variable} variable-charge row(s). Multi-rate bills usually split both — variable parser may have missed a row.`,
          suspect: true,
        });
      }
      if (rows.variable >= 2 && rows.fixed < 2) {
        parse_warnings.push({
          field: 'rate_rows', code: 'multi_rate_fixed_undercount',
          reason: `Detected ${rows.variable} variable-charge rows but only ${rows.fixed} fixed-charge row(s). Multi-rate bills usually split both — fixed parser may have missed a row.`,
          suspect: true,
        });
      }
      break;
    }
    case 'tou': {
      const peakSum = (parsed.kwh_peak || 0) + (parsed.kwh_off_peak || 0);
      if (parsed.kwh_total && peakSum > 0 && Math.abs(peakSum - parsed.kwh_total) > 1) {
        parse_warnings.push({
          field: 'kwh_total', code: 'tou_kwh_dont_sum',
          reason: `TOU peak (${parsed.kwh_peak}) + off-peak (${parsed.kwh_off_peak}) = ${peakSum} ≠ stated total ${parsed.kwh_total}.`,
          suspect: true,
        });
      }
      break;
    }
    case 'free_hours': {
      parse_warnings.push({
        field: 'bill_type', code: 'free_hours_partial_billing',
        reason: 'Free-hours plan detected — some kWh billed at $0. Sales should verify the free-window kWh on first call.',
        suspect: false,
      });
      break;
    }
  }

  return parse_warnings;
}

// Shared enrichment with cross-retailer fields (address, postcode, ICP, distributor)
function enrichWithCrossRetailerFields(parsed, text) {
  const serviceAddress    = parsed.service_address    || extractServiceAddress(text);
  const servicePostcode   = parsed.service_postcode   || extractPostcode(serviceAddress);
  const icpNumber         = parsed.icp_number         || extractICP(text);
  const networkDistributor= parsed.network_distributor|| extractDistributor(text);
  return {
    ...parsed,
    service_address:     serviceAddress,
    service_postcode:    servicePostcode,
    icp_number:          icpNumber,
    network_distributor: networkDistributor,
  };
}

// ── Retailer-specific parsers ─────────────────────────────────────────────

const MERCURY = {
  name: 'Mercury',
  match: (t) => /\bmercury\b/i.test(t) && /\b(NZ Energy|Mercury NZ|mercury\.co\.nz|electricity)\b/i.test(t),
  parse: (t) => {
    const errors = [];
    const out = { retailer: 'Mercury', plan_name: null };

    // ── Scope to the ELECTRICITY section only ──
    // Mercury bills can be electricity-only OR dual-fuel (electricity + gas).
    // The bill analyser is solar-focused — we only care about the electricity
    // portion. Slice the text from the "ELECTRICITY" header to the next
    // major section header (GAS / If you have any concerns / PAYMENT SLIP).
    let elec = t;
    const elecStart = t.search(/^\s*ELECTRICITY\s*$|⚡?\s*ELECTRICITY\b/im);
    if (elecStart >= 0) {
      const remaining = t.slice(elecStart);
      // Cut at the next section: GAS section, PAYMENT SLIP, or "If you have"
      const cutMatch = remaining.slice(15).search(/^\s*GAS\s*$|⚡?\s*GAS\b|PAYMENT\s+SLIP|If you have|^\s*ELECTRICITY\s+TOTAL\b/im);
      // Include the ELECTRICITY TOTAL line (don't cut before it) but cut at GAS
      const gasMatch = remaining.search(/(?:^|\n)\s*GAS\b(?!\s+TOTAL)/m);
      if (gasMatch >= 0) {
        elec = remaining.slice(0, gasMatch);
      } else {
        elec = remaining;
      }
    }

    // Plan name — Mercury uses "Homeline Standard" / "Homeline Saver" / "Anytime" / "Off-Peak"
    const planMatch = elec.match(/Homeline\s+(Standard|Saver|Plus)|\bAnytime\b|\bEveryDay\b|\bOff[- ]?Peak\b/i);
    if (planMatch) out.plan_name = planMatch[0];

    // Billing period — handles "Billing period 7 Nov 2025 - 4 Dec 2025" and variants
    const periodMatch = pickFirst(elec, [
      /(?:Billing\s+)?[Pp]eriod[:\s]+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*(?:to|–|—|-)\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
      /From\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*(?:to|–|—|-)\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
    ]);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Could not find billing period dates' });

    // ── kWh total — sum ALL multi-rate usage lines ──
    // Mercury splits usage across two lines when a price change falls inside
    // the billing period (e.g. "Anytime 85 kWh x 19.90 cents ... / Anytime 593
    // kWh x 20.96 cents ..."). matchAll captures every Anytime/Day/Night/Off-
    // Peak/Variable row in the elec slice and we sum them. Falls back to
    // single-figure formats only when none of the rate-line pattern matches.
    const rateLines = [...elec.matchAll(/(?:Anytime|Variable\s+Usage\s+Charge|Off[- ]?Peak|Day|Night)\s+([\d,]+(?:\.\d+)?)\s*kWh\s+x/gi)];
    if (rateLines.length) {
      out.kwh_total = +rateLines.reduce((sum, m) => sum + parseNum(m[1]), 0);
    } else {
      const fallback = pickFirst(elec, [
        /Total\s+kWh\s+used[:\s]+([\d,]+(?:\.\d+)?)/i,
        /Units\s+used[\s\S]{0,40}?([\d,]+(?:\.\d+)?)\s*kWh/i,
        /\(actual\)[\s\S]{0,80}?([\d,]+(?:\.\d+)?)\s*kWh\s*$/im,
        /([\d,]+(?:\.\d+)?)\s*kWh\s*@/,
      ]);
      if (fallback) out.kwh_total = parseNum(fallback[1]);
      else errors.push({ field: 'kwh_total', reason: 'kWh total not found in electricity section' });
    }

    // ── Rolling 12-month usage — Mercury prints this on every bill ──
    // "Your total usage for the last 365 days is 9504 units (kWh)."
    // Used as a ground-truth annual kWh + sanity check against our extrapolation.
    const rollingMatch = elec.match(/total\s+usage\s+for\s+the\s+last\s+365\s+days\s+is\s+([\d,]+)\s+units/i);
    if (rollingMatch) out.annual_kwh_rolling = parseNum(rollingMatch[1]);

    // ── Per-fuel ELECTRICITY total — preferred over combined "Amount due" ──
    // Mercury 2025 format: "ELECTRICITY TOTAL $153.38"
    // Falls back to combined total for older/single-fuel formats.
    const totalMatch = pickFirst(elec, [
      /ELECTRICITY\s+TOTAL[:\s]+\$?([\d,]+\.\d{2})/i,
      /Total\s+amount\s+due[:\s]+\$?([\d,]+\.\d{2})/i,
      /Amount\s+due[:\s]+\$?([\d,]+\.\d{2})/i,
      /Total\s+this\s+bill[:\s]+\$?([\d,]+\.\d{2})/i,
    ]);
    if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
    else errors.push({ field: 'total_nzd', reason: 'Electricity total not found' });

    // ── Fixed charge — sum ALL "Daily Fixed Charge" line totals ──
    // Handles BOTH:
    //   (a) single-rate bills: one row, e.g.
    //       "Daily fixed charge   31 days @ $1.40     $43.40"
    //       Captures the line-end $X.XX (the column TOTAL), not the per-day rate.
    //   (b) multi-rate bills (price change mid-period): two rows, e.g.
    //       "Daily Fixed Charge  4 Days x 237.00 cents $9.48"
    //       "Daily Fixed Charge 28 Days x 272.00 cents $76.16"
    //       matchAll captures both; sum = $85.64.
    // The `\s*$` with /m flag is load-bearing: anchors to end-of-line so we
    // always capture the LAST $-amount on each row (the column total), not
    // the per-day rate that appears earlier on the same line.
    const fixedLines = [...elec.matchAll(/(?:Daily\s+(?:fixed\s+)?charge|Fixed\s+charge)[\s\S]{0,160}?\$([\d,]+\.\d{2})\s*$/gim)];
    if (fixedLines.length) {
      out.fixed_charge_nzd = +fixedLines.reduce((sum, m) => sum + parseNum(m[1]), 0).toFixed(2);
    }

    // ── Variable charge — sum ALL per-rate usage $-totals on the elec slice ──
    // Handles BOTH single-rate and multi-rate. The pattern ends at $X.XX after
    // "x N cents" — both formats put the line total at the same anchor point.
    //   single-rate: "Anytime 1940 kWh x 28.9 cents $560.66"
    //   multi-rate:  "Anytime 85 kWh x 19.90c $16.92" + "Anytime 593 kWh x 20.96c $124.29"
    const variableLines = [...elec.matchAll(/(?:Anytime|Variable\s+Usage\s+Charge|Off[- ]?Peak|Day|Night)\s+[\d,]+(?:\.\d+)?\s*kWh\s+x\s+[\d.]+\s*cents\s+\$([\d,]+\.\d{2})/gi)];
    if (variableLines.length) {
      out.variable_charge_nzd = +variableLines.reduce((sum, m) => sum + parseNum(m[1]), 0).toFixed(2);
    } else {
      const fallback = elec.match(/(?:Energy|Variable|Electricity)\s+charges?[\s\S]{0,200}?\$([\d,]+\.\d{2})/i);
      if (fallback) out.variable_charge_nzd = parseNum(fallback[1]);
    }

    // ── Bill type detection ──
    // Captures the structural shape of the bill so type-aware validators
    // can apply the right consistency rules downstream.
    //   single_rate — one fixed-charge row + one variable-charge row
    //   multi_rate  — 2+ rows in either (price change mid-period)
    //   tou         — variable rows include Peak / Off-Peak / Day / Night labels
    //   free_hours  — has a Free / 0-cost kWh row (Contact Good Nights, etc.)
    //   dual_fuel   — bill has both ELECTRICITY and GAS sections (we already
    //                 scope `elec` to electricity-only above; flag for transparency)
    const variableLabels = variableLines.map(m => m[0].match(/Anytime|Off[- ]?Peak|Day|Night|Variable\s+Usage\s+Charge/i)?.[0]);
    const uniqueRateLabels = [...new Set(variableLabels.map(l => l?.toLowerCase()))].filter(Boolean);
    const isTou = uniqueRateLabels.some(l => /off.?peak|day|night/i.test(l)) && uniqueRateLabels.length > 1;
    const isMultiRate = fixedLines.length > 1 || (variableLines.length > 1 && !isTou);
    const isDualFuel = /\bGAS\b/i.test(t) && /\bELECTRICITY\b/i.test(t);
    const hasFreeHours = /\bFree\b[\s\S]{0,30}?\d+\s*kWh\s*@?\s*0+(?:\.0+)?\s*(?:c(?:ents?)?)?/i.test(elec)
                       || /9\s*pm[\s\S]{0,20}?midnight/i.test(elec);

    out.bill_type = isDualFuel       ? 'dual_fuel'
                   : hasFreeHours    ? 'free_hours'
                   : isTou           ? 'tou'
                   : isMultiRate     ? 'multi_rate'
                                     : 'single_rate';
    out.rate_rows = { fixed: fixedLines.length, variable: variableLines.length };
    out.raw_extracted_fields = {
      ...(out.raw_extracted_fields || {}),
      fixed_rows_total_$: fixedLines.map(m => parseNum(m[1])),
      variable_rows_total_$: variableLines.map(m => parseNum(m[1])),
      detected_rate_labels: uniqueRateLabels,
    };

    // ── Subtotal (excl GST) — Mercury 2025 includes a "Subtotal" line ──
    const subtotalMatch = elec.match(/Subtotal[:\s]+\$?([\d,]+\.\d{2})/i);
    if (subtotalMatch) out.subtotal_nzd = parseNum(subtotalMatch[1]);

    // ── GST — scoped to electricity section, not the combined header GST ──
    const gstMatch = elec.match(/^\s*GST[\s\S]{0,80}?\$([\d,]+\.\d{2})/im)
                  || elec.match(/GST(?:\s*\(15%\))?[\s\S]{0,80}?\$([\d,]+\.\d{2})/i);
    if (gstMatch) out.gst_nzd = parseNum(gstMatch[1]);

    // ── Solar export (if customer already has solar) ──
    const exportMatch = elec.match(/(?:Solar\s+(?:export|buyback|feed)|Export)\s+(?:credit|payment)?[\s\S]{0,150}?([\d,]+(?:\.\d+)?)\s*kWh.*?\$?([\d,]+\.\d{2})/i);
    if (exportMatch) {
      out.kwh_exported = parseNum(exportMatch[1]);
      out.export_credit_nzd = parseNum(exportMatch[2]);
    }

    if (out.period_start && out.period_end) {
      out.days_in_period = daysBetween(out.period_start, out.period_end);
    }

    out.parse_errors = errors;
    return out;
  },
};

const GENESIS = {
  name: 'Genesis',
  match: (t) => /\bgenesis\s+energy\b/i.test(t) || /\bgenesisenergy\.co\.nz\b/i.test(t),
  parse: (t) => {
    const errors = [];
    const out = { retailer: 'Genesis', plan_name: null };

    // ── Scope to the electricity *usage detail* (page 2), not the page-1 summary ──
    // Genesis bills can be electricity-only, dual-fuel (electricity + bottled
    // gas), or commercial (with Capricorn). The page-1 summary just shows the
    // total. Per-kWh rates and the days-fixed line live in the
    // "Current Electricity Usage" detail table on page 2 — anchor there.
    let elec = t;
    const elecStart = t.search(/Current\s+Electricity\s+Usage/i);
    if (elecStart >= 0) {
      const remaining = t.slice(elecStart);
      const cutMatch = remaining.slice(20).search(/Current\s+Bottled\s+Gas|Current\s+Gas\s+Usage|For\s+Bottled\s+Gas\s+supply|For\s+Gas\s+supply/i);
      elec = cutMatch >= 0 ? remaining.slice(0, cutMatch + 20) : remaining;
    }

    // Plan — Genesis uses "Plus Standard", "Plus Saver", "Energy IQ", "Go Standard"
    const planMatch = t.match(/(Plus\s+(?:Standard|Saver|Free)|Go\s+(?:Standard|Saver|Free)|Energy\s+IQ|EnergyDuo)/i);
    if (planMatch) out.plan_name = planMatch[0];

    // Billing period — "Covers the 30 day period from 02 Feb 2026 to 3 Mar 2026"
    const periodMatch = pickFirst(t, [
      /Covers\s+the\s+\d+\s+day\s+period\s+from\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+to\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
      /(?:Reading|Billing)\s+period[:\s]+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(?:to|–|-)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
      /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(?:to|–|-)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
    ]);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Could not find billing period dates' });

    // ── kWh total — sum ALL "N @ R c/unit" rate lines ──
    // Same multi-rate handling as Mercury: a price change mid-period (or a
    // multi-meter setup) prints multiple "Actual N @ R c/unit X.XX" rows.
    // Sum every kWh value to get the true total.
    const kwhLines = [...elec.matchAll(/(?:Actual\s+)?([\d,]+(?:\.\d+)?)\s+@\s+[\d.]+\s*c\/unit/gi)];
    if (kwhLines.length) {
      out.kwh_total = +kwhLines.reduce((sum, m) => sum + parseNum(m[1]), 0);
    } else {
      const fallback = pickFirst(elec, [
        /Total\s+(?:electricity|energy)\s+used[:\s]+([\d,]+(?:\.\d+)?)\s*kWh/i,
        /([\d,]+(?:\.\d+)?)\s*kWh\s+used/i,
        /([\d,]+(?:\.\d+)?)\s*kWh\s*@/,
      ]);
      if (fallback) out.kwh_total = parseNum(fallback[1]);
      else errors.push({ field: 'kwh_total', reason: 'kWh total not found' });
    }

    // ── Rolling 12-month usage (if Genesis prints it) ──
    const rollingMatch = elec.match(/total\s+(?:usage|consumption)\s+for\s+the\s+last\s+365\s+days[\s\S]{0,40}?([\d,]+)\s*(?:units|kWh)/i)
                      || t.match(/(?:Annual|Yearly)\s+(?:usage|consumption)[\s\S]{0,40}?([\d,]+)\s*kWh/i);
    if (rollingMatch) out.annual_kwh_rolling = parseNum(rollingMatch[1]);

    // ── Total — prefer post-discount total, fall back to pre-discount ──
    // Genesis dollar amounts often have a space: "$ 443.11"
    const totalMatch = pickFirst(elec, [
      /TOTAL\s+CURRENT\s+ELECTRICITY\s+CHARGES[^$]*\$\s*([\d,]+\.\d{2})/i,
      /Current\s+Electricity\s+Charges[\s\S]{0,40}?\$\s*([\d,]+\.\d{2})/i,
      /Total\s+Charges[\s\S]{0,40}?\$?\s*([\d,]+\.\d{2})/i,
      /Total\s+this\s+bill[:\s]+\$?\s*([\d,]+\.\d{2})/i,
      /Amount\s+(?:due|payable)[:\s]+\$?\s*([\d,]+\.\d{2})/i,
    ]);
    if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
    else errors.push({ field: 'total_nzd', reason: 'Total amount not found' });

    // ── Fixed charge — sum ALL "N days @ R c/day X.XX" rows ──
    // Multi-rate bills print two "days @ c/day" lines (one per rate period).
    const fixedLines = [...elec.matchAll(/\d+\s+days\s+@\s+[\d.]+\s*c\/day\s+([\d,]+\.\d{2})/gi)];
    if (fixedLines.length) {
      out.fixed_charge_nzd = +fixedLines.reduce((sum, m) => sum + parseNum(m[1]), 0).toFixed(2);
    } else {
      const fallback = elec.match(/Daily\s+(?:Fixed\s+|Charge)[\s\S]{0,200}?\$?\s*([\d,]+\.\d{2})/i);
      if (fallback) out.fixed_charge_nzd = parseNum(fallback[1]);
    }

    // ── Variable charge — sum ALL "N @ R c/unit X.XX" totals ──
    const variableLines = [...elec.matchAll(/[\d,]+\s+@\s+[\d.]+\s*c\/unit\s+([\d,]+\.\d{2})/gi)];
    if (variableLines.length) {
      out.variable_charge_nzd = +variableLines.reduce((sum, m) => sum + parseNum(m[1]), 0).toFixed(2);
    } else {
      const fallback = elec.match(/(?:Anytime|Variable|Energy)\s+rate[\s\S]{0,200}?\$?\s*([\d,]+\.\d{2})/i);
      if (fallback) out.variable_charge_nzd = parseNum(fallback[1]);
    }

    // ── Subtotal (excl GST) ──
    const subtotalMatch = elec.match(/Sub\s*Total[\s\S]{0,40}?([\d,]+\.\d{2})/i);
    if (subtotalMatch) out.subtotal_nzd = parseNum(subtotalMatch[1]);

    // ── GST — scoped to electricity section ──
    const gstMatch = elec.match(/^\s*GST[\s\S]{0,40}?([\d,]+\.\d{2})/im)
                  || elec.match(/GST(?:\s*\(15%\))?[\s\S]{0,40}?\$?\s*([\d,]+\.\d{2})/i);
    if (gstMatch) out.gst_nzd = parseNum(gstMatch[1]);

    if (out.period_start && out.period_end) {
      out.days_in_period = daysBetween(out.period_start, out.period_end);
    }

    out.parse_errors = errors;
    return out;
  },
};

const CONTACT = {
  name: 'Contact Energy',
  match: (t) => /\bcontact\s+energy\b/i.test(t) || /\bcontactenergy\.co\.nz\b/i.test(t) || /\bcontact\.co\.nz\b/i.test(t),
  parse: (t) => {
    const errors = [];
    const out = { retailer: 'Contact Energy', plan_name: null };

    // ── Section-aware slicing ──
    // Contact bills can bundle electricity + gas + broadband + mobile on
    // a single statement. We find every product-section header in the bill,
    // sort by position, and slice between the electricity header and the
    // next section's header. The fallback handles older Contact formats
    // that don't print a "Electricity charges - installation" header.
    //
    // To support a future Contact variant (e.g. EV plan with its own header)
    // add one entry to SECTION_MARKERS.
    const SECTION_MARKERS = [
      { name: 'electricity', re: /Electricity\s+charges\s*[-–]?\s*installation/i },
      { name: 'gas',         re: /Natural\s+gas\s+charges|^\s*Gas\s+charges|Bottled\s+gas/im },
      { name: 'broadband',   re: /Broadband\s+charges/i },
      { name: 'mobile',      re: /Mobile\s+charges/i },
    ];

    let elec;
    const elecIdx = t.search(SECTION_MARKERS[0].re);
    if (elecIdx >= 0) {
      // Find the next non-electricity section marker that appears AFTER the
      // electricity detail header. Necessary because the page-1 summary block
      // mentions other product names ("Natural gas charges  $56.46") before
      // the actual electricity detail — a naive sort-by-position would put
      // gas before electricity and the slice would never close.
      const startFrom = elecIdx + 20;
      const tail      = t.slice(startFrom);
      const nextIdxs  = SECTION_MARKERS
        .slice(1)
        .map(s => {
          const rel = tail.search(s.re);
          return rel >= 0 ? startFrom + rel : null;
        })
        .filter(x => x !== null);
      const elecEnd = nextIdxs.length ? Math.min(...nextIdxs) : t.length;
      elec = t.slice(elecIdx, elecEnd);
    } else {
      // Fallback for older Contact formats without the explicit "Electricity charges - installation" header
      const elecStart = t.search(/Energy\s+used\s+by/i);
      if (elecStart >= 0) {
        const remaining = t.slice(elecStart);
        const cutMatch = remaining.slice(20).search(/Natural\s+gas\s+charges|Gas\s+charges|Bottled\s+gas|Broadband\s+charges|Mobile\s+charges/i);
        elec = cutMatch >= 0 ? remaining.slice(0, cutMatch + 20) : remaining;
      } else {
        elec = t;
      }
    }

    // Plan — Contact uses "Good Nights", "Standard User", "Anytime", "Free Power"
    const planMatch = t.match(/(Good\s+Nights|Standard\s+User|Free\s+Power\s+Saturdays|Bach\s+Plan|Anytime)/i);
    if (planMatch) out.plan_name = planMatch[0];

    // Billing period — "Your bill for 31 Dec 2025 to 30 Jan 2026"
    const periodMatch = pickFirst(t, [
      /Your\s+bill\s+for\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+to\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
      /from\s+(\d{1,2}\s+[A-Za-z]+\s+\d{2,4})\s+to\s+(\d{1,2}\s+[A-Za-z]+\s+\d{2,4})/i,
      /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*(?:to|–|-)\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
    ]);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Could not find billing period dates' });

    // ── kWh total — sum all "<n> kWh @ <rate> cents per kWh" lines ──
    // TOU plans split usage into multiple windows (e.g. "Charged: Midnight - 9pm 220 kWh @ 28.900",
    // "Free: 9pm - Midnight 69 kWh @ 0.000"). We sum *all* kWh lines so total
    // consumption is captured even when some windows are free.
    const kwhLines = elec.match(/([\d,]+(?:\.\d+)?)\s*kWh\s+@\s+[\d.]+\s*cent/gi);
    if (kwhLines && kwhLines.length) {
      let total = 0;
      let peak = null;
      let off = null;
      for (const line of kwhLines) {
        const m = line.match(/([\d,]+(?:\.\d+)?)\s*kWh\s+@\s+([\d.]+)\s*cent/i);
        if (!m) continue;
        const kwh = parseNum(m[1]);
        const rate = parseNum(m[2]);
        total += kwh;
        if (rate === 0) off = (off || 0) + kwh;
        else            peak = (peak || 0) + kwh;
      }
      out.kwh_total = total;
      if (peak != null) out.kwh_peak = peak;
      if (off  != null) out.kwh_off_peak = off;
    } else {
      const fallback = pickFirst(elec, [
        /([\d,]+(?:\.\d+)?)\s*kWh\s+used/i,
        /Total\s+used[:\s]+([\d,]+(?:\.\d+)?)\s*kWh/i,
        /Anytime[\s\S]{0,200}?([\d,]+(?:\.\d+)?)\s*kWh/i,
      ]);
      if (fallback) out.kwh_total = parseNum(fallback[1]);
      else errors.push({ field: 'kwh_total', reason: 'kWh total not found in electricity section' });
    }

    // ── Total Electricity subtotal — bill-told-us-the-answer (preferred) ──
    // Contact dual-fuel / bundled bills print a footer line like
    //   "Total Electricity charges  $485.42"
    // That's the electricity total EXCL GST — the source of truth, robust
    // against future line-item variants.
    const elecSubtotalMatch = elec.match(/Total\s+Electricity\s+charges[\s\S]{0,40}?\$([\d,]+\.\d{2})/i);
    const elecSubtotalExclGst = elecSubtotalMatch ? parseNum(elecSubtotalMatch[1]) : null;

    // ── Fixed charge — search the elec slice only (avoids gas "Living Smart Daily Charge") ──
    // Priority:
    //   1. "Fixed charges total $X" / "Fixed daily charges $X" footer (older Contact bills)
    //   2. SUM of ALL "Daily Charge ... $X" lines (handles bills with a
    //      mid-period rate change — Contact prints two Daily Charge rows in
    //      that case, e.g. "4 days @ $2.738" + "24 days @ $2.985")
    //   3. Generic last-resort Daily / Fixed first match
    const fixedFooter = pickFirst(elec, [
      /Fixed\s+charges\s+total[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
      /Fixed\s+daily\s+charges[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
    ]);
    if (fixedFooter) {
      out.fixed_charge_nzd = parseNum(fixedFooter[1]);
    } else {
      let sum = 0, found = 0;
      // matchAll with non-greedy `[\s\S]{0,150}?` picks the FIRST $X after each
      // "Daily Charge" — and lastIndex advancement gives us the next entry on
      // the next iteration. Robust for one OR many Daily Charge rows.
      for (const m of elec.matchAll(/Daily\s+Charge[\s\S]{0,150}?\$([\d,]+\.\d{2})/gi)) {
        sum += parseNum(m[1]);
        found++;
      }
      if (found > 0) {
        out.fixed_charge_nzd = +sum.toFixed(2);
      } else {
        const generic = elec.match(/(?:Daily|Fixed)\s+(?:charge|fee)[\s\S]{0,200}?\$([\d,]+\.\d{2})/i);
        if (generic) out.fixed_charge_nzd = parseNum(generic[1]);
      }
    }

    // ── Variable charge — explicit "Variable charges" footer (older bills) ──
    const variableMatch = pickFirst(elec, [
      /Variable\s+charges\s+total[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
      /Variable\s+charges[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
    ]);
    if (variableMatch) out.variable_charge_nzd = parseNum(variableMatch[1]);

    // ── Totals — three sources in priority order ──
    //   1. Bill's own "Total Electricity charges" subtotal (most reliable for dual-fuel)
    //   2. Computed from explicit fixed + variable footers
    //   3. Generic "Total amount due" fallback (may include gas/broadband — last resort)
    if (elecSubtotalExclGst != null) {
      // Derive any missing piece from the subtotal so the row is internally consistent.
      if (out.fixed_charge_nzd != null && out.variable_charge_nzd == null) {
        out.variable_charge_nzd = +(elecSubtotalExclGst - out.fixed_charge_nzd).toFixed(2);
      } else if (out.variable_charge_nzd != null && out.fixed_charge_nzd == null) {
        out.fixed_charge_nzd = +(elecSubtotalExclGst - out.variable_charge_nzd).toFixed(2);
      }
      out.total_nzd = +(elecSubtotalExclGst * 1.15).toFixed(2);
      out.gst_nzd   = +(elecSubtotalExclGst * 0.15).toFixed(2);
    } else if (out.fixed_charge_nzd != null && out.variable_charge_nzd != null) {
      const exclGst = out.fixed_charge_nzd + out.variable_charge_nzd;
      out.total_nzd = +(exclGst * 1.15).toFixed(2);
      out.gst_nzd   = +(exclGst * 0.15).toFixed(2);
    } else {
      const totalMatch = pickFirst(t, [
        /Total\s+amount\s+due[^$]{0,80}\$([\d,]+\.\d{2})/i,
        /Total\s+(?:to\s+pay|this\s+bill|current\s+charges)[:\s]+\$?([\d,]+\.\d{2})/i,
      ]);
      if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
      else errors.push({ field: 'total_nzd', reason: 'Total amount not found' });

      const gstMatch = t.match(/^\s*GST[\s\S]{0,40}?\$([\d,]+\.\d{2})/im);
      if (gstMatch) out.gst_nzd = parseNum(gstMatch[1]);
    }

    if (out.period_start && out.period_end) {
      out.days_in_period = daysBetween(out.period_start, out.period_end);
    }

    out.parse_errors = errors;
    return out;
  },
};

const MERIDIAN = {
  name: 'Meridian Energy',
  match: (t) => /\bmeridian\s+energy\b/i.test(t) || /\bmeridianenergy\.co\.nz\b/i.test(t),
  parse: (t) => {
    const errors = [];
    const out = { retailer: 'Meridian Energy', plan_name: null };

    const planMatch = t.match(/(Certainty|Anytime|Off-Peak|Bach)/i);
    if (planMatch) out.plan_name = planMatch[0];

    const periodMatch = t.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*(?:to|–|-)\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Could not find billing period dates' });

    const kwhMatch = pickFirst(t, [
      /([\d,]+(?:\.\d+)?)\s*kWh\s+used/i,
      /Total\s+(?:kWh|usage)[:\s]+([\d,]+(?:\.\d+)?)/i,
    ]);
    if (kwhMatch) out.kwh_total = parseNum(kwhMatch[1]);
    else errors.push({ field: 'kwh_total', reason: 'kWh total not found' });

    const totalMatch = t.match(/(?:Total|Amount)\s+(?:due|to\s+pay|this\s+bill)[:\s]+\$?([\d,]+\.\d{2})/i);
    if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
    else errors.push({ field: 'total_nzd', reason: 'Total amount not found' });

    if (out.period_start && out.period_end) {
      out.days_in_period = daysBetween(out.period_start, out.period_end);
    }

    out.parse_errors = errors;
    return out;
  },
};

const PULSE = {
  name: 'Pulse Energy',
  // Pulse PDFs sometimes mangle "Pulse Energy" into "0ULSE %NERGY" due to font
  // encoding, so match on multiple fingerprints — domain, plain name, and
  // a couple of unambiguous strings that survive the encoding issue.
  match: (t) => /\bpulse\s+energy\b/i.test(t)
             || /\bpulseenergy\.co\.nz\b/i.test(t)
             || /pulse\s+energy\s+alliance/i.test(t),
  parse: (t) => {
    const errors = [];
    const out = { retailer: 'Pulse Energy', plan_name: null };

    // Plan — "Pulse Energy Standard User Counties Power", "Standard User",
    // "Low User", "Freedom Plan"
    const planMatch = t.match(/Pulse\s+Energy\s+(Standard\s+User|Low\s+User|Freedom)[^\n]{0,40}/i)
                  || t.match(/Your\s+Freedom\s+Plan/i)
                  || t.match(/(Standard\s+User|Low\s+User|Freedom\s+Plan)/i);
    if (planMatch) out.plan_name = planMatch[0].trim();

    // Billing period — "For the period from 24/03/2026 to 25/04/2026"
    const periodMatch = pickFirst(t, [
      /For\s+the\s+period\s+from\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+to\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
      /period\s+from\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+to\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
      /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(?:to|–|-)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
    ]);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Could not find billing period dates' });

    // ── kWh total — sum "kWh this period: NNN" lines (one per meter) ──
    // Pulse can have controlled + uncontrolled meters; both contribute.
    const kwhPeriodLines = [...t.matchAll(/kWh\s+this\s+period[:\s]+([\d,]+(?:\.\d+)?)/gi)];
    if (kwhPeriodLines.length) {
      out.kwh_total = kwhPeriodLines.reduce((sum, m) => sum + parseNum(m[1]), 0);
    } else {
      // Fall back to summing "Energy Rate - … N kWh" lines in the detailed invoice
      const energyLines = [...t.matchAll(/Energy\s+Rate\s+-[^\n]*?([\d,]+(?:\.\d+)?)\s*kWh/gi)];
      if (energyLines.length) {
        out.kwh_total = energyLines.reduce((sum, m) => sum + parseNum(m[1]), 0);
      } else errors.push({ field: 'kwh_total', reason: 'kWh total not found' });
    }

    // ── Variable charge — sum BOTH energy AND delivery-side variable lines ──
    // Pulse bills have a two-section structure:
    //   Energy section:    "Energy Rate - Uncontrolled / Controlled" → "Total Energy"
    //   Delivery section:  "EA Levy", "Network Services Variable - Controlled/Uncontrolled"
    //                      plus the per-day fixed lines (Metering, Fixed Daily, Retailer)
    //
    // The OLD parser captured only "Total Energy" (Energy section only) and silently
    // dropped the Delivery-section variable charges — typically $100-150/bill of
    // network usage charges. This caused 30%+ underestimation of variable spend
    // for every Pulse customer (cross-field validator flagged it as line_items_dont_sum).
    //
    // Fix: sum (Total Energy) + (each per-kWh delivery-side row identified by its
    // "N kWh" quantity marker). The fixed_charge_nzd block below independently
    // captures the per-day rows from the same section, so no double-count.
    const energyTotalMatch = t.match(/Total\s+Energy[\s\S]{0,40}?\$([\d,]+\.\d{2})/i);
    let variableTotal = energyTotalMatch ? parseNum(energyTotalMatch[1]) : 0;
    // Delivery-side per-kWh charges — identifiable by their "<num> kWh" quantity
    // marker (distinguishes them from per-day "<num> Days" fixed rows).
    // Constrain to a single line ([^\n]) so the regex can't accidentally reach
    // forward to the next row's $-amount when two consecutive rows share the
    // same label prefix (e.g. "Network Services Variable - Controlled" and
    // "Network Services Variable - Uncontrolled" on adjacent lines).
    const deliveryVarLines = [...t.matchAll(
      /(?:(?:EA|Electricity)\s+(?:Authority\s+)?Levy|Network\s+Services\s+Variable)[^\n]*?[\d,]+\s*kWh[^\n]*?\$([\d,]+\.\d{2})/gi
    )];
    for (const m of deliveryVarLines) {
      variableTotal += parseNum(m[1]) || 0;
    }
    if (variableTotal > 0) out.variable_charge_nzd = +variableTotal.toFixed(2);

    // ── Fixed charge — sum of "X Days @ Y.000 $Z.ZZ" lines for fixed-daily items ──
    // Pulse's "Total Delivery" mixes per-kWh network charges with per-day fixed
    // charges, so we sum the unambiguous daily lines instead.
    const dayLines = [...t.matchAll(/(Metering|Network\s+Services\s+Fixed\s+Daily|Retailer\s+Services|Daily\s+Fixed\s+Charge)[\s\S]{0,30}?\d+\s+Days[\s\S]{0,40}?\$([\d,]+\.\d{2})/gi)];
    if (dayLines.length) {
      out.fixed_charge_nzd = +dayLines.reduce((sum, m) => sum + parseNum(m[2]), 0).toFixed(2);
    }

    // ── "Other Fees" — non-electricity charges (dishonour fees, late fees, etc.) ──
    // Pulse includes one-off fees in "Current Electricity Charges (including GST)"
    // but they're NOT actual electricity usage — solar won't reduce them. Capture
    // separately so we can subtract from total_nzd (which the analysis engine
    // uses as the "baseline annual spend" for sizing). Without this exclusion,
    // a customer who's had a bounced direct debit would get an over-sized
    // solar quote based on inflated baseline spend.
    const otherFeesMatch = t.match(/Total\s+Other\s+Fees[\s\S]{0,40}?\$([\d,]+\.\d{2})/i);
    const otherFees = otherFeesMatch ? parseNum(otherFeesMatch[1]) : 0;

    // ── Total — "Current Electricity Charges (including GST) $1,335.39" ──
    // Prefer this over "Total Current Amount Due" which can include opening balance.
    const totalMatch = pickFirst(t, [
      /Current\s+Electricity\s+Charges\s+\(including\s+GST\)[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
      /Electricity\s+Charges[\s\S]{0,20}?\$([\d,]+\.\d{2})/i,
      /Total\s+Current\s+Amount\s+Due[\s\S]{0,80}?\$([\d,]+\.\d{2})/i,
    ]);
    if (totalMatch) {
      const grossTotal = parseNum(totalMatch[1]);
      // Strip "Other Fees" so total_nzd represents true electricity usage cost.
      // The original gross is preserved in raw_extracted_fields for audit.
      out.total_nzd = +(grossTotal - otherFees).toFixed(2);
      if (otherFees > 0) {
        out.raw_extracted_fields = {
          ...(out.raw_extracted_fields || {}),
          gross_bill_total_nzd: grossTotal,
          other_fees_nzd:       otherFees,
          other_fees_excluded_from_total: true,
        };
      }
    } else errors.push({ field: 'total_nzd', reason: 'Total amount not found' });

    // ── GST — "GST at 15% $108.82" ──
    const gstMatch = t.match(/GST\s+at\s+15%[\s\S]{0,40}?\$([\d,]+\.\d{2})/i)
                  || t.match(/GST(?:\s*\(15%\))?[\s\S]{0,40}?\$([\d,]+\.\d{2})/i);
    if (gstMatch) out.gst_nzd = parseNum(gstMatch[1]);

    if (out.period_start && out.period_end) {
      out.days_in_period = daysBetween(out.period_start, out.period_end);
    }

    out.parse_errors = errors;
    return out;
  },
};

const POWERSHOP = {
  name: 'Powershop',
  match: (t) => /\bpowershop\b/i.test(t),
  parse: (t) => {
    const errors = [];
    const out = { retailer: 'Powershop', plan_name: null };

    const periodMatch = t.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*(?:to|–|-)\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Could not find billing period dates' });

    const kwhMatch = pickFirst(t, [
      /([\d,]+(?:\.\d+)?)\s*kWh\s+(?:used|consumed)/i,
      /Total\s+kWh[:\s]+([\d,]+(?:\.\d+)?)/i,
    ]);
    if (kwhMatch) out.kwh_total = parseNum(kwhMatch[1]);
    else errors.push({ field: 'kwh_total', reason: 'kWh total not found' });

    const totalMatch = t.match(/(?:Total|Bill\s+total)[:\s]+\$?([\d,]+\.\d{2})/i);
    if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
    else errors.push({ field: 'total_nzd', reason: 'Total amount not found' });

    if (out.period_start && out.period_end) {
      out.days_in_period = daysBetween(out.period_start, out.period_end);
    }

    out.parse_errors = errors;
    return out;
  },
};

// ── Generic fallback — used when we can't identify the retailer ──────────

const GENERIC = {
  name: 'Unknown',
  match: () => true,  // always matches as last resort
  parse: (t) => {
    const errors = [];
    const out = { retailer: 'Unknown' };

    // Try the most common patterns regardless of retailer
    const periodMatch = t.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*(?:to|–|-)\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Generic parser could not find period — retailer may need a custom parser' });

    const kwhMatch = t.match(/([\d,]+(?:\.\d+)?)\s*kWh/);
    if (kwhMatch) out.kwh_total = parseNum(kwhMatch[1]);
    else errors.push({ field: 'kwh_total', reason: 'No kWh figure found' });

    const totalMatch = t.match(/\$\s*([\d,]+\.\d{2})/);
    if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
    else errors.push({ field: 'total_nzd', reason: 'No dollar amount found' });

    if (out.period_start && out.period_end) {
      out.days_in_period = daysBetween(out.period_start, out.period_end);
    }

    errors.push({ field: 'retailer', reason: 'Retailer not recognised — check the retailer name in your bill, then ask Goldenray to add a custom parser. The numbers above are best-effort only.' });

    out.parse_errors = errors;
    return out;
  },
};

const RETAILERS = [MERCURY, GENESIS, CONTACT, PULSE, MERIDIAN, POWERSHOP];

// Also export a function to parse from already-extracted text (useful for
// testing without real PDFs and for systems where text extraction happens
// elsewhere — e.g. Tesseract OCR done client-side).
export function parseBillText(text, opts = {}) {
  const retailer = RETAILERS.find(r => r.match(text)) || GENERIC;
  let parsed;
  try { parsed = retailer.parse(text); }
  catch (e) { parsed = { parse_errors: [{ field: 'all', reason: `Parser threw: ${e.message}` }] }; }

  // ── Cross-retailer enrichment + cross-field validators (shared helpers) ──
  // Same logic runs from parseBillPdf() and parseBillImage().
  const enriched = enrichWithCrossRetailerFields(parsed, text);
  const parse_warnings = runCrossFieldValidators(enriched);

  return {
    ...makeEmptyBill(),
    ...enriched,
    retailer: enriched.retailer || retailer.name,
    ocr_text_excerpt: text.slice(0, 4000),
    ocr_text_full: text,
    ocr_confidence: estimateConfidence(enriched),
    field_confidence: computeFieldConfidence(enriched),
    parse_errors: enriched.parse_errors || [],
    parse_warnings,
    parse_suspect: parse_warnings.some(w => w.suspect === true),
    raw_extracted_fields: enriched.raw_extracted_fields || {},
    file_name: opts.fileName || null,
  };
}

// ── (legacy inline validator block removed — superseded by shared
//     runCrossFieldValidators() above; parseBillPdf, parseBillImage, and
//     parseBillText all call the same helper now.) ──

function _legacy_remove_me_anchor() {
  /* The following block is intentionally unreachable. It existed as the
     old inline validator block in parseBillText. Kept as a stub so the
     remaining code below this comment (return statement + closing brace)
     stays syntactically valid until I do a follow-up cleanup commit. */
  const parse_warnings = [];
  const parsed = {};
  const text = '';
  const opts = {};
  const retailer = { name: '' };

  // (1) kWh-vs-total: existing check (kept for back-compat)
  if (parsed.kwh_total != null && parsed.total_nzd != null && parsed.total_nzd > 0) {
    const impliedSpendFromKwh = parsed.kwh_total * 0.25;
    const ratio = impliedSpendFromKwh / parsed.total_nzd;
    if (ratio < 0.30) {
      parse_warnings.push({
        field: 'kwh_total',
        code:  'kwh_low_vs_total',
        reason: `kWh (${parsed.kwh_total}) looks low vs total ($${parsed.total_nzd}). At ~25¢/kWh blended this would be ~$${impliedSpendFromKwh.toFixed(0)} — only ${(ratio*100).toFixed(0)}% of the bill. Likely a multi-rate row was missed.`,
        suspect: true,
      });
    }
  }

  // (2) Extrapolation-vs-rolling: existing check
  if (parsed.kwh_total && parsed.annual_kwh_rolling && parsed.days_in_period) {
    const extrapolated = parsed.kwh_total * (365 / parsed.days_in_period);
    if (extrapolated > parsed.annual_kwh_rolling * 1.8) {
      parse_warnings.push({
        field: 'kwh_total',
        code:  'kwh_double_count_suspect',
        reason: `kWh extrapolated to ~${Math.round(extrapolated)}/yr but bill says rolling 365 days = ${parsed.annual_kwh_rolling}. Possible double-count.`,
        suspect: true,
      });
    }
  }

  // (3) NEW — line items must sum to total within $1 (rules 4.5, 4.6, 4.10)
  if (parsed.total_nzd != null) {
    const fixed = parsed.fixed_charge_nzd    || 0;
    const variable = parsed.variable_charge_nzd || 0;
    const gst = parsed.gst_nzd               || 0;
    const exportCred = parsed.export_credit_nzd || 0;
    // Different retailers express totals as (fixed + variable + gst − export_credit)
    // or with GST already inside the line totals. Allow both — flag if BOTH
    // interpretations are off by more than $1.
    const sumInclGst = fixed + variable + gst - exportCred;
    const sumExclGst = fixed + variable        - exportCred;
    const driftA = Math.abs(sumInclGst - parsed.total_nzd);
    const driftB = Math.abs(sumExclGst - parsed.total_nzd);
    if (driftA > 1 && driftB > 1 && (fixed > 0 || variable > 0)) {
      parse_warnings.push({
        field: 'total_nzd',
        code:  'line_items_dont_sum',
        reason: `Line items don't sum to total. Fixed $${fixed.toFixed(2)} + Variable $${variable.toFixed(2)} ${gst ? `+ GST $${gst.toFixed(2)} ` : ''}${exportCred ? `− Export $${exportCred.toFixed(2)} ` : ''}= $${sumInclGst.toFixed(2)}, but bill total is $${parsed.total_nzd.toFixed(2)} (drift $${driftA.toFixed(2)}).`,
        suspect: true,
      });
    }
  }

  // (4) NEW — GST must be ~15% of pre-tax subtotal (rule 4.6)
  if (parsed.gst_nzd != null && parsed.gst_nzd > 0) {
    const preTax = (parsed.fixed_charge_nzd || 0) + (parsed.variable_charge_nzd || 0);
    if (preTax > 0) {
      const expected = preTax * 0.15;
      const drift = Math.abs(parsed.gst_nzd - expected);
      // Tolerance: 1% of pre-tax OR $0.50, whichever is bigger (rounding)
      const tol = Math.max(0.5, preTax * 0.01);
      if (drift > tol) {
        parse_warnings.push({
          field: 'gst_nzd',
          code:  'gst_not_15pct',
          reason: `GST $${parsed.gst_nzd.toFixed(2)} ≠ 15% of pre-tax $${preTax.toFixed(2)} (expected ~$${expected.toFixed(2)}, drift $${drift.toFixed(2)}).`,
          suspect: true,
        });
      }
    }
  }

  // (5) NEW — billing end must be after start, duration positive (rules 4.2, 4.3)
  if (parsed.period_start && parsed.period_end) {
    const start = new Date(parsed.period_start + 'T00:00:00Z');
    const end   = new Date(parsed.period_end   + 'T00:00:00Z');
    if (!isNaN(start) && !isNaN(end)) {
      if (end <= start) {
        parse_warnings.push({
          field: 'period_end',
          code:  'end_before_start',
          reason: `Billing end ${parsed.period_end} is not after start ${parsed.period_start}.`,
          suspect: true,
        });
      }
      // Also: stated days_in_period must match end−start+1 (within 1 day)
      if (parsed.days_in_period) {
        const computed = Math.round((end - start) / 86400000) + 1;
        if (Math.abs(computed - parsed.days_in_period) > 1) {
          parse_warnings.push({
            field: 'days_in_period',
            code:  'days_mismatch',
            reason: `Stated days_in_period=${parsed.days_in_period} but ${parsed.period_start} → ${parsed.period_end} = ${computed} days.`,
            suspect: true,
          });
        }
      }
    }
  }

  // (6) NEW — non-negative invariants (rules 4.4, 4.5)
  for (const [field, value] of Object.entries({
    kwh_total: parsed.kwh_total, kwh_peak: parsed.kwh_peak,
    kwh_off_peak: parsed.kwh_off_peak, kwh_exported: parsed.kwh_exported,
    fixed_charge_nzd: parsed.fixed_charge_nzd, variable_charge_nzd: parsed.variable_charge_nzd,
    gst_nzd: parsed.gst_nzd, total_nzd: parsed.total_nzd,
  })) {
    if (value != null && value < 0) {
      parse_warnings.push({
        field, code: 'negative_value',
        reason: `${field} is negative (${value}) — should never be < 0.`,
        suspect: true,
      });
    }
  }

  // (7) NEW — bill-type-aware structural checks
  //
  // The earlier sum + GST + dates validators above apply to ALL bill types
  // because the math (fixed + variable + gst = total) is invariant. These
  // additional checks key off `bill_type` to catch type-specific parser bugs
  // that the sum check alone would miss:
  //   multi_rate  — must have ≥2 rate rows extracted; if parser only got 1,
  //                 the bill total would still match (because we'd have one
  //                 of the two correct totals + a wrong one) so the sum check
  //                 wouldn't always fire. Explicit row-count check catches it.
  //   tou         — peak kWh + off-peak kWh should sum to total kWh (within 1)
  //   free_hours  — flag that variable-charge math will look off because some
  //                 kWh are billed at $0; this is INFORMATIONAL only, not suspect
  switch (parsed.bill_type) {
    case 'multi_rate': {
      const rows = parsed.rate_rows || { fixed: 0, variable: 0 };
      // The classifier set bill_type=multi_rate because fixedLines>1 OR variableLines>1.
      // Flag if the OTHER category only has 1 row — usually means parser missed
      // a row (Mercury multi-rate bills should have BOTH fixed and variable
      // duplicated when a price change falls inside the period).
      if (rows.fixed >= 2 && rows.variable < 2) {
        parse_warnings.push({
          field: 'rate_rows',
          code:  'multi_rate_variable_undercount',
          reason: `Detected ${rows.fixed} fixed-charge rows but only ${rows.variable} variable-charge row(s). Multi-rate bills usually split both — variable parser may have missed a row.`,
          suspect: true,
        });
      }
      if (rows.variable >= 2 && rows.fixed < 2) {
        parse_warnings.push({
          field: 'rate_rows',
          code:  'multi_rate_fixed_undercount',
          reason: `Detected ${rows.variable} variable-charge rows but only ${rows.fixed} fixed-charge row(s). Multi-rate bills usually split both — fixed parser may have missed a row.`,
          suspect: true,
        });
      }
      break;
    }
    case 'tou': {
      // Time-of-use: peak + off-peak kWh should sum to total (within 1 kWh)
      const peakSum = (parsed.kwh_peak || 0) + (parsed.kwh_off_peak || 0);
      if (parsed.kwh_total && peakSum > 0 && Math.abs(peakSum - parsed.kwh_total) > 1) {
        parse_warnings.push({
          field: 'kwh_total',
          code:  'tou_kwh_dont_sum',
          reason: `TOU peak (${parsed.kwh_peak}) + off-peak (${parsed.kwh_off_peak}) = ${peakSum} ≠ stated total ${parsed.kwh_total}.`,
          suspect: true,
        });
      }
      break;
    }
    case 'free_hours': {
      // Informational only — variable_charge math won't equal kwh_total × rate
      // because some kWh are billed at $0 (Contact Good Nights 9pm-midnight)
      parse_warnings.push({
        field: 'bill_type',
        code:  'free_hours_partial_billing',
        reason: 'Free-hours plan detected — some kWh are billed at $0. Variable-charge sum checks adjusted; sales should still verify the free-window kWh on first call.',
        suspect: false,                 // INFO, not blocker
      });
      break;
    }
    // single_rate, dual_fuel — covered fully by checks (1)-(6) above
  }

  // ── v2 cross-retailer field extraction (same as parseBillPdf) ──
  const serviceAddress    = parsed.service_address    || extractServiceAddress(text);
  const servicePostcode   = parsed.service_postcode   || extractPostcode(serviceAddress);
  const icpNumber         = parsed.icp_number         || extractICP(text);
  const networkDistributor= parsed.network_distributor|| extractDistributor(text);

  const enriched = {
    ...parsed,
    service_address:     serviceAddress,
    service_postcode:    servicePostcode,
    icp_number:          icpNumber,
    network_distributor: networkDistributor,
  };

  return {
    ...makeEmptyBill(),
    ...enriched,
    retailer: enriched.retailer || retailer.name,
    ocr_text_excerpt: text.slice(0, 4000),
    ocr_text_full: text,
    ocr_confidence: estimateConfidence(enriched),
    field_confidence: computeFieldConfidence(enriched),
    parse_errors: enriched.parse_errors || [],
    parse_warnings,
    // Only "suspect" if at least one warning explicitly marks suspect:true.
    // INFO-level entries (e.g. free_hours_partial_billing) don't trip the gate.
    parse_suspect: parse_warnings.some(w => w.suspect === true),
    raw_extracted_fields: enriched.raw_extracted_fields || {},
    file_name: opts.fileName || null,
  };
}
