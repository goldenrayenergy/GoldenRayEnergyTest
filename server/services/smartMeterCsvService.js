// ════════════════════════════════════════════════════════════════════════════
// smartMeterCsvService.js — Deploy #4 / Track 6
//
// Parses smart-meter usage CSVs from the four NZ data sources customers
// most commonly export from:
//
//   • Mercury  myAccount  → "Energy Usage" CSV
//   • Genesis  Energy IQ  → "Detailed Usage" CSV
//   • Contact  app/web    → "Usage Data" CSV
//   • Powerswitch         → standardised consumer-NZ format
//
// Smart-meter exports are more accurate than monthly bills (half-hourly
// granularity vs whole-month aggregate). We convert them to monthly buckets
// matching the shape produced by the existing tabular row entry path
// (server/routes/billAnalysis.js /tabular) — so the same analyzeBills()
// pipeline downstream consumes both. Only the ingest stage is new.
//
// Public API:
//
//   parseSmartMeterCsv(buffer | text, opts)
//     → { source: 'mercury' | 'genesis' | 'contact' | 'powerswitch' | 'generic',
//         monthly_rows: [{ days, kwh, usage_nzd?, total_nzd?, month_year }, …],
//         granularity:  'half_hourly' | 'hourly' | 'daily' | 'monthly',
//         row_count: N,
//         date_range: { start: ISO, end: ISO },
//         warnings: [{ code, reason }],
//       }
//
// Detection scheme: header-sniff first (each retailer prints a recognisable
// column name); fall back to a generic Date+kWh parser if nothing matches.
// Date format auto-detected per file (DD/MM/YYYY vs YYYY-MM-DD vs DD-MMM-YYYY).
// ════════════════════════════════════════════════════════════════════════════

// ── CSV row reader (no external dep — light parser sufficient for these files) ──
// Smart-meter CSVs are well-formed: simple comma separation, sometimes
// double-quoted strings. No multiline cells, no escape complexity. A 30-line
// parser handles every retailer format we've seen.
function parseCsvRows(text) {
  const out = [];
  // Normalise line endings and strip BOM if Excel-exported
  const cleaned = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  for (const rawLine of cleaned.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Split on commas not inside double-quotes
    const cells = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    out.push(cells);
  }
  return out;
}

// ── Date parsing — auto-detect format across the file ─────────────────────
// Smart-meter exports use a mix: 2025-01-31 (ISO, Mercury), 31/01/2025
// (Genesis NZ), 31-Jan-2025 (Contact), 2025/01/31 (Powerswitch). We detect
// by inspecting the first valid-looking date cell and apply the same format
// to all rows in the file.
function detectDateFormat(samples) {
  for (const s of samples) {
    if (/^\d{4}-\d{2}-\d{2}/.test(s))            return 'iso';            // 2025-01-31
    if (/^\d{4}\/\d{2}\/\d{2}/.test(s))          return 'iso_slash';      // 2025/01/31
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s))      return 'nz_slash';       // 31/01/2025
    if (/^\d{1,2}-[A-Za-z]{3}-\d{4}/.test(s))    return 'nz_mmm';         // 31-Jan-2025
    if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(s))return 'nz_mmm_space';   // 31 Jan 2025
    if (/^\d{1,2}-\d{1,2}-\d{4}/.test(s))        return 'nz_dash';        // 31-01-2025
  }
  return null;
}

const MMM_TO_NUM = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

function parseDateCell(s, fmt) {
  if (!s) return null;
  const v = String(s).trim();
  let y, mo, d;
  try {
    switch (fmt) {
      case 'iso': {
        const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (!m) return null;
        [, y, mo, d] = m;
        break;
      }
      case 'iso_slash': {
        const m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!m) return null;
        [, y, mo, d] = m;
        break;
      }
      case 'nz_slash': {
        const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (!m) return null;
        [, d, mo, y] = m;
        break;
      }
      case 'nz_dash': {
        const m = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
        if (!m) return null;
        [, d, mo, y] = m;
        break;
      }
      case 'nz_mmm':
      case 'nz_mmm_space': {
        const sep = fmt === 'nz_mmm' ? '-' : '\\s+';
        const m = v.match(new RegExp(`^(\\d{1,2})${sep}([A-Za-z]{3})${sep}(\\d{4})`));
        if (!m) return null;
        d = m[1];
        mo = MMM_TO_NUM[m[2].toLowerCase()];
        y = m[3];
        break;
      }
      default: return null;
    }
    const yi = parseInt(y, 10), mi = parseInt(mo, 10), di = parseInt(d, 10);
    if (!yi || !mi || !di || mi < 1 || mi > 12 || di < 1 || di > 31) return null;
    return `${yi}-${String(mi).padStart(2, '0')}-${String(di).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function parseNum(s) {
  if (s == null || s === '') return null;
  const v = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return isFinite(v) ? v : null;
}

function ymKey(isoDate) { return isoDate ? isoDate.slice(0, 7) : null; }

// ── Granularity detection ─────────────────────────────────────────────────
// Determines whether the file's rows are half-hourly, hourly, daily, or
// monthly. Strategy: count rows-per-date across the whole stream. High
// row counts per date (40+) ⇒ half-hourly; 20+ ⇒ hourly; etc. Falls back
// to date-span between unique dates only when rows-per-date is ambiguous.
function detectGranularity(parsedRows) {
  if (parsedRows.length < 2) return 'unknown';

  // Count rows per date (whole stream — but cap at 200 for cost). For a
  // half-hourly file with 17k rows we'd see ~48 rows per date even in a
  // small sample; for a daily file we'd see exactly 1.
  const rowsPerDate = {};
  const cap = Math.min(parsedRows.length, 200);
  for (let i = 0; i < cap; i++) {
    const d = parsedRows[i].date;
    if (d) rowsPerDate[d] = (rowsPerDate[d] || 0) + 1;
  }
  const dateCount = Object.keys(rowsPerDate).length;
  if (dateCount === 0) return 'unknown';

  // Take the MODE of rows-per-date rather than mean — outliers (partial
  // first/last day) can skew the mean below the granularity threshold.
  const counts = Object.values(rowsPerDate).sort((a, b) => b - a);
  const modeRowsPerDate = counts[Math.floor(counts.length / 2)] || counts[0];

  if (modeRowsPerDate >= 40) return 'half_hourly';   // 48 readings/day
  if (modeRowsPerDate >= 20) return 'hourly';        // 24 readings/day
  if (modeRowsPerDate >= 2)  return 'sub_daily';     // some peak/offpeak split

  // mode is 1 (one row per date) — distinguish daily from monthly by the
  // typical spacing between consecutive unique dates.
  if (dateCount < 2) return 'daily';   // single-day file
  const sortedDates = Object.keys(rowsPerDate).sort();
  const d1 = new Date(sortedDates[0] + 'T00:00:00Z');
  const d2 = new Date(sortedDates[1] + 'T00:00:00Z');
  const spanDays = Math.abs((d2 - d1) / 86400000);
  if (spanDays >= 25) return 'monthly';
  return 'daily';
}

// ── Aggregate parsed-row stream to monthly buckets ────────────────────────
// Each bucket is shaped like a manually-entered table row so the existing
// /api/bill-analysis/tabular synthesise → analyzeBills pipeline can consume
// it unchanged. days = actual coverage days for the bucket; kwh = sum;
// usage_nzd = sum of cost column (null if file has no cost data).
function aggregateMonthly(parsedRows) {
  const buckets = new Map();
  for (const r of parsedRows) {
    if (!r.date || r.kwh == null) continue;
    const key = ymKey(r.date);
    if (!key) continue;
    if (!buckets.has(key)) {
      buckets.set(key, {
        month_year: key,
        kwh: 0,
        usage_nzd: 0,
        usage_nzd_present: false,
        days: new Set(),
      });
    }
    const b = buckets.get(key);
    b.kwh += r.kwh;
    if (r.cost != null) {
      b.usage_nzd += r.cost;
      b.usage_nzd_present = true;
    }
    b.days.add(r.date);
  }
  // Materialise: round, drop usage_nzd when not present, sort chronologically
  return [...buckets.values()]
    .sort((a, b) => a.month_year.localeCompare(b.month_year))
    .map(b => ({
      month_year: b.month_year,
      days:       b.days.size,
      kwh:        +b.kwh.toFixed(2),
      usage_nzd:  b.usage_nzd_present ? +b.usage_nzd.toFixed(2) : null,
      // total_nzd left null — smart-meter exports don't include fixed daily
      // charges or GST. The downstream analyser handles a missing total_nzd
      // gracefully by computing one from kWh × retailer rate.
      total_nzd:  null,
      fixed_nzd:  null,
    }));
}

// ── Per-retailer header sniffers + column extractors ──────────────────────
//
// Each parser receives the raw cell rows (array of arrays) and returns
// { rows: [{date, kwh, cost?}], retailer: string } or null if the format
// doesn't match. The dispatcher tries each in order; first match wins.

// Mercury "Energy Usage" CSV exports from myAccount.
//
// Known column layouts seen in the wild:
//   (A) Date,Time,Energy Used (kWh)                           ← half-hourly
//   (B) Date,Day total (kWh),Off-peak (kWh),Peak (kWh)        ← daily TOU
//   (C) Date,Usage (kWh),Cost ($)                             ← daily + cost
//
// All 3 use ISO YYYY-MM-DD dates. Header row always present, kWh column
// always labelled with "kWh" somewhere. Identified by the file referring
// to Mercury or having no retailer header but ISO dates + half-hour times.
const MERCURY = {
  name: 'mercury',
  match: (rows) => {
    const header = (rows[0] || []).map(c => c.toLowerCase()).join('|');
    return /mercury/.test(header)
        || (/energy\s*used.*kwh/.test(header) && rows.length > 30);
  },
  parse: (rows, dateFmt) => {
    const headerCells = rows[0].map(c => c.toLowerCase());
    const dateCol  = headerCells.findIndex(c => /date/.test(c));
    // Energy column — try "energy used", "usage", "kwh", "day total" in order
    const kwhCol   = headerCells.findIndex(c => /energy\s*used.*kwh|usage.*kwh|day\s*total/.test(c))
                  ?? headerCells.findIndex(c => /kwh/i.test(c));
    const costCol  = headerCells.findIndex(c => /cost|amount|\$/.test(c));
    if (dateCol < 0 || kwhCol < 0) return null;

    const parsed = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDateCell(r[dateCol], dateFmt);
      const kwh  = parseNum(r[kwhCol]);
      const cost = costCol >= 0 ? parseNum(r[costCol]) : null;
      if (date && kwh != null) parsed.push({ date, kwh, cost });
    }
    return parsed.length ? { rows: parsed, retailer: 'Mercury' } : null;
  },
};

// Genesis "Detailed Usage" CSV from Energy IQ.
//
// Known column layouts:
//   "Read Date","Time","Usage (kWh)","Cost ($)"             ← half-hourly
//   "Date","kWh"                                            ← daily summary
//
// Dates often DD/MM/YYYY (NZ format). Identified by "Read Date" header
// or by the file containing "Genesis" anywhere in the first 5 rows.
const GENESIS = {
  name: 'genesis',
  match: (rows) => {
    const top = rows.slice(0, 5).map(r => r.join('|').toLowerCase()).join('\n');
    return /genesis/.test(top)
        || /read\s*date/.test(top);
  },
  parse: (rows, dateFmt) => {
    const headerCells = rows[0].map(c => c.toLowerCase());
    const dateCol = headerCells.findIndex(c => /date/.test(c));
    const kwhCol  = headerCells.findIndex(c => /kwh|usage/.test(c) && !/cost/.test(c));
    const costCol = headerCells.findIndex(c => /cost|\$/.test(c));
    if (dateCol < 0 || kwhCol < 0) return null;

    const parsed = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDateCell(r[dateCol], dateFmt);
      const kwh  = parseNum(r[kwhCol]);
      const cost = costCol >= 0 ? parseNum(r[costCol]) : null;
      if (date && kwh != null) parsed.push({ date, kwh, cost });
    }
    return parsed.length ? { rows: parsed, retailer: 'Genesis' } : null;
  },
};

// Contact Energy "Usage Data" CSV from the app/web export.
//
// Known column layout:
//   Date,Half-hour ending,Consumption (kWh)                ← half-hourly
//   Date,Total kWh                                          ← daily
//
// Dates often DD-MMM-YYYY. Identified by "Consumption" header or "Contact"
// in header rows.
const CONTACT = {
  name: 'contact',
  match: (rows) => {
    const top = rows.slice(0, 5).map(r => r.join('|').toLowerCase()).join('\n');
    return /contact\s*energy/.test(top)
        || /consumption.*kwh/.test(top)
        || /half[- ]hour\s+ending/.test(top);
  },
  parse: (rows, dateFmt) => {
    const headerCells = rows[0].map(c => c.toLowerCase());
    const dateCol = headerCells.findIndex(c => /date/.test(c));
    const kwhCol  = headerCells.findIndex(c => /consumption.*kwh|total\s*kwh|kwh/.test(c));
    const costCol = headerCells.findIndex(c => /cost|amount|\$/.test(c));
    if (dateCol < 0 || kwhCol < 0) return null;

    const parsed = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDateCell(r[dateCol], dateFmt);
      const kwh  = parseNum(r[kwhCol]);
      const cost = costCol >= 0 ? parseNum(r[costCol]) : null;
      if (date && kwh != null) parsed.push({ date, kwh, cost });
    }
    return parsed.length ? { rows: parsed, retailer: 'Contact Energy' } : null;
  },
};

// Powerswitch (Consumer NZ) standardised consumer format.
//
// Documented schema:
//   Date,kWh                                                ← daily, ISO dates
// This is the format Consumer NZ recommends for uploading usage data to
// their price comparison tool, so it's the cleanest "neutral" format.
// Identified by exactly 2 columns and a "kwh" header.
const POWERSWITCH = {
  name: 'powerswitch',
  match: (rows) => {
    if (!rows[0] || rows[0].length !== 2) return false;
    const header = rows[0].map(c => c.toLowerCase()).join('|');
    return /\bkwh\b/.test(header) && /\bdate\b/.test(header);
  },
  parse: (rows, dateFmt) => {
    const headerCells = rows[0].map(c => c.toLowerCase());
    const dateCol = headerCells.findIndex(c => /date/.test(c));
    const kwhCol  = headerCells.findIndex(c => /kwh/.test(c));
    if (dateCol < 0 || kwhCol < 0) return null;
    const parsed = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDateCell(r[dateCol], dateFmt);
      const kwh  = parseNum(r[kwhCol]);
      if (date && kwh != null) parsed.push({ date, kwh });
    }
    return parsed.length ? { rows: parsed, retailer: 'Powerswitch (generic)' } : null;
  },
};

// Generic fallback — last chance for unknown formats. Tries the first
// column for dates and the first numeric column for kWh.
const GENERIC = {
  name: 'generic',
  match: () => true,
  parse: (rows, dateFmt) => {
    const headerCells = rows[0].map(c => c.toLowerCase());
    let dateCol = headerCells.findIndex(c => /date|time/.test(c));
    if (dateCol < 0) dateCol = 0;
    let kwhCol  = headerCells.findIndex(c => /kwh/.test(c));
    if (kwhCol < 0) {
      // Fall back to first column other than date that's numeric in row 1
      for (let i = 0; i < (rows[1] || []).length; i++) {
        if (i === dateCol) continue;
        if (parseNum(rows[1][i]) != null) { kwhCol = i; break; }
      }
    }
    if (dateCol < 0 || kwhCol < 0) return null;

    const parsed = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDateCell(r[dateCol], dateFmt);
      const kwh  = parseNum(r[kwhCol]);
      if (date && kwh != null) parsed.push({ date, kwh });
    }
    return parsed.length ? { rows: parsed, retailer: 'Unknown (generic CSV)' } : null;
  },
};

const PARSERS = [MERCURY, GENESIS, CONTACT, POWERSWITCH, GENERIC];

// ── Public entry point ────────────────────────────────────────────────────
export function parseSmartMeterCsv(input, opts = {}) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    return {
      source: null,
      monthly_rows: [],
      granularity: 'unknown',
      row_count: 0,
      date_range: { start: null, end: null },
      warnings: [{ code: 'empty_csv', reason: 'CSV had no parseable rows.' }],
    };
  }

  // Detect date format from the first 10 likely-date cells (any column)
  const dateSamples = [];
  for (let i = 1; i < Math.min(11, rows.length); i++) {
    for (const c of rows[i]) {
      if (/\d{1,4}[-/\s][A-Za-z\d]{1,4}[-/\s]\d{2,4}/.test(c)) {
        dateSamples.push(c);
        break;
      }
    }
  }
  const dateFmt = detectDateFormat(dateSamples);
  if (!dateFmt) {
    return {
      source: null,
      monthly_rows: [],
      granularity: 'unknown',
      row_count: rows.length - 1,
      date_range: { start: null, end: null },
      warnings: [{ code: 'unknown_date_format', reason: 'Could not detect a date column in a recognised NZ format.' }],
    };
  }

  // Dispatch to the first matching parser
  let result = null;
  let matchedSource = null;
  for (const p of PARSERS) {
    if (!p.match(rows)) continue;
    const r = p.parse(rows, dateFmt);
    if (r) { result = r; matchedSource = p.name; break; }
  }
  if (!result) {
    return {
      source: null,
      monthly_rows: [],
      granularity: 'unknown',
      row_count: rows.length - 1,
      date_range: { start: null, end: null },
      warnings: [{ code: 'unrecognised_csv', reason: 'CSV format does not match any known smart-meter export schema.' }],
    };
  }

  const granularity = detectGranularity(result.rows);
  const monthly     = aggregateMonthly(result.rows);
  const dates       = result.rows.map(r => r.date).filter(Boolean).sort();

  const warnings = [];
  if (monthly.length === 0) {
    warnings.push({ code: 'no_monthly_buckets', reason: 'Parsed CSV but could not aggregate any monthly buckets.' });
  }
  if (monthly.length < 3) {
    warnings.push({ code: 'short_history', reason: `Only ${monthly.length} month(s) of data — projections will be less reliable.` });
  }
  // Sanity: a daily-granularity file should produce ~28-31 unique dates per bucket
  for (const b of monthly) {
    if (granularity === 'daily' && (b.days < 25 || b.days > 31)) {
      warnings.push({ code: 'partial_month', reason: `Month ${b.month_year} has ${b.days} days — partial coverage.` });
    }
  }

  return {
    source:        matchedSource,
    retailer:      result.retailer,
    monthly_rows:  monthly,
    granularity,
    row_count:     result.rows.length,
    date_range:    { start: dates[0] || null, end: dates[dates.length - 1] || null },
    warnings,
  };
}
