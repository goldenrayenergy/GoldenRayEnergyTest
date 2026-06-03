-- ────────────────────────────────────────────────────────────────────────────
-- Migration 026 — Bill PDF storage path on bill_uploads
--
-- Earlier policy was "don't store the PDF" (memory-only parsing, only the
-- parsed numbers persisted). That conflicts with the human-review workflow:
-- when a bill is flagged as parse_suspect, sales needs to look at the
-- original document to verify with the customer.
--
-- This migration adds storage-path columns. Production decision (today):
-- store ALL bill PDFs in a private Supabase Storage bucket. The bucket
-- itself must be created out-of-band via the Supabase dashboard or the
-- setup-storage.js admin script (see server/scripts/setup-bill-storage.js).
--
-- Privacy / retention:
--   - The Storage bucket is private (RLS forbids anon read).
--   - The portal generates a short-lived signed URL when sales clicks
--     "View original bill" — keeps the PDF away from public links.
--   - We revisit a retention policy (auto-delete after N months) when
--     storage usage approaches the Supabase free-tier ceiling. Meanwhile
--     `file_uploaded_at` lets us age out manually if needed.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE bill_uploads
  ADD COLUMN IF NOT EXISTS file_storage_path  VARCHAR(500),
  ADD COLUMN IF NOT EXISTS file_mime_type     VARCHAR(80),
  ADD COLUMN IF NOT EXISTS file_uploaded_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bill_uploads_storage_path
  ON bill_uploads(file_storage_path)
  WHERE file_storage_path IS NOT NULL;
