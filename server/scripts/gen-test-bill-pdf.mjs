// Generates a synthetic Mercury Energy bill PDF for a given address, so E2E
// tests can upload a real file (not a URL shortcut) and prove the FULL flow.
//
// Usage:
//   node server/scripts/gen-test-bill-pdf.mjs                          # all defaults
//   node server/scripts/gen-test-bill-pdf.mjs --address="6 Woodacre Street" --suburb="Flat Bush, Auckland 2019" --kwh=850 --out=woodacre-bill.pdf
//
// Output default: server/scripts/test-fixtures/e2e-test-bill.pdf

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'test-fixtures');

// ── CLI args ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv);
const CFG = {
  address:   args.address || '25 Commodore Drive',
  suburb:    args.suburb  || 'Lynfield, Auckland 1042',
  kwh:       Number(args.kwh)    || 700,
  days:      Number(args.days)   || 30,
  rate:      Number(args.rate)   || 30,    // cents per kWh
  fixed:     Number(args.fixed)  || 135,   // cents per day
  billNo:    args.billNo || '2609876543',
  icp:       args.icp || '0000123456AB789',
  outFile:   args.out || 'e2e-test-bill.pdf',
};
CFG.variableCents = Math.round(CFG.kwh * CFG.rate);
CFG.fixedCents    = CFG.fixed * CFG.days;
CFG.subtotalCents = CFG.variableCents + CFG.fixedCents;
CFG.gstCents      = Math.round(CFG.subtotalCents * 0.15);
CFG.totalCents    = CFG.subtotalCents + CFG.gstCents;

const fmt$ = (cents) => `$ ${(cents / 100).toFixed(2)}`;

// ── Bill content ──────────────────────────────────────────────────────────
// Follows Mercury Energy bill format so the retailer-specific regex parser
// (server/services/billOcrService.js -> MERCURY) recognizes the fields.
const BILL_TEXT = [
  'MERCURY',
  'Mercury NZ Limited',
  'mercury.co.nz',
  'PO Box 90399, Victoria Street West, Auckland 1142',
  'GST number: 12-345-678',
  '',
  'TAX INVOICE',
  '',
  `Bill number:    ${CFG.billNo}`,
  'Issue date:     01 August 2026',
  'Due date:       15 August 2026',
  '',
  'ACCOUNT HOLDER',
  'Name:            E2E Test Customer',
  'Account number:  123-456-789',
  '',
  'SERVICE ADDRESS',
  `Property:        ${CFG.address}`,
  `Suburb:          ${CFG.suburb}`,
  '',
  `ICP number:      ${CFG.icp}`,
  'Meter number:    E9876543210',
  'Tariff plan:     Anytime Standard',
  'Network:         Vector Auckland',
  '',
  'ELECTRICITY',
  '',
  `Billing period 30 June 2026 to ${(30 + CFG.days) > 31 ? '30 July' : (30 + CFG.days) + ' June'} 2026`,
  '',
  `Anytime            ${CFG.kwh.toFixed(1)} kWh x ${CFG.rate.toFixed(2)} cents  = ${fmt$(CFG.variableCents)}`,
  `Daily fixed charge    ${CFG.days} days x   ${CFG.fixed} cents = ${fmt$(CFG.fixedCents)}`,
  '',
  `Total kWh used: ${CFG.kwh.toFixed(1)}`,
  '',
  'CHARGES BREAKDOWN',
  `Variable charge:       ${fmt$(CFG.variableCents)}`,
  `Subtotal excl. GST:    ${fmt$(CFG.subtotalCents)}`,
  `GST (15%):             ${fmt$(CFG.gstCents)}`,
  `Total electricity      ${fmt$(CFG.totalCents)}`,
  `TOTAL INCL. GST:       ${fmt$(CFG.totalCents)}`,
  '',
  `Your total usage for the last 365 days is ${Math.round(CFG.kwh * 365 / CFG.days)} units (kWh).`,
  '',
  'RATES ON YOUR PLAN',
  `Anytime rate:          ${CFG.rate.toFixed(2)} c/kWh`,
  `Daily fixed:           $ ${(CFG.fixed / 100).toFixed(2)} per day`,
  '',
  'HOW TO PAY',
  'Direct debit:  Automatic on due date',
  'Internet:      Bank: 12-3456-7890123-00',
  'Reference:     123456789',
  '',
  'CONTACT MERCURY',
  'Phone:      0800 MERCURY (0800 637 2879)',
  'Web:        mercury.co.nz',
  '',
  'This bill has been generated for E2E testing.',
  'Any resemblance to a real customer bill is intentional to test the parser.',
];

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const OUT_FILE = path.join(OUT_DIR, CFG.outFile);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);   // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const size = 11;
  const startY = 800;
  const lineHeight = 16;

  BILL_TEXT.forEach((line, i) => {
    page.drawText(line, {
      x: 50,
      y: startY - i * lineHeight,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  });

  const bytes = await pdf.save();
  await fs.writeFile(OUT_FILE, bytes);
  console.log(`✓ Wrote synthetic bill PDF: ${OUT_FILE} (${bytes.length} bytes)`);
  console.log(`  address=${CFG.address}, suburb=${CFG.suburb}, kwh=${CFG.kwh}, days=${CFG.days}`);
}

main().catch(e => { console.error(e); process.exit(1); });
