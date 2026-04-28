import { supabaseAdmin } from '../config/supabase.js';

// ── Upload proposal PDF to Supabase Storage ──
// Create a bucket called 'proposals' in Supabase Dashboard → Storage

export async function uploadProposalPDF(fileName, pdfBuffer) {
  if (!supabaseAdmin) {
    console.warn('Supabase not configured — skipping storage upload');
    return null;
  }

  const { data, error } = await supabaseAdmin.storage
    .from('proposals')
    .upload(`pdfs/${fileName}`, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  // Get public URL
  const { data: urlData } = supabaseAdmin.storage
    .from('proposals')
    .getPublicUrl(`pdfs/${fileName}`);

  return urlData.publicUrl;
}

export async function getProposalPDF(fileName) {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin.storage
    .from('proposals')
    .download(`pdfs/${fileName}`);

  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return data;
}

export async function deleteProposalPDF(fileName) {
  if (!supabaseAdmin) return;

  const { error } = await supabaseAdmin.storage
    .from('proposals')
    .remove([`pdfs/${fileName}`]);

  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}
