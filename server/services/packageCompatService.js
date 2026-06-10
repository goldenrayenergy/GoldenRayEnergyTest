// Compat lookup helpers for the package builder + quote generator.
//
// Reads from three tables:
//   products                  — modules, panels, inverters (canonical SKUs + specs jsonb)
//   battery_systems           — named bundles (Reserva 6.3, BYD HVS 5.1, …) with components[]
//   inverter_battery_compat   — 14-row pairing rules: which inverter works with which battery
//                               family, size range, charge/discharge kW, full backup support
//
// All functions return null for not-found rather than throwing — caller decides.

import { supabaseAdmin } from '../config/supabase.js';

// ── Product lookups ──────────────────────────────────────────────────────
export async function getProduct(sku) {
  if (!sku) return null;
  const { data } = await supabaseAdmin
    .from('products')
    .select('id,sku,name,brand,category,subcategory,cost_nzd,default_margin_pct,specs,stock_status,qty_available,is_active')
    .eq('sku', sku)
    .maybeSingle();
  return data;
}

export async function getProducts(skus) {
  if (!skus || !skus.length) return [];
  const { data } = await supabaseAdmin
    .from('products')
    .select('id,sku,name,brand,category,subcategory,cost_nzd,default_margin_pct,specs,stock_status,qty_available,is_active')
    .in('sku', skus);
  return data || [];
}

// ── Battery system lookups ──────────────────────────────────────────────
export async function getBatterySystem(system_sku) {
  if (!system_sku) return null;
  const { data } = await supabaseAdmin
    .from('battery_systems')
    .select('*')
    .eq('system_sku', system_sku)
    .maybeSingle();
  return data;
}

// Expands a system into its product components — returns array of
// { sku, qty, product } where product is the full products row.
// Returns [] if system not found.
export async function componentsOf(system_sku) {
  const system = await getBatterySystem(system_sku);
  if (!system) return [];
  const components = system.components || [];
  const skus = components.map(c => c.sku);
  const products = await getProducts(skus);
  const bySku = Object.fromEntries(products.map(p => [p.sku, p]));
  return components.map(c => ({ sku: c.sku, qty: c.qty, product: bySku[c.sku] || null }));
}

// Compute total cost (excl GST) for a battery system from its components
// system_cost = SUM(component.product.cost_nzd × qty × (1 + margin/100))
export async function priceBatterySystem(system_sku, { applyGst = false, marginOverride = null } = {}) {
  const comps = await componentsOf(system_sku);
  if (!comps.length) return null;
  let costSum = 0;
  let sellSum = 0;
  for (const c of comps) {
    if (!c.product) return null; // missing component product
    const cost = Number(c.product.cost_nzd) || 0;
    const margin = marginOverride != null ? marginOverride : (Number(c.product.default_margin_pct) || 0);
    const lineCost = cost * c.qty;
    const lineSell = lineCost * (1 + margin / 100);
    costSum += lineCost;
    sellSum += lineSell;
  }
  const gst = applyGst ? sellSum * 0.15 : 0;
  return {
    cost_total: Math.round(costSum * 100) / 100,
    sell_excl_gst: Math.round(sellSum * 100) / 100,
    sell_incl_gst: Math.round((sellSum + gst) * 100) / 100,
    components: comps,
  };
}

// ── Compat lookups ──────────────────────────────────────────────────────
// Returns array of compat rows + the full battery_system for each match.
// Empty array if no compatible batteries.
export async function compatibleBatteriesFor(inverter_sku) {
  if (!inverter_sku) return [];
  const { data: pairs } = await supabaseAdmin
    .from('inverter_battery_compat')
    .select('battery_system_sku,min_battery_kwh,max_battery_kwh,max_towers,max_capacity_kwh,charge_kw,discharge_kw,full_backup,is_compatible')
    .eq('inverter_sku', inverter_sku)
    .eq('is_compatible', true);
  if (!pairs || !pairs.length) return [];
  const sysSkus = pairs.map(p => p.battery_system_sku);
  const { data: systems } = await supabaseAdmin
    .from('battery_systems')
    .select('system_sku,brand,family,display_name,capacity_kwh,usable_kwh,min_modules,max_modules,components')
    .in('system_sku', sysSkus);
  const bySku = Object.fromEntries((systems || []).map(s => [s.system_sku, s]));
  return pairs.map(p => ({ ...p, battery_system: bySku[p.battery_system_sku] || null }));
}

// Reverse — given a battery system SKU, return inverters that work with it.
export async function compatibleInvertersFor(battery_system_sku) {
  if (!battery_system_sku) return [];
  const { data: pairs } = await supabaseAdmin
    .from('inverter_battery_compat')
    .select('inverter_sku,min_battery_kwh,max_battery_kwh,max_towers,charge_kw,discharge_kw,full_backup,is_compatible')
    .eq('battery_system_sku', battery_system_sku)
    .eq('is_compatible', true);
  if (!pairs || !pairs.length) return [];
  const invSkus = pairs.map(p => p.inverter_sku);
  const { data: inverters } = await supabaseAdmin
    .from('products')
    .select('sku,name,brand,subcategory,cost_nzd,default_margin_pct,specs')
    .in('sku', invSkus);
  const bySku = Object.fromEntries((inverters || []).map(i => [i.sku, i]));
  return pairs.map(p => ({ ...p, inverter: bySku[p.inverter_sku] || null }));
}

// Check ONE specific pair — returns the compat row or null.
export async function checkCompat(inverter_sku, battery_system_sku) {
  if (!inverter_sku || !battery_system_sku) return null;
  const { data } = await supabaseAdmin
    .from('inverter_battery_compat')
    .select('*')
    .eq('inverter_sku', inverter_sku)
    .eq('battery_system_sku', battery_system_sku)
    .maybeSingle();
  return data;
}

// ── Smart-meter pairing ──────────────────────────────────────────────────
// Each inverter's specs may include `recommended_smart_meter` (e.g. "63A-1").
// This maps that label to the canonical catalogue SKU.
const METER_LABEL_TO_SKU = {
  '63A-1':    'FRN-MTR-63-S1P',
  '63A-3':    'FRN-MTR-63-T3P',
  'TS65A-3':  'FRN-MTR-WR-T3P',   // best-guess; refine when WR meter is the right pairing
  '63A':      'FRN-MTR-63-S1P',   // fallback when phase is unclear in spec
};

// Given an inverter product (or specs jsonb), return the canonical recommended meter SKU
// (string or null). Looks up the inverter's `specs.recommended_smart_meter` label and
// maps it to the catalogue SKU.
export function recommendedSmartMeterSku(inverterOrSpecs) {
  const specs = inverterOrSpecs?.specs || inverterOrSpecs || {};
  const label = (specs.recommended_smart_meter || '').trim();
  if (!label) return null;
  return METER_LABEL_TO_SKU[label] || null;
}

// ── Racking BOM computation ──────────────────────────────────────────────
// Heuristic: portrait panels in 2-row strings, standard 4.7m Hopergy rails,
// metal-roof L-feet OR tile hooks depending on roof_type.
//
// Returns expected racking items as { rails, end_clamps, mid_clamps, feet,
//   earthing_lugs, earthing_plates }. Caller compares to package's actual
//   racking_items list.
//
// Assumptions baked in (refine when per-panel dimensions land in specs):
//   panel width = 1134 mm (typical Phono Quasar / REC AlphaPure)
//   rail span per panel = 1.13 m (panel width + small gap)
//   rails per panel row = 2 (one above, one below — standard split rail config)
//   end clamps fixed at 4 per array
//   mid clamps = 2 × (panel_qty − 2) for panel_qty ≥ 2
//   feet: metal=ceil(qty × 1.2), tile=ceil(qty × 1.5), tin=ceil(qty × 1.2)
//   earthing: 1 lug, ceil(qty/2) plates
const PANEL_WIDTH_M  = 1.134;
const RAIL_LENGTH_M  = 4.7;
const ROOF_FEET_RATIO = { metal: 1.2, tile: 1.5, tin: 1.2, asphalt: 1.5, default: 1.3 };

export function computeRackingBom(panel_qty, roof_type = 'default') {
  if (!panel_qty || panel_qty < 1) return null;
  const r = ROOF_FEET_RATIO[roof_type] ?? ROOF_FEET_RATIO.default;
  const rails_needed     = Math.ceil((panel_qty * PANEL_WIDTH_M * 2) / RAIL_LENGTH_M);
  const end_clamps       = 4;
  const mid_clamps       = Math.max(0, (panel_qty - 2) * 2);
  const feet             = Math.ceil(panel_qty * r);
  const earthing_lugs    = 1;
  const earthing_plates  = Math.ceil(panel_qty / 2);
  return {
    rails: rails_needed,
    end_clamps, mid_clamps,
    feet,
    earthing_lugs, earthing_plates,
    assumptions: {
      panel_width_m: PANEL_WIDTH_M,
      rail_length_m: RAIL_LENGTH_M,
      feet_per_panel_ratio: r,
      roof_type: roof_type === 'default' ? '(unspecified)' : roof_type,
    },
  };
}

// Aggregate a package's racking_items list into counts by kind.
// Expects each item to have its kind in specs.kind (rail / clamp-end / clamp-inner /
// l-foot / tile-hook / earthing / etc.) — set by the Racking fill-sheet tab.
export async function summariseRackingItems(racking_items) {
  if (!racking_items || !racking_items.length) {
    return { rails: 0, end_clamps: 0, mid_clamps: 0, feet: 0, earthing_lugs: 0, earthing_plates: 0, items_seen: [], missing_specs: [] };
  }
  const skus = racking_items.map(i => i.sku).filter(Boolean);
  const products = await getProducts(skus);
  const bySku = Object.fromEntries(products.map(p => [p.sku, p]));
  const out = { rails: 0, end_clamps: 0, mid_clamps: 0, feet: 0, earthing_lugs: 0, earthing_plates: 0, items_seen: [], missing_specs: [] };
  for (const it of racking_items) {
    const prod = bySku[it.sku];
    if (!prod) { out.missing_specs.push(it.sku); continue; }
    const kind = (prod.specs?.kind || '').toLowerCase();
    const qty = it.qty || 0;
    out.items_seen.push({ sku: it.sku, kind, qty });
    if (kind === 'rail') out.rails += qty;
    else if (kind === 'clamp-end' || kind === 'end-clamp') out.end_clamps += qty;
    else if (kind === 'clamp-inner' || kind === 'mid-clamp') out.mid_clamps += qty;
    else if (kind === 'l-foot' || kind === 'foot' || kind === 'tile-hook' || kind === 'bracket') out.feet += qty;
    else if (kind === 'earthing') {
      // crude: distinguish lugs (~$3) vs plates (~$0.64) by cost
      const cost = Number(prod.cost_nzd) || 0;
      if (cost > 2) out.earthing_lugs += qty;
      else out.earthing_plates += qty;
    } else {
      // unknown kind — don't double-count, just record
    }
  }
  return out;
}
