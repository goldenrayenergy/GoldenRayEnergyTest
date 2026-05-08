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

// ── Public entry point ────────────────────────────────────────────────────

export async function parseBillPdf(buffer, { fileName } = {}) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty PDF buffer');
  }

  let text;
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    text = result.text || '';
  } catch (e) {
    throw new Error('Failed to extract PDF text: ' + e.message);
  }

  if (!text.trim()) {
    return makeEmptyBill({
      ocr_text_excerpt: '',
      ocr_confidence: 0,
      parse_errors: [{ field: 'all', reason: 'PDF appears to be image-based (no text). OCR fallback not yet implemented — try a different PDF or contact support.' }],
    });
  }

  // Detect retailer
  const retailer = RETAILERS.find(r => r.match(text)) || GENERIC;

  let parsed;
  try {
    parsed = retailer.parse(text);
  } catch (e) {
    parsed = { parse_errors: [{ field: 'all', reason: `Parser threw: ${e.message}` }] };
  }

  // Normalise + add metadata
  return {
    ...makeEmptyBill(),
    ...parsed,
    retailer: parsed.retailer || retailer.name,
    ocr_text_excerpt: text.slice(0, 4000),
    ocr_confidence: estimateConfidence(parsed),
    parse_errors: parsed.parse_errors || [],
    file_name: fileName || null,
    file_size_bytes: buffer.length,
  };
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
    ocr_confidence: 0,
    ocr_text_excerpt: '',
    parse_errors: [],
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

// ── Retailer-specific parsers ─────────────────────────────────────────────

const MERCURY = {
  name: 'Mercury',
  match: (t) => /\bmercury\b/i.test(t) && /\b(NZ Energy|Mercury NZ|electricity)\b/i.test(t),
  parse: (t) => {
    const errors = [];
    const out = { retailer: 'Mercury', plan_name: null };

    // Plan name — Mercury uses "Homeline Standard" / "Homeline Saver" / similar
    const planMatch = t.match(/Homeline\s+(Standard|Saver|Plus)|Anytime|EveryDay/i);
    if (planMatch) out.plan_name = planMatch[0];

    // Billing period — Mercury format: "Period: 1 Jul 2025 to 31 Jul 2025"
    const periodMatch = pickFirst(t, [
      /(?:Billing\s+)?[Pp]eriod[:\s]+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(?:to|–|-)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
      /From\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(?:to|–|-)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
    ]);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Could not find billing period dates' });

    // Total kWh
    const kwhMatch = pickFirst(t, [
      /Total\s+kWh\s+used[:\s]+([\d,]+(?:\.\d+)?)/i,
      /(?:Energy|Electricity)\s+(?:charges?|usage)[\s\S]{0,200}?([\d,]+(?:\.\d+)?)\s*kWh/i,
      /([\d,]+(?:\.\d+)?)\s*kWh\s*@/,
    ]);
    if (kwhMatch) out.kwh_total = parseNum(kwhMatch[1]);
    else errors.push({ field: 'kwh_total', reason: 'kWh total not found' });

    // Total bill amount
    const totalMatch = pickFirst(t, [
      /Total\s+amount\s+due[:\s]+\$?([\d,]+\.\d{2})/i,
      /Amount\s+due[:\s]+\$?([\d,]+\.\d{2})/i,
      /Total\s+this\s+bill[:\s]+\$?([\d,]+\.\d{2})/i,
    ]);
    if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
    else errors.push({ field: 'total_nzd', reason: 'Total amount not found' });

    // Fixed charge
    const fixedMatch = t.match(/(?:Daily\s+(?:fixed\s+)?charge|Fixed\s+charge)[\s\S]{0,200}?\$?([\d,]+\.\d{2})/i);
    if (fixedMatch) out.fixed_charge_nzd = parseNum(fixedMatch[1]);

    // Variable charge — sum of energy charges
    const variableMatch = t.match(/(?:Energy|Variable|Electricity)\s+charges?[\s\S]{0,200}?\$?([\d,]+\.\d{2})/i);
    if (variableMatch) out.variable_charge_nzd = parseNum(variableMatch[1]);

    // GST
    const gstMatch = t.match(/GST(?:\s*\(15%\))?[\s\S]{0,80}?\$?([\d,]+\.\d{2})/i);
    if (gstMatch) out.gst_nzd = parseNum(gstMatch[1]);

    // Export (solar feed-in, if applicable)
    const exportMatch = t.match(/(?:Solar\s+(?:export|buyback|feed)|Export)\s+(?:credit|payment)?[\s\S]{0,150}?([\d,]+(?:\.\d+)?)\s*kWh.*?\$?([\d,]+\.\d{2})/i);
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

    const planMatch = t.match(/(Go\s+(?:Standard|Saver|Free)|Energy\s+IQ|Pulse|EnergyDuo)/i);
    if (planMatch) out.plan_name = planMatch[0];

    const periodMatch = pickFirst(t, [
      /(?:Reading|Billing)\s+period[:\s]+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(?:to|–|-)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
      /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(?:to|–|-)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
    ]);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Could not find billing period dates' });

    const kwhMatch = pickFirst(t, [
      /Total\s+(?:electricity|energy)\s+used[:\s]+([\d,]+(?:\.\d+)?)\s*kWh/i,
      /([\d,]+(?:\.\d+)?)\s*kWh\s+used/i,
      /([\d,]+(?:\.\d+)?)\s*kWh\s*@/,
    ]);
    if (kwhMatch) out.kwh_total = parseNum(kwhMatch[1]);
    else errors.push({ field: 'kwh_total', reason: 'kWh total not found' });

    const totalMatch = pickFirst(t, [
      /Total\s+this\s+bill[:\s]+\$?([\d,]+\.\d{2})/i,
      /Amount\s+(?:due|payable)[:\s]+\$?([\d,]+\.\d{2})/i,
    ]);
    if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
    else errors.push({ field: 'total_nzd', reason: 'Total amount not found' });

    const fixedMatch = t.match(/Daily\s+charge[\s\S]{0,200}?\$?([\d,]+\.\d{2})/i);
    if (fixedMatch) out.fixed_charge_nzd = parseNum(fixedMatch[1]);

    const variableMatch = t.match(/(?:Anytime|Variable|Energy)\s+rate[\s\S]{0,200}?\$?([\d,]+\.\d{2})/i);
    if (variableMatch) out.variable_charge_nzd = parseNum(variableMatch[1]);

    const gstMatch = t.match(/GST(?:\s*\(15%\))?[\s\S]{0,80}?\$?([\d,]+\.\d{2})/i);
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
  match: (t) => /\bcontact\s+energy\b/i.test(t) || /\bcontactenergy\.co\.nz\b/i.test(t),
  parse: (t) => {
    const errors = [];
    const out = { retailer: 'Contact Energy', plan_name: null };

    const planMatch = t.match(/(Standard\s+User|Free\s+Power\s+Saturdays|Bach\s+Plan|Anytime)/i);
    if (planMatch) out.plan_name = planMatch[0];

    const periodMatch = t.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*(?:to|–|-)\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
    if (periodMatch) {
      out.period_start = parseDate(periodMatch[1]);
      out.period_end   = parseDate(periodMatch[2]);
    } else errors.push({ field: 'period', reason: 'Could not find billing period dates' });

    const kwhMatch = pickFirst(t, [
      /([\d,]+(?:\.\d+)?)\s*kWh\s+used/i,
      /Total\s+used[:\s]+([\d,]+(?:\.\d+)?)\s*kWh/i,
      /Anytime[\s\S]{0,200}?([\d,]+(?:\.\d+)?)\s*kWh/i,
    ]);
    if (kwhMatch) out.kwh_total = parseNum(kwhMatch[1]);
    else errors.push({ field: 'kwh_total', reason: 'kWh total not found' });

    const totalMatch = pickFirst(t, [
      /Total\s+(?:to\s+pay|this\s+bill|amount)[:\s]+\$?([\d,]+\.\d{2})/i,
    ]);
    if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
    else errors.push({ field: 'total_nzd', reason: 'Total amount not found' });

    const fixedMatch = t.match(/(?:Daily|Fixed)\s+(?:charge|fee)[\s\S]{0,200}?\$?([\d,]+\.\d{2})/i);
    if (fixedMatch) out.fixed_charge_nzd = parseNum(fixedMatch[1]);

    const gstMatch = t.match(/GST(?:\s*\(15%\))?[\s\S]{0,80}?\$?([\d,]+\.\d{2})/i);
    if (gstMatch) out.gst_nzd = parseNum(gstMatch[1]);

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

const RETAILERS = [MERCURY, GENESIS, CONTACT, MERIDIAN, POWERSHOP];

// Also export a function to parse from already-extracted text (useful for
// testing without real PDFs and for systems where text extraction happens
// elsewhere — e.g. Tesseract OCR done client-side).
export function parseBillText(text, opts = {}) {
  const retailer = RETAILERS.find(r => r.match(text)) || GENERIC;
  let parsed;
  try { parsed = retailer.parse(text); }
  catch (e) { parsed = { parse_errors: [{ field: 'all', reason: `Parser threw: ${e.message}` }] }; }
  return {
    ...makeEmptyBill(),
    ...parsed,
    retailer: parsed.retailer || retailer.name,
    ocr_text_excerpt: text.slice(0, 4000),
    ocr_confidence: estimateConfidence(parsed),
    parse_errors: parsed.parse_errors || [],
    file_name: opts.fileName || null,
  };
}
