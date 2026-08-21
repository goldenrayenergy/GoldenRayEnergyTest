// ────────────────────────────────────────────────────────────────────────────
// One-off setup: create the 'roof-images' Supabase Storage bucket.
//
// Usage:
//   cd server && node scripts/ensure-roof-images-bucket.js
//
// Idempotent — safe to re-run. Prints whether it created or found the bucket.
//
// Alternative: create the bucket manually in Supabase Studio:
//   Studio → Storage → New bucket → name: 'roof-images' → Private → Save
//
// After this succeeds, Google Solar API Phase 2 (roof imagery in proposal
// PDFs and UI thumbnails) will start working on the next wizard submit
// with FEATURE_GOOGLE_SOLAR=true.
// ────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '../config/supabase.js';
import { ensureRoofImagesBucket } from '../services/googleSolar/roofImagery.js';

async function main() {
  if (!supabaseAdmin) {
    console.error('❌ Supabase not configured (check SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env).');
    process.exit(1);
  }

  try {
    const result = await ensureRoofImagesBucket({ supabase: supabaseAdmin });
    if (result.created) {
      console.log(`✓ Created private bucket '${result.bucket}'.`);
    } else {
      console.log(`✓ Bucket '${result.bucket}' already exists — nothing to do.`);
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to ensure bucket:', err.message || err);
    process.exit(1);
  }
}

main();
