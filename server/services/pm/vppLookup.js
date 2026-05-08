// ── VPP-compatible hardware lookup ──
// Read once at module load. The commissioning endpoint and the frontend
// commissioning form use the same dataset to determine vpp_capable_hardware.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath  = path.join(__dirname, '../../data/vpp-compatible-hardware.json');

let DATA;
try {
  DATA = JSON.parse(readFileSync(dataPath, 'utf8'));
} catch (e) {
  console.warn('VPP hardware lookup unavailable:', e.message);
  DATA = { inverters: [], batteries: [] };
}

function matches(prefixEntry, model) {
  if (!model) return false;
  return String(model).toLowerCase().startsWith(prefixEntry.model_prefix.toLowerCase());
}

export function inverterIsVppCapable(make, model) {
  const candidates = DATA.inverters.filter(e => e.make.toLowerCase() === String(make || '').toLowerCase());
  for (const c of candidates) if (matches(c, model)) return c.vpp_capable;
  return false;
}

export function batteryIsVppCapable(make, model) {
  if (!make) return false;
  const candidates = DATA.batteries.filter(e => e.make.toLowerCase() === String(make || '').toLowerCase());
  for (const c of candidates) if (matches(c, model)) return c.vpp_capable;
  return false;
}

/**
 * Returns true if the system as a whole is VPP-capable.
 * Inverter must be capable. Battery is optional but if present must also be capable.
 */
export function systemIsVppCapable({ inverter_make, inverter_model, battery_make, battery_model }) {
  const invOk = inverterIsVppCapable(inverter_make, inverter_model);
  if (!invOk) return false;
  if (!battery_make && !battery_model) return true;  // solar-only — can still dispatch via inverter
  return batteryIsVppCapable(battery_make, battery_model);
}

export function vppHardwareCatalog() {
  return DATA;
}
