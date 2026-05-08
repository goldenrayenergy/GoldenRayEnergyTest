// ────────────────────────────────────────────────────────────────────────────
// PM tool — artifact file storage (Supabase Storage bucket: pm-projects)
//
// Bucket layout:
//   pm-projects/
//     {project_id}/
//       {swim_lane}/
//         {timestamp}-{filename}
//
// Files are stored privately. Downloads use signed URLs (1h expiry by default)
// rather than public URLs — these documents (signed contracts, COCs, install
// photos with addresses) shouldn't be publicly indexable.
// ────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '../../config/supabase.js';

const BUCKET = 'pm-projects';
const SIGNED_URL_TTL_SEC = 60 * 60;  // 1 hour

function safeName(name) {
  return String(name || 'file')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120);
}

export async function uploadArtifact({ projectId, swimLane, fileName, mimeType, buffer }) {
  if (!supabaseAdmin) throw new Error('Supabase storage not configured');
  const ts = Date.now();
  const path = `${projectId}/${swimLane}/${ts}-${safeName(fileName)}`;
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mimeType || 'application/octet-stream', upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return { path, bucket: BUCKET };
}

export async function getSignedUrl(path) {
  if (!supabaseAdmin) throw new Error('Supabase storage not configured');
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);
  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}

export async function deleteArtifact(path) {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

export async function ensureBucket() {
  if (!supabaseAdmin) return;
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (buckets?.some(b => b.name === BUCKET)) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Bucket create failed: ${error.message}`);
  }
}
