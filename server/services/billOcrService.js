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

    // ── kWh total — Mercury 2025 format ──
    // Patterns in order of preference:
    //   "Anytime 273 kWh x 20.96 cents $57.22"  — usage line for variable rate
    //   "Variable Usage Charge 550 kWh x ..."   — alt label
    //   "Total kWh used: 273"                    — older format
    //   "Units used 273 kWh"                     — meter table line
    //   "(actual) 273 kWh"                       — meter table fallback
    const kwhMatch = pickFirst(elec, [
      /(?:Anytime|Variable\s+Usage\s+Charge|Off[- ]?Peak|Day|Night)\s+([\d,]+(?:\.\d+)?)\s*kWh\s+x/i,
      /Total\s+kWh\s+used[:\s]+([\d,]+(?:\.\d+)?)/i,
      /Units\s+used[\s\S]{0,40}?([\d,]+(?:\.\d+)?)\s*kWh/i,
      /\(actual\)[\s\S]{0,80}?([\d,]+(?:\.\d+)?)\s*kWh\s*$/im,
      /([\d,]+(?:\.\d+)?)\s*kWh\s*@/,
    ]);
    if (kwhMatch) out.kwh_total = parseNum(kwhMatch[1]);
    else errors.push({ field: 'kwh_total', reason: 'kWh total not found in electricity section' });

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

    // ── Fixed charge — must capture $-amount, not the per-day rate (cents) ──
    // 2025 format: "Daily Fixed Charge 28 Days x 272.00 cents $76.16"
    // Capture the LAST $-amount on the line (the dollar total), not the rate.
    const fixedMatch = elec.match(/(?:Daily\s+(?:fixed\s+)?charge|Fixed\s+charge)[\s\S]{0,120}?\$([\d,]+\.\d{2})\s*$/im)
                    || elec.match(/(?:Daily\s+(?:fixed\s+)?charge|Fixed\s+charge)[\s\S]{0,200}?\$([\d,]+\.\d{2})(?!\s*cents)/i);
    if (fixedMatch) out.fixed_charge_nzd = parseNum(fixedMatch[1]);

    // ── Variable charge — the per-kWh dollar total on the usage line ──
    // 2025 format: "Anytime 273 kWh x 20.96 cents $57.22"
    const variableMatch = pickFirst(elec, [
      /(?:Anytime|Variable\s+Usage\s+Charge|Off[- ]?Peak|Day|Night)\s+[\d,]+(?:\.\d+)?\s*kWh\s+x\s+[\d.]+\s*cents\s+\$([\d,]+\.\d{2})/i,
      /(?:Energy|Variable|Electricity)\s+charges?[\s\S]{0,200}?\$([\d,]+\.\d{2})/i,
    ]);
    if (variableMatch) out.variable_charge_nzd = parseNum(variableMatch[1]);

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

    // ── kWh total ──
    // Commercial line: "Plus Standard Anytime 251409757 35564 37023 Actual 1459 @ 23.5200 c/unit 343.16"
    // Older format: "Total electricity used: 1,750 kWh"
    const kwhMatch = pickFirst(elec, [
      /Actual\s+([\d,]+(?:\.\d+)?)\s+@\s+[\d.]+\s*c\/unit/i,
      /([\d,]+(?:\.\d+)?)\s+@\s+[\d.]+\s*c\/unit/,
      /Total\s+(?:electricity|energy)\s+used[:\s]+([\d,]+(?:\.\d+)?)\s*kWh/i,
      /([\d,]+(?:\.\d+)?)\s*kWh\s+used/i,
      /([\d,]+(?:\.\d+)?)\s*kWh\s*@/,
    ]);
    if (kwhMatch) out.kwh_total = parseNum(kwhMatch[1]);
    else errors.push({ field: 'kwh_total', reason: 'kWh total not found' });

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

    // ── Fixed charge — "30 days @ 267.4900 c/day 80.25" ──
    const fixedMatch = pickFirst(elec, [
      /\d+\s+days\s+@\s+[\d.]+\s*c\/day\s+([\d,]+\.\d{2})/i,
      /Daily\s+(?:Fixed\s+|Charge)[\s\S]{0,200}?\$?\s*([\d,]+\.\d{2})/i,
    ]);
    if (fixedMatch) out.fixed_charge_nzd = parseNum(fixedMatch[1]);

    // ── Variable charge — "1459 @ 23.5200 c/unit 343.16" ──
    const variableMatch = pickFirst(elec, [
      /[\d,]+\s+@\s+[\d.]+\s*c\/unit\s+([\d,]+\.\d{2})/i,
      /(?:Anytime|Variable|Energy)\s+rate[\s\S]{0,200}?\$?\s*([\d,]+\.\d{2})/i,
    ]);
    if (variableMatch) out.variable_charge_nzd = parseNum(variableMatch[1]);

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

    // ── Scope to the electricity *detail* section (page 2), not the page-1 summary ──
    // Contact bills can bundle broadband, mobile, and gas. The page-1 summary
    // shows aggregate amounts only — the per-kWh detail with rates lives in
    // the "Energy used by …" section on page 2. We slice from there to the
    // next non-electricity detail section so the parser sees only the electricity
    // line items it can compute against.
    let elec = t;
    const elecStart = t.search(/Energy\s+used\s+by/i);
    if (elecStart >= 0) {
      const remaining = t.slice(elecStart);
      // Cut at the *next* "Broadband charges" / "Gas charges" header (skip
      // the slice's own start) so we keep the electricity detail.
      const cutMatch = remaining.slice(20).search(/Broadband\s+charges|Mobile\s+charges|Gas\s+charges|Bottled\s+gas/i);
      elec = cutMatch >= 0 ? remaining.slice(0, cutMatch + 20) : remaining;
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

    // ── Fixed charge — "Fixed daily charges $91.45" or "Fixed charges total $91.45" ──
    const fixedMatch = pickFirst(t, [
      /Fixed\s+charges\s+total[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
      /Fixed\s+daily\s+charges[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
      /(?:Daily|Fixed)\s+(?:charge|fee)[\s\S]{0,200}?\$([\d,]+\.\d{2})/i,
    ]);
    if (fixedMatch) out.fixed_charge_nzd = parseNum(fixedMatch[1]);

    // ── Variable charge — "Variable charges $63.58" or "Variable charges total $63.58" ──
    const variableMatch = pickFirst(t, [
      /Variable\s+charges\s+total[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
      /Variable\s+charges[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
    ]);
    if (variableMatch) out.variable_charge_nzd = parseNum(variableMatch[1]);

    // ── Total — prefer pure-electricity computed total over combined bill total ──
    // Contact's "Total amount due" includes broadband. If we have fixed + variable,
    // compute the true electricity total (incl GST). Otherwise fall back to bill total.
    if (out.fixed_charge_nzd != null && out.variable_charge_nzd != null) {
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

    // ── Variable charge — "Total Energy $437.75" ──
    const variableMatch = t.match(/Total\s+Energy[\s\S]{0,40}?\$([\d,]+\.\d{2})/i);
    if (variableMatch) out.variable_charge_nzd = parseNum(variableMatch[1]);

    // ── Fixed charge — sum of "X Days @ Y.000 $Z.ZZ" lines for fixed-daily items ──
    // Pulse's "Total Delivery" mixes per-kWh network charges with per-day fixed
    // charges, so we sum the unambiguous daily lines instead.
    const dayLines = [...t.matchAll(/(Metering|Network\s+Services\s+Fixed\s+Daily|Retailer\s+Services|Daily\s+Fixed\s+Charge)[\s\S]{0,30}?\d+\s+Days[\s\S]{0,40}?\$([\d,]+\.\d{2})/gi)];
    if (dayLines.length) {
      out.fixed_charge_nzd = +dayLines.reduce((sum, m) => sum + parseNum(m[2]), 0).toFixed(2);
    }

    // ── Total — "Current Electricity Charges (including GST) $1,335.39" ──
    // Prefer this over "Total Current Amount Due" which can include opening balance.
    const totalMatch = pickFirst(t, [
      /Current\s+Electricity\s+Charges\s+\(including\s+GST\)[\s\S]{0,40}?\$([\d,]+\.\d{2})/i,
      /Electricity\s+Charges[\s\S]{0,20}?\$([\d,]+\.\d{2})/i,
      /Total\s+Current\s+Amount\s+Due[\s\S]{0,80}?\$([\d,]+\.\d{2})/i,
    ]);
    if (totalMatch) out.total_nzd = parseNum(totalMatch[1]);
    else errors.push({ field: 'total_nzd', reason: 'Total amount not found' });

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
