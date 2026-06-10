// ────────────────────────────────────────────────────────────────────────────
// Proposal generator — Supabase Storage for quote PDFs.
//
// Bucket layout (private bucket, signed URLs only):
//   pm-quotes/
//     {quote_id}/
//       v{n}/
//         customer.pdf
//         sales-console.pdf
//         signed-customer.pdf       (after customer signature upload)
//         counter-signed.pdf        (after Goldenray counter-sign)
//
// Files are private. Customer download links are short-lived signed URLs.
// ────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { supabaseAdmin as supabaseFromConfig } from '../../config/supabase.js';

const BUCKET = 'pm-quotes';
const SIGNED_URL_TTL_SEC = 60 * 60;  // 1 hour
const CUSTOMER_LINK_TTL_SEC = 7 * 24 * 60 * 60;  // 7 days for emailed customer link

// Test seam — same pattern as routes/pm/quotes.js
let _sb = supabaseFromConfig;
export function __setSupabaseForTests(client) { _sb = client; }
const sb = () => _sb;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function path(quoteId, versionNumber, fileName) {
  return `${quoteId}/v${versionNumber}/${fileName}`;
}

export async function uploadQuotePdf({ quote_id, version_number, kind, buffer }) {
  if (!sb()) throw new Error('Supabase storage not configured');
  if (!['customer', 'sales-console', 'signed-customer', 'counter-signed'].includes(kind)) {
    throw new Error(`Invalid kind: ${kind}`);
  }
  const fileName = `${kind}.pdf`;
  const storagePath = path(quote_id, version_number, fileName);
  const { error } = await sb().storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: 'application/pdf',
    upsert: true,  // Re-generation overwrites in place; version_id pins the snapshot.
  });
  if (error) throw new Error(`Storage upload failed (${kind}): ${error.message}`);
  return {
    storage_path: storagePath,
    size_bytes: buffer.length,
    sha256: sha256(buffer),
  };
}

export async function downloadQuotePdf(storagePath) {
  if (!sb()) throw new Error('Supabase storage not configured');
  const { data, error } = await sb().storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  // data is a Blob in Node; convert to Buffer for downstream consumers.
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function getInternalSignedUrl(storagePath, ttlSec = SIGNED_URL_TTL_SEC) {
  if (!sb()) throw new Error('Supabase storage not configured');
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(storagePath, ttlSec);
  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}

export async function getCustomerLink(storagePath) {
  return getInternalSignedUrl(storagePath, CUSTOMER_LINK_TTL_SEC);
}

export async function ensureQuotesBucket() {
  if (!sb()) return;
  const { data: buckets } = await sb().storage.listBuckets();
  if (buckets?.some(b => b.name === BUCKET)) return;
  const { error } = await sb().storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Bucket create failed: ${error.message}`);
  }
}

export const QUOTE_BUCKET = BUCKET;
