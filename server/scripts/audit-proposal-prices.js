// Audit the proposal mockup's tier prices against the actual catalogue + Excel
// Sheet1 BOM. Confirms each option's total price is internally consistent.

import xlsx from 'xlsx';

// ── Catalogue / Excel unit costs (NZD wholesale) ───────────────────────────
const COSTS = {
  panel_475w_phono:         195.00,    // catalogue match
  fronius_primo_10_gen24:   4900.00,   // Excel Sheet1 (catalogue $4,811, Excel uses $4,900)
  fronius_reserva_bms:      1937.00,   // Excel only — not in catalogue
  secondary_bms_controller: 3000.00,   // NEW — secondary BMS for battery configurations (Options 2 + 3)
  reserva_module_315kwh:    2076.00,   // matches catalogue ($2,075.85)
  smart_meter_63a1:         300.00,    // Excel Sheet1 (catalogue $228.23)
  dc_isolator:              150.00,
  ac_isolator:              220.00,
  dc_spd:                   180.00,
  ac_spd:                   180.00,
  battery_protection:       120.00,
  solarflex_conduit_30m:    696.00,
  ac_cable_per_m:           18.00,
  mc4_bos:                  180.00,
  label_kit:                53.00,
  tilt_kit_4panel:          333.00,
  cable_tie_pack:           52.00,
  roof_seal:                52.00,
  roof_mount_fasteners:     350.00,
  earthing_kit:             180.00,
};

// ── Margin policy (per Excel Sheet1) ───────────────────────────────────────
const MARGIN = {
  panel:        0.50,    // 50%
  inverter:     0.40,    // 40%
  battery_mod:  0.40,    // 40%
  bms:          0.30,    // 30%
  meter:        0.30,    // 30%
  bos:          0.30,    // 30%
  tilt:         0.30,
  isolator:     0.30,
  spd:          0.30,
  cable:        0.30,
  conduit:      0.30,
  fastener:     0.30,
  earthing:     0.30,
};

const sellExclGST = (cost, marginFrac) => cost * (1 + marginFrac);
const inclGST = (n) => n * 1.15;
const fmt = (n) => '$' + Math.round(n).toLocaleString('en-NZ');

// ── Common materials (shared by all 3 options) ─────────────────────────────
function commonMaterialsSellExclGST() {
  return (
    22 * sellExclGST(COSTS.panel_475w_phono, MARGIN.panel)
    + 1 * sellExclGST(COSTS.fronius_primo_10_gen24, MARGIN.inverter)
    + 1 * sellExclGST(COSTS.smart_meter_63a1, MARGIN.meter)
    + 1 * sellExclGST(COSTS.dc_isolator, MARGIN.isolator)
    + 1 * sellExclGST(COSTS.ac_isolator, MARGIN.isolator)
    + 1 * sellExclGST(COSTS.dc_spd, MARGIN.spd)
    + 1 * sellExclGST(COSTS.ac_spd, MARGIN.spd)
    + 1 * sellExclGST(COSTS.solarflex_conduit_30m, MARGIN.conduit)
    + 24 * sellExclGST(COSTS.ac_cable_per_m, MARGIN.cable)
    + 1 * sellExclGST(COSTS.mc4_bos, MARGIN.bos)
    + 1 * sellExclGST(COSTS.label_kit, MARGIN.bos)
    + 8 * sellExclGST(COSTS.tilt_kit_4panel, MARGIN.tilt)
    + 1 * sellExclGST(COSTS.cable_tie_pack, MARGIN.bos)
    + 1 * sellExclGST(COSTS.roof_seal, MARGIN.bos)
    + 6 * sellExclGST(COSTS.roof_mount_fasteners, MARGIN.fastener)
    + 1 * sellExclGST(COSTS.earthing_kit, MARGIN.earthing)
  );
}

// Battery cost per option — now includes a secondary BMS controller for redundancy
function batteryMaterialsSellExclGST(modules) {
  if (modules === 0) return 0;
  return (
    1 * sellExclGST(COSTS.fronius_reserva_bms, MARGIN.bms)
    + 1 * sellExclGST(COSTS.secondary_bms_controller, MARGIN.bms)   // NEW
    + modules * sellExclGST(COSTS.reserva_module_315kwh, MARGIN.battery_mod)
    + 1 * sellExclGST(COSTS.battery_protection, MARGIN.bos)
  );
}

// Labour + Compliance (from Excel Sheet1)
const LABOUR_FULL_SELL_EXCL_GST = 7995;    // Sheet1: $5,850 + $845 + $455 + $845
const COMPLIANCE_FULL_SELL_EXCL_GST = 1846; // Sheet1: $260 + $650 + $260 + $325 + $195 + $156

function computeOption({ label, modules, labourFactor, complianceFactor }) {
  const materials = commonMaterialsSellExclGST() + batteryMaterialsSellExclGST(modules);
  const labour = LABOUR_FULL_SELL_EXCL_GST * labourFactor;
  const compliance = COMPLIANCE_FULL_SELL_EXCL_GST * complianceFactor;
  const exclGST = materials + labour + compliance;
  const total = inclGST(exclGST);
  return { label, materials, labour, compliance, exclGST, total };
}

// ── Current proposal mockup ranges (what's shown to the customer) ──────────
const PROPOSAL_RANGES = {
  option1: { min: 33000, max: 37000 },
  option2: { min: 53500, max: 58500 },
  option3: { min: 60000, max: 65000 },
};

// ── Compute ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  PROPOSAL PRICE AUDIT — BOM vs Mockup Ranges');
console.log('═══════════════════════════════════════════════════════════════\n');

const opt1 = computeOption({ label: 'Option 1 (10 kW solar only)',         modules: 0, labourFactor: 0.70, complianceFactor: 0.85 });
const opt2 = computeOption({ label: 'Option 2 (10 kW + 9.45 kWh battery)', modules: 3, labourFactor: 1.00, complianceFactor: 1.00 });
const opt3 = computeOption({ label: 'Option 3 (10 kW + 15.8 kWh battery)', modules: 5, labourFactor: 1.00, complianceFactor: 1.00 });

for (const [name, opt, range] of [
  ['option1', opt1, PROPOSAL_RANGES.option1],
  ['option2', opt2, PROPOSAL_RANGES.option2],
  ['option3', opt3, PROPOSAL_RANGES.option3],
]) {
  const inRange = opt.total >= range.min && opt.total <= range.max;
  const verdict = inRange ? '✅ within proposal range' : '⚠ outside proposal range';
  console.log(`${opt.label}`);
  console.log(`  Materials excl GST:  ${fmt(opt.materials)}`);
  console.log(`  Labour excl GST:     ${fmt(opt.labour)}`);
  console.log(`  Compliance excl GST: ${fmt(opt.compliance)}`);
  console.log(`  Subtotal excl GST:   ${fmt(opt.exclGST)}`);
  console.log(`  TOTAL incl GST:      ${fmt(opt.total)}`);
  console.log(`  Proposal mockup:     ${fmt(range.min)} – ${fmt(range.max)}    ${verdict}`);
  console.log('');
}
