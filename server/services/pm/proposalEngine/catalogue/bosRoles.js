// ────────────────────────────────────────────────────────────────────────────
// BoS Role registry — engine knows ROLES, catalogue knows SKUs.
//
// The proposal engine needs concrete BoS items at quote time: a mounting kit
// for the panels, an AC isolator, MC4 connectors, etc. Previously these were
// hardcoded SKUs in bomBuilder.js ('HOP-TIN-KIT-4P', 'SLF-BOS-32-30M', …).
//
// That broke as soon as the engine started reading from the live products
// table because admin SKUs don't always match the engine's hardcoded list.
//
// This registry inverts the relationship: the engine declares ROLES it needs,
// each role has a predicate that picks the best matching SKU from whatever
// the catalogue contains. Admin can add new SKUs without touching engine code
// as long as one row matches the pattern.
//
// `findBosByRole(catalogue, 'mounting_kit_4p')` → returns the SKU object or null.
//
// Engineering note: each role's `pickPriority` sub-predicates run in order;
// first non-null match wins. Use brand/keyword preferences to prefer the
// "right" SKU when multiple match (e.g. prefer black-finish tin kit over tile).
// ────────────────────────────────────────────────────────────────────────────

// Helper: case-insensitive name regex tester.
const nameMatches = (item, pattern) =>
  typeof item.name === 'string' && pattern.test(item.name);

// Pick the first item from the catalogue where any priority predicate matches.
// `priorities` is an array of predicates — each gets the full row. The FIRST
// row that any priority matches wins; ties broken by lower cost.
function pickByPriorities(items, priorities) {
  for (const pred of priorities) {
    const matches = items.filter(pred);
    if (matches.length > 0) {
      // Tie-break: lowest cost
      return matches.sort((a, b) => (a.cost_nzd || Infinity) - (b.cost_nzd || Infinity))[0];
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Role definitions. Each role has:
//   - description: human-readable for warnings/UI
//   - required: if true, missing match warns; if false, silently skipped
//   - pick(catalogue): returns matched item or null
// ────────────────────────────────────────────────────────────────────────────

export const BOS_ROLES = {
  // ── Mounting ──────────────────────────────────────────────────────────
  mounting_kit_4p: {
    description: 'Mounting kit per 4 panels (tin / tile / tilt)',
    required: true,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /\(4-?Panel\).*TIN\s*KIT.*Black/i),  // prefer black tin
        i => nameMatches(i, /\(4-?Panel\).*TIN\s*KIT/i),
        i => nameMatches(i, /\(4-?Panel\).*TILE\s*KIT/i),
        i => nameMatches(i, /\(4-?Panel\).*KIT/i),
        i => i.category === 'mounting' && /kit/i.test(i.name || ''),
      ]);
    },
  },

  roof_seal_per_panel: {
    description: 'EPDM roof seal per panel mount',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Flashrite|Flexatile.*EPDM/i),
        i => nameMatches(i, /EPDM.*Black/i),
        i => nameMatches(i, /Roof Seal|EPDM Seal/i),
        i => i.category === 'mounting' && /seal/i.test(i.name || ''),
      ]);
    },
  },

  // ── Cabling ──────────────────────────────────────────────────────────
  dc_conduit_30m: {
    description: 'DC pre-wired conduit (30m roll, 6×4mm² + earth)',
    required: true,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Solarflex.*32mm.*6\s*x\s*4mm.*30/i),
        i => nameMatches(i, /Solarflex.*32mm.*\(30mt\)/i),
        i => nameMatches(i, /Solarflex.*30/i),
        i => i.category === 'cabling' && /conduit/i.test(i.name || '') && /30/.test(i.name || ''),
      ]);
    },
  },

  ac_cable_per_metre: {
    description: 'AC cable per metre (inverter → switchboard)',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /AC Cable.*per metre/i),
        i => nameMatches(i, /AC Cable\s*\d/i),
        i => i.category === 'cabling' && /AC.*cable/i.test(i.name || ''),
      ]);
    },
  },

  // ── Electrical ────────────────────────────────────────────────────────
  mc4_connector_pack: {
    description: 'MC4 connector pack (pair, bag of 50)',
    required: true,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /MC4.*Connectors.*M\/?F Pair.*BAG/i),
        i => nameMatches(i, /MC4.*Pair/i) && !/in-?line fuse/i.test(i.name || ''),
        i => i.category === 'electrical' && /MC4/i.test(i.name || ''),
      ]);
    },
  },

  dc_isolator_rooftop: {
    description: 'Rooftop DC isolator (40A 1500V or similar)',
    required: true,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Commercial DC Isolator.*40A.*1500V/i),
        i => nameMatches(i, /DC Isolator.*40A/i),
        i => nameMatches(i, /DC.*32A.*ISOLATOR.*1000V/i),     // smaller fallback
        i => /DC/i.test(i.name || '') && /isolator/i.test(i.name || ''),
      ]);
    },
  },

  ac_isolator_1ph: {
    description: 'Switchboard AC isolator (1-phase, 40A)',
    required: true,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Single Phase.*40A.*Isolator/i),
        i => nameMatches(i, /AC.*40A.*Single-?Phase/i),
        i => nameMatches(i, /AC 32A Isolator.*Single-?Phase/i),
      ]);
    },
  },

  ac_isolator_3ph: {
    description: 'Switchboard AC isolator (3-phase)',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /40A.*Three-?Phase AC Isolator/i),
        i => nameMatches(i, /63A.*Three-?Phase AC Isolator/i),
      ]);
    },
  },

  ac_spd: {
    description: 'Type 2 AC surge protection device (residential)',
    required: true,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Type 2 Residential SPD.*AC/i),
        i => nameMatches(i, /AC.*SPD.*Type 2/i),
        i => i.category === 'electrical' && /SPD/i.test(i.name || '') && /AC/i.test(i.name || ''),
      ]);
    },
  },

  dc_spd: {
    description: 'DC SPD (string-level surge protection)',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Type 1\+2.*SPD.*AC\/DC/i),
        i => nameMatches(i, /Type 2.*DC.*SPD/i),
        i => i.category === 'electrical' && /SPD/i.test(i.name || '') && /DC/i.test(i.name || ''),
      ]);
    },
  },

  enclosure_pv: {
    description: 'IP65 PV enclosure for SPDs + isolators',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /4 Pole PV.*IP65/i),
        i => nameMatches(i, /8 Pole PV.*IP65/i),
        i => nameMatches(i, /12 Pole PV.*IP65/i),
        i => i.category === 'enclosure',
      ]);
    },
  },

  // ── Compliance / labels ──────────────────────────────────────────────
  label_kit: {
    description: 'AS/NZS 4777 compliance labels kit',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Label Kit.*Hybrid 2025/i),
        i => nameMatches(i, /Label Kit.*String/i),
        i => nameMatches(i, /Label.*4777/i),
        i => nameMatches(i, /Label Kit/i),
      ]);
    },
  },

  // ── Sundries / earthing ──────────────────────────────────────────────
  sundries: {
    description: 'Cable ties, glands, sealants',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Cable Tie.*Black.*Pack/i),
        i => nameMatches(i, /Cable Tie.*100\s*pcs/i),
        i => nameMatches(i, /Cable Tie/i),
      ]);
    },
  },

  earth_rod_kit: {
    description: 'Earth rod + bonding cable',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Earth Rod|Earthing Kit/i),
        i => nameMatches(i, /Earthing Clip/i),
      ]);
    },
  },

  // ── Parallel topology combiner ───────────────────────────────────────
  combiner_box: {
    description: 'DC string combiner box + fuses (parallel topology)',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Combiner Box/i),
        i => nameMatches(i, /String Combiner/i),
        // Fall back: PV enclosure + DC fuses, but treat as single line
        i => nameMatches(i, /PV.*IP65.*8 Pole/i),
      ]);
    },
  },

  // ── Hot water diverter (non-battery quotes per §2.18) ───────────────
  hot_water_diverter: {
    description: 'Catch Power hot water diverter',
    required: false,
    pick(catalogue) {
      const items = Object.values(catalogue.BOS_ITEMS || {});
      return pickByPriorities(items, [
        i => nameMatches(i, /Catch Power.*Diverter/i),
        i => nameMatches(i, /Hot Water Diverter/i),
        i => /diverter/i.test(i.name || ''),
      ]);
    },
  },
};

// ── Public lookup ─────────────────────────────────────────────────────────
export function findBosByRole(catalogue, role) {
  const def = BOS_ROLES[role];
  if (!def) throw new Error(`Unknown BoS role: ${role}`);
  return def.pick(catalogue);
}

// ── BMS picker (by battery series, not hardcoded SKU) ────────────────────
// engineeringRules.js has BMS_RULES.HVM.bms_sku='GEN-BAC-ACC-HVM', but the
// live catalogue has BYD-BAC-ACC-GEN. Look up by series match instead.
export function findBmsForBattery(catalogue, batterySeries) {
  if (!batterySeries) return null;
  const bmsItems = Object.values(catalogue.BMS_CONTROLLERS || {});
  // 1. Try exact for_battery_series match
  const exact = bmsItems.find(i => i.for_battery_series === batterySeries);
  if (exact) return exact;
  // 2. Try brand-aligned generic accessory (e.g., BYD-BAC-ACC-GEN for any BYD)
  const brandPrefix = batterySeries.startsWith('HV') ? 'BYD'   // HVM/HVS = BYD
                    : batterySeries === 'Reserva'    ? 'Fronius'
                    : batterySeries === 'LVL'        ? 'BYD'
                    : null;
  if (brandPrefix) {
    const branded = bmsItems.find(i => i.brand?.startsWith(brandPrefix));
    if (branded) return branded;
  }
  // 3. Last resort: any BMS controller (warn-and-use)
  return bmsItems[0] || null;
}
