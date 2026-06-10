-- Phase 4 — Battery Systems definitions + Inverter↔Battery Compatibility
--
-- Picked Option A (single source of truth for pricing):
--   * Physical units stay in `products` (modules + standalone systems)
--   * `battery_systems` defines named bundles (e.g. "Fronius Reserva 6.3 kWh
--     = 2 × FRN-BAT-315-RSV + 1 × FRN-BAC-ACC-RSV") with NO own price.
--     Price is computed at quote/display time as
--       SUM(component.cost_nzd × component.qty × (1 + margin/100) × 1.15)
--   * The quote builder picks a system_sku, expands into components, but
--     collapses to a single line in the customer-facing quote
--   * No duplicate pricing risk — modules are the only place cost lives
--
-- `inverter_battery_compat` is the foundation Phase 5 needs — the package
-- builder uses it to answer "what batteries fit this inverter?" Source data
-- is the 228-row matrix on Sheet2 of Battery Master Database.xlsx.

-- ── battery_systems — named bundles of products that form a saleable battery ──
CREATE TABLE IF NOT EXISTS battery_systems (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  system_sku          VARCHAR(40) UNIQUE NOT NULL,   -- e.g. 'FR-RES-6.3', 'BYD-HVS-5.1'
  brand               VARCHAR(40) NOT NULL,
  family              VARCHAR(40),                   -- 'Reserva', 'HVS', 'HVM', 'LVL', 'eTower', 'LiTE2', 'SIMPO'
  display_name        VARCHAR(120) NOT NULL,         -- 'Fronius Reserva 6.3 kWh'

  -- Capacity
  capacity_kwh        NUMERIC(6,2) NOT NULL,
  usable_kwh          NUMERIC(6,2),

  -- Chemistry + electrical
  chemistry           VARCHAR(20),                   -- 'LFP', 'NMC'
  voltage_type        VARCHAR(8),                    -- 'HV' | 'LV'
  voltage_min_v       VARCHAR(20),                   -- store as text to preserve "160V" style; convert when math needed
  voltage_max_v       VARCHAR(20),

  -- Stack rules
  min_modules         INTEGER DEFAULT 1,
  max_modules         INTEGER DEFAULT 1,
  parallel_allowed    BOOLEAN DEFAULT false,
  max_parallel_towers INTEGER,                       -- typically 3

  -- Warranty
  warranty_years      INTEGER,
  soh_pct_at_warranty INTEGER,                       -- 70 (= ≥70% SOH at warranty end)
  throughput_mwh      VARCHAR(40),                   -- numeric or "Manufacturer-defined"

  -- Physical / install
  bms_included        BOOLEAN DEFAULT false,
  indoor_rated        BOOLEAN,
  outdoor_rated       BOOLEAN,
  ip_rating           VARCHAR(10),                   -- 'IP65', 'IP55'
  bms_protocol_can    BOOLEAN,
  bms_protocol_rs485  BOOLEAN,

  -- Components: which product SKUs assemble this system, with quantities
  -- [{"sku": "FRN-BAT-315-RSV", "qty": 2}, {"sku": "FRN-BAC-ACC-RSV", "qty": 1}]
  components          JSONB NOT NULL DEFAULT '[]'::jsonb,

  notes               TEXT,

  -- Lifecycle
  is_active           BOOLEAN DEFAULT true,
  source              VARCHAR(40),                   -- 'battery_master_database_v1'
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_battery_systems_brand     ON battery_systems(brand);
CREATE INDEX IF NOT EXISTS idx_battery_systems_family    ON battery_systems(family);
CREATE INDEX IF NOT EXISTS idx_battery_systems_active    ON battery_systems(is_active);
CREATE INDEX IF NOT EXISTS idx_battery_systems_capacity  ON battery_systems(capacity_kwh);

COMMENT ON TABLE  battery_systems IS 'Named battery system bundles (e.g. Reserva 6.3). Price computed from components — no own price column.';
COMMENT ON COLUMN battery_systems.components IS 'JSON array of {sku, qty} pointing to products. System price = SUM(component.cost × qty × margin × GST).';

-- ── inverter_battery_compat — which inverters work with which battery systems ──
-- Source: Battery Master Database.xlsx Sheet2 (228 rows)
CREATE TABLE IF NOT EXISTS inverter_battery_compat (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inverter_sku        VARCHAR(40) NOT NULL,          -- canonical FRN-INV-* SKU
  battery_system_sku  VARCHAR(40) NOT NULL,          -- → battery_systems.system_sku

  is_compatible       BOOLEAN NOT NULL DEFAULT true,
  min_battery_kwh     NUMERIC(6,2),                  -- min battery size supported on this inverter
  max_battery_kwh     NUMERIC(6,2),                  -- max battery size supported
  max_towers          INTEGER,                       -- max parallel towers/stacks
  max_capacity_kwh    NUMERIC(8,2),                  -- max total capacity (towers × max_per_tower)
  charge_kw           NUMERIC(6,2),                  -- max charging rate
  discharge_kw        NUMERIC(6,2),                  -- max discharge rate
  full_backup         BOOLEAN,                       -- supports whole-home/full backup (not just essential)

  notes               TEXT,
  source              VARCHAR(40),                   -- 'battery_master_database_v1'
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(inverter_sku, battery_system_sku)
);

CREATE INDEX IF NOT EXISTS idx_inv_bat_compat_inv  ON inverter_battery_compat(inverter_sku);
CREATE INDEX IF NOT EXISTS idx_inv_bat_compat_bat  ON inverter_battery_compat(battery_system_sku);
CREATE INDEX IF NOT EXISTS idx_inv_bat_compat_yes  ON inverter_battery_compat(is_compatible) WHERE is_compatible = true;

COMMENT ON TABLE  inverter_battery_compat IS 'Pairing rules for package builder. Source: Battery Master Database.xlsx Sheet2.';
COMMENT ON COLUMN inverter_battery_compat.inverter_sku       IS 'Canonical SKU — FRN-INV-50-G24P-1P, not the external FR-PRIMO-G24P-5.0';
COMMENT ON COLUMN inverter_battery_compat.battery_system_sku IS 'References battery_systems.system_sku (FR-RES-6.3, BYD-HVS-5.1, etc.)';

-- Trigger to keep battery_systems.updated_at fresh on update
CREATE OR REPLACE FUNCTION update_battery_systems_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_battery_systems_updated_at ON battery_systems;
CREATE TRIGGER trg_battery_systems_updated_at
  BEFORE UPDATE ON battery_systems
  FOR EACH ROW EXECUTE FUNCTION update_battery_systems_updated_at();
