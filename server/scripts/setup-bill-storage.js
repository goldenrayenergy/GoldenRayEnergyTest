// One-time setup: create the Supabase Storage bucket for customer bill PDFs.
// Idempotent — safe to re-run.
//
// Usage:  node server/scripts/setup-bill-storage.js
//
// Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env

import { supabaseAdmin } from '../config/supabase.js';

const BUCKET = 'customer-bills';

async function main() {
  if (!supabaseAdmin) {
    console.error('Supabase service-role key not configured.');
    process.exit(1);
  }

  console.log(`Checking for bucket "${BUCKET}"...`);
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) { console.error(listErr); process.exit(1); }

  const existing = (buckets || []).find(b => b.name === BUCKET);
  if (existing) {
    console.log(`✓ Bucket "${BUCKET}" already exists (id: ${existing.id}, public: ${existing.public})`);
  } else {
    console.log(`Creating bucket "${BUCKET}"...`);
    const { error: createErr } = await supabaseAdmin.storage.createBucket(BUCKET, {
      public: false,                                 // private — accessed only via signed URLs
      fileSizeLimit: 10 * 1024 * 1024,               // 10 MB hard cap per file
      allowedMimeTypes: [
        'application/pdf',
        'image/jpeg', 'image/jpg', 'image/png',
        'image/webp', 'image/heic', 'image/heif',
      ],
    });
    if (createErr) { console.error(createErr); process.exit(1); }
    console.log(`✓ Bucket "${BUCKET}" created.`);
  }

  console.log('\nSetup complete. Bills uploaded via POST /api/bill-analysis will now be');
  console.log('stored at: customer-bills/<analysis_id>/<upload_id>.<ext>');
  console.log('\nSigned-URL generation:  GET /api/bill-analysis/uploads/:id/signed-url');
}

main().catch(e => { console.error(e); process.exit(1); });
