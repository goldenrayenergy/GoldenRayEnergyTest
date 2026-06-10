// Costed BOM for Saliya's 6 kW single-phase quote.
//
// HARDWARE:  catalogue costs + per-product margins.
// LABOUR:    saliya rate card (install-small + battery + commissioning + compliance + design).
// BoS:       itemised line-by-line, scaled to 13-panel install.
// LABOUR MARGIN: zero (per user, labour cost = labour sell).
// DISCOUNT:  none (apply later if needed).
//
// Formula: sell_ex_gst = cost × (1 + margin_pct/100); sell_incl_gst = sell_ex_gst × 1.15

const GST = 1.15;
const LABOUR_COST_PCT_OF_SELL = 1.0;   // 100% of labour sell is cost → 0% margin
const DISCOUNT_PCT = 0;                // no discount applied

// ── Catalogue costs (verified) ──────────────────────────────────────────
const CAT = {
  PHN_PNL_475_QSR:     { name: 'Phono Solar 475W Quasar All-Black panel',         cost: 195.00,   margin: 50 },
  FRN_INV_60_G24P_1P:  { name: 'Fronius Primo 6.0 GEN24 Plus 1P Upgradable Hybrid Inverter', cost: 3740.00, margin: 30 },
  FRN_BAT_315_RSV:     { name: 'Fronius Reserva 3.15 kWh battery module',         cost: 2075.85,  margin: 30 },
  FRN_BAC_ACC_RSV:     { name: 'Fronius Reserva BMS controller',                   cost: 1937.25,  margin: 30 },
  SMART_METER:         { name: 'Fronius Smart Meter 63A-1 (1-phase)',              cost: 228.23,   margin: 30 },

  // ── BoS line items (catalogue + flagged estimates) ────────────────────
  HOP_TIN_KIT_4P:      { name: 'Hopergy 4-Panel Tin Kit Black (L-feet, splice, clamps, earth lug + plates)', cost: 101.44, margin: 30 },
  SLF_BOS_32_30M:      { name: 'Solarflex 32mm HD UV Pre-wired Conduit 6×4mm² + Earth (30m)', cost: 596.40, margin: 30 },
  GEN_BOS_MC4:         { name: 'MC4 Connectors M/F Pair — bag of 50',         cost: 386.10,  margin: 30 },
  GEN_BOS_40_DC:       { name: 'DC Isolator 40A 1500V IP66 (rooftop)',         cost: 250.00,  margin: 30 },
  GEN_BOS_32_AC:       { name: 'AC Isolator 32A IP66 single-phase 5–8kW',     cost: 300.00,  margin: 30 },
  GEN_BOS_SPD_AC:      { name: 'Type 2 Residential AC SPD',                    cost: 450.00,  margin: 30 },
  GEN_BOS_SPD_DC:      { name: 'Type 2 DC SPD (catalogue estimate)',           cost: 200.00,  margin: 30 },
  ECS_BOS_ENC:         { name: 'ECS 12-Pole PV IP65 Enclosure',                cost: 150.00,  margin: 30 },
  GEN_RCK_SEAL_EPD_B:  { name: 'FlashRite Roof Seal EPDM Black',               cost:   8.85,  margin: 30 },
  GEN_BOS_CABLE_AC:    { name: 'AC cable (per metre)',                          cost: 18.00,  margin: 30 },
  GEN_BOS_LABEL:       { name: 'AS/NZS 4777 Label Kit (catalogue estimate)',   cost:  50.00,  margin: 30 },
  GEN_BOS_EARTH:       { name: 'Earth rod + bonding cable',                    cost:  80.00,  margin: 30 },
  GEN_BOS_SUNDRY:      { name: 'Cable ties, glands, sealants, sundries',       cost:  80.00,  margin: 30 },
};

// ── Saliya 6 kW system spec ─────────────────────────────────────────────
// 13 × 475W = 6.175 kW DC into Primo 6.0 GEN24 Plus (6 kW AC) — 1.03× DC/AC ratio
// Reserva 6.3 kWh = 2 × 3.15 kWh modules + 1 BMS controller
const TIER = {
  label: 'Saliya 6 kW — Primo 6.0 GEN24 Plus + Reserva 6.3 kWh',
  items: [
    { sku: 'PHN_PNL_475_QSR',     qty: 13 },
    { sku: 'FRN_INV_60_G24P_1P',  qty: 1 },
    { sku: 'FRN_BAT_315_RSV',     qty: 2 },     // 2 × 3.15 = 6.3 kWh
    { sku: 'FRN_BAC_ACC_RSV',     qty: 1 },
    { sku: 'SMART_METER',         qty: 1 },
  ],
  has_battery: true,
};

// ── BoS bill scaled for 13-panel install ────────────────────────────────
const BOS_ITEMS = [
  { sku: 'HOP_TIN_KIT_4P',      qty: 4,  reason: '13 panels ÷ 4 per kit = 3.25 → round up to 4 kits' },
  { sku: 'SLF_BOS_32_30M',      qty: 1,  reason: '6 conductors handle 2 strings; 30m run' },
  { sku: 'GEN_BOS_MC4',         qty: 1,  reason: '13 panels in 2 strings ≈ 15 pairs; bag of 50' },
  { sku: 'GEN_BOS_40_DC',       qty: 1,  reason: 'Rooftop DC isolator' },
  { sku: 'GEN_BOS_32_AC',       qty: 1,  reason: 'Switchboard AC isolator (32A · 5-8kW range fits 6kW)' },
  { sku: 'GEN_BOS_SPD_AC',      qty: 1,  reason: 'AC surge protection' },
  { sku: 'GEN_BOS_SPD_DC',      qty: 1,  reason: 'DC surge protection' },
  { sku: 'ECS_BOS_ENC',         qty: 1,  reason: 'IP65 enclosure for SPDs + isolators' },
  { sku: 'GEN_RCK_SEAL_EPD_B',  qty: 13, reason: 'One EPDM roof seal per panel mount' },
  { sku: 'GEN_BOS_CABLE_AC',    qty: 20, reason: '20m AC run inverter→switchboard ($18/m)' },
  { sku: 'GEN_BOS_LABEL',       qty: 1,  reason: 'AS/NZS 4777 compliance labels' },
  { sku: 'GEN_BOS_EARTH',       qty: 1,  reason: 'Earth rod + bonding to switchboard' },
  { sku: 'GEN_BOS_SUNDRY',      qty: 1,  reason: 'Cable ties, glands, sealants' },
];

// ── Labour — saliya rate card (install-small for ≤6 kW; matches Saliya original) ──
const LABOUR = {
  install_small:        2500,    // saliya rate card · 1-day crew of 2
  battery_premium:      1500,    // extra labour for battery install
  commissioning:         500,    // Solar.web + monitoring setup + Fronius 5yr extension reg
  compliance:            750,    // CoC + ROI + DG application
  design:                400,    // SLD + DG drawings + load assessment
};

// ── Costing ──────────────────────────────────────────────────────────────
function costTier(tier) {
  const lines = [];
  let majorCost = 0, majorSellEx = 0;
  let bosCost  = 0, bosSellEx  = 0;

  // Major hardware
  for (const item of tier.items) {
    const c = CAT[item.sku];
    const lineCost = +(c.cost * item.qty).toFixed(2);
    const lineSellEx = +(lineCost * (1 + c.margin/100)).toFixed(2);
    lines.push({
      sku: item.sku.replace(/_/g, '-'),
      name: c.name,
      qty: item.qty,
      unit_cost: c.cost,
      line_cost: lineCost,
      margin_pct: c.margin,
      sell_ex_gst: lineSellEx,
      gst: +(lineSellEx * 0.15).toFixed(2),
      sell_incl_gst: +(lineSellEx * 1.15).toFixed(2),
      group: 'hardware',
    });
    majorCost += lineCost;
    majorSellEx += lineSellEx;
  }

  // BoS — itemised
  for (const item of BOS_ITEMS) {
    const c = CAT[item.sku];
    const lineCost = +(c.cost * item.qty).toFixed(2);
    const lineSellEx = +(lineCost * (1 + c.margin/100)).toFixed(2);
    lines.push({
      sku: item.sku.replace(/_/g, '-'),
      name: c.name,
      qty: item.qty,
      unit_cost: c.cost,
      line_cost: lineCost,
      margin_pct: c.margin,
      sell_ex_gst: lineSellEx,
      gst: +(lineSellEx * 0.15).toFixed(2),
      sell_incl_gst: +(lineSellEx * 1.15).toFixed(2),
      group: 'bos',
    });
    bosCost += lineCost;
    bosSellEx += lineSellEx;
  }

  const hwCost = +(majorCost + bosCost).toFixed(2);
  const hwSellEx = +(majorSellEx + bosSellEx).toFixed(2);

  // Labour (no margin → cost = sell)
  const labour = [
    { name: 'Installation labour (small · ≤6 kW · 1-day crew)',  amt: LABOUR.install_small },
    ...(tier.has_battery ? [{ name: 'Battery installation premium', amt: LABOUR.battery_premium }] : []),
    { name: 'Commissioning & monitoring setup',                    amt: LABOUR.commissioning },
    { name: 'Compliance — CoC, ROI, DG application',               amt: LABOUR.compliance },
    { name: 'System design & engineering',                          amt: LABOUR.design },
  ];
  let labourSellEx = 0;
  for (const l of labour) {
    lines.push({
      sku: '—',
      name: l.name,
      qty: 1,
      unit_cost: null,
      line_cost: null,
      margin_pct: null,
      sell_ex_gst: l.amt,
      gst: +(l.amt * 0.15).toFixed(2),
      sell_incl_gst: +(l.amt * 1.15).toFixed(2),
      group: 'labour',
    });
    labourSellEx += l.amt;
  }

  const totalSellEx = +(hwSellEx + labourSellEx).toFixed(2);
  const totalSellInc = +(totalSellEx * 1.15).toFixed(2);

  return {
    tier, lines,
    majorCost, majorSellEx,
    bosCost, bosSellEx,
    hwCost, hwSellEx,
    labourSellEx,
    totalSellEx, totalSellInc,
  };
}

// ── Render ────────────────────────────────────────────────────────────────
const fmt$ = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt$0 = n => n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-NZ');
const pad = (s, n, align='left') => align === 'right' ? String(s).padStart(n) : String(s).padEnd(n);

const r = costTier(TIER);

console.log('\n' + '═'.repeat(140));
console.log(`  ${TIER.label}`);
console.log('═'.repeat(140));
console.log(`  ${pad('LINE', 64)} ${pad('QTY', 4, 'right')} ${pad('UNIT COST', 12, 'right')} ${pad('LINE COST', 12, 'right')} ${pad('MARGIN', 8, 'right')} ${pad('SELL exGST', 13, 'right')} ${pad('SELL incGST', 13, 'right')}`);

let lastGroup = '';
for (const ln of r.lines) {
  if (ln.group !== lastGroup) {
    const header = ln.group === 'hardware' ? 'Major hardware'
                 : ln.group === 'bos'      ? 'Balance of System (electrical + mounting)'
                 :                            'Labour, compliance & design';
    console.log(`  ── ${header} `.padEnd(138, '─'));
    lastGroup = ln.group;
  }
  console.log(`  ${pad(ln.name.slice(0,62), 64)} ${pad(ln.qty, 4, 'right')} ${pad(fmt$(ln.unit_cost), 12, 'right')} ${pad(fmt$(ln.line_cost), 12, 'right')} ${pad(ln.margin_pct != null ? ln.margin_pct + '%' : '—', 8, 'right')} ${pad(fmt$(ln.sell_ex_gst), 13, 'right')} ${pad(fmt$(ln.sell_incl_gst), 13, 'right')}`);
}

// ── Summary ──────────────────────────────────────────────────────────────
const hwExGst       = r.majorCost;
const hwIncGst      = +(hwExGst * 1.15).toFixed(2);
const bosExGst      = r.bosCost;
const bosIncGst     = +(bosExGst * 1.15).toFixed(2);
const labourExGst   = r.labourSellEx;
const labourIncGst  = +(labourExGst * 1.15).toFixed(2);
const finalPriceIncGst = r.totalSellInc;
const finalPriceExGst  = +(finalPriceIncGst / 1.15).toFixed(2);
const totalCostExGst   = +(hwExGst + bosExGst + labourExGst).toFixed(2);
const totalCostIncGst  = +(totalCostExGst * 1.15).toFixed(2);
const profitExGst   = +(finalPriceExGst - totalCostExGst).toFixed(2);
const profitIncGst  = +(finalPriceIncGst - totalCostIncGst).toFixed(2);

console.log('\n' + '═'.repeat(180));
console.log('  SUMMARY — Saliya 6 kW · NO DISCOUNT · labour cost = labour sell (no margin)');
console.log('═'.repeat(180));
console.log(`  ${pad('LINE', 50)} ${pad('ex GST', 14, 'right')} ${pad('inc GST', 14, 'right')}`);
console.log('  ' + '─'.repeat(178));
console.log(`  ${pad('Hardware (panels, inverter, battery, BMS, meter)', 50)} ${pad(fmt$0(hwExGst), 14, 'right')} ${pad(fmt$0(hwIncGst), 14, 'right')}`);
console.log(`  ${pad('BoS (mounting, conduit, isolators, SPDs, etc.)', 50)} ${pad(fmt$0(bosExGst), 14, 'right')} ${pad(fmt$0(bosIncGst), 14, 'right')}`);
console.log(`  ${pad('Labour (install + battery + cmsg + cmpl + dsgn)', 50)} ${pad(fmt$0(labourExGst), 14, 'right')} ${pad(fmt$0(labourIncGst), 14, 'right')}`);
console.log(`  ${pad('TOTAL YOUR SPEND', 50)} ${pad(fmt$0(totalCostExGst), 14, 'right')} ${pad(fmt$0(totalCostIncGst), 14, 'right')}`);
console.log('  ' + '─'.repeat(178));
console.log(`  ${pad('FINAL — customer pays', 50)} ${pad(fmt$0(finalPriceExGst), 14, 'right')} ${pad(fmt$0(finalPriceIncGst), 14, 'right')}`);
console.log(`  ${pad('PROFIT (revenue − costs)', 50)} ${pad(fmt$0(profitExGst), 14, 'right')} ${pad(fmt$0(profitIncGst), 14, 'right')}`);
console.log('═'.repeat(180));
console.log('  All figures NZ$. NO discount applied. Labour cost = labour sell (no labour margin).');
console.log('  System: 13 × Phono 475W (6.175 kW DC) into Fronius Primo 6.0 GEN24 Plus 1-phase (6 kW AC) + Reserva 6.3 kWh (2 modules + BMS).');
