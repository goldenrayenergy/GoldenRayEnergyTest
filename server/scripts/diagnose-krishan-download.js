// Diagnose why the customer PDF for PR-KRISHAN-2026-001 won't download.
// Checks: quote row, version, status, storage bucket contents, signed-URL paths.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const REF = 'PR-KRISHAN-2026-001';
const hr = (s) => { console.log(); console.log('━'.repeat(100)); console.log(' ' + s); console.log('━'.repeat(100)); };

hr(`Quote ${REF}`);
const { data: q, error: qErr } = await sb.from('quotes')
  .select('*').eq('quote_ref', REF).maybeSingle();
if (qErr) console.error('Quote query error:', qErr.message);
if (!q) {
  console.log('  Quote NOT FOUND in DB.');
  console.log('  (Did the team recreate it after the flush, or is this a stale UI link?)');
  // List recent quotes for context
  const { data: recent } = await sb.from('quotes')
    .select('quote_ref, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('\nMost recent quotes in DB:');
  for (const r of recent || []) console.log(`  ${r.created_at?.slice(0,19)}  ${r.quote_ref}  ${r.status}`);
} else {
  console.log(`  id: ${q.id}`);
  console.log(`  status: ${q.status}`);
  console.log(`  contact_id: ${q.contact_id}`);
  console.log(`  current_version_id: ${q.current_version_id}`);
  console.log(`  created_at: ${q.created_at}`);
  console.log(`  updated_at: ${q.updated_at}`);

  hr('Current version');
  const { data: v } = await sb.from('quote_versions')
    .select('id, version_number, generated_at, pdf_customer_path, pdf_sales_console_path, pricing_snapshot')
    .eq('id', q.current_version_id).maybeSingle();
  if (!v) {
    console.log('  Current version NOT FOUND.');
  } else {
    console.log(`  version_number: v${v.version_number}`);
    console.log(`  generated_at: ${v.generated_at || '<NEVER GENERATED>'}`);
    console.log(`  pdf_customer_path: ${v.pdf_customer_path || '<empty>'}`);
    console.log(`  pdf_sales_console_path: ${v.pdf_sales_console_path || '<empty>'}`);
    console.log(`  pricing_snapshot present: ${v.pricing_snapshot != null}`);
  }

  hr('Storage — look for the customer PDF file');
  // Find the bucket the upload code uses
  const { data: buckets } = await sb.storage.listBuckets();
  const candidateBuckets = (buckets || [])
    .filter(b => /quote|pdf|pm/i.test(b.name))
    .map(b => b.name);
  console.log(`  Candidate buckets: ${candidateBuckets.join(', ') || '(none found)'}`);

  for (const bucket of candidateBuckets) {
    // Try to list files inside the quote's folder
    const prefix = q.id;
    const { data: files, error: e } = await sb.storage.from(bucket).list(prefix, { limit: 50 });
    if (e) { console.log(`  ${bucket}/${prefix}: ${e.message}`); continue; }
    console.log(`  ${bucket}/${prefix}: ${files?.length || 0} entries`);
    for (const f of files || []) {
      console.log(`    - ${f.name}  size=${f.metadata?.size || '?'} bytes`);
    }
    // Also list any nested versions
    if (v?.version_number != null) {
      const vPrefix = `${q.id}/v${v.version_number}`;
      const { data: vFiles } = await sb.storage.from(bucket).list(vPrefix, { limit: 50 });
      if (vFiles?.length) {
        console.log(`  ${bucket}/${vPrefix}: ${vFiles.length} entries`);
        for (const f of vFiles) {
          console.log(`    - ${f.name}  size=${f.metadata?.size || '?'} bytes`);
        }
      }
    }
  }

  hr('Try generating a signed URL for customer.pdf');
  for (const bucket of candidateBuckets) {
    const paths = [
      `${q.id}/v${v?.version_number}/customer.pdf`,
      `${q.id}/customer.pdf`,
      v?.pdf_customer_path,
    ].filter(Boolean);
    for (const p of paths) {
      const { data: signed, error: se } = await sb.storage.from(bucket).createSignedUrl(p, 60);
      if (se) {
        console.log(`  ${bucket}/${p}: ERROR ${se.message}`);
      } else if (signed?.signedUrl) {
        console.log(`  ${bucket}/${p}: signed URL OK`);
        // Probe the URL to see if it actually serves bytes
        try {
          const r = await fetch(signed.signedUrl, { method: 'HEAD' });
          console.log(`    HEAD ${r.status}  content-type=${r.headers.get('content-type')}  content-length=${r.headers.get('content-length')}`);
        } catch (e) { console.log(`    HEAD failed: ${e.message}`); }
      }
    }
  }
}
