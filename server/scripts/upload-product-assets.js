// Downloads product images + datasheets from the source URLs in
// product-assets-manifest.json, re-uploads them to Supabase storage
// (pm-product-images / product-datasheets), and sets products.image_url /
// products.datasheet_url on the matching rows.
//
// Use --dry-run to probe every URL with HEAD and stop before any download or
// DB write. The dry-run is the safety check — if any URL 404s, the upload run
// is aborted before touching production data.
//
// Usage:
//   node scripts/upload-product-assets.js --dry-run
//   node scripts/upload-product-assets.js
//
// Idempotent — storage upserts on the same path, DB updates by id. Safe to
// re-run.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const dryRun = process.argv.includes('--dry-run');

const IMAGE_BUCKET = 'pm-product-images';
const DATASHEET_BUCKET = 'product-datasheets';

const manifestPath = path.resolve(__dirname, 'product-assets-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// ──────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────

function extFromContentType(ct) {
  if (!ct) return null;
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('pdf')) return 'pdf';
  return null;
}

function extFromUrl(url) {
  const m = url.match(/\.(webp|png|jpg|jpeg|pdf)(\?|$)/i);
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === 'jpeg' ? 'jpg' : e;
}

async function probe(url) {
  try {
    // Some CDNs reject HEAD — fall back to range GET with 0 bytes.
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (!res.ok || !res.headers.get('content-type')) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
      });
    }
    return {
      ok: res.ok || res.status === 206,
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentLength: Number(res.headers.get('content-length') || 0),
    };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType: res.headers.get('content-type') };
}

async function resolveProduct({ sku, name_match }) {
  if (sku != null && sku !== '') {
    const { data } = await sb.from('products').select('id, sku, name').eq('sku', sku).maybeSingle();
    return data || null;
  }
  if (name_match) {
    const { data } = await sb.from('products')
      .select('id, sku, name')
      .or(`sku.is.null,sku.eq.`)
      .ilike('name', `%${name_match}%`)
      .maybeSingle();
    return data || null;
  }
  return null;
}

async function uploadAsset({ filename, kind, type, buf, contentType }) {
  const bucket = type === 'image' ? IMAGE_BUCKET : DATASHEET_BUCKET;
  const ext = type === 'image'
    ? extFromContentType(contentType) || 'webp'
    : 'pdf';
  const storagePath = `${kind}/${filename}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(storagePath, buf, {
    contentType: contentType || (type === 'image' ? 'image/webp' : 'application/pdf'),
    upsert: true,
  });
  if (error) throw new Error(`storage upload ${bucket}/${storagePath}: ${error.message}`);
  const { data } = sb.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-family processor
// ──────────────────────────────────────────────────────────────────────────

async function processFamily(family) {
  const skusLabel = family.skus.map(s => s === null ? `(null→match "${family.sku_name_match}")` : s).join(', ');
  console.log(`\n■ ${family.label}`);
  console.log(`  SKUs: ${skusLabel}`);
  if (family.confidence !== 'high') console.log(`  ⚠ confidence: ${family.confidence}${family.notes ? ` — ${family.notes}` : ''}`);

  const issues = [];

  // 1. Probe image URL
  if (family.image_url) {
    const p = await probe(family.image_url);
    const sizeKB = p.contentLength ? `${Math.round(p.contentLength / 1024)} KB` : '?';
    const flag = p.ok ? '✓' : '✗';
    console.log(`  ${flag} image  ${p.status}  ${p.contentType || '?'}  ${sizeKB}`);
    if (!p.ok) issues.push(`image probe failed: ${p.status} ${p.error || ''}`);
  }

  // 2. Probe datasheet URL (if not skip)
  if (family.datasheet_url && !family.skip_datasheet) {
    const p = await probe(family.datasheet_url);
    const sizeKB = p.contentLength ? `${Math.round(p.contentLength / 1024)} KB` : '?';
    const flag = p.ok ? '✓' : '✗';
    console.log(`  ${flag} datasheet  ${p.status}  ${p.contentType || '?'}  ${sizeKB}`);
    if (!p.ok) issues.push(`datasheet probe failed: ${p.status} ${p.error || ''}`);
  }

  if (issues.length) return { ok: false, family: family.label, issues };
  if (dryRun) return { ok: true, family: family.label, dryRun: true };

  // 3. Download once per family (re-used across all SKUs in family)
  const imgDownload = family.image_url ? await download(family.image_url) : null;
  const dsDownload = (family.datasheet_url && !family.skip_datasheet) ? await download(family.datasheet_url) : null;

  // 4. For each SKU in the family → resolve product → upload → update DB
  const skuResults = [];
  for (const sku of family.skus) {
    const product = await resolveProduct({ sku, name_match: sku === null ? family.sku_name_match : null });
    if (!product) {
      console.log(`    ✗ no product row for ${sku || `name:"${family.sku_name_match}"`}`);
      skuResults.push({ sku, ok: false, reason: 'no-product' });
      continue;
    }

    const filename = product.sku || family.sku_name_match || `unmatched-${product.id}`;
    const updates = {};

    if (imgDownload) {
      updates.image_url = await uploadAsset({
        filename, kind: family.kind, type: 'image',
        buf: imgDownload.buf, contentType: imgDownload.contentType,
      });
    }
    if (dsDownload) {
      updates.datasheet_url = await uploadAsset({
        filename, kind: family.kind, type: 'datasheet',
        buf: dsDownload.buf, contentType: dsDownload.contentType,
      });
    }

    if (Object.keys(updates).length) {
      const { error } = await sb.from('products').update(updates).eq('id', product.id);
      if (error) {
        console.log(`    ✗ DB update failed for ${product.sku || product.name}: ${error.message}`);
        skuResults.push({ sku: product.sku, ok: false, reason: error.message });
      } else {
        console.log(`    ✓ ${product.sku || `(${product.name})`}  ←  ${Object.keys(updates).join(' + ')}`);
        skuResults.push({ sku: product.sku, ok: true, updated: Object.keys(updates) });
      }
    }
  }

  return { ok: true, family: family.label, skuResults };
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  const banner = dryRun ? 'DRY-RUN (HEAD-probe only)' : 'LIVE (download → upload → DB update)';
  console.log(`Mode: ${banner}`);
  console.log(`Families to process: ${manifest.families.length}`);
  console.log(`Total SKUs: ${manifest.families.reduce((n, f) => n + f.skus.length, 0)}`);

  const results = [];
  for (const family of manifest.families) {
    try {
      results.push(await processFamily(family));
    } catch (e) {
      console.log(`  ✗ EXCEPTION: ${e.message}`);
      results.push({ ok: false, family: family.label, issues: [e.message] });
    }
  }

  // ── Summary ──
  console.log(`\n${'═'.repeat(70)}`);
  const okFamilies = results.filter(r => r.ok).length;
  const failedFamilies = results.filter(r => !r.ok);
  console.log(`Families: ${okFamilies}/${results.length} OK`);
  if (failedFamilies.length) {
    console.log(`\nFailed families:`);
    for (const f of failedFamilies) {
      console.log(`  ✗ ${f.family}`);
      for (const issue of f.issues || []) console.log(`      ${issue}`);
    }
  }

  if (!dryRun) {
    const allSku = results.flatMap(r => r.skuResults || []);
    const okSku = allSku.filter(s => s.ok).length;
    console.log(`SKUs updated: ${okSku}/${allSku.length}`);
  }

  if (dryRun) console.log(`\nDry-run only — no files uploaded, no DB writes.\nRe-run without --dry-run to execute.`);

  process.exit(failedFamilies.length > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
