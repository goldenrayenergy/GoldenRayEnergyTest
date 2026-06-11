-- ─────────────────────────────────────────────────────────────────────────────
-- MVP1_004 — Populate Fronius inverter mppt_v_min values
--
-- §2.10 Vmp lower-envelope check (new) needs the inverter's MPPT minimum
-- tracking voltage to enforce string_Vmp_hot ≥ mppt_v_min × 1.10.
--
-- Without this field, the validator silently skips the check (graceful
-- fallback by design). Apply this migration to enable it for the 33
-- Fronius inverters.
--
-- Source: Fronius GEN24 / Verto product datasheets ("MPP voltage range" lower
-- bound). Values verified against datasheets as of 2026-06-11.
--
-- Schema: `products.specs` is jsonb — no DDL change, just data merge.
-- ─────────────────────────────────────────────────────────────────────────────

-- Primo GEN24 (1ph, Plus + Base) ----------------------------------------------
-- 3.0 / 3.6 / 4.0 / 4.6 / 5.0 kW : MPP range 80–530 V → mppt_v_min = 80
-- 6.0 / 8.0 / 10.0     kW : MPP range 165–530 V → mppt_v_min = 165
UPDATE products
SET specs = specs || jsonb_build_object('mppt_v_min', 80)
WHERE category IN ('Inverters - Grid Tied', 'Inverters - Commercial')
  AND brand = 'Fronius'
  AND name ~* 'Primo.*GEN24'
  AND (specs->>'rated_kw')::numeric BETWEEN 3.0 AND 5.0;

UPDATE products
SET specs = specs || jsonb_build_object('mppt_v_min', 165)
WHERE category IN ('Inverters - Grid Tied', 'Inverters - Commercial')
  AND brand = 'Fronius'
  AND name ~* 'Primo.*GEN24'
  AND (specs->>'rated_kw')::numeric BETWEEN 6.0 AND 10.0;

-- Symo GEN24 (3ph, Plus + Base) ----------------------------------------------
-- 3.0 / 4.0 / 5.0     kW : MPP range 90–530 V → mppt_v_min = 90
-- 6.0 / 8.0 / 10.0    kW : MPP range 165–530 V → mppt_v_min = 165
UPDATE products
SET specs = specs || jsonb_build_object('mppt_v_min', 90)
WHERE category IN ('Inverters - Grid Tied', 'Inverters - Commercial')
  AND brand = 'Fronius'
  AND name ~* 'Symo.*GEN24'
  AND (specs->>'rated_kw')::numeric BETWEEN 3.0 AND 5.0;

UPDATE products
SET specs = specs || jsonb_build_object('mppt_v_min', 165)
WHERE category IN ('Inverters - Grid Tied', 'Inverters - Commercial')
  AND brand = 'Fronius'
  AND name ~* 'Symo.*GEN24'
  AND (specs->>'rated_kw')::numeric BETWEEN 6.0 AND 12.0;

-- Verto Plus (3ph commercial) ------------------------------------------------
-- 15.0 / 20.0 / 25.0 / 27.0 / 30.0 / 33.3 kW : MPP range 240–870 V → mppt_v_min = 240
UPDATE products
SET specs = specs || jsonb_build_object('mppt_v_min', 240)
WHERE category IN ('Inverters - Grid Tied', 'Inverters - Commercial')
  AND brand = 'Fronius'
  AND name ~* 'Verto';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification query — run after migration to confirm coverage.
-- Expected: zero rows. Any Fronius inverter without mppt_v_min means the
-- patterns above missed a SKU naming variant. Investigate before shipping.
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT sku, name, specs->>'rated_kw' AS rated_kw, specs->>'mppt_v_min' AS mppt_v_min
-- FROM products
-- WHERE category IN ('Inverters - Grid Tied', 'Inverters - Commercial')
--   AND brand = 'Fronius'
--   AND (specs->>'mppt_v_min') IS NULL
--   AND is_active = true;
