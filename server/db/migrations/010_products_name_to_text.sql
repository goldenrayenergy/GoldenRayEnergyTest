-- Phase 1 hotfix — widen products.name from VARCHAR(255) to TEXT
--
-- Some real product entries (notably Hopergy racking kits) carry the kit's
-- bill-of-materials text inside the name field, hitting 275–315 chars.
-- Postgres TEXT and VARCHAR(n) are stored identically; the only difference
-- is VARCHAR's length check. Switching to TEXT removes the artificial cap
-- without any data conversion or risk to existing rows.

ALTER TABLE products ALTER COLUMN name TYPE TEXT;
