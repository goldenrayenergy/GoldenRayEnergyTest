// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Cost engine
//
// Pure function. Given a validated spec + BoM, returns the full P&L:
//   - Per-line cost + margin + sell breakdown
//   - Section subtotals (hardware / bos / labour / compliance)
//   - Customer Total (list) ex GST + inc GST
//   - Applied discount (per spec.pricing)
//   - Profit + project margin %
//   - Margin floor status (above 10% / below 10%)
//
// Convention: GST applied ONCE at the total (not per line). Labour cost =
// labour sell (no labour margin per owner decision 2026-06-05). Hardware
// margins are per-SKU from catalogue.
//
// All amounts NZD. ex GST = real-money base; inc GST = invoice-face amount.
// ────────────────────────────────────────────────────────────────────────────

import { getCatalogue, lineFromSku, selectInstallLabour } from './catalogue/index.js';
import { FINANCIAL_DEFAULTS } from './data/engineeringRules.js';

// Round helpers (currency).
const r2 = (n) => +(+n).toFixed(2);
const r0 = (n) => Math.round(+n);

// Builds a labour / compliance / custom "line" object that matches the
// hardware-line shape (so the renderer treats them identically).
//
// MVP1_003 (P4): labour + compliance items can carry margins. Catalogue
// defaults are 30% per the locked rule; legacy JS fallback has 0%; per-quote
// overrides admin-only (audit-logged). The line respects whatever margin_pct
// is on the input item.
function labourLine(item, group, qtyOverride = null) {
  const qty = qtyOverride ?? item.default_qty ?? 1;
  const margin = item.margin_pct || 0;
  const line_cost = +(item.cost_nzd * qty).toFixed(2);
  const sell_ex_gst = +(line_cost * (1 + margin / 100)).toFixed(2);
  return {
    sku: item.sku,
    name: item.name,
    qty,
    unit_cost: item.cost_nzd,
    line_cost,
    margin_pct: margin,
    sell_ex_gst,
    margin_dollar: +(sell_ex_gst - line_cost).toFixed(2),
    group,
  };
}

// ── P4: Cost-override overlay helpers ──────────────────────────────────────
//
// spec.cost_overrides.labour      → array of { sku, qty?, cost_nzd?, margin_pct?,
//                                              is_custom?, name?, category?,
//                                              override_reason? }
// spec.cost_overrides.compliance  → same shape
// spec.cost_overrides.custom      → array of { sku, name, category, qty,
//                                              cost_nzd, margin_pct,
//                                              override_reason? }
//
// Override semantics:
//   • Match by SKU vs existing rate-card-driven lines → modify qty/cost/margin
//   • qty: 0  → mark line for removal
//   • is_custom: true → add as new line in the labour or compliance section
//   • custom[] → additive lines, routed by `category` into the right section

function applyOverrideToLine(line, ov) {
  if (ov.qty === 0) return null;   // remove
  const qty = ov.qty ?? line.qty;
  const cost = ov.cost_nzd ?? line.unit_cost;
  const margin = ov.margin_pct ?? line.margin_pct;
  const line_cost = +(cost * qty).toFixed(2);
  const sell_ex_gst = +(line_cost * (1 + margin / 100)).toFixed(2);
  return {
    ...line,
    qty,
    unit_cost: cost,
    line_cost,
    margin_pct: margin,
    sell_ex_gst,
    margin_dollar: +(sell_ex_gst - line_cost).toFixed(2),
    overridden: true,
    override_reason: ov.override_reason || null,
  };
}

function buildCustomLine(ov, group) {
  if (ov.qty == null || ov.cost_nzd == null) {
    throw new Error(`Custom line missing qty or cost_nzd: ${JSON.stringify(ov)}`);
  }
  const margin = ov.margin_pct ?? 30;
  const line_cost = +(ov.cost_nzd * ov.qty).toFixed(2);
  const sell_ex_gst = +(line_cost * (1 + margin / 100)).toFixed(2);
  return {
    sku: ov.sku || `CUSTOM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: ov.name || 'Custom line',
    qty: ov.qty,
    unit_cost: ov.cost_nzd,
    line_cost,
    margin_pct: margin,
    sell_ex_gst,
    margin_dollar: +(sell_ex_gst - line_cost).toFixed(2),
    is_custom: true,
    group,
    override_reason: ov.override_reason || null,
  };
}

// Apply override array to an existing labour/compliance line array.
// Returns the new array. Lines marked qty=0 are removed. Customs in the
// override array are appended. Unmatched (sku not in defaults) non-custom
// overrides are warned but ignored.
function applyOverlay(defaultLines, overrideArr, group, warnings = []) {
  if (!Array.isArray(overrideArr) || overrideArr.length === 0) return defaultLines;
  const overrideMap = new Map();
  const customs = [];
  for (const ov of overrideArr) {
    if (ov.is_custom) customs.push(ov);
    else overrideMap.set(ov.sku, ov);
  }
  // Modify existing
  const result = defaultLines.flatMap(line => {
    const ov = overrideMap.get(line.sku);
    if (!ov) return [line];
    overrideMap.delete(line.sku);  // mark consumed
    const replaced = applyOverrideToLine(line, ov);
    return replaced ? [replaced] : [];
  });
  // Warn about unmatched (non-custom) override entries
  for (const [sku] of overrideMap) {
    warnings.push({
      severity: 'warn',
      code: 'override_sku_not_in_defaults',
      message: `${group}: override for SKU ${sku} did not match any default line (ignored).`,
    });
  }
  // Append customs
  for (const c of customs) {
    result.push(buildCustomLine({ ...c, sku: c.sku || null }, group));
  }
  return result;
}

// ── Main cost computation ──────────────────────────────────────────────────
export function computeCost(spec, bom, options = {}) {
  const catalogue = getCatalogue(options);
  const gst = options.gst_rate ?? FINANCIAL_DEFAULTS.gst_rate;
  const marginFloor = options.minimum_project_margin_pct
                    ?? FINANCIAL_DEFAULTS.minimum_project_margin_pct;

  const lines = [];

  // ── Hardware + BoS lines (from BoM) ────────────────────────────────────
  let majorCost = 0, majorSellEx = 0;
  let bosCost = 0, bosSellEx = 0;
  const overrideWarnings = options.override_warnings || [];
  let bosLines = [];

  for (const item of bom) {
    const line = lineFromSku(catalogue, item.sku, item.qty);
    line.group = item.group;        // hardware | bos
    line.reason = item.reason;
    if (item.group === 'hardware') {
      lines.push(line);             // hardware stays read-only (catalogue-driven)
      majorCost += line.line_cost;
      majorSellEx += line.sell_ex_gst;
    } else if (item.group === 'bos') {
      bosLines.push(line);          // overlay applied below — same as labour/compliance
    }
  }

  // P8.7 — BoS overlay (rep can override qty / cost; admin can override margin).
  bosLines = applyOverlay(bosLines, spec.cost_overrides?.bos, 'bos', overrideWarnings);
  for (const ln of bosLines) {
    lines.push(ln);
    bosCost   += ln.line_cost;
    bosSellEx += ln.sell_ex_gst;
  }

  // ── System kW (for labour tier selection) ──────────────────────────────
  const panelSku = spec.system.panel.sku;
  const panelData = catalogue.PANELS[panelSku];
  if (!panelData) throw new Error(`Panel SKU ${panelSku} not in catalogue`);
  const systemKw = +(spec.system.panel.count * panelData.watts / 1000).toFixed(2);

  // ── Build default labour lines from catalogue, then apply spec overrides ──
  // (overrideWarnings declared above near BoS)
  let labourLines = [];
  const installTier = selectInstallLabour(catalogue, systemKw);
  if (installTier) labourLines.push(labourLine(installTier, 'labour'));
  if (spec.system?.battery?.sku && catalogue.BATTERY_INSTALL_PREMIUM) {
    labourLines.push(labourLine(catalogue.BATTERY_INSTALL_PREMIUM, 'labour'));
  }
  for (const item of [catalogue.SUPERVISOR, catalogue.TRAVEL, catalogue.LOGISTICS]) {
    if (item) labourLines.push(labourLine(item, 'labour'));
  }
  if (spec.system?.string_topology === 'parallel' && catalogue.PARALLEL_PREMIUM) {
    labourLines.push(labourLine(catalogue.PARALLEL_PREMIUM, 'labour'));
  }

  // P4 — labour overlay
  labourLines = applyOverlay(labourLines, spec.cost_overrides?.labour, 'labour', overrideWarnings);

  let labourSellEx = 0;
  let labourCostSum = 0;
  for (const ln of labourLines) {
    lines.push(ln);
    labourSellEx += ln.sell_ex_gst;
    labourCostSum += ln.line_cost;
  }

  // ── Compliance lines (defaults from catalogue, then overlay) ──────────
  let complianceLines = [
    catalogue.SYSTEM_DESIGN, catalogue.INSPECTION_COMPLIANCE,
    catalogue.COMMISSIONING, catalogue.GRID_APPLICATION,
    catalogue.COC, catalogue.ESC,
  ].filter(Boolean).map(item => labourLine(item, 'compliance'));

  complianceLines = applyOverlay(complianceLines, spec.cost_overrides?.compliance, 'compliance', overrideWarnings);

  let complianceSellEx = 0;
  let complianceCostSum = 0;
  for (const ln of complianceLines) {
    lines.push(ln);
    complianceSellEx += ln.sell_ex_gst;
    complianceCostSum += ln.line_cost;
  }

  // ── P4 — Custom add-on lines (routed by category) ─────────────────────
  // spec.cost_overrides.custom = [ { category, sku?, name, qty, cost_nzd, margin_pct?, override_reason? } ]
  let customMajorSell = 0, customMajorCost = 0;
  let customBosSell = 0, customBosCost = 0;
  for (const cust of spec.cost_overrides?.custom || []) {
    const cat = (cust.category || 'labour').toLowerCase();
    const groupForCategory = cat === 'hardware' ? 'hardware'
                          : cat === 'bos'        ? 'bos'
                          : cat === 'compliance' ? 'compliance'
                          : 'labour';
    const line = buildCustomLine(cust, groupForCategory);
    lines.push(line);
    if (groupForCategory === 'hardware') {
      customMajorSell += line.sell_ex_gst; customMajorCost += line.line_cost;
    } else if (groupForCategory === 'bos') {
      customBosSell += line.sell_ex_gst; customBosCost += line.line_cost;
    } else if (groupForCategory === 'compliance') {
      complianceSellEx += line.sell_ex_gst; complianceCostSum += line.line_cost;
    } else {
      labourSellEx += line.sell_ex_gst; labourCostSum += line.line_cost;
    }
  }
  majorSellEx += customMajorSell; majorCost += customMajorCost;
  bosSellEx += customBosSell; bosCost += customBosCost;

  // ── Section subtotals ──────────────────────────────────────────────────
  const hwCost = r2(majorCost + bosCost);
  const hwSellEx = r2(majorSellEx + bosSellEx);
  const hwMarginDollar = r2(hwSellEx - hwCost);

  // Labour + compliance: cost may now differ from sell when margin_pct > 0
  // (locked rule: 30% margin everywhere on labour + compliance at seed time).
  const labourCost = r2(labourCostSum);
  const complianceCost = r2(complianceCostSum);

  // ── Totals (list = full catalogue price; before any discount) ──────────
  const totalCostExGst = r2(hwCost + labourCost + complianceCost);
  const totalListExGst = r2(hwSellEx + labourSellEx + complianceSellEx);
  const totalGstOnList = r2(totalListExGst * gst);
  const totalListIncGst = r2(totalListExGst + totalGstOnList);

  // ── Customer Total (the price the customer pays) ───────────────────────
  // Two modes drive customer_total:
  //
  //   • AUTO-PRICED (customer_price_inc_gst == null, the new default):
  //       customer_total = list - discount.applied_nzd
  //     The discount intake field is the SOURCE OF TRUTH for any rep-given
  //     discount in this mode. With applied_nzd = 0 (no discount), customer
  //     total = full list. Set applied_nzd > 0 to push the customer total
  //     down — engine recomputes margin against the new lower total.
  //
  //   • LOCKED (customer_price_inc_gst = a number):
  //       customer_total = the locked price
  //     The implicit discount is whatever (list - locked_price) is; the
  //     client UI auto-fills applied_nzd to match for the audit trail.
  //
  // Margin is derived against the final customer_total in either mode.
  const auto_priced = spec.pricing?.customer_price_inc_gst == null;
  const appliedDiscountInput = Math.max(0,
    Number(spec.pricing?.discount?.applied_nzd) || 0);
  const customerTotalIncGst = auto_priced
    ? r2(Math.max(0, totalListIncGst - appliedDiscountInput))
    : r2(spec.pricing.customer_price_inc_gst);
  const customerTotalExGst = r2(customerTotalIncGst / (1 + gst));
  const discountAppliedIncGst = r2(totalListIncGst - customerTotalIncGst);
  const discountAppliedExGst = r2(totalListExGst - customerTotalExGst);
  const discountPctOfList = totalListIncGst > 0
    ? r2((discountAppliedIncGst / totalListIncGst) * 100)
    : 0;

  // ── Profit + margin ────────────────────────────────────────────────────
  // Profit ex GST = the real, taxable profit.
  const profitExGst = r2(customerTotalExGst - totalCostExGst);
  const profitIncGst = r2(customerTotalIncGst - totalCostExGst * (1 + gst));
  const projectMarginPct = customerTotalExGst > 0
    ? r2((profitExGst / customerTotalExGst) * 100)
    : 0;

  // Hardware blended margin (used as supplementary metric in sales console)
  const hwBlendedMarginPct = hwCost > 0
    ? r2((hwMarginDollar / hwCost) * 100)
    : 0;

  // ── Margin floor status ────────────────────────────────────────────────
  let marginFloorStatus;
  if (projectMarginPct >= 12) marginFloorStatus = 'healthy';        // green
  else if (projectMarginPct >= marginFloor) marginFloorStatus = 'amber'; // amber zone
  else marginFloorStatus = 'below_floor';                            // red, blocks

  // ── Approval gate ──────────────────────────────────────────────────────
  // ANY discount > $1 needs owner_approved, regardless of which path produced
  // it (auto-mode discount field OR locked-below-list implicit gap). Uses the
  // computed gap so a rep can't bypass the gate by locking the price and
  // leaving applied_nzd at 0 in the audit log.
  const hasDiscount = discountAppliedIncGst > 1;

  // ── Warnings ───────────────────────────────────────────────────────────
  const warnings = [];
  if (marginFloorStatus === 'below_floor') {
    warnings.push({
      severity: 'error',
      code: 'below_margin_floor',
      message: `Project margin ${projectMarginPct.toFixed(1)}% is below ${marginFloor}% floor. ` +
               `Owner approval required, or raise customer price to ` +
               `~$${r0(totalCostExGst / (1 - marginFloor / 100) * (1 + gst))}.`,
    });
  }
  if (hasDiscount && !spec.pricing.discount?.owner_approved) {
    warnings.push({
      severity: 'error',
      code: 'discount_not_approved',
      message: `Discount of $${r0(discountAppliedIncGst)} applied but owner_approved is not true. ` +
               `Admin must tick "Owner has approved" on the Pricing tab.`,
    });
  }
  if (hasDiscount && !(spec.pricing.discount?.reason || '').trim()) {
    warnings.push({
      severity: 'error',
      code: 'discount_reason_missing',
      message: `Discount of $${r0(discountAppliedIncGst)} applied but no reason recorded. ` +
               `Audit log requires a reason text for every discount.`,
    });
  }

  return {
    lines,
    sections: {
      major_hardware: { cost: r2(majorCost), sell_ex_gst: r2(majorSellEx),
                       margin_dollar: r2(majorSellEx - majorCost) },
      bos: { cost: r2(bosCost), sell_ex_gst: r2(bosSellEx),
             margin_dollar: r2(bosSellEx - bosCost) },
      labour: { cost: labourCost, sell_ex_gst: r2(labourSellEx),
                margin_dollar: r2(labourSellEx - labourCost) },
      compliance: { cost: complianceCost, sell_ex_gst: r2(complianceSellEx),
                    margin_dollar: r2(complianceSellEx - complianceCost) },
    },
    totals: {
      system_kw: systemKw,
      auto_priced,
      total_cost_ex_gst: totalCostExGst,
      total_list_ex_gst: totalListExGst,
      total_list_inc_gst: totalListIncGst,
      discount_applied_ex_gst: discountAppliedExGst,
      discount_applied_inc_gst: discountAppliedIncGst,
      discount_pct_of_list: discountPctOfList,
      customer_total_ex_gst: customerTotalExGst,
      customer_total_inc_gst: customerTotalIncGst,
      gst_on_customer_total: r2(customerTotalIncGst - customerTotalExGst),
      profit_ex_gst: profitExGst,
      profit_inc_gst: profitIncGst,
      project_margin_pct: projectMarginPct,
      hw_blended_margin_pct: hwBlendedMarginPct,
      hw_margin_dollar: hwMarginDollar,
    },
    margin_floor_status: marginFloorStatus,
    warnings,
    gst_rate: gst,
  };
}
