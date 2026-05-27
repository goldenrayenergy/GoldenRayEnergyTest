// Generate the 3 initial QR codes (PNG + SVG, with logo overlay) and write
// them to disk. Standalone helper — useful for previewing or sending direct
// to the printer without going through the admin UI.
//
// Usage:
//   node scripts/generate-qr-files.js [baseUrl] [outDir]
//
//   baseUrl default: env QR_BASE_URL or vercel preview placeholder
//   outDir  default: ../qr-output/ (created if missing)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { generateQrPng, generateQrSvg, buildQrUrl } from '../services/qrGeneratorService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const SLUGS    = ['card', 'show-akl', 'flyer-mtr'];
const BASE_URL = process.argv[2] || process.env.QR_BASE_URL || 'https://goldenrayenergy-test.vercel.app';
const OUT_DIR  = path.resolve(process.argv[3] || path.join(__dirname, '../../qr-output'));

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log(`Base URL: ${BASE_URL}`);
console.log(`Output:   ${OUT_DIR}\n`);

for (const slug of SLUGS) {
  const url = buildQrUrl(BASE_URL, slug);
  console.log(`Generating /qr/${slug} → encodes: ${url}`);
  const png = await generateQrPng(url);
  writeFileSync(path.join(OUT_DIR, `goldenray-qr-${slug}.png`), png);
  console.log(`  ✓ PNG (${(png.length/1024).toFixed(1)} KB) → goldenray-qr-${slug}.png`);
  const svg = await generateQrSvg(url);
  writeFileSync(path.join(OUT_DIR, `goldenray-qr-${slug}.svg`), svg, 'utf8');
  console.log(`  ✓ SVG (${(svg.length/1024).toFixed(1)} KB) → goldenray-qr-${slug}.svg\n`);
}

console.log(`Done. 6 files in ${OUT_DIR}`);
