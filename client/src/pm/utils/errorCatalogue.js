// ────────────────────────────────────────────────────────────────────────────
// Error Catalogue — the single source of truth behind the Team Error Playbook.
//
// One entry per stable error `code`. Both the inline ErrorCard and the (future)
// Troubleshooting page read from here, so wording never drifts.
//
// Shape of each entry:
//   title     — plain one-liner (what happened), no codes/jargon
//   meaning   — why it happens (one sentence)
//   whatToDo  — the concrete next action the team member takes
//   owner     — 'rep' | 'admin' | 'dev'   (who resolves it)
//   severity  — 'block' | 'flag' | 'info' (how hard the system stops you)
//   area      — 'bill' | 'quote' | 'pricing' | 'sales' | 'data' | 'system'
//   tab?      — optional editor tab to jump to (quote editor only)
//
// Keep this file in lockstep with docs/TEAM_ERROR_PLAYBOOK.md.
// Server emits the `code`; this file owns everything the human sees.
// ────────────────────────────────────────────────────────────────────────────

export const OWNERS = {
  rep:   { label: 'You can fix this', badge: 'REP',   tone: 'emerald' },
  admin: { label: 'Needs admin',      badge: 'ADMIN', tone: 'amber'   },
  dev:   { label: 'Needs the dev team', badge: 'DEV', tone: 'rose'    },
};

export const SEVERITIES = {
  block: { label: 'Blocks you',  tone: 'rose'  },
  flag:  { label: 'Worth a look', tone: 'amber' },
  info:  { label: 'For your info', tone: 'slate' },
};

// ── A. Bill analysis (billOcrService parse-warning codes) ───────────────────
const BILL = {
  kwh_double_count_suspect: {
    title: 'Usage looks about 2× the annual figure on the bill',
    meaning: 'Often a winter/high-use month; occasionally a total was read twice.',
    whatToDo: 'Open the PDF. If it’s a high-use month and the $/rate look normal, accept it. If the kWh genuinely looks doubled, correct it or report it.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  kwh_high_vs_rolling_seasonal: {
    title: 'Usage is high for the period, but the rate looks normal',
    meaning: 'This month extrapolates above the annual average, yet the unit rate is normal — so it’s a high-use (e.g. winter) period, not a double-count.',
    whatToDo: 'Usually fine to accept. Glance at the PDF if you want to be sure.',
    owner: 'rep', severity: 'info', area: 'bill',
  },
  kwh_low_vs_total: {
    title: 'Usage read looks low compared with the bill total',
    meaning: 'A line item may have been missed, or it’s a low-use month with a big fixed charge.',
    whatToDo: 'Check the usage line on the PDF and type the correct kWh if it’s wrong.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  line_items_dont_sum: {
    title: 'The line items don’t add up to the printed total',
    meaning: 'A charge or credit was missed, or the bill has an unusual layout.',
    whatToDo: 'Compare with the PDF and correct the figure that’s off.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  variable_rate_above_residential_range: {
    title: 'The per-kWh rate looks higher than a normal home rate',
    meaning: 'Commercial plan, a peak/controlled rate read as the main rate, or a parse slip.',
    whatToDo: 'Confirm the rate on the bill. If it’s genuinely a business/peak rate, accept it; otherwise correct it.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  variable_rate_below_residential_range: {
    title: 'The per-kWh rate looks lower than a normal home rate',
    meaning: 'Off-peak/controlled rate read as the main rate, a free-hours plan, or a parse slip.',
    whatToDo: 'Confirm against the bill and correct if needed.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  kwh_per_day_outside_residential_range: {
    title: 'Daily usage is outside the typical home range',
    meaning: 'Large property (high), holiday home/empty (low), or wrong billing-period days.',
    whatToDo: 'Sanity-check the period dates and usage, and correct whatever is wrong.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  days_mismatch: {
    title: 'The billing-period length doesn’t match the dates',
    meaning: 'A date was misread.',
    whatToDo: 'Fix the period start/end dates from the PDF.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  end_before_start: {
    title: 'Billing period ends before it starts',
    meaning: 'The dates are swapped or misread.',
    whatToDo: 'Swap or correct the dates.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  tou_kwh_dont_sum: {
    title: 'Time-of-use buckets don’t add up to total usage',
    meaning: 'The peak/off-peak/shoulder split was misread on a time-of-use plan.',
    whatToDo: 'Check the time-of-use breakdown on the bill and correct it.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  multi_rate_variable_undercount: {
    title: 'Fewer variable-rate rows than expected on a multi-rate plan',
    meaning: 'A complex multi-rate bill; one row didn’t read.',
    whatToDo: 'Add the missing rate row from the PDF.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  multi_rate_fixed_undercount: {
    title: 'Fewer fixed-charge rows than expected on a multi-rate plan',
    meaning: 'A complex multi-rate bill; one fixed-charge row didn’t read.',
    whatToDo: 'Add the missing fixed-charge row from the PDF.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  free_hours_partial_billing: {
    title: 'Looks like a free-hours plan billed for part of the period',
    meaning: 'Plans like “Hour of Power”/free-window plans can skew a single period.',
    whatToDo: 'Note it — usage may not reflect a full normal period. Confirm with the customer if it’s sizing-critical.',
    owner: 'rep', severity: 'info', area: 'bill',
  },
  negative_value: {
    title: 'A figure came through negative (e.g. a credit)',
    meaning: 'An account credit/solar buyback, or a misread sign.',
    whatToDo: 'Confirm it’s a real credit; if it’s a misread, correct it.',
    owner: 'rep', severity: 'flag', area: 'bill',
  },
  pdf_image_only_ocr_unavailable: {
    title: 'This bill is a scanned image — we can’t read it automatically',
    meaning: 'It’s a photo/scan, not a digital PDF, so the text can’t be extracted.',
    whatToDo: 'Enter the bill manually (annual kWh, rate, fixed charge) in the Bills tab.',
    owner: 'rep', severity: 'block', area: 'bill',
  },
};

// ── B. Engineering (engineeringValidator codes) ─────────────────────────────
const ENGINEERING = {
  voc_cold_exceeded: {
    title: 'Too many panels in a string for this inverter',
    meaning: 'On a cold morning the string voltage exceeds the inverter’s limit (AS/NZS 5033).',
    whatToDo: 'Reduce panels-per-string, or add another string. The auto-designer does this for you.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  voc_reduced_mode_warn: {
    title: 'String voltage is high for oversized mode',
    meaning: 'Voltage is above the threshold needed for Fronius reduced-mode oversizing.',
    whatToDo: 'Keep the DC/AC ratio in range, or shorten the strings. Disclose clipping in the proposal.',
    owner: 'rep', severity: 'info', area: 'quote', tab: 'system',
  },
  vmp_below_min: {
    title: 'Too few panels in a string',
    meaning: 'String voltage drops below where the inverter can track power on warm days.',
    whatToDo: 'Add panels to the shortest string, or pick an inverter with a lower MPPT floor.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  vmp_borderline: {
    title: 'String length is borderline-short',
    meaning: 'Voltage is within 10% of the inverter’s tracking minimum — works, but no headroom.',
    whatToDo: 'Consider lengthening that string group for thermal headroom.',
    owner: 'rep', severity: 'info', area: 'quote', tab: 'system',
  },
  mppt_current_clipping: {
    title: 'Panel current is above the inverter input — some clipping expected',
    meaning: 'The string current exceeds the inverter’s operating-current limit per input.',
    whatToDo: 'Accept the small generation loss, split into more strings, or pick a higher-current inverter.',
    owner: 'rep', severity: 'flag', area: 'quote', tab: 'system',
  },
  isc_exceeded: {
    title: 'String current is above the inverter’s safety limit',
    meaning: 'String short-circuit current (×1.25) exceeds the inverter input rating.',
    whatToDo: 'Add string fuses or reduce strings per input. The auto-designer re-lays-out for you.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  dc_ac_oversize_max: {
    title: 'Too much panel power for this inverter’s size',
    meaning: 'The DC/AC ratio exceeds the maximum allowed (voids warranty).',
    whatToDo: 'Step up to a larger inverter, or reduce panels. The auto-designer steps up.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  dc_ac_reduced_voc: {
    title: 'Oversizing needs shorter strings',
    meaning: 'The DC/AC ratio requires reduced-mode oversizing, but string voltage is too high for it.',
    whatToDo: 'Shorten the series strings, or reduce DC capacity.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  dc_ac_reduced_mode: {
    title: 'Running in oversized (reduced) mode',
    meaning: 'The DC/AC ratio is in the reduced-mode window — some clipping at peak sun.',
    whatToDo: 'Disclose the expected clipping in the customer proposal.',
    owner: 'rep', severity: 'info', area: 'quote', tab: 'system',
  },
  battery_needs_plus_inverter: {
    title: 'This inverter can’t host a battery',
    meaning: 'A battery was added, but the chosen inverter isn’t the battery-capable (Plus) version.',
    whatToDo: 'Switch to the Plus variant of the inverter to add a battery.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  inverter_battery_not_approved: {
    title: 'This battery isn’t approved for this inverter',
    meaning: 'The manufacturer’s compatibility matrix doesn’t approve this pairing.',
    whatToDo: 'Pick a compatible battery — the system suggests valid ones.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  battery_module_count_invalid: {
    title: 'That battery module count isn’t allowed',
    meaning: 'The chosen number of modules isn’t a valid stack size for this battery family.',
    whatToDo: 'Set the module count to one of the allowed values shown.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  battery_not_lfp: {
    title: 'Only LFP batteries are allowed',
    meaning: 'Our MVP supports LFP chemistry only.',
    whatToDo: 'Choose an LFP battery (HVM / HVS / Reserva).',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  string_below_minimum: {
    title: 'A string is below the minimum panel count',
    meaning: 'Fronius requires at least 4 panels per string.',
    whatToDo: 'Add panels to reach the minimum string length.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  phase_mismatch: {
    title: 'Smart-meter phase doesn’t match the site',
    meaning: 'The meter is set to a different phase (1 vs 3) than the inverter/site.',
    whatToDo: 'Set the smart-meter phase to match the site.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
  parallel_topology_disclosure: {
    title: 'Parallel string topology used',
    meaning: 'Adds a combiner box, DC fuses and larger isolators; ~4% clipping at peak sun.',
    whatToDo: 'Make sure the proposal discloses this design choice.',
    owner: 'rep', severity: 'info', area: 'quote', tab: 'system',
  },
  mixed_vendor_disclosure: {
    title: 'Mixed-vendor battery + inverter',
    meaning: 'A different-brand battery and inverter means separate warranty pathways.',
    whatToDo: 'Make sure the proposal discloses the separate warranties.',
    owner: 'rep', severity: 'info', area: 'quote', tab: 'system',
  },
};

// ── C. Pricing / commercial (costEngine) ────────────────────────────────────
const PRICING = {
  margin_below_floor: {
    title: 'This price falls below the minimum margin',
    meaning: 'At this price the project margin is under the 10% floor.',
    whatToDo: 'Raise the customer price, or get owner approval to discount (with a reason).',
    owner: 'rep', severity: 'block', area: 'pricing', tab: 'pricing',
  },
  discount_needs_approval: {
    title: 'This discount needs owner approval',
    meaning: 'There’s no fixed % cap, but a discount needs sign-off and a reason (audit-logged).',
    whatToDo: 'Get owner approval and enter the reason. The margin floor is the real hard limit.',
    owner: 'rep', severity: 'block', area: 'pricing', tab: 'pricing',
  },
  rate_card_missing: {
    title: 'A labour/compliance rate is missing',
    meaning: 'The cost engine couldn’t find a rate-card line it needs.',
    whatToDo: 'Tell admin which line; they refresh the rate-card CSV.',
    owner: 'admin', severity: 'block', area: 'pricing',
  },
  product_not_found: {
    title: 'A picked item isn’t in the catalogue',
    meaning: 'The panel/inverter/battery/meter SKU couldn’t be found.',
    whatToDo: 'Re-pick from the dropdown. If it should exist, tell admin.',
    owner: 'rep', severity: 'block', area: 'quote', tab: 'system',
  },
};

// ── D. Sales / lifecycle ────────────────────────────────────────────────────
const SALES = {
  convert_failed: {
    title: 'This tier couldn’t be converted to a firm offer',
    meaning: 'The chosen package has a configuration or pricing problem (the site survey is no longer required to convert).',
    whatToDo: 'Open the quote in the editor — the “What to resolve” panel shows exactly what to fix, then convert again.',
    owner: 'rep', severity: 'block', area: 'sales',
  },
  generate_needs_site_survey: {
    title: 'A firm offer needs the site survey filled',
    meaning: 'Generating a firm (Stage 2) PDF requires the survey data.',
    whatToDo: 'Fill the Site Survey before generating the firm PDF.',
    owner: 'rep', severity: 'block', area: 'sales',
  },
  quote_version_locked: {
    title: 'This quote already has a generated version',
    meaning: 'A generated version is a permanent snapshot and doesn’t change retroactively.',
    whatToDo: 'Create a new version to make changes — the old PDF stays as it is.',
    owner: 'rep', severity: 'info', area: 'sales',
  },
  quote_cannot_ship: {
    title: 'This quote can’t be generated yet',
    meaning: 'One or more engineering or pricing checks are still blocking it.',
    whatToDo: 'Open the quote editor — the “What to resolve” panel lists exactly what to fix.',
    owner: 'rep', severity: 'block', area: 'sales',
  },
  tier_mode_not_allowed: {
    title: 'Different-size tiers are gated',
    meaning: 'MVP policy: all tiers cover the full need and differ by features, not size.',
    whatToDo: 'Use same-size tiers, or ask the owner to enable tiered mode.',
    owner: 'rep', severity: 'block', area: 'sales',
  },
};

// ── E. System / technical (can fire on any screen) ──────────────────────────
const SYSTEM = {
  session_expired: {
    title: 'Your session expired',
    meaning: 'You were signed out after a period of inactivity.',
    whatToDo: 'Sign in again — your draft is saved.',
    owner: 'rep', severity: 'block', area: 'system',
  },
  network_offline: {
    title: 'Couldn’t save — no connection',
    meaning: 'The internet/network dropped mid-action.',
    whatToDo: 'Check your connection; the screen retries automatically. Your input stays on screen.',
    owner: 'rep', severity: 'flag', area: 'system',
  },
  save_failed_server: {
    title: 'Save failed',
    meaning: 'The server rejected or hiccuped on the save.',
    whatToDo: 'Try once more. If it repeats, report it — your draft is kept.',
    owner: 'rep', severity: 'block', area: 'system',
  },
  permission_denied: {
    title: 'You don’t have permission for this',
    meaning: 'This action needs admin/owner rights.',
    whatToDo: 'Ask admin/owner to do it or grant you access.',
    owner: 'rep', severity: 'block', area: 'system',
  },
  concurrent_edit: {
    title: 'Someone else edited this',
    meaning: 'Two people changed the same record.',
    whatToDo: 'Reload to see their version, then re-apply your change.',
    owner: 'rep', severity: 'flag', area: 'system',
  },
  data_load_failed: {
    title: 'Couldn’t load this data',
    meaning: 'A list or record failed to fetch.',
    whatToDo: 'Refresh. If it persists, report it.',
    owner: 'rep', severity: 'flag', area: 'system',
  },
  email_send_failed: {
    title: 'The proposal didn’t send',
    meaning: 'The email/send to the customer failed.',
    whatToDo: 'Retry the send. If it repeats, report it — the customer wasn’t emailed.',
    owner: 'rep', severity: 'block', area: 'system',
  },
  customer_link_expired: {
    title: 'The customer’s link expired',
    meaning: 'A magic-link proposal link timed out.',
    whatToDo: 'Re-issue the link from the quote.',
    owner: 'rep', severity: 'flag', area: 'system',
  },
  csv_import_failed: {
    title: 'CSV import failed',
    meaning: 'A catalogue/rate-card upload was rejected.',
    whatToDo: 'Check the file format; admin re-uploads.',
    owner: 'admin', severity: 'block', area: 'system',
  },
};

export const CATALOGUE = {
  ...BILL, ...ENGINEERING, ...PRICING, ...SALES, ...SYSTEM,
};

// The global safety net: anything we don't yet recognise still gets a card.
export const FALLBACK = {
  title: 'Something went wrong here',
  meaning: 'An unexpected problem the system doesn’t yet have specific guidance for.',
  whatToDo: 'Your work is safe. Use “Report it” — it’ll reach the dev team with the details attached.',
  owner: 'dev', severity: 'flag', area: 'system',
};

// Look up an entry by code. Always returns *something* (FALLBACK if unknown),
// so no caller ever has to handle a missing entry.
export function lookupError(code) {
  if (code && CATALOGUE[code]) return { code, ...CATALOGUE[code] };
  return { code: code || 'unknown', ...FALLBACK };
}
