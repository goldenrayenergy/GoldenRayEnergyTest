import env from '../config/env.js';

export function calculateSolar(input, customConfig = null) {
  const cfg = customConfig || env.solar;
  const elecRate = parseFloat(input.electricityRate) || cfg.defaultElecRate;
  const monthlyBill = parseFloat(input.monthlyBill) || 200;
  const monthlyKwh = monthlyBill / elecRate;
  const dailyKwh = monthlyKwh / 30;
  const systemSize = Math.ceil((dailyKwh / cfg.sunHours) * 10) / 10;
  const panels = Math.ceil((systemSize * 1000) / cfg.panelWatts);

  let batteryKwh = 0, batteryCost = 0;
  if (input.systemType === 'off-grid') {
    const withBattery = (input.batteryOption ?? 'with-battery') !== 'without-battery';
    if (withBattery) { batteryKwh = Math.ceil(dailyKwh * 1.5); batteryCost = batteryKwh * cfg.batteryCostPerKwh; }
  }
  else if (input.systemType === 'hybrid') { batteryKwh = Math.ceil(dailyKwh * 0.6); batteryCost = batteryKwh * cfg.batteryCostPerKwh; }

  const isPPA = input.systemType === 'ppa';
  const ppaDiscount = 0.25; // 25% below grid rate

  const panelCost = isPPA ? 0 : systemSize * cfg.costPerKw;
  const inverterCost = isPPA ? 0 : panelCost * cfg.inverterPct / 100;
  const laborCost = isPPA ? 0 : panelCost * cfg.laborPct / 100;
  const subtotal = panelCost + inverterCost + laborCost + batteryCost;
  const markup = isPPA ? 0 : subtotal * cfg.markup / 100;
  const tax = isPPA ? 0 : (subtotal + markup) * cfg.taxRate / 100;
  const totalCost = Math.round(subtotal + markup + tax);

  const savingsRate = isPPA ? ppaDiscount : 0.85;
  const monthlySavings = Math.round(monthlyBill * savingsRate);
  const annualSavings = monthlySavings * 12;
  const paybackYears = totalCost > 0 ? Math.round(totalCost / annualSavings * 10) / 10 : 0;
  const roi = totalCost > 0
    ? Math.round((annualSavings * 25 - totalCost) / totalCost * 100)
    : 0;
  const annualKwh = Math.round(systemSize * cfg.sunHours * 365 * 0.8);
  const co2TonsYear = Math.round(annualKwh * cfg.co2Factor / 1000 * 10) / 10;
  const treesEquivalent = Math.round(co2TonsYear * 40);
  const traditionalCost = Math.round(monthlyKwh * 12 * elecRate);
  const costReduction = Math.round((annualSavings / traditionalCost) * 100);

  return {
    systemSize, panels, batteryKwh, batteryCost,
    panelCost: Math.round(panelCost), inverterCost: Math.round(inverterCost),
    laborCost: Math.round(laborCost), markup: Math.round(markup), tax: Math.round(tax),
    totalCost, monthlySavings, annualSavings, paybackYears, roi,
    annualKwh, co2TonsYear, treesEquivalent, traditionalCost, costReduction,
    lifetimeCo2: Math.round(co2TonsYear * 25), lifetimeSavings: Math.round(annualSavings * 25),
  };
}
