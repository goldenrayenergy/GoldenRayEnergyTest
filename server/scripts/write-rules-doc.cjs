// Build Goldenray MVP-1 Business Rules — Markdown source + rendered PDF.
// Both saved to C:\Users\ram33\Downloads.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const XLSX = require('xlsx');

const TODAY = '9 June 2026';

// ── Pull the decisions arrays out of the Excel sheet we already maintain ────
const wb = XLSX.readFile('C:/Users/ram33/Downloads/Goldenray_MVP1_Decisions.xlsx');
const openAOA = XLSX.utils.sheet_to_json(wb.Sheets['Open Decisions'], { header: 1 });
const lockedAOA = XLSX.utils.sheet_to_json(wb.Sheets['Already Decided'], { header: 1 });
// drop header rows
const OPEN = openAOA.slice(1).filter(r => r.length >= 7);
const LOCKED = lockedAOA.slice(1).filter(r => r.length >= 3);

// ── Helpers for markdown formatting ────────────────────────────────────────
function questionsForSection(sectionPrefix) {
  return OPEN.filter(r => String(r[1] || '').startsWith(sectionPrefix));
}
function calloutMd(q) {
  const [num, sec, topic, question, rec, alts, impl] = q;
  return `> **DECISION NEEDED — Q${num} — ${sec} — ${topic}**\n>\n> **Question** — ${question}\n>\n> **Recommended default** — ${rec}\n>\n> **Alternatives** — ${alts}\n>\n> **Why it matters / implication** — ${impl}\n`;
}
function decisionsBlockMd(prefix) {
  const list = questionsForSection(prefix);
  if (!list.length) return '\n> *(No open questions in this section; all rules locked.)*\n';
  return '\n' + list.map(calloutMd).join('\n');
}

// ── Section content ──────────────────────────────────────────────────────────

const FRONT = `# Goldenray Energy NZ — MVP-1 Business Rules

*DRAFT for co-founder review — ${TODAY}*

---

## Document purpose

This document defines the **business rules and assumptions** that drive Goldenray's MVP-1 single-tenant solar quote-and-install platform. It is the operating contract between the platform and the people who use it.

It captures:
- **What we've decided** (229 locked rules, mirrored in the paired Excel "Already Decided" tab)
- **What we still need to decide** (107 open questions, mirrored in the Excel "Open Decisions" tab)
- **The reasoning** behind each decision — why this default vs. the alternatives

Sections §10 (Roles & Permissions) and §12 (Out-of-MVP-1 explicit deferrals) were deliberately skipped during this review pass — referenced inline elsewhere.

## How to read this document

- **Sections 1–11** state the rules in their final form (where locked) or proposed form (where open questions remain)
- **"Decision needed" callouts** appear at the end of each section, surfacing what the co-founder discussion needs to answer
- **Appendix A** consolidates all 107 open questions for tracking
- **Appendix B** consolidates all 229 locked rules for reference
- **Appendix C** is a glossary of solar + privacy + technical terms

The paired \`Goldenray_MVP1_Decisions.xlsx\` is the canonical decision-tracking artifact. This document explains; the Excel records.

## TL;DR — MVP-1 at a glance

**What's being built** — a single-tenant solar quote-and-install platform for Goldenray Energy NZ, covering: bill upload → engineering-validated multi-option design → financial modelling → customer-signed proposal → site survey → Stage 2 firm price → install → commissioning → compliance pack.

**Differentiator** — NZ depth (network operator integrations + AS/NZS compliance + MBIE/EECA modelling).

**Timeline** — ~12 working weeks for MVP-1.

**Stack** — Vercel app hosting (Sydney + Singapore edge) + Supabase AU region (DB + Auth + Storage) + Postmark transactional email + Twilio NZ SMS + Google Solar API + LINZ + Electricity Authority.

**Scope IN MVP-1** — bill ingest for 8 retailers · 5 network operators · proposal PDF generator · pricing engine · 3-tier sizing (single-option default) · battery + compatibility matrix · AS/NZS validator · financial model with financing + monthly cashflow · customer portal (magic-link) · 3-touch follow-up · site survey form + Stage 2 re-quote · install + commissioning workflow · compliance pack generation · audit log · Privacy Act compliance.

**Scope DEFERRED to MVP-2 or V1** — multi-tenant · smart-meter half-hourly ingestion · auto-calibration from install actuals · multi-roof aggregation · sensitivity analysis · off-grid comparison · Stripe/POLi payment · mobile installer app · supplier PO automation · network operator submission tracking · automated commissioning · automated aftercare · SOC 2 readiness · marketing analytics.

`;

const SECTION1 = `## Section 1 — Pricing Rules

### 1.1 Source of truth
- Every priced item lives in one of four tables: \`products\`, \`labour_rate_card\`, \`bos_kits\`, \`pricing_rules\`.
- Catalogue cost (\`cost_nzd\`) and per-SKU margin (\`margin_pct\`) are the only inputs to list price for hardware.
- Labour and BoS each carry their own SKU-level cost + margin.
- **No hardcoded prices anywhere in code.** Anything not in these tables cannot be quoted.

### 1.2 Customer Total calculation (engine builds this for every quote)

Engine intelligently includes the line items the system needs (no fixed mandatory list). Items are organised into three sections matching the Excel calculator:

- **Section A — Materials** (~19 lines typical): panels · inverter · BMS · battery modules · smart meter · DC isolator · AC isolator · DC SPD · AC SPD · fuse · conduit · AC cable · MC4 pack · label kit · mount kit · cable ties · EPDM seal · rails · earthing kit.
- **Section B — Labour & Installation** (~4 lines typical): installation labour (kW-tiered) · supervisor · travel · loading/transport.
- **Section C — Compliance & Other Costs** (~5 lines typical): system design + engineering · inspection + compliance · monitoring + commissioning · grid (DG) application · CoC.

**Per-line math (same for A, B, C):**
- \`line_cost = product.cost_nzd × qty\`
- \`line_sell_ex_gst = line_cost × (1 + product.margin_pct / 100)\`
- No GST applied at line level.

**Customer Total:**
- \`project_subtotal_ex_gst = A_subtotal + B_subtotal + C_subtotal\`
- \`customer_total_inc_gst = project_subtotal_ex_gst × (1 + gst_rate)\`
- GST applied **once at the total** — not per line.

This is the **default customer-quoted price**. No "list" / "floor" terminology in customer view.

### 1.3 Discount workflow

**No defaults.** Every quote ships at the full Customer Total. There is no published cap, no implicit negotiation budget.

A discount may be requested but must satisfy ALL of:

| Constraint | Rule |
|---|---|
| Scope | Total-project level only — single bottom-line reduction. Never per line. |
| Authoriser | **Owner role only.** Sales rep requests; cannot self-approve. |
| Reason | Mandatory free-text reason in audit log. |
| Margin floor | Final project margin ex GST must stay ≥ **10%**. Engine hard-blocks below. Second-tier override by owner with documented reason. |
| Audit trail | Request + approval + rejection logged. |
| No retroactive | Cannot apply to signed quotes — Change Order required. |
| No carry-forward | Revised quote = new approval workflow. |
| Expiry | Approved discount expires when quote expires. |

**Customer-facing presentation:** Stage 1 estimate shows discount as a "−$X" line. FINAL_MODE (single-option locked) hides discount entirely — customer sees only the final price.

### 1.4 GST
- Single GST rate (\`pricing_rules.gst_rate\`, default 0.15).
- All quotes inc GST in customer-facing pages. All internal margin math ex GST.

### 1.5 Margin visibility by role
- **Owner**: cost, margin %, discount, list, floor, profit visible.
- **Sales rep**: discount cap, floor, customer price visible. Can request override. Cannot see cost or margin %.
- **Installer**: BOM only. No margin, cost, or price.
- **Customer**: never sees cost, margin, discount, list, or floor. Final inc-GST price only.

### 1.6 Topology surcharges
- Parallel-string topology adds fixed BoS + labour surcharges (per BoS kit row, not hardcoded).

### 1.7 Standing constraint — discount cap recalculated on every spec change
Engine recomputes list + floor every time spec changes (panel count, inverter, battery, BoS, topology). Never freeze old list. (Per stored feedback memory; learned during Krishna proposal regen.)

### Enhancements integrated (E1–E10)

| E# | Rule |
|:---:|---|
| E1 | Minimum project margin floor (10% — see §1.3) |
| E2 | Cost staleness flag if \`cost_last_verified_at\` > 90 days |
| E3 | Pricing snapshot frozen at quote-send time (JSONB on quote version) |
| E4 | Quote versioning + structured diff between adjacent versions |
| E5 | Mandatory-line-items audit (engine intelligently derives per project) |
| E6 | FX-dependent cost tracking (last_fx_rate + buffer) |
| E7 | Quote expiry behaviour (14 days default, re-issue resets) |
| E8 | Customer-facing total rounding (opt-in per quote) |
| E9 | Lost-quote reason tracking (structured codes + free-text) |
| E10 | Bulk cost refresh workflow (CSV upload + single audit batch) |

${decisionsBlockMd('§1')}

`;

const SECTION2 = `## Section 2 — System Sizing Rules

### 2.1 Solar suitability gate
Hard-fails block any quote: usable roof area < 1.6 m²/kWp · S-facing-only roof · > 25% mid-day shading · asbestos cladding · switchboard inadequate without upgrade · LNC zero-export + customer rejects · renter without landlord consent.

Soft warnings: pitch < 10° or > 45°, mid-day shading 5–25% (recommends optimisers), multi-storey access, heritage zone (manual flag in MVP-1).

### 2.2 Coverage target
**Default = 85–90% annual coverage + battery shift** (economically optimal for NZ residential). All tiers cover the same target — tier differentiation is by battery / backup / features only, never solar size.

### 2.3 Future-load forecasting
Customer asked about planned loads in next 2–5 years:
- EV (+2,500 kWh/yr per car) — recommended auto-include unless customer opts out
- Heat pump conversion (+3,500 kWh/yr) — opt-in
- Pool heating (+4,000 kWh/yr) — opt-in
- Induction cooktop (+600 kWh/yr) — opt-in
- Hot water cylinder retrofit (+3,000 kWh/yr) — opt-in

### 2.4 Capacity sizing math
\`\`\`
target_kwh        = current_annual + Σ future_load
target_dc_kwp     = target_kwh / (regional_yield × (1 - losses_pct))
panel_count       = ceil(target_dc_kwp × 1000 / panel_watts)
\`\`\`
Engine proposes 1–3 candidates within ±10% of target; validator picks the warranty-safe one.

### 2.5 Regional yield + losses
| Region | Yield (kWh/kWp/yr) | Losses | Wind zone |
|---|---:|---:|:---:|
| Auckland (Vector) | 1,250 | 14% | W3 |
| Counties / Franklin | 1,260 | 14% | W3 |
| Northland (Northpower) | 1,290 | 14% | W4 |
| Waikato (WEL) | 1,230 | 14% | W2 |
| BoP / Tauranga | 1,280 | 14% | W4 |
| Taranaki (Powerco) | 1,200 | 15% | W3-4 |
| Wellington | 1,150 | 16% | W5 |
| Canterbury (Orion) | 1,220 | 13% | W3 |
| Otago / Queenstown (Aurora) | 1,300 | 12% | W3 + snow |

### 2.6 Orientation + pitch
N (0° ±20°) = 1.00 · NE/NW (45°) = 0.95 · E/W (90°/270°) = 0.85 · SE/SW = 0.75 · S = 0.65.
Hard rule: **same-azimuth panels per MPPT input** (mixed-orientation strings cause 5–15% mismatch loss).

### 2.7 Shading + optimisers
5–15% shading → auto-recommend DC optimisers (Tigo TS4-A-O or equivalent). >15% → recommend different roof or micro-inverters.

### 2.8 Inverter selection decision tree
1. Phase match (1ph → Primo; 3ph → Symo or Verto)
2. Has battery → "Plus" variant required
3. AC kW closest to \`target_dc_kwp / DC_AC_ratio\`
4. DC/AC ratio rules (per §2.9)
5. MPPT count vs string count
6. AS/NZS 4777.2:2020 certified
7. AC headroom for planned EV charger

### 2.9 DC/AC ratio
| Range | Mode | Voc constraint |
|---|---|---|
| 1.00 – 1.25 | Conservative | < inverter Uoc max |
| **1.25 – 1.35** | **Default target** | < inverter Uoc max |
| 1.35 – 1.43 | Standard oversizing | < inverter Uoc max |
| 1.43 – 1.50 | Reduced-mode oversizing | < **450V** STC |
| > 1.50 | Not allowed (warranty void) | Engine blocks |

### 2.10 String design
- Try simple series first; check Voc at coldest expected temperature (Auckland −10°C default)
- Validate Isc per MPPT (current clipping flag if exceeded)
- Switch to parallel-string topology if Voc fails — adds BoS surcharge (combiner + DC fuses + larger isolators) auto
- Asymmetric strings allowed if Voc/Isc compliant and string_min ≥ 4 panels

### 2.11 Voltage rise compliance (AS/NZS 3008)
Hard rule: voltage rise inverter → switchboard at MPP ≤ 1%. Engine auto-upgrades AC cable cross-section (16 → 25 → 35 → 50 mm²) if needed.

### 2.12 Battery sizing — four drivers
1. Evening peak shift (5–10pm load × backup hours)
2. Self-consumption maximisation
3. Backup priority (essentials / whole-home / multi-day)
4. **Tariff arbitrage** — engine consults customer's retailer plan (free hours, off-peak windows) for optimal dispatch

Tier table (when multi-tier offered in V1):
| Tier | Battery role | Default sizing |
|---|---|---|
| Essential | Daily evening shift | ~50% peak × 4 hr |
| Comfort | Evening + low-sun day | ~100% peak × 8 hr |
| Resilience | Multi-day + EV-ready | ~150% peak × 16 hr |

### 2.13 EV charging requirements
- +2,500 kWh/yr per planned EV; inverter +7kW AC headroom
- Wattpilot integration (11kW 1ph / 22kW 3ph) as optional cost-add
- 3-yr Fronius warranty per warranty memory

### 2.14 Phased install option
Auto-offered above $35,000 inc GST: Stage 1 (solar + GEN24 Plus + smart meter) ≈ $22–28k now · Stage 2 (BYD HVM modules + BMS+BCU + reconfig) ≈ $15–18k in year 2–3. Plus inverter spec'd from day 1.

### 2.15 Future-proofing buffers (default ON)
+1 kW inverter AC headroom · battery expandability headroom · 2 spare RCBO slots · DC home-run sized for battery expansion · VPP-ready spec.

### 2.16 Wind-zone racking selection
Racking SKU + fastener spacing selected automatically from products catalogue by AS/NZS 1170.2 wind zone (W1–W5). Coastal/cyclone zones get marine-grade fixings.

### 2.17 Roof life vs panel warranty
If \`(roof_lifespan − roof_age) < panel_performance_warranty\`, proposal includes "consider re-roof first" recommendation with estimated remove/reinstall cost ($4–8k).

### 2.18 Hot water diverter for non-battery quotes
SmartHWC / Catch Power / Paladin diverter auto-added to non-battery quotes (~$1,500 install). Pushes self-consumption from ~30% to ~60%. Customer can decline.

### 2.19 Buyback rate decline modelling
Default 30-yr decline curve: 9c (yr 1) → 7c (yr 5) → 5c (yr 10) → 3c (yr 20) → 2c (yr 30). Configurable.

### 2.20 Export cap scenario modelling
Engine models TWO projection scenarios per quote — best case (current rules persist) AND conservative (zero-export or 5kW cap imposed in year 5). Customer sees both.

### 2.21 Behaviour-change cheat sheet
One-page "Maximise your solar" personalised tips auto-included in commissioning pack.

### 2.22 Tier-by-features rule (standing constraint)
All tiers cover same kWh need. Differ on battery / backup / monitoring / warranty. Never solar size.

### 2.23 No customer-to-customer benchmarking (standing constraint)
Sizing uses bills + MBIE + EECA + datasheets + Solar API. Never other customers' figures.

### 2.24 Stage 1 vs Stage 2
Stage 1 = bills + Solar API + customer prefs (estimate). Stage 2 = re-run with measured site data. >1 panel change OR >5% price change → customer re-signs.

### Deferred to MVP-2 (per A1–A4 + Pattern X/Y)
- A1 Smart-meter half-hourly data ingest
- A2 Bill-to-hourly profile inference
- A3 Closed-loop calibration from install actuals
- A4 Multi-roof aggregation
- Pattern X Sensitivity analysis customer-facing
- Pattern Y Off-grid economics comparison

${decisionsBlockMd('§2')}

`;

const SECTION3 = `## Section 3 — Battery + Compatibility Matrix Rules

Every inverter↔battery↔meter combo lives in \`compatibility_matrix\` table. Engine queries this table; nothing hardcoded.

### 3.1 Selection decision tree
1. Phase match (hard rule)
2. Inverter battery interface (must be Plus variant)
3. Customer backup scope → minimum kWh
4. Customer vendor preference (default: lowest cost/kWh)
5. Tier sizing (when multi-tier)
6. Future expandability buffer (modules_used / max ≤ 0.75)

### 3.2 Master compatibility (MVP-1 set)
| Inverter | Phase | Compatible batteries |
|---|:---:|---|
| Fronius Primo 10.0 GEN24 **Plus** | 1ph | BYD HVS 5.1-12.8 · BYD HVM 8.3-22.1 · Fronius Reserva 6.3/9.5 |
| Fronius Primo 8.0 GEN24 Plus | 1ph | BYD HVS · BYD HVM 8.3-22.1 · Reserva 6.3/9.5 |
| Fronius Primo 6.0 GEN24 Plus | 1ph | BYD HVS · BYD HVM 8.3-11.0 · Reserva 6.3/9.5 |
| Fronius Symo 10.0 GEN24 Plus | 3ph | BYD HVS · BYD HVM · Reserva all sizes |
| Fronius Verto Plus 15.0-33.3 | 3ph | BYD HVS · BYD HVM 13.8-22.1 · Reserva all |

### 3.3 BMS-per-tower rules
| Vendor | Modules/tower | BMS controllers | Max parallel towers |
|---|:---:|:---:|:---:|
| BYD HVM | 3–8 | 1 × BMS+BCU (Vers 2) | 3 |
| BYD HVS | 2–5 | 1 × BMS+BCU | 3 |
| Reserva 6.3 / 9.5 | 2 or 3 × 3.15 kWh | 1 BMS | 4 |
| Reserva 12.6 / 15.8 | 4 or 5 × 3.15 kWh | **2 BMS** | 4 |

Engine auto-includes correct BMS count. Validator blocks mismatch.

### 3.4 Parallel tower rules
- Identical module count required across parallel towers (BYD rule)
- Each tower needs own BMS+BCU
- Max 32A combined output regardless of tower count
- Combined DC charge/discharge capped by inverter battery interface kW

### 3.5 Cell chemistry — LFP only
NMC excluded for residential safety (post-Korea ESS fires + insurance). BYD and Reserva are both LFP — no spec change needed.

### 3.6 Round-trip + DoD
BYD HVM/HVS: ≥96% RTE, 100% DoD usable. Reserva: ≥92% RTE, 90% DoD usable.

### 3.7 SoH warranty thresholds
BYD HVM/HVS: ≥60% SoH at year 10. Reserva: ≥70% SoH at year 10.

### 3.8 Sizing math (refines §2.12)
\`required_usable_kwh = max(evening_shift, self_consumption, backup_resilience, tariff_arbitrage)\`
\`required_nominal_kwh = required_usable_kwh / dod_factor\`
Engine picks smallest compatible candidate that satisfies all + leaves expansion headroom.

### 3.9 Backup scope mapping
| Scope | Continuous load | Hours target | Typical battery |
|---|---:|---:|---|
| Essentials only | ~1.5 kW | 4 hr | 6 kWh usable |
| Whole-home essentials | ~3 kW | 8 hr | 12 kWh usable |
| Multi-day resilience | ~3 kW | 16 hr | 18 kWh usable |

### 3.10 Backup mode (Fronius)
Three modes: **PV Point** (3kW socket) · **PV Point Comfort** (single fixed circuit) · **Full Backup** (whole-home essentials, Plus only, via auto-switchover contactor).

Default for battery systems: Full Backup (~$800 contactor cost).

### 3.11 Battery placement rules
BYD HVM IP55 outdoor-OK · Reserva indoor only · max 5m DC cable inverter↔battery default · 200mm above + 300mm sides + 500mm front clearance · −10°C to +50°C operating range · avoid direct sun + freezing zones.

### 3.12 Mixed-vendor designs (BYD + Fronius)
Allowed + customer-disclosed: "BYD battery warranty via BYD NZ · Fronius inverter warranty via Fronius NZ · Goldenray workmanship 10-yr."

### 3.13 VPP-readiness criteria
All four required: GEN24 Plus · supported LFP battery · Fronius Smart Meter · Solar.web subscription (free). Engine auto-includes all in every battery quote.

### 3.14 Battery expandability
BYD HVM can add modules to tower (up to 8) + parallel tower (up to 3). Reserva tiers fixed.

### 3.15 Wattpilot EV integration
Only works with Plus inverters. 1ph homes get 11kW; 3ph get 22kW. Smart load management coordinates solar → battery → EV.

### 3.16 Battery + EV combined dispatch
Mid-day: solar → home → battery → EV → export. Evening peak: battery → home → EV pause. Off-peak overnight: grid → EV. Free hour: grid → battery.

### 3.17 Battery cost-per-kWh tracking (internal)
Engine surfaces $/kWh-usable comparison to owner at quote time. Default to lowest cost when all rules tied.

### 3.18 Commissioning
BMS/BCU firmware update · initial full cycle · Solar.web registration (triggers Fronius 10+5 warranty) · health baseline (cell voltages, internal resistance, temperature) · customer training (backup test, SoC indicator, app login).

### 3.19 Aftercare schedule
Annual remote (Solar.web data review) · on-site audit at year 5 · BMS firmware updates as released.

### 3.20 End-of-life
LFP recyclable (~95% recovery). BYD take-back via AU (expected NZ extension). Reserva return-to-Fronius. Customer disclosure in T&Cs.

### 3.21 Retrofit pathway
Existing-solar customer adding battery: engine checks current inverter; if Plus → battery retrofit; if base → inverter swap required.

### 3.22 Single source of truth
\`compatibility_matrix\` table is the authority. Updates one place, engine adapts automatically.

${decisionsBlockMd('§3')}

`;

const SECTION4 = `## Section 4 — Engineering Validation (AS/NZS Deep Dive)

Every quote runs through every applicable standard. Pass = ship. Hard-fail = block. Soft warning = surface + flag in engineering doc.

### 4.1 Validator architecture
Pure function: \`validate(spec) → { passes, hard_fails, soft_warnings, unverified, standards_referenced, validator_version, validated_at }\`. JSONB stored on every quote version.

### 4.2 AS/NZS 5033:2021 — PV array (DC side)
- Voc at cold morning temperature ≤ inverter Uoc max (and ≤ 1000V or 1500V system limit)
- Isc × 1.25 ≤ MPPT Isc max
- DC isolator current ≥ Isc_design (auto-upgrade 32→40→63A)
- Rooftop **and** inverter-side isolators both required
- DC cable sized for current AND voltage drop ≤ 3%
- Double-insulated UV-rated cable required
- **Single-vendor MC4 connectors** (hard rule — mixed-vendor connectors are NZ's #1 DC arc fault cause)
- Type II DC SPD required
- Panel frame earthed via 6mm² min

### 4.3 AS/NZS 3000:2018 — Wiring rules (AC side)
- AC cable size ≥ inverter current × 1.25
- 63A IP66 lockable AC isolator at switchboard
- Solar main circuit breaker (default 50A for 10kW 1ph)
- Type A RCBO recommended default
- Type II AC SPD required
- Earthing + bonding per §5
- Switchboard adequacy: ≥ 3 spare RCBO slots, main fuse rating sufficient, age ≤ 25 yrs OR recent rewire

### 4.4 AS/NZS 4777.2:2020 — Grid-connect inverter
- Inverter on cert list (Fronius GEN24/Plus/Verto/Symo all confirmed)
- NZ Annex A volt-watt + freq-watt settings (not Australia's)
- Anti-islanding passive + active
- THD ≤ 5% at point-of-supply (soft warning)
- Export limit configurable per LNC requirement

### 4.5 AS/NZS 1170.2:2021 — Wind loading
Region from address postcode → racking + fastener spec from catalogue.
W1–W2 = standard rail · W3 = standard with closer fastener spacing · W4 = cyclone-rated rail + marine-grade fixings · W5 = C5 rail + all stainless + uplift restraints.
Edge setback 300mm minimum.
Snow zones: pitch < 15° flagged.

### 4.6 AS/NZS 5139:2019 — Battery installation safety
- **Indoor habitable rooms** = hard fail (no batteries in bedrooms/lounge/kitchen)
- Indoor non-habitable (garage, utility) = LFP only allowed
- Outdoor wall-mounted = IP55+ LFP only
- Outdoor free-standing = IP55+ LFP only
- Clearances from openings: 600mm non-habitable / 900mm habitable openings
- Fire separation: ≥ 30-min FRR or non-habitable space
- LFP doesn't need mechanical ventilation but natural airflow required
- Operating temp range strictly enforced (−10°C to +50°C)
- Mandatory signage per §3.6
- Emergency disconnect: accessible without tools, externally mounted, lockable OFF

### 4.7 AS/NZS 3008.1.1:2017 — Cable selection
- AC voltage rise ≤ 1% (per §2.11)
- DC voltage drop ≤ 3%
- Ampacity derating for ambient temp + install method + grouping

### 4.8 NZ Building Code (B1, B2)
- B1: load calculations + truss spacing check (> 900mm triggers engineer letter) + roof age check (> 30yrs = soft warning)
- B2: ≥ 25-yr warranty on major components disclosed to customer
- Asbestos cladding confirmed = hard fail (until remediated)
- Heritage zone manual flag in MVP-1 (auto-GIS check deferred)

### 4.9 Electricity (Safety) Regulations 2010
- CoC by Licensed Electrical Worker (within 20 working days of completion per Reg 65)
- ROI by independent Licensed Electrical Inspector before grid-connect
- WorkSafe-compliant SWMS per job

### 4.10 DC/AC oversizing rules (Fronius-specific)
≤ 1.25 conservative · 1.25–1.43 standard · 1.43–1.50 reduced-mode (Voc < 450V STC) · > 1.50 voids warranty (engine blocks).

### 4.11 MPPT current clipping
When string Imp × parallel strings > inverter IDC_max per MPPT: engine computes expected annual clipping % (3–5% typical at 1.4× oversizing in Auckland). Applied to generation model + disclosed in engineering doc.

### 4.12 LNC export approval
| LNC | 1ph cap (kW) | 3ph cap (kW) | Dynamic export |
|---|---:|---:|:---:|
| Vector | 5 | 15 | Roadmap 2027 |
| Counties Energy | 5 | 15 | No |
| Northpower | 5 | 10 | No |
| Aurora Energy | 5 | 20 | No |
| Powerco | 5 | 15 | Roadmap 2026 |

Hard rule: any grid-connect requires DG application; engine auto-fills LNC-specific form.

### 4.13 Hard rules vs soft warnings
**Hard fails (block quote send):** Voc exceeds Uoc max · DC isolator under-rated · inverter not on cert list · BMS count mismatch · battery in habitable room · AS/NZS 5139 clearance violation · LNC export cap exceeded without config · wind zone racking mismatch · asbestos · voltage rise > 1% without cable upgrade.

**Soft warnings (proceed with note):** MPPT current clipping > 0% · roof age > 30yrs · switchboard age > 25yrs · mid-day shading 5–15% · heritage zone · snow load risk (pitch < 15° in snow zone) · S-facing only · mixed-vendor warranty disclosure · reduced-mode DC/AC · planned EV without Wattpilot.

### 4.14 Stage 1 vs Stage 2 validation
Stage 1 = best-effort with assumed defaults + "subject to Stage 2 survey" disclaimer. Stage 2 = full with measured data.

### 4.15 Validator output format
JSONB stored on every quote. Drives engineering doc generator · proposal renderer · sales dashboard · DG form attestations · audit log.

### 4.16 Standards version pinning
\`compliance_standards\` table tracks code + version + last_reviewed + next_review_due. Quote carries \`validator_version\` at validation time.

### 4.17 Compliance pack (10 documents per install)
Site survey report · Stage 2 signed quote · DG approval letter · as-built SLD · string design table · test results · CoC · ROI · warranty cards (Phono, Fronius, BYD, Goldenray) · customer training record.

### 4.18 Site safety + insurance
Public liability ≥ $5M · working-at-heights cert · asbestos awareness for pre-1990 roofs · first-aid certified person on site · WorkSafe SWMS per job.

${decisionsBlockMd('§4')}

`;

const SECTION5 = `## Section 5 — Financial Modelling (Rebalanced)

After honest review, we **stripped customer-facing complexity** and **added decision-relevant content** (financing + monthly cashflow + dynamic self-consumption).

### 5.1 Model architecture
Deterministic + idempotent. Same spec + same pricing snapshot + same regional defaults = identical PDF output. Re-runnable; replayable from snapshot.

### 5.2 Year-1 economics
- \`yr1_generation = system_kw × regional_yield × (1 − total_losses) × (1 − clipping_pct)\`
- \`self_consumed = min(generation × self_consume_fraction, annual_usage)\` — physics cap
- \`imported = max(0, usage − self_consumed)\`
- \`exported = generation − self_consumed\`
- \`old_bill = annual_fixed + annual_kwh × variable_rate\` (from customer's bills)
- \`new_bill = max(0, imported × variable_rate + annual_fixed − exported × buyback_rate)\`
- \`yr1_savings = old_bill − new_bill\` (never negative)

### 5.2.2 Self-consumption fractions (default by usable battery kWh)
| Battery kWh usable | Self-consume % |
|---:|---:|
| 0 (no battery) | 0.30 |
| 0 + diverter | 0.55 |
| 6.0 | 0.65 |
| 9.5 | 0.78 |
| 12.6 + | 0.85 |
| 13.8 BYD HVM | 0.85 |
| 15.8 + | 0.88 |
| > 18 | 0.90 |

**Dynamic over 30 years** (new MVP-1 addition): engine recomputes annually accounting for panel degradation (raises %), battery degradation (lowers %), future-load ramp (raises %).

### 5.3 30-year projection
- Energy inflation: **7%/yr** (NZ MBIE 10-yr retail trend; configurable)
- Panel degradation: 1.0% Yr-1, **0.4%/yr** linear thereafter (per Phono datasheet)
- Buyback decline curve: 9c → 7c (yr5) → 5c (yr10) → 3c (yr20) → 2c (yr30)
- Export cap scenario: two cashflow scenarios — best case + conservative (cap imposed yr 5)

### 5.4 Payback (rebalanced — ONE customer-facing figure)
- **Headline: inflation+degradation payback** (~yr 9 for Krishna's 24-panel) — chart-annotated at crossover
- Discounted payback (5% TVM) — **dropped from customer PDF**; internal sales console only
- Simple payback — never shown anywhere

### 5.5 NPV / IRR / ROI (rebalanced)
- **NPV @ 5%** — dropped from customer PDF; internal only
- **IRR / annualised return** — dropped from customer PDF; internal only
- **Total ROI %** — KEPT in customer PDF (intuitive)

### 5.6 Monthly profile rule
- Each monthly column sums to its annual figure exactly (largest-remainder rounding)
- Old bill total = annual spend ± $1 (reconciliation hard test)
- Same for generation, usage, imports, exports, new bill, savings
- Drift fixed during Krishna regen — applied to engine going forward

### 5.7 Tariff switching recommendation
Engine computes best plan from \`retailer_plans\` for customer's region + load shape. Threshold to surface: > $200/yr improvement.

### 5.8 VPP earnings (rebalanced)
Disclosed as **capability statement** only — no specific $/yr number. *"Your system is VPP-ready when the NZ market opens (estimated 2027)."*

### 5.9 Phased install economics
Stage 1 + Stage 2 economics comparison shown when total > $35k. Stage 2 cost assumes 2%/yr battery cost inflation.

### 5.10 Financing options (NEW for MVP-1)
Engine models customer's chosen loan:
- **ANZ Good Energy Home Loan** (home-loan rate − 1%)
- **Westpac Warm Up** (home-loan rate)
- **Kiwibank Sustainable Energy Loan** (1% over 5 yrs, capped $15k)
- **BNZ Healthy Homes** (home-loan rate − 0.5%)
- **ASB Better Homes top-up** (home-loan rate)
- **Auckland Council Retrofit Your Home** (0% over 10 yrs, capped $10k)
- **Cash**

Customer picks one in pre-qual; engine computes loan amortisation.

### 5.11 Monthly cashflow projection (NEW for MVP-1)
Customer-facing: month-by-month projection with chosen loan — *solar bill + loan payment − bill savings = net monthly position*. Yr 1 detailed, yr 2–30 yearly.

### 5.12 Internal sales-console economics
Owner sees full P&L: cost ex GST · list ex GST · margin % · per-line HW margin · customer price · discount · profit. NPV/IRR/discounted-payback retained internally.

### 5.13 Model version pinning
\`financial_model_version\` (semver) stored on every quote. Methodology snapshot preserved; old quotes don't drift.

### 5.14 Customer disclosure footnote (mandatory)
> *Projections assume 7%/yr energy-price inflation, 0.4%/yr panel degradation, 85% self-consumption with battery, declining buyback. Actual results vary. Figures are projections, not guarantees, and do not constitute financial advice.*

### 5.15 Reconciliation invariants (CI-enforced)
Monthly columns must sum to annual figures within ±$1 / ±1 kWh. Quote blocked if any invariant fails.

### 5.16 Honest projection rules (standing — likely hard rule)
- No marketing-inflated numbers
- Disclose limits + assumptions
- No fabricated "average customer" comparisons
- 30-year horizon consistently (no cherry-picking shorter periods)

### 5.17 Post-install actuals tracking (architectural stub for MVP-2)
Predicted yr-1 generation captured at install. Actual captured 12 mo later. Prediction accuracy % drives MVP-2 closed-loop calibration.

### What was DROPPED from MVP-1 (after honest review)
- End-of-life capex (yr 15 inverter/battery replacement) — not modelled
- Battery degradation in financial model — not applied
- Ongoing maintenance + insurance costs — not modelled
- Customer use-class branching (residential / home office / rental) — all treated as residential
- Rebate / incentive auto-check (Auckland Council RYH etc.) — sales rep mentions manually
- Alternative-investment comparison (TD vs solar etc.) — not Goldenray's job
- Sensitivity analysis (Pattern X) — dropped from roadmap
- Off-grid economics comparison (Pattern Y) — dropped from roadmap

${decisionsBlockMd('§5')}

`;

const SECTION6 = `## Section 6 — Customer-facing Proposal & Quote Lifecycle

### 6.1 Proposal structure (17–18 sections + signature + appendices)
1. Cover + welcome · 2. At-a-glance · 3. Installation · 4. Components · 5. Performance · 6. How it works · 7. Bill savings · 8. Net financial · 9. Year-by-year · 10. Daily flows · **11. Financing & Monthly Cashflow (NEW)** · 12. Quotation · 13. T&Cs · 14. Sales Agreement · 15. Schedules A-D · 16. SLD · 17. Datasheet index · 18. Digital signature page · Appendices = manufacturer datasheets.

### 6.2 Customer visibility rules
**Always shown**: system spec · yr-1 savings · monthly breakdown · 30-yr cumulative · ROI % · payback (inflation+degradation only) · monthly cashflow with chosen loan · roof layout · SLD · warranties · T&Cs · datasheets.

**Never shown (FINAL_MODE)**: Goldenray cost · margin % · list price · discount applied · NPV/IRR/discounted payback · VPP $/yr · other customer comparisons · floor price · audit trail.

**Stage 1 estimate mode adds**: discount as "−$X" line · "subject to Stage 2 confirmation" disclaimer · range numbers ("$3,250–3,350").

### 6.3 Quote lifecycle states
\`draft → pending_owner_review → ready_to_send → sent → viewed → signed → counter_signed → deposit_received → install_scheduled → installed → commissioned\`

Side states: \`expired · withdrawn · superseded · closed_lost · cancelled_cooling_off\`

### 6.4 Validity periods
14-day default. Day 11 = "expires in 3 days" reminder. Day 14 = expired. Re-issue runs engine fresh; discount approval doesn't carry forward.

### 6.5 Pricing snapshot freeze at send-time
JSONB snapshot of all costs/margins/GST/totals/discount captured on \`draft → sent\` transition. Honoured for validity window regardless of catalogue changes.

### 6.6 Customer portal (magic-link)
Email-only sign-in. View proposal · sign digitally · download PDFs · ask questions · forward link. No password.

### 6.7 Digital signature workflow
AcroForm + PKCS#7 fields. Works in Adobe Reader (mobile + desktop), Apple Preview, modern PDF viewers. Engine verifies cryptographically. Goldenray counter-signs for binding contract. Wet-ink fallback available.

### 6.8 Multi-decision-maker rule
Pre-qualification asks: "Are there other parties to this decision?" If YES → 2nd signature field generated. Both signatures required for \`signed\` status.

### 6.9 Customer follow-up (3-touch cadence)
Day 3 "any questions?" · Day 7 "validity reminder" · Day 11 "3 days left" · Day 14 expired. Auto-suppress if customer replied since.

### 6.10 Sign → deposit (manual bank transfer)
On signature: 20% deposit invoice auto-generated, emailed with Goldenray bank details + reference. Customer transfers. Sales rep marks received in console. No Stripe/POLi in MVP-1.

### 6.11 Stage 1 → Stage 2 transition
Site survey → engine re-runs with measured data → Stage 2 diff produced → if < 5% price change AND no spec change AND no new Change Orders AND no new hard-fails → auto-lock; else explicit re-signature.

### 6.12 Change Orders (post-Stage 2)
Any spec/scope/material change = Change Order. Engine recomputes. 10% margin floor enforced. Customer signs cost delta + reason.

### 6.13 Quote versioning + diff
Every revision = new version. Prior preserved as \`superseded\`. Structured diff (spec / pricing / topology / compliance) produced. Owner sees history; customer sees only latest.

### 6.14 Customer notification matrix
Quote sent / viewed / signed / counter-signed / deposit invoiced / received / install scheduled / installed / compliance pack ready → customer email + sales rep in-app.

### 6.15 Portal change-request workflow
Customer submits question / change request via portal (free-text + attachments). Routes to sales rep (in-app + email). Threads stored against quote in audit log.

### 6.16 Portal document downloads
All customer documents permanently accessible via magic-link: latest quote · signed contract · deposit invoice · receipts · compliance pack · as-built SLD · datasheets.

### 6.17 Magic-link sharing + revocation
Customer can forward link to spouse/advisor. Forwarded link works for anyone with URL. Customer can regenerate to revoke old. All access logged.

### 6.18 Cooling-off + cancellation
5 working days NZ Consumer Law. Customer cancels via portal "cancel" button or email. Refund within 14 working days less reasonable third-party costs if materials ordered.

### 6.19 Closed-lost tracking
Structured reason codes: price · scope · timing · competitor · financing · site issues · ghosted · other. Owner sees aggregate analytics.

### 6.20 Sender identity + branding
Sender: \`proposals@goldenrayenergy.com\`. Display name: "Goldenray Energy NZ — [Sales rep name]". Reply-to: sales rep. PDFs branded with logo + sales rep cover card.

### 6.21 Customer-facing language tone (standing rule)
Plain English, no marketing-speak. Disclose uncertainty. No comparative claims against other installers. No customer-to-customer comparisons.

### 6.22 Mobile responsiveness
Portal mobile-responsive. PDF readable on mobile. Magic-link works in mobile email clients. Signature tested on iOS + Android.

### 6.23 Accessibility
Best-effort WCAG AA in MVP-1: text selectable, table headers, contrast, alt text. Full audit at V1.

${decisionsBlockMd('§6')}

`;

const SECTION7 = `## Section 7 — Lead Capture & Qualification

### 7.1 Entry points (locked)
- Public \`/get-quote\` wizard (web inbound)
- Sales-rep console manual entry (walk-ins, phone, referrals, events)

Every lead carries \`lead_source\`.

### 7.2 Pre-qualification wizard (10 steps)
1. Contact details · 2. Ownership + property · 3. Energy usage snapshot · 4. Future plans · 5. Backup + battery preference · 6. Financing · 7. Decision context · 8. Bill upload · 9. Existing solar · 10. Marketing consent.

Partial submissions saved.

### 7.3 LINZ address validation
LINZ NZ Addresses API → formatted address + lat/lng + suburb + region. Matched against network operator polygon (LNC assignment) · wind region · heritage zone (manual in MVP-1) · council jurisdiction.

### 7.4 ICP lookup (Electricity Authority registry)
Auto-confirms ICP exists + phase config + network operator + current retailer. Cross-checked vs customer declarations.

### 7.5 Bill upload flow
**8 supported retailers**: Mercury · Genesis · Contact · Electric Kiwi · Meridian · Powershop · Trustpower · Frank Energy. Others route to manual entry.

Bill OCR extracts: service address · ICP · period · days · kWh (total + peak + off-peak) · variable + fixed + total $ · exported kWh + credit · retailer + plan.

Minimum bills: 1 acceptable (extrapolated, flagged as Stage 1 estimate) · 4+ preferred for accuracy · 12 months ideal.

Manual entry fallback always available.

### 7.6 Lead source attribution
Web: UTM source/medium/campaign/content/term + referrer + landing page + user-agent + IP.
Manual: dropdown — Phone enquiry · Walk-in · Existing-customer referral · Industry referral · Event · Cold-call · Other.

### 7.7 Duplicate detection
Email match (exact) · ICP match · address normalised (20m radius) · phone match. Active duplicate flagged; closed_lost > 6 months allows re-engagement.

### 7.8 Lead scoring (internal-only)
0-100 score weighted: bill quality 30 · ownership 20 · timeline 15 · budget 15 · suitability 10 · phase confirm 10. Drives sales-rep prioritisation. Never shown to customer.

### 7.9 Lead routing
Default round-robin between active sales reps. Owner can override. Solo phase (just Rajeshwar) = all to him.

### 7.10 Lead lifecycle states
\`new → qualified → quote_in_progress → quote_ready → quote_sent\` (merges with quote state machine after this) · \`closed_lost\` · \`archived\` (180 days inactive + closed_lost).

### 7.11 Anonymous browsing
DEFER to MVP-2. Full wizard with contact details upfront in MVP-1.

### 7.12 Stale lead handling cascade
14d auto-email · 30d sales-rep notify · 90d cold · 180d archived · 365d soft-delete PII (audit log preserved).

### 7.13 Marketing consent
Default OFF (opt-IN). Transactional emails always sent (engagement-required). Customer can opt-out anytime via unsubscribe link.

### 7.14 Privacy Act 2020 disclosure at form
Mandatory disclosure shown on Step 1: *"We collect your name, email, address and electricity bills to prepare a personalised solar quote. Stored securely in Supabase (Sydney, AU region) under NZ Privacy Act 2020. You can request access, correction or deletion of your data at any time."*

Customer ticks "I understand". Consent timestamp + IP logged.

Manual sales-rep entry: \`consent_method = in_person_verbal\` or \`phone_verbal\`.

### 7.15 Data schema fields per lead
Stored: contact + address + ownership + property + usage + future plans + backup + battery preference + financing + decision-makers + timeline + bill data quality + lead score + assigned rep + UTM + consent + lifecycle status.

### 7.16 Sales-rep console (lead view)
Filtered by status / score / lead_source / assigned rep. Detail view with all qualification fields + bill history + address map + Solar API roof preview + activity log + "Generate proposal" + "Reassign" + "Closed-lost" buttons.

### 7.17 Roof preview at qualification (Google Solar API)
On address validation, engine calls Google Solar API → roof segments + sun-hours + shading. Shown to customer as estimate. Cached per address 90 days. Cost ~$0.10–0.50/lookup.

### 7.18 Lead enrichment (async)
Post-capture: LINZ + ICP + Solar API + bill OCR + bill analysis. Sales rep notified when complete (~2 min typical).

### 7.19 Bot / spam filtering
Google reCAPTCHA v3 (invisible) · honeypot field · throttle (5 leads/hr/IP).

### 7.20 Customer data export at lead stage
Includes: form fields · bill uploads · bill analysis · LINZ/ICP/Solar API enrichment · communication log · marketing consent history. JSON + ZIP of original PDFs. 7-day SLA.

${decisionsBlockMd('§7')}

`;

const SECTION8 = `## Section 8 — Site Survey & Stage 1 / Stage 2

### 8.1 Purpose
Site survey is the bridge between Stage 1 estimate and Stage 2 firm price. Every install passes through here.

### 8.2 Triggers
Stage 1 accepted (verbal/written) · Stage 1 signed · sales-rep request · customer-requested before commitment.

### 8.3 Roles
Sales rep books + drives the survey + fills the form. Installer/lead electrician joins for complex sites. Customer encouraged but not required.

### 8.4 Survey fee policy
Free within Auckland metro · $150+GST travel for >60km (refundable on install) · waived if site hard-fails.

### 8.5 Scheduling defaults
Customer offered 3 available slots in sales-rep calendar. Lead time 3–7 working days. Duration 60min standard / 90min complex.

### 8.6 Survey form — 11 sub-sections
1. Property exterior + access · 2. Roof measurements · 3. Shading + obstructions · 4. Structural assessment · 5. Switchboard · 6. Cable run · 7. Battery placement · 8. Network operator · 9. Hazards · 10. Internal notes · 11. Customer-provided info.

### 8.7 Photo evidence — 9 mandatory
1. Front of property · 2. Each roof face (4-6) · 3. Roof close-up · 4. Switchboard cover open · 5. Switchboard internal · 6. Inverter location · 7. Battery location (if any) · 8. Existing solar/battery (if any) · 9. Hazards observed. Engine blocks Stage 2 submission if any missing.

### 8.8 Survey output
Site survey report PDF · Stage 2 spec recommendation (engine re-runs with measured data) · Stage 2 diff report · Change Order recommendations.

### 8.9 Stage 1 → Stage 2 auto-lock conditions (all must hold)
- Price change ≤ 5%
- No spec change (panels, inverter, battery)
- No new hard-fail validations
- No new Change Orders (switchboard, scaffolding, asbestos)
- Stage 1 already signed

Otherwise: explicit Stage 2 re-signature. Customer gets full Stage 2 PDF + diff summary.

### 8.10 Common findings → cost adjustments
| Finding | Typical cost |
|---|---:|
| Switchboard upgrade | $1,200–3,000 |
| Scaffolding | $500–3,000 |
| Asbestos remediation | $2,000–8,000 |
| Roof re-roof recommended | $8,000–25,000 |
| Cable run upsize | $200–800 |
| Engineer letter | $300–500 |
| Tree pruning | $300–1,500 |
| Heritage permitting | $500–2,000 |

Each = Change Order line item.

### 8.11 Survey-failure outcomes
Asbestos w/o customer funding · switchboard beyond budget · roof structurally inadequate · LNC zero-export rejected · renter w/o landlord consent → travel fee refunded + lead → closed_lost (site_not_suitable).

### 8.12 Timeline
Site survey → Stage 2 quote: 24-48 hr. Stage 2 quote validity: 14 days. Stage 2 sign → install start: 4-8 weeks. Total Stage 1 → install: **6-10 weeks typical**.

### 8.13 Site survey + Change Order integration
Site survey produces Stage 2 firm quote AND/OR Change Orders. Each CO = separate PDF + signature.

### 8.14 Survey record retention
Indefinite per audit log policy. Form data + photos + Stage 2 diff + sales rep notes + customer Qs retained.

### 8.15 Customer-visible vs internal
Customer receives: Stage 2 firm quote · Stage 2 diff summary (1pg) · Change Orders (if any) · 4-6 relevant site photos · sales rep notes.
Customer does not receive: internal hazard photos · lead-scoring · engineering validator technical breakdown · all 9 mandatory photos.

### 8.16 Tool — web form in MVP-1
Mobile-responsive web form (PWA-capable). Native installer app deferred to V1.

### 8.17 Pre-survey reminder
24 hr before: date+time confirmation, what to have ready (bills, recent roof/elec work), property access, sales-rep mobile + ETA window.

### 8.18 Post-survey follow-up
Sales rep posts via portal within 24 hr: highlights observed + Stage 2 quote ETA + open thread for customer questions.

${decisionsBlockMd('§8')}

`;

const SECTION9 = `## Section 9 — Operational Rules (60-second Pipeline, Notifications, Audit)

### 9.1 The 60-second pipeline (customer-facing SLA)
Bill upload → customer proposal PDF in ≤ 60s. Async stages (BOM, engineering doc, DG form, commissioning checklist) finish in another 60–120s.

**Stages parallelised**: bill_ingest + address_validate + icp_lookup + solar_api + network_op + retailer_plans all run T+0 to T+15s. Per-spec validate + generation + financial + pricing run concurrently for surviving candidate specs.

### 9.2 Sync vs async classification
**Sync (15 stages, all complete in 60s)**: bill_ingest · consumption_analyze · address_validate · icp_lookup · solar_api · network_op_assign · retailer_plans · config_builder · compat_matrix_check · engineering_validate · generation_model · financial_model · quote_engine · proposal_renderer · magic_link_emit.

**Async (4 stages, T+60-180s)**: installer_bom_pdf · engineering_doc_pdf · dg_application_pdf · commissioning_checklist.

### 9.3 SLA enforcement
Recommended: soft target with telemetry — pipeline runs to completion; > 60s logs warning; > 120s flags investigation. No customer-facing fail.

### 9.4 Failure handling
- External API timeout: 3 retries with exponential backoff + manual override fallback
- Bill OCR fail: auto-route to manual entry + notify customer
- Config-builder no valid specs: surface site-not-suitable
- Quote margin below floor: pause for owner discount approval
- Proposal renderer error: retry once + alert owner
- Email send failure: 3 retries over 1 hour + sales rep notified

### 9.5 Idempotency
Same spec + same pricing snapshot + same regional defaults = byte-identical PDF output. Hash input → check cached output.

### 9.6 Notifications
**Email (transactional)**: Postmark (preferred) or SendGrid. 17+ template events. Templates editable by owner in admin console.

**SMS (transactional, opt-in)**: Twilio NZ. Events: install reminder · ETA · install complete · site survey reminder. Default OFF.

**In-app (Supabase Realtime)**: lead captured · quote viewed · customer signed · discount pending · stale-lead reminders · pipeline alerts.

### 9.7 Audit log (the running record)
**What gets logged** (non-exhaustive): lead.* · quote.* · pricing.* · survey.* · install.* · payment.* · customer.* · user.* · system.*.

**Schema**: actor_user_id · actor_role · action · entity_type · entity_id · before JSONB · after JSONB · metadata · occurred_at.

**Retention**: indefinite. Append-only (no updates, no deletes). Soft-delete on entities preserves audit trail.

**Customer access** via portal: filtered to entries where entity is this customer. JSON + PDF export within 7 days.

**Internal access**: owner = full · sales rep = own actions + entities touched · installer = assigned installs.

### 9.8 Background job queue
Supabase pg_cron + queue tables. Jobs: bill OCR · Solar API · LINZ · ICP · email send · SMS send · stale lead follow-up · quote expiry check · site survey reminder · compliance pack PDF · daily backup verification.

Default retry: 3 retries with 2x backoff.

### 9.9 Search across customer record
Supabase Full-Text Search (tsvector) over lead data + quotes + survey + emails + install records + compliance pack + audit log. Filtered by customer_id.

### 9.10 Document storage (Supabase Storage buckets)
\`quote-pdfs\` · \`signed-contracts\` · \`site-survey-photos\` · \`install-photos\` · \`compliance-pack\` · \`bill-uploads\` · \`internal-docs\` · \`templates\`. All private. RLS policies per bucket.

### 9.11 Backup + disaster recovery
- Supabase daily managed backup (7-day retention)
- Supabase PITR continuous (7-day)
- Off-platform weekly Saturday 02:00 NZT S3 snapshot (90-day retention)
- Quarterly anonymised export for ML/analytics
- RTO 4hr, RPO 24hr worst case

### 9.12 Monitoring + alerts
Pipeline runtime > 60s (warning) / > 120s (investigation) · pipeline failure rate > 5%/hr · email failure > 10%/hr · external API failures > 3/10min · storage > 80% · backup failure · discount approval pending > 4hr · Privacy Act breach detection.

Alerts: email + in-app + SMS (for critical).

### 9.13 Rate limiting
\`/get-quote\` 5/hr/IP · magic-link gen 10/hr/customer · customer portal 100/hr/session · email 10/day/customer · SMS 5/day/customer.

### 9.14 External services + API keys
LINZ (free) · Electricity Authority (free) · Google Solar API (~$0.10-0.50/lookup) · Postmark/SendGrid · Twilio NZ · Google reCAPTCHA v3 · Supabase · Vercel. All keys in Supabase Vault.

### 9.15 Quote-to-install handoff
On signature: contract PDF (counter-signed) + installer BOM + engineering doc + DG application + deposit invoice. Each step audit-logged. Install record + pre-install checklist created.

### 9.16 Install → commissioning workflow
Installer marks complete: photos + test results + CoC (EW digital sig) + ROI (EI digital sig) + Solar.web registration + customer training record + compliance pack auto-generated + aftercare schedule activated.

### 9.17 Session timeout
Owner/sales/installer: 8hr active + 24hr remember-me. Customer portal magic-link: ~30-day validity (regeneratable). Admin console: 1hr forced re-auth.

### 9.18 Multi-device sessions
Staff can log in on multiple devices simultaneously. Customer magic-link works in multiple browsers/devices. Concurrent quote edits: optimistic locking with conflict warning.

### 9.19 System status page
MVP-1: JSON \`/status\` endpoint returning pipeline + external API health. Full UI page deferred to V1.

### 9.20 Maintenance windows
Sunday 02:00-04:00 NZT routine. Owner notified 7 days before any planned maintenance.

### 9.21 Privacy Act 2020 operational rules
- All data at rest: Supabase AES-256
- All data in transit: TLS 1.3
- Audit log captures every customer data access (who, when, what)
- Customer data export within 7 days
- 72-hour breach notification to Privacy Commissioner if affects > 1 customer

${decisionsBlockMd('§9')}

`;

const SECTION11 = `## Section 11 — Data Residency, Retention, Privacy Act 2020

(Section 10 — Roles & Permissions — was skipped during this review; referenced inline in §1.5, §11.23, and the access governance matrix below.)

### 11.1 Data classification
7 classes: PII-Identifying · PII-Identifying-high (ICP, bank ref) · PII-Financial (bills, payments) · Behavioural (marketing opt-in, portal access) · Derived (lead score, model outputs) · Technical (IP, UA, UTM) · Internal (catalogue prices, audit events).

Engine tags every column. RLS policies + access rules reference the class.

### 11.2 Data residency map
| Layer | Location | Lawful basis |
|---|---|---|
| Vercel hosting | Sydney + Singapore edge | APEC equivalence |
| Supabase DB + Storage + Auth | Sydney AU region | APEC equivalence |
| Postmark email | US + DPA | Standard Contractual Clauses |
| Twilio NZ SMS | NZ-resident | NZ |
| LINZ + Electricity Authority | NZ government | NZ |
| Google Solar API + reCAPTCHA | Global Google + DPA + SCCs | SCCs |

No NZ-only data centre in MVP-1. AU is acceptable under NZ Privacy Act 2020 APEC framework. Disclosed in privacy policy.

### 11.3 Encryption
At rest: Supabase AES-256. In transit: TLS 1.3. API keys: Supabase Vault. No customer passwords stored (magic-link only). Staff: Supabase Auth + 12+ char strong password. 2FA: recommended owner, optional sales/installer.

### 11.4 Retention periods
| Class | Retention |
|---|---|
| PII active customer | Indefinite |
| PII closed-lost lead | 365 days then PII blanked |
| PII signed install | Indefinite |
| Bill PDFs | 7 years (NZ tax) |
| Quote history | Indefinite |
| Site survey photos | Indefinite |
| Install + compliance pack | Indefinite |
| Marketing consent log | Indefinite |
| Communications log | Indefinite |
| Audit log | Indefinite (no exceptions) |
| Session data | 30 days rolling |
| IP + user-agent logs | 90 days |

### 11.5 Customer rights (NZ Privacy Act IPP 6–13)
- **Access** (IPP 6): portal export → JSON + PDF summary, 7-day SLA
- **Correction** (IPP 7): customer submits, sales rep applies, audit logged
- **Deletion**: soft-delete PII blank, audit preserved, warranty/tax retained 7yr; owner reviews + approves
- **Restriction**: marketing opt-out anytime
- **Portability**: JSON export
- **Object to automated decisions**: lead scoring; human review on request
- **Withdraw consent**: instant; future not auto-enrolled

### 11.6 Third-party data sharing
LINZ (address) · EA (address) · Google Solar (address) · Postmark (email + content) · Twilio (phone + content) · Network operator (ICP + spec + name) · Bank for green loan (customer-initiated) · reCAPTCHA (IP + behaviour). Every share audit-logged + customer-disclosed.

### 11.7 DPAs
Supabase · Postmark/SendGrid · Twilio NZ · Google Cloud. Annual review + 90-day expiry alerts.

### 11.8 Breach notification
72-hour to Privacy Commissioner if > 1 customer affected. Customer notified ASAP. Breach log retained indefinitely.

Automatic detection indicators: failed login spikes · mass data export · unusual access timing · bulk RLS violations. Owner alerted via email + SMS + in-app.

### 11.9 Data minimisation
Always collected: email + name · address · ICP · bills · roof + structural · property type + ownership.
Conditionally: phone (opt-in SMS) · future loads · backup preference · financing preference · existing solar details.
Never collected by Goldenray: DOB · ethnicity/religion · health info · government IDs beyond ICP · bank account numbers.

### 11.10 Privacy by design
- Default closed customer portal (magic-link)
- Audit log default-on every customer table
- Soft-delete preserves audit
- Multi-tenant V1 hard org boundary
- Backup encrypted with separate keys
- Test/dev = anonymised data
- Least-privilege roles
- RLS server-side enforcement

### 11.11 Data export workflow
Customer trigger → verification → audit log → async job collects all customer rows → JSON + PDF summary + ZIP of original PDFs + photos → encryption with one-time password (separate channel) → email one-time download link (24hr expiry) → 7-day SLA.

### 11.12 Data deletion workflow
Customer trigger → owner notification + 7-day review → if approved: PII blank in main tables + warranty/tax anonymised but retained + audit log preserved + Storage objects deleted. Customer notified completion. 30-day max.

### 11.13 Anonymisation for analytics/ML
Address → suburb + lat/lng rounded 100m. Email → hashed UUID. Bills → aggregated. Quarterly review by owner.

### 11.14 Cross-border data transfers (acceptable)
AU (Supabase) · SG (Vercel edge) · US (Postmark, Google) under SCCs · EU under GDPR adequacy. Other = case-by-case.

### 11.15 Penetration testing schedule
MVP-1 launch: self-assessed. 6 months post-launch: external pen test (NZ infosec firm like Aura, ~$5-10k). Annual ongoing.

### 11.16 SOC 2 / ISO 27001 roadmap
MVP-1: not required. V1 multi-tenant: SOC 2 Type 1 readiness if pursuing installer org clients. V2 enterprise: SOC 2 Type 2 + ISO 27001.

### 11.17 Cookies + tracking
Essential cookies only in MVP-1 (session, CSRF, reCAPTCHA, magic-link). No GA, no FB Pixel, no marketing cookies.

### 11.18 Privacy policy + ToS
\`/privacy\` = NZ-lawyer-drafted privacy policy pre-launch. \`/terms\` = customer engagement T&Cs (currently in proposal). SaaS ToS deferred to V1. Annual review.

### 11.19 Customer's right to privacy advisory
Customer can ask Goldenray "how is my data used?" via portal thread. Sales rep responds within 3 working days.

### 11.20 Staff privacy training
Onboarding: 1-hour NZ Privacy Act summary. Annual refresher (30 min). Incident response protocol documented + accessible.

### 11.21 Breach response protocol
Containment → owner notified within 1hr → severity assessment → Privacy Commissioner within 72hr if > 1 customer → customer notified ASAP → remediation → post-mortem → public statement if material.

### 11.22 Vendor data minimisation
LINZ: address only. EA: address only. Solar API: address only. Postmark: email + content. Network operator: only LNC form fields. Bank: only proposal PDF (customer choice).

### 11.23 Internal access governance matrix
| Access type | Owner | Sales rep | Installer | Customer |
|---|:---:|:---:|:---:|:---:|
| All customer PII | ✅ | Own portfolio | Assigned installs | Own only |
| Pricing rules / margins | ✅ | ❌ | ❌ | ❌ |
| Discount approvals | ✅ | Request only | ❌ | ❌ |
| Audit log full | ✅ | Own actions | Own actions | Own via portal |
| User management | ✅ | ❌ | ❌ | ❌ |
| External API keys | ✅ | ❌ | ❌ | ❌ |
| Bulk data export | ✅ (audit logged) | ❌ | ❌ | Own only |

### 11.24 Privacy Impact Assessment (PIA)
Conducted at MVP-1 design phase + reviewed before each major release. V1 multi-tenant requires fresh PIA.

### 11.25 Children's data — not collected
Customers are property owners (18+). Pre-qualification excludes minors.

### 11.26 Privacy-friendly defaults
Marketing consent: opt-in OFF · SMS consent: opt-in OFF · third-party sharing: minimum necessary · cookies: essential only · analytics: none MVP-1 · customer data retention: minimum for compliance · sales team: only assigned rep sees individual leads.

### 11.27 Privacy Commissioner relationship
Owner = designated Privacy Officer. Subscribed to OPC newsletter. Quarterly OPC guidance review. Annual self-assessment against IPPs.

${decisionsBlockMd('§11')}

`;

const APPENDIX_A = `## Appendix A — Open Questions Register (${OPEN.length} questions)

| # | Section | Topic | Question | Recommended | Alternatives |
|---:|---|---|---|---|---|
${OPEN.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} | ${r[5]} |`).join('\n')}

`;

const APPENDIX_B = `## Appendix B — Locked Decisions Register (${LOCKED.length} rules)

| # | Topic | Decision |
|---:|---|---|
${LOCKED.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |`).join('\n')}

`;

const APPENDIX_C = `## Appendix C — Glossary

**APEC equivalence** — Asia-Pacific Economic Cooperation framework allowing NZ Privacy Act 2020 data to flow to Australia and other privacy-equivalent jurisdictions.

**AS/NZS 3000 / 5033 / 4777.2 / 1170 / 5139 / 3008** — Australian/NZ standards covering AC wiring, PV array installation, grid-connect inverter, structural wind loading, battery installation safety, and cable selection respectively.

**BMS+BCU** — Battery Management System + Battery Control Unit. Required for every BYD HVM/HVS battery tower.

**CoC** — Certificate of Compliance, issued by a Licensed Electrical Worker after install.

**DC/AC ratio** — DC array capacity divided by inverter AC rated power. Goldenray default 1.25–1.35.

**DG application** — Distributed Generation application submitted to the local network company before grid-connect.

**DoD** — Depth of Discharge. BYD HVM/HVS: 100% usable. Fronius Reserva: 90% usable.

**EECA** — Energy Efficiency and Conservation Authority NZ.

**FINAL_MODE** — Single-option proposal mode (no tier comparison, discount hidden, signature page included).

**Goldenray workmanship warranty** — 10-yr cap on installation workmanship, separate from manufacturer warranties.

**ICP** — Installation Control Point, the unique identifier for a NZ electricity connection.

**IPP** — Information Privacy Principle (NZ Privacy Act 2020, 13 principles numbered 1-13).

**IRR** — Internal Rate of Return on the solar investment cashflow.

**LFP** — Lithium Iron Phosphate battery chemistry (BYD + Reserva). Excluded: NMC (safety + insurance reasons).

**LNC** — Local Network Company (Vector, Counties Energy, Northpower, Aurora, Powerco for MVP-1).

**MBIE** — Ministry of Business, Innovation and Employment NZ. Source of 10-year retail electricity inflation trend.

**MPPT** — Maximum Power Point Tracker. Inverter inputs that track each panel string's optimal operating point.

**NPV** — Net Present Value of the solar investment at a 5% discount rate (internal use only after MVP-1 rebalance).

**OPC** — Office of the Privacy Commissioner NZ.

**PIA** — Privacy Impact Assessment.

**PII** — Personally Identifiable Information.

**Plus inverter** — Fronius GEN24 Plus / Symo Plus / Verto Plus variant required when a battery is included in the system.

**RLS** — Row-Level Security (Postgres / Supabase mechanism for enforcing per-row access permissions).

**ROI** — Return on Investment (financial) OR Record of Inspection (electrical — issued by independent Licensed Electrical Inspector).

**SoH** — State of Health (battery health metric). BYD HVM/HVS: ≥60% at year 10. Reserva: ≥70% at year 10.

**Stage 1** — Estimate based on bills + Solar API + customer-stated preferences. "Subject to Stage 2 confirmation."

**Stage 2** — Firm price after on-site survey.

**Solar.web** — Fronius monitoring portal. Registration at commissioning triggers 10+5 yr warranty extension.

**SPD** — Surge Protection Device (DC + AC).

**Stage 1 / Stage 2 / Change Order workflow** — Two-stage quoting with explicit re-issue for post-Stage-2 changes.

**TVM** — Time Value of Money. 5% discount rate applied for "discounted payback" calculation (internal-only after MVP-1 rebalance).

**Voc / Vmp / Isc / Imp** — Open-circuit voltage / max-power-point voltage / short-circuit current / max-power-point current (panel electrical characteristics, AS/NZS 5033 validation drivers).

**VPP** — Virtual Power Plant. Future grid services market expected to open in NZ ~2027.

**Wattpilot** — Fronius EV charger integration. 11kW single-phase or 22kW three-phase.

**WCAG AA** — Web Content Accessibility Guidelines, AA level. Best-effort in MVP-1; full audit at V1.

`;

const FULL = FRONT + SECTION1 + SECTION2 + SECTION3 + SECTION4 + SECTION5 +
            SECTION6 + SECTION7 + SECTION8 + SECTION9 + SECTION11 +
            APPENDIX_A + APPENDIX_B + APPENDIX_C;

// ── Write markdown ──────────────────────────────────────────────────────────
const mdPath = 'C:/Users/ram33/Downloads/Goldenray_MVP1_Business_Rules.md';
fs.writeFileSync(mdPath, FULL, 'utf8');
console.log('✓ Markdown written:', mdPath);
console.log('  Length:', (FULL.length / 1024).toFixed(1), 'KB');

// ── Render markdown to PDF (via styled HTML + Puppeteer) ───────────────────
// Tiny inline markdown→HTML converter — enough for our structure
function mdToHtml(md) {
  let html = md;
  // escape HTML entities (basic)
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // code fences (just plain monospace block)
  html = html.replace(/```([\s\S]*?)```/g, (m, code) => `<pre>${code.trim()}</pre>`);
  // tables (very simple — assumes well-formed)
  html = html.replace(/(\|[^\n]+\|\n\|[\s\|:-]+\|\n(?:\|[^\n]+\|\n)+)/g, (m) => {
    const lines = m.trim().split('\n');
    const headerCells = lines[0].split('|').slice(1, -1).map(c => `<th>${c.trim()}</th>`).join('');
    const bodyRows = lines.slice(2).map(line => {
      const cells = line.split('|').slice(1, -1).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('\n');
    return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  });
  // headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // bold + italic + inline code
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // unordered lists
  html = html.replace(/((?:^[-*] .+\n?)+)/gm, (m) => {
    const items = m.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  // ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (m) => {
    const items = m.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  // blockquotes (decision callouts) — group consecutive > lines
  html = html.replace(/((?:^> .*\n?)+)/gm, (m) => {
    const body = m.split('\n').map(l => l.replace(/^> ?/, '')).join('\n').trim();
    return `<blockquote>${body.replace(/\n/g, '<br>')}</blockquote>`;
  });
  // horizontal rules
  html = html.replace(/^---$/gm, '<hr>');
  // paragraphs (wrap orphan text lines)
  html = html.split('\n\n').map(block => {
    if (block.match(/^<(h\d|table|ul|ol|blockquote|pre|hr)/)) return block;
    if (block.trim() === '') return '';
    return `<p>${block.trim().replace(/\n/g, ' ')}</p>`;
  }).join('\n');
  return html;
}

const CSS = `
  @page { size: A4; margin: 18mm 14mm 18mm 14mm }
  body { font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif; color:#0B0F1A; font-size:10.5px; line-height:1.45; max-width: 100%; }
  h1 { font-size: 24px; color: #0B0F1A; border-bottom: 3px solid #F5A623; padding-bottom: 6px; margin: 24px 0 12px; page-break-after: avoid; }
  h2 { font-size: 16px; color: #0B0F1A; border-bottom: 1.5px solid #F5A623; padding-bottom: 4px; margin: 20px 0 8px; page-break-after: avoid; }
  h3 { font-size: 12px; color: #5C6470; text-transform: uppercase; letter-spacing: .5px; margin: 14px 0 4px; font-weight: 700; page-break-after: avoid; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.5px; page-break-inside: avoid; }
  th, td { border: 1px solid #D9DCE1; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #F7F8FA; font-weight: 700; color: #5C6470; text-transform: uppercase; font-size: 8.5px; letter-spacing: .4px; }
  code { background: #F7F8FA; padding: 1px 4px; border-radius: 3px; font-family: Consolas, Monaco, monospace; font-size: 9.5px; }
  pre { background: #F7F8FA; padding: 8px 12px; border-radius: 4px; font-family: Consolas, Monaco, monospace; font-size: 9.5px; overflow-x: auto; }
  blockquote { background: #fffbed; border-left: 4px solid #F5A623; padding: 10px 14px; margin: 10px 0; font-size: 10px; line-height: 1.6; page-break-inside: avoid; }
  strong { color: #0B0F1A; }
  hr { border: none; border-top: 1px solid #E5E7EB; margin: 20px 0; }
  /* Page break aid */
  h1 + h2, h2 + h3 { margin-top: 6px; }
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Goldenray MVP-1 Business Rules</title>
<style>${CSS}</style>
</head>
<body>
${mdToHtml(FULL)}
</body>
</html>`;

const htmlPath = 'C:/Users/ram33/Downloads/Goldenray_MVP1_Business_Rules.html';
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('✓ HTML written:', htmlPath);

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file:///' + htmlPath, { waitUntil: 'networkidle0' });
  const pdfPath = 'C:/Users/ram33/Downloads/Goldenray_MVP1_Business_Rules.pdf';
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8px;color:#9CA3AF;width:100%;padding:0 14mm;display:flex;justify-content:space-between"><span>Goldenray MVP-1 Business Rules — DRAFT</span><span>${TODAY}</span></div>`,
    footerTemplate: `<div style="font-size:8px;color:#9CA3AF;width:100%;padding:0 14mm;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  });
  await browser.close();
  console.log('✓ PDF written:', pdfPath);
  const stat = fs.statSync(pdfPath);
  console.log('  Size:', (stat.size / 1024).toFixed(1), 'KB');
})().catch(e => {
  console.error('✗ PDF render failed:', e.message);
  console.error(e.stack);
});
