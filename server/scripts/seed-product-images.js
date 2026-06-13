// ────────────────────────────────────────────────────────────────────────────
// Phase C-1 seed — creates the pm-product-images PUBLIC bucket and uploads
// 4 representative product photos from mockups/3-quote-sample-haldankar/.
// Sets products.image_url on the matching SKUs. Idempotent.
//
// Run: node server/scripts/seed-product-images.js
//
// In Phase C-9 this gets superseded by an admin UI for image upload, but for
// C-1 verification we need at least a handful of SKUs with real photos so
// the Components page renders something other than placeholders.
//
// SKUs deliberately limited to 4 — one per hardware kind. Adding the rest
// is admin-UI work (C-9), not engine work.
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const BUCKET = 'pm-product-images';
const MOCKUP_DIR = path.resolve(__dirname, '../../mockups/3-quote-sample-haldankar');

// SKU → local file mapping. Each entry includes the destination path inside
// the bucket (organised by category so future admin uploads have a sane
// folder structure).
const SEEDS = [
  { sku: 'PHN-PNL-475-QSR',     file: 'Quasar-54-front-BW.png',
    contentType: 'image/png',  dest: 'panels/PHN-PNL-475-QSR.png' },
  { sku: 'FRN-INV-100-G24P-1P', file: 'GEN24-PRIMO.jpg',
    contentType: 'image/jpeg', dest: 'inverters/FRN-INV-100-G24P-1P.jpg' },
  { sku: 'FRN-BAT-315-RSV',     file: 'SE_Product_Image_Product_Rendering_Fronius_Reserva__5_Modules_.jpg',
    contentType: 'image/jpeg', dest: 'batteries/FRN-BAT-315-RSV.jpg' },
  { sku: 'FRN-MTR-63-S1P',      file: 'SE_WPIC_Fronius_Smart_Meter_63A-1_rdax_100.jpg',
    contentType: 'image/jpeg', dest: 'smart-meters/FRN-MTR-63-S1P.jpg' },
];

// ── 1. Ensure the public bucket exists ─────────────────────────────────────
async function ensureBucket() {
  const { data: buckets, error } = await sb.storage.listBuckets();
  if (error) throw new Error(`listBuckets failed: ${error.message}`);
  if (buckets?.some(b => b.name === BUCKET)) {
    console.log(`✓ Bucket ${BUCKET} already exists`);
    return;
  }
  const { error: cErr } = await sb.storage.createBucket(BUCKET, { public: true });
  if (cErr) throw new Error(`createBucket failed: ${cErr.message}`);
  console.log(`✓ Created public bucket ${BUCKET}`);
}

// ── 2. Upload + set products.image_url ─────────────────────────────────────
async function seedOne(seed) {
  const localPath = path.join(MOCKUP_DIR, seed.file);
  if (!existsSync(localPath)) {
    console.log(`✗ ${seed.sku}: source file missing (${seed.file}) — skipped`);
    return false;
  }
  const buffer = readFileSync(localPath);
  const { error: uErr } = await sb.storage.from(BUCKET).upload(seed.dest, buffer, {
    contentType: seed.contentType,
    upsert: true,
  });
  if (uErr) throw new Error(`${seed.sku}: upload failed — ${uErr.message}`);

  const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(seed.dest);
  const publicUrl = urlData.publicUrl;

  const { error: upErr } = await sb.from('products')
    .update({ image_url: publicUrl })
    .eq('sku', seed.sku);
  if (upErr) throw new Error(`${seed.sku}: db update failed — ${upErr.message}`);

  console.log(`✓ ${seed.sku.padEnd(22)} → ${seed.dest} (${(buffer.length / 1024).toFixed(0)} KB)`);
  return true;
}

await ensureBucket();
console.log();
let okCount = 0;
for (const seed of SEEDS) {
  if (await seedOne(seed)) okCount++;
}
console.log(`\nSeeded ${okCount}/${SEEDS.length} products with image_url.`);

// Verification
const { data: verify } = await sb.from('products')
  .select('sku, image_url')
  .in('sku', SEEDS.map(s => s.sku));
console.log('\nVerification (products.image_url):');
for (const v of verify || []) {
  console.log(`  ${v.sku.padEnd(22)} ${v.image_url ? '✓' : '✗ MISSING'}`);
}
