// Costed BOM for Krishna's 3-tier quote.
//
// HARDWARE: real catalogue costs + per-product catalogue margins (verified
// 2026-06-04 from products table).
// LABOUR + COMPLIANCE: saliya rate card (build-saliya-proposal.js lines 208,221)
// + scale-up assumption for 10 kW (install-medium) explicitly flagged.
// BoS: scaled from saliya's $950 (5 kW) to ~$1,800 (10 kW) — flagged.
//
// Formula per line: sell_ex_gst = cost × (1 + margin_pct/100); sell_incl_gst = sell_ex_gst × 1.15

const GST = 1.15;

// ── Catalogue costs (verified 2026-06-04) ────────────────────────────────
const CAT = {
  PHN_PNL_475_QSR:     { name: 'Phono Solar 475W Quasar All-Black panel',     cost: 195.00,   margin: 50 },
  // ⚠ PHN_PNL_595_DRACO cost = ESTIMATE. NZ wholesale typically $245–280 for
  // 595W bifacial; using $260 midpoint. Confirm with Phono NZ before locking
  // the quote — and add proper SKU to catalogue (suggested: PHN-PNL-595-DRC).
  PHN_PNL_595_DRACO:   { name: 'Phono Solar 595W Draco Module ⚠ price estimate', cost: 260.00, margin: 50 },
  FRN_INV_100_G24P_1P: { name: 'Fronius Primo 10.0 GEN24 Plus 1P hybrid inv', cost: 4811.00,  margin: 30 },
  FRN_INV_100_G24_1P:  { name: 'Fronius Primo 10.0 GEN24 (base) 1P hybrid',   cost: 3777.00,  margin: 30 },
  FRN_BAT_315_RSV:     { name: 'Fronius Reserva 3.15 kWh battery module',     cost: 2075.85,  margin: 30 },
  FRN_BAC_ACC_RSV:     { name: 'Fronius Reserva BMS controller',               cost: 1937.25,  margin: 30 },
  BYD_BAT_276_HVM:     { name: 'BYD HVM 2.76 kWh battery module',              cost: 1855.00,  margin: 30 },
  GEN_BAC_ACC_HVM:     { name: 'BYD HVM BMS Base & BCU v2',                    cost: 920.00,   margin: 30 },
  // Smart meter — Saliya used FRN-MTR-63-S1P at $228.23. Single-phase assumed
  // (Krishna's phases unconfirmed — flag if 3-phase needed).
  SMART_METER:         { name: 'Fronius Smart Meter 63A-1 (1-phase)',          cost: 228.23,   margin: 30 },

  // ── BoS line items (all verified from products table 2026-06-04) ──────
  HOP_TIN_KIT_4P:      { name: 'Hopergy 4-Panel Tin Kit Black (L-feet, splice, clamps, earth lug + plates)', cost: 101.44, margin: 30 },
  SLF_BOS_32_30M:      { name: 'Solarflex 32mm HD UV Pre-wired Conduit 6×4mm² + Earth (30m)', cost: 596.40, margin: 30 },
  GEN_BOS_MC4:         { name: 'MC4 Connectors M/F Pair — bag of 50',         cost: 386.10,  margin: 30 },
  GEN_BOS_40_DC:       { name: 'DC Isolator 40A 1500V IP66 (rooftop)',         cost: 250.00,  margin: 30 },
  GEN_BOS_40_S1P_AC:   { name: 'AC Isolator 40A IP66 single-phase 8–10kW',     cost: 300.00,  margin: 30 },
  GEN_BOS_SPD_AC:      { name: 'Type 2 Residential AC SPD',                    cost: 450.00,  margin: 30 },
  GEN_BOS_SPD_DC:      { name: 'Type 2 DC SPD (catalogue estimate)',           cost: 200.00,  margin: 30 },
  ECS_BOS_ENC:         { name: 'ECS 12-Pole PV IP65 Enclosure',                cost: 150.00,  margin: 30 },
  GEN_RCK_SEAL_EPD_B:  { name: 'FlashRite Roof Seal EPDM Black',               cost:   8.85,  margin: 30 },
  GEN_BOS_CABLE_AC:    { name: 'AC cable (per metre)',                          cost: 18.00, margin: 30 },
  GEN_BOS_LABEL:       { name: 'AS/NZS 4777 Label Kit (catalogue estimate)',   cost:  50.00,  margin: 30 },
  GEN_BOS_EARTH:       { name: 'Earth rod + bonding cable',                    cost:  80.00,  margin: 30 },
  GEN_BOS_SUNDRY:      { name: 'Cable ties, glands, sealants, sundries',       cost:  80.00,  margin: 30 },
};

// ── BoS bill (same across all 3 tiers — 10kW / 22 panels / tin roof / 1ph) ──
// Items + quantities sized for Krishna's 10kW residential install.
// Override quantities here if your site survey reveals different needs
// (longer cable run = 2× conduit; tile roof = different mounting; etc.)
const BOS_ITEMS = [
  { sku: 'HOP_TIN_KIT_4P',      qty: 5,  reason: '18 panels ÷ 4 per kit = 4.5 → round up to 5 kits' },
  { sku: 'SLF_BOS_32_30M',      qty: 1,  reason: '6 conductors handle 2 strings; 30m typical run' },
  { sku: 'GEN_BOS_MC4',         qty: 1,  reason: 'Bulk pack — 22 panels in 2 strings ≈ 25 pairs incl spares' },
  { sku: 'GEN_BOS_40_DC',       qty: 1,  reason: 'Rooftop DC isolator (inverter side built-in)' },
  { sku: 'GEN_BOS_40_S1P_AC',   qty: 1,  reason: 'Switchboard AC isolator' },
  { sku: 'GEN_BOS_SPD_AC',      qty: 1,  reason: 'AC surge protection' },
  { sku: 'GEN_BOS_SPD_DC',      qty: 1,  reason: 'DC surge protection' },
  { sku: 'ECS_BOS_ENC',         qty: 1,  reason: 'IP65 enclosure for SPDs + isolators' },
  { sku: 'GEN_RCK_SEAL_EPD_B',  qty: 18, reason: 'One EPDM roof seal per panel mount' },
  { sku: 'GEN_BOS_CABLE_AC',    qty: 24, reason: '24m AC run inverter→switchboard ($18/m)' },
  { sku: 'GEN_BOS_LABEL',       qty: 1,  reason: 'AS/NZS 4777 compliance labels' },
  { sku: 'GEN_BOS_EARTH',       qty: 1,  reason: 'Earth rod + bonding to switchboard' },
  { sku: 'GEN_BOS_SUNDRY',      qty: 1,  reason: 'Cable ties, glands, sealants' },
];

// ── Soft costs (FLAGGED — needs your sign-off) ───────────────────────────
//
// Saliya rate card (5 kW system):
//   install-small         $2,500
//   battery-premium       $1,500   (extra labour to install battery)
//   commissioning         $500
//   compliance            $750     (CoC, ROI, DG application)
//   design                $400
//   Racking + BoS sell    ~$950
//
// Extrapolation for Krishna (10 kW = 22 panels, ~2× saliya's panel count):
//   install-medium        $4,000   ← NOT in rate card, scaled 1.6× from install-small
//   Racking + BoS sell    ~$1,800  ← scaled 1.9× from saliya's $950 for double panel count
const LABOUR = {
  install_medium_10kw:  4000,    // ⚠ EXTRAPOLATED — saliya rate card has install-small only
  battery_premium:      1500,
  commissioning:         500,
  compliance:            750,
  design:                400,
};
const BOS_SELL_EX_GST = 1800;     // ⚠ EXTRAPOLATED from saliya $950 for 11 panels
const BOS_NOTIONAL_MARGIN = 50;   // racking + BoS treated as a 50%-margin sell

// Per user decision 2026-06-05: NO MARGIN on labour for this quote.
// Labour cost = labour sell — i.e. the saliya rate-card prices ARE what you
// pay your crew + subbies, with zero markup. Profit comes entirely from
// the hardware (major HW + BoS) margin.
const LABOUR_COST_PCT_OF_SELL = 1.0;   // 100% of labour sell is cost → 0% margin

function bosCost(sellExGst, marginPct) {
  return +(sellExGst / (1 + marginPct/100)).toFixed(2);
}

// ── Tier hardware bills ──────────────────────────────────────────────────
const TIERS = {
  option1: {
    label: 'Option 1 — Fronius Primo 10.0 GEN24 Plus + Reserva 9.45 kWh',
    items: [
      { sku: 'PHN_PNL_595_DRACO',   qty: 18 },   // 18 × 595W = 10.71 kW (vs 22 × 475W = 10.45 kW)
      { sku: 'FRN_INV_100_G24P_1P', qty: 1 },
      { sku: 'FRN_BAT_315_RSV',     qty: 3 },     // 3 × 3.15 = 9.45 kWh
      { sku: 'FRN_BAC_ACC_RSV',     qty: 1 },
      { sku: 'SMART_METER',         qty: 1 },
    ],
    has_battery: true,
  },
  option2: {
    label: 'Option 2 — Fronius Primo 10.0 GEN24 Plus + Reserva 15.75 kWh',
    items: [
      { sku: 'PHN_PNL_595_DRACO',   qty: 18 },   // 18 × 595W = 10.71 kW (vs 22 × 475W = 10.45 kW)
      { sku: 'FRN_INV_100_G24P_1P', qty: 1 },
      { sku: 'FRN_BAT_315_RSV',     qty: 5 },     // 5 × 3.15 = 15.75 kWh (marketed as 15.8)
      { sku: 'FRN_BAC_ACC_RSV',     qty: 2 },     // 2 × BMS — primary + secondary controller for 15.75 kWh stack
      { sku: 'SMART_METER',         qty: 1 },
    ],
    has_battery: true,
  },
  option3: {
    label: 'Option 3 — Fronius Primo 10.0 GEN24 (base) + BYD HVM 13.8 kWh',
    items: [
      { sku: 'PHN_PNL_595_DRACO',   qty: 18 },   // 18 × 595W = 10.71 kW (vs 22 × 475W = 10.45 kW)
      { sku: 'FRN_INV_100_G24_1P',  qty: 1 },     // BASE GEN24, not Plus
      { sku: 'BYD_BAT_276_HVM',     qty: 5 },     // 5 × 2.76 = 13.8 kWh
      { sku: 'GEN_BAC_ACC_HVM',     qty: 1 },     // BYD HVM BMS+BCU
      { sku: 'SMART_METER',         qty: 1 },
    ],
    has_battery: true,
  },
};

// ── Costing ──────────────────────────────────────────────────────────────
function costTier(tier) {
  const lines = [];
  let majorCost = 0, majorSellEx = 0;
  let bosCost  = 0, bosSellEx  = 0;

  // Major hardware lines
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
      margin_dollar: +(lineSellEx - lineCost).toFixed(2),
      group: 'hardware',
    });
    majorCost += lineCost;
    majorSellEx += lineSellEx;
  }

  // BoS — itemised (one line per SKU instead of lumped)
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
      margin_dollar: +(lineSellEx - lineCost).toFixed(2),
      group: 'bos',
    });
    bosCost += lineCost;
    bosSellEx += lineSellEx;
  }

  // Combined hardware totals (major + BoS — used downstream)
  const hwCost   = +(majorCost + bosCost).toFixed(2);
  const hwSellEx = +(majorSellEx + bosSellEx).toFixed(2);

  // Labour lines (no margin %; labour rate-card is the sell price directly)
  const labour = [
    { name: 'Installation labour (medium · 10 kW · 2-3 day crew)', amt: LABOUR.install_medium_10kw, flag: true },
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
      margin_dollar: null,
      flag: l.flag,
      group: 'labour',
    });
    labourSellEx += l.amt;
  }

  const totalSellEx = +(hwSellEx + labourSellEx).toFixed(2);
  const totalGst = +(totalSellEx * 0.15).toFixed(2);
  const totalSellInc = +(totalSellEx * 1.15).toFixed(2);
  const totalHwMargin = +(hwSellEx - hwCost).toFixed(2);

  // ── Labour cost estimate (FLAGGED — see LABOUR_COST_PCT_OF_SELL note) ──
  const labourCost = +(labourSellEx * LABOUR_COST_PCT_OF_SELL).toFixed(2);
  const labourMargin = +(labourSellEx - labourCost).toFixed(2);

  // ── Total project profit & margin (PRE-discount) ──
  // Total project cost = your spend on hardware + estimated labour cost
  // Profit ex GST  = total sell ex GST − total cost
  // Profit incl GST view = same $ as ex GST (GST is pass-through, doesn't add
  //   to your bottom line) — shown as a fraction of incl-GST revenue
  const totalCost = +(hwCost + labourCost).toFixed(2);
  const profitPreDiscountExGst = +(totalSellEx - totalCost).toFixed(2);
  const projectMarginPctPreDisc = +((profitPreDiscountExGst / totalSellEx) * 100).toFixed(1);

  const bosSellInc   = +(bosSellEx * 1.15).toFixed(2);
  const majorSellInc = +(majorSellEx * 1.15).toFixed(2);
  const labourSellInc = +(labourSellEx * 1.15).toFixed(2);
  return {
    tier, lines,
    majorCost, majorSellEx, majorSellInc,
    bosCost, bosSellEx, bosSellInc,
    hwCost, hwSellEx,
    labourSellEx, labourSellInc, labourCost, labourMargin,
    totalSellEx, totalGst, totalSellInc, totalHwMargin,
    totalCost, profitPreDiscountExGst, projectMarginPctPreDisc,
  };
}

// ── Render ────────────────────────────────────────────────────────────────
const fmt$ = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt$0 = n => n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-NZ');
const pad = (s, n, align='left') => align === 'right' ? String(s).padStart(n) : String(s).padEnd(n);

for (const [id, tier] of Object.entries(TIERS)) {
  const r = costTier(tier);
  console.log('\n' + '═'.repeat(140));
  console.log(`  ${tier.label}`);
  console.log('═'.repeat(140));
  console.log(`  ${pad('LINE', 64)} ${pad('QTY', 4, 'right')} ${pad('UNIT COST', 12, 'right')} ${pad('LINE COST', 12, 'right')} ${pad('MARGIN', 8, 'right')} ${pad('SELL exGST', 13, 'right')} ${pad('SELL incGST', 13, 'right')}`);
  console.log(`  ${'─'.repeat(138)}`);

  let lastGroup = '';
  for (const ln of r.lines) {
    if (ln.group !== lastGroup) {
      const header = ln.group === 'hardware' ? 'Major hardware'
                   : ln.group === 'bos'      ? 'Balance of System (electrical + mounting)'
                   :                            'Labour, compliance & design';
      console.log(`  ── ${header} `.padEnd(138, '─'));
      lastGroup = ln.group;
    }
    const flagMark = ln.flag ? ' ⚠' : '';
    console.log(`  ${pad(ln.name.slice(0,62) + flagMark, 64)} ${pad(ln.qty, 4, 'right')} ${pad(fmt$(ln.unit_cost), 12, 'right')} ${pad(fmt$(ln.line_cost), 12, 'right')} ${pad(ln.margin_pct != null ? ln.margin_pct + '%' : '—', 8, 'right')} ${pad(fmt$(ln.sell_ex_gst), 13, 'right')} ${pad(fmt$(ln.sell_incl_gst), 13, 'right')}`);
  }

  console.log(`  ${'─'.repeat(138)}`);
  console.log(`  ${pad('Major hardware  · cost / sell ex GST / sell incl GST', 76)} ${pad(fmt$0(r.majorCost), 13, 'right')} ${pad(fmt$0(r.majorSellEx), 13, 'right')} ${pad(fmt$0(r.majorSellInc), 13, 'right')}`);
  console.log(`  ${pad('Balance of System · cost / sell ex GST / sell incl GST', 76)} ${pad(fmt$0(r.bosCost), 13, 'right')} ${pad(fmt$0(r.bosSellEx), 13, 'right')} ${pad(fmt$0(r.bosSellInc), 13, 'right')}`);
  console.log(`  ${pad('Hardware combined (major + BoS) cost / sell ex GST', 76)} ${pad(fmt$0(r.hwCost), 13, 'right')} ${pad(fmt$0(r.hwSellEx), 13, 'right')}`);
  console.log(`  ${pad('Hardware GROSS MARGIN ($) — what you make on hardware after cost', 76)} ${pad('', 13)} ${pad(fmt$0(r.totalHwMargin), 13, 'right')}`);
  console.log(`  ${pad('Hardware blended margin (%)', 76)} ${pad('', 13)} ${pad(((r.totalHwMargin / r.hwCost) * 100).toFixed(1) + '%', 13, 'right')}`);
  console.log(`  ${pad('Labour + design + compliance (sell ex GST — rate-card prices)', 76)} ${pad('', 13)} ${pad(fmt$0(r.labourSellEx), 13, 'right')} ${pad(fmt$0(r.labourSellInc), 13, 'right')}`);
  console.log(`  ${'─'.repeat(138)}`);
  console.log(`  ${pad('TOTAL EX GST', 76)} ${pad('', 13)} ${pad(fmt$0(r.totalSellEx), 13, 'right')}`);
  console.log(`  ${pad('GST (15%)', 76)} ${pad('', 13)} ${pad(fmt$0(r.totalGst), 13, 'right')}`);
  console.log(`  ${pad('TOTAL INCL GST — quote price', 76)} ${pad('', 13)} ${pad('', 13)} ${pad(fmt$0(r.totalSellInc), 13, 'right')}`);
  console.log(`  ${'─'.repeat(138)}`);
}

// ── Side-by-side summary table — 8% DISCOUNT, ex-GST + incl-GST views ──
const DISCOUNT_PCT = 10;
const all = Object.values(TIERS).map(costTier);
console.log('\n');
console.log('═'.repeat(252));
console.log(`  SUMMARY — all 3 tiers · ${DISCOUNT_PCT}% customer discount · labour cost = labour sell (no margin)`);
console.log('═'.repeat(252));
console.log(`  ${pad('TIER', 50)} ${pad('HW ex GST', 11, 'right')} ${pad('HW inc GST', 12, 'right')} ${pad('BoS ex GST', 12, 'right')} ${pad('BoS inc GST', 12, 'right')} ${pad('Labour ex GST', 14, 'right')} ${pad('Labour inc GST', 15, 'right')} ${pad('Discount', 10, 'right')} ${pad('FINAL ex GST', 14, 'right')} ${pad('FINAL inc GST', 15, 'right')} ${pad('PROFIT ex GST', 14, 'right')} ${pad('PROFIT inc GST', 15, 'right')}`);
console.log('  ' + '─'.repeat(250));
for (const r of all) {
  // Apply customer discount
  const discountIncGst    = +(r.totalSellInc * DISCOUNT_PCT / 100).toFixed(2);
  const finalPriceIncGst  = +(r.totalSellInc - discountIncGst).toFixed(2);
  const finalPriceExGst   = +(finalPriceIncGst / 1.15).toFixed(2);

  // Costs — catalogue costs are ex GST (your supplier invoices net of GST claim).
  // Multiply by 1.15 to get the gross invoice amount you actually pay them.
  const hwExGst       = r.majorCost;
  const hwIncGst      = +(hwExGst * 1.15).toFixed(2);
  const bosExGst      = r.bosCost;
  const bosIncGst     = +(bosExGst * 1.15).toFixed(2);
  const labourExGst   = r.labourSellEx;     // no margin → labour cost = labour sell
  const labourIncGst  = +(labourExGst * 1.15).toFixed(2);

  const totalCostExGst    = +(hwExGst + bosExGst + labourExGst).toFixed(2);
  const totalCostIncGst   = +(totalCostExGst * 1.15).toFixed(2);

  // PROFIT ex GST = real, taxable profit (revenue ex GST − costs ex GST)
  const profitExGst   = +(finalPriceExGst - totalCostExGst).toFixed(2);
  // PROFIT inc GST = same dollar amount expressed with GST attached
  //   (revenue inc GST − costs inc GST = profit × 1.15)
  const profitIncGst  = +(finalPriceIncGst - totalCostIncGst).toFixed(2);

  console.log(`  ${pad(r.tier.label.slice(0, 50), 50)} ${pad(fmt$0(hwExGst), 11, 'right')} ${pad(fmt$0(hwIncGst), 12, 'right')} ${pad(fmt$0(bosExGst), 12, 'right')} ${pad(fmt$0(bosIncGst), 12, 'right')} ${pad(fmt$0(labourExGst), 14, 'right')} ${pad(fmt$0(labourIncGst), 15, 'right')} ${pad('-' + fmt$0(discountIncGst), 10, 'right')} ${pad(fmt$0(finalPriceExGst), 14, 'right')} ${pad(fmt$0(finalPriceIncGst), 15, 'right')} ${pad(fmt$0(profitExGst), 14, 'right')} ${pad(fmt$0(profitIncGst), 15, 'right')}`);
}
console.log('═'.repeat(252));
console.log(`  All figures NZ$. ${DISCOUNT_PCT}% customer discount applied. Labour cost = labour sell (no labour margin).`);
console.log('  ex GST  = the actual money figure (used for accounting + tax)');
console.log('  inc GST = the same number with 15% GST attached (the invoice-face amount you pay/receive)');
console.log('  PROFIT ex GST = revenue ex GST − costs ex GST (your real, taxable profit)');
console.log('  PROFIT inc GST = the same profit shown on the GST-inclusive scale (= PROFIT ex GST × 1.15)');

console.log(`\n⚠ FLAGS — please confirm before locking the quote:`);
console.log(`  1. install_medium_10kw = $4,000 (saliya rate card has install-small=$2,500; medium is extrapolated 1.6×)`);
console.log(`  2. Racking + BoS sell = $1,800 (scaled from saliya $950 for 22 panels vs 11)`);
console.log(`  3. Smart meter assumed single-phase (FRN-MTR-63-S1P) — change to 3-phase if Krishna's supply is 3-phase`);
console.log(`  4. Margins shown are catalogue defaults — override per line if you want a different markup`);
