// Diagnose why the sales-console PDF for PR-KRISHAN-2026-001 won't download.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const REF = process.argv[2] || 'PR-KRISHAN-2026-001';

const { data: q } = await sb.from('quotes')
  .select('id, quote_ref, status, current_version_id')
  .eq('quote_ref', REF).maybeSingle();
if (!q) { console.log('Quote not found.'); process.exit(0); }

console.log(`Quote ${REF}`);
console.log(`  id: ${q.id}`);
console.log(`  status: ${q.status}`);

const { data: versions } = await sb.from('quote_versions')
  .select('id, version_number, generated_at, customer_pdf_storage_path, customer_pdf_size_bytes, internal_onepager_pdf_storage_path, internal_onepager_pdf_size_bytes, signed_pdf_storage_path')
  .eq('quote_id', q.id)
  .order('version_number');

console.log(`\nVersions (${versions?.length || 0}):`);
for (const v of versions || []) {
  const marker = v.id === q.current_version_id ? ' ◀ CURRENT' : '';
  console.log(`  v${v.version_number}  generated=${v.generated_at?.slice(0, 19) || 'NEVER'}${marker}`);
  console.log(`    customer_pdf: ${v.customer_pdf_storage_path || '(empty)'}  ${v.customer_pdf_size_bytes || '?'} bytes`);
  console.log(`    sales_console: ${v.internal_onepager_pdf_storage_path || '(empty)'}  ${v.internal_onepager_pdf_size_bytes || '?'} bytes`);
}

// Probe storage for the current version
const cur = (versions || []).find(v => v.id === q.current_version_id);
if (!cur) { console.log('\nNo current version row.'); process.exit(0); }

console.log('\n━'.repeat(80));
console.log('Storage probes — current version');
console.log('━'.repeat(80));

async function probe(path, label) {
  if (!path) { console.log(`  ${label}: no path on the version row`); return; }
  const { data: signed, error } = await sb.storage.from('pm-quotes').createSignedUrl(path, 60);
  if (error) { console.log(`  ${label}: signed-URL error — ${error.message}`); return; }
  try {
    const r = await fetch(signed.signedUrl);
    const buf = Buffer.from(await r.arrayBuffer());
    const magic = buf.slice(0, 5).toString();
    const isPdf = magic === '%PDF-';
    console.log(`  ${label}:`);
    console.log(`    path: ${path}`);
    console.log(`    HTTP ${r.status}  content-type=${r.headers.get('content-type')}  bytes=${buf.length}`);
    console.log(`    magic: ${magic === '%PDF-' ? '%PDF- (real PDF) ✓' : `"${buf.slice(0,20).toString('utf8').replace(/[^\x20-\x7E]/g,'.')}" (NOT a PDF) ✗`}`);
  } catch (e) { console.log(`    fetch failed: ${e.message}`); }
}

await probe(cur.customer_pdf_storage_path, 'customer.pdf');
await probe(cur.internal_onepager_pdf_storage_path, 'sales-console.pdf');

// Also list the folder to see what's actually there
console.log('\n━'.repeat(80));
console.log('Listing pm-quotes bucket folder for this quote+version');
console.log('━'.repeat(80));
const { data: files, error: lErr } = await sb.storage.from('pm-quotes')
  .list(`${q.id}/v${cur.version_number}`, { limit: 100 });
if (lErr) console.log(`  ERROR: ${lErr.message}`);
else {
  console.log(`  pm-quotes/${q.id}/v${cur.version_number}/ — ${files?.length || 0} entries`);
  for (const f of files || []) console.log(`    ${f.name}  size=${f.metadata?.size || '?'}`);
}

// Check quote_run_log for the most recent /generate run
console.log('\n━'.repeat(80));
console.log('Most recent /generate run from quote_run_log');
console.log('━'.repeat(80));
const { data: runs } = await sb.from('quote_run_log')
  .select('*')
  .eq('quote_id', q.id)
  .order('created_at', { ascending: false })
  .limit(3);
for (const r of runs || []) {
  console.log(`  ${r.created_at?.slice(0,19)}  kind=${r.run_kind}  status=${r.validation_status}  duration_ms=${r.duration_ms}`);
  if (r.outputs) {
    const o = r.outputs;
    console.log(`    used_fallback: ${o.used_fallback}`);
    console.log(`    fallback_reason: ${o.fallback_reason || '—'}`);
    if (o.customer_pdf) console.log(`    customer_pdf:    ${o.customer_pdf.size_bytes} bytes  path=${o.customer_pdf.storage_path}`);
    if (o.sales_console_pdf) console.log(`    sales_console:   ${o.sales_console_pdf.size_bytes} bytes  path=${o.sales_console_pdf.storage_path}`);
    if (o.concat) console.log(`    concat: cover_pages=${o.concat.cover_pages} datasheet_pages=${o.concat.datasheet_pages} merged_skus=${o.concat.merged_skus?.join(',')}`);
  }
}
