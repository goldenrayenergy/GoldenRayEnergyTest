// Page — Single Line Diagram (SLD) — Phase H5
//
// Vertical engineering schematic matching the v2 mockup design.
// PV ARRAY (top) → String Combiner (parallel only) → DC Isolator →
// Hybrid Inverter (with battery branch right) → AC Isolator →
// Main Switchboard (house loads + backup circuit split) → Smart Meter →
// Electricity Grid. Earth bond runs down the left as a dashed green line.
//
// All sized + labelled from THIS customer's spec — panel count + watts,
// inverter brand/model, battery series + kWh, string topology, AS/NZS refs.

import { pageHead, pageFoot } from '../_shared.js';
import { findBomRowByPattern } from '../proposalData.js';

const DC = '#F5A623';     // orange
const AC = '#1E40AF';     // blue
const EARTH = '#16A34A';  // green
const PV_FILL = '#fffbed';
const INV_FILL = '#fef3c7';
const SB_FILL = '#fef3c7';
const GRID_FILL = '#dbeafe';

export function pageSLD(d, sectionNum, sectionsTotal) {
  const sys = d.system || {};
  const hardware = d.hardware || {};

  // Pull facts (with fallbacks so the page always renders)
  const panelCount = sys.panels || hardware.panel?.count || 0;
  const panelWatts = hardware.panel?.watts || 0;
  const totalKw = sys.kw || (panelCount && panelWatts ? +(panelCount * panelWatts / 1000).toFixed(2) : 0);
  const stringTopology = sys.string_topology || 'series';
  const isParallel = stringTopology === 'parallel';

  const inverterBrand = hardware.inverter?.brand || 'Hybrid inverter';
  const inverterName  = hardware.inverter?.name?.replace(`${inverterBrand} `, '') || '';
  const inverterAcKw  = hardware.inverter?.ac_kw;
  const mpptCount     = hardware.inverter?.mppt_count || 2;
  const uocMax        = hardware.inverter?.uoc_max_v;

  const hasBattery = !!hardware.battery;
  const batteryBrand = hardware.battery?.brand || '';
  const batterySeries = hardware.battery?.series || '';
  const batteryKwh    = hardware.battery?.total_usable_kwh;
  const batteryChem   = hardware.battery?.chemistry || 'LFP';
  const bmsCount      = d.insights?.bms_count;  // optional

  const meterPhase = hardware.smart_meter?.phase || sys.phase || 1;
  const hasWattpilot = !!sys.wattpilot_included;

  // Phase H6 — pull cabling / isolator details from this quote's actual BoS rows
  const bosRows = sys.bos_rows || [];
  const dcConduit = findBomRowByPattern(bosRows, /conduit|solarflex|pv-?sf|cable/i)?.name
                 || 'PV-rated DC cable + conduit';
  const mc4Pack = findBomRowByPattern(bosRows, /mc4/i)?.name || '';
  const dcCableLine = mc4Pack ? `${dcConduit} (AS/NZS 5033) · ${mc4Pack}` : dcConduit;

  // Phase H6 — derive house loads + backup circuit from preferences if present
  const backupPriority = d.preferences?.backup_priority;
  const houseLoadsLine = (() => {
    const items = ['Lights', 'sockets', 'HWC', 'heat pump', 'oven'];
    if (hasWattpilot) items.push('EV');
    return items.join(' · ');
  })();
  const backupCircuitLine = (() => {
    if (!hasBattery) return null;  // no backup if no battery
    if (backupPriority === 'whole_home_essentials') {
      return 'Fridge · selected lights · router · phone chargers';
    }
    if (backupPriority === 'whole_home_extended') {
      return 'Fridge · most lights · router · heat pump · selected sockets';
    }
    if (backupPriority === 'critical_only') {
      return 'Fridge · medical equipment · phone chargers';
    }
    return 'Fridge · selected lights · router · phone chargers';
  })();

  // Build panel icons strip (panelCount, max ~24 shown)
  const panelIconsCount = Math.min(panelCount || 6, 6);  // visual only — clusters as "strings"
  const panelIcons = [];
  const panelStartX = 228;
  for (let i = 0; i < panelIconsCount; i++) {
    const x = panelStartX + i * 26;
    panelIcons.push(`
      <rect x="${x}" y="60" width="22" height="14" fill="#1E40AF" stroke="#0B0F1A" stroke-width="0.4"/>
      <line x1="${x + 11}" y1="60" x2="${x + 11}" y2="74" stroke="#0B0F1A" stroke-width="0.3"/>
      <line x1="${x}" y1="67" x2="${x + 22}" y2="67" stroke="#0B0F1A" stroke-width="0.3"/>`);
  }

  // PV summary line: e.g. "24 × 595W bifacial · 14.28 kW · 4 strings of 6 (2 per MPPT)"
  // String composition pulled from spec.system.string_design if present
  const strings = sys.string_design?.groups || [];
  const stringsDesc = strings.length
    ? strings.map(g => `${g.string_count} × ${g.panels_per_string}`).join(' + ')
    : '';
  const pvSubText = [
    panelCount && panelWatts ? `${panelCount} × ${panelWatts}W bifacial` : 'PV array',
    totalKw ? `${totalKw} kW` : null,
    stringsDesc ? `${stringsDesc} ${isParallel ? `(paralleled into ${mpptCount} MPPT)` : '(one per MPPT)'}` : null,
  ].filter(Boolean).join(' · ');

  // Conditional rows: parallel-only String Combiner sits between PV and DC Isolator
  const yStringCombiner = isParallel ? 120 : null;
  const yDcIso = isParallel ? 195 : 120;
  const yInverter = yDcIso + 75;
  const yAcLineTop = yInverter + 86;
  const yAcIso = yAcLineTop + 39;
  const ySb = yAcIso + 75;
  const ySmartMeter = ySb + 128;
  const yGrid = ySmartMeter + 62;

  // Battery branch (right side of inverter)
  const batterySvg = hasBattery ? `
    <line x1="430" y1="${yInverter + 43}" x2="490" y2="${yInverter + 43}" stroke="${DC}" stroke-width="3"/>
    <text x="460" y="${yInverter + 36}" text-anchor="middle" font-size="9" font-weight="700" fill="${DC}">DC ↔</text>
    <polygon points="490,${yInverter + 43} 484,${yInverter + 40} 484,${yInverter + 46}" fill="${DC}"/>
    <polygon points="430,${yInverter + 43} 436,${yInverter + 40} 436,${yInverter + 46}" fill="${DC}"/>
    <rect x="490" y="${yInverter + 5}" width="110" height="80" rx="8" fill="${PV_FILL}" stroke="#0B0F1A" stroke-width="1.8"/>
    <text x="545" y="${yInverter + 28}" text-anchor="middle" font-size="12" font-weight="800" fill="#0B0F1A">BATTERY</text>
    <text x="545" y="${yInverter + 45}" text-anchor="middle" font-size="9.5" fill="#5C6470">${escapeSvg(batteryBrand)} ${escapeSvg(batterySeries)}</text>
    <text x="545" y="${yInverter + 59}" text-anchor="middle" font-size="9.5" fill="#5C6470">${batteryKwh} kWh</text>
    <text x="545" y="${yInverter + 75}" text-anchor="middle" font-size="8" fill="#5C6470">${escapeSvg(batteryChem)} · ${bmsCount || 1} BMS+BCU</text>
  ` : '';

  // String combiner box (parallel only)
  const stringCombinerSvg = isParallel ? `
    <rect x="230" y="120" width="160" height="40" rx="6" fill="#fff" stroke="#0B0F1A" stroke-width="1.5"/>
    <text x="310" y="139" text-anchor="middle" font-size="11" font-weight="700" fill="#0B0F1A">STRING COMBINER</text>
    <text x="310" y="153" text-anchor="middle" font-size="8.5" fill="#5C6470">${strings.length} strings → ${mpptCount} paralleled MPPT feeds + DC fuses</text>
    <line x1="310" y1="160" x2="310" y2="${yDcIso}" stroke="${DC}" stroke-width="3"/>
  ` : '';

  // Earth bond (left side, down to switchboard)
  const earthBond = `
    <line x1="180" y1="${yInverter + 43}" x2="60" y2="${yInverter + 43}" stroke="${EARTH}" stroke-width="1.5" stroke-dasharray="4,3"/>
    <line x1="60" y1="${yInverter + 43}" x2="60" y2="${ySb + 49}" stroke="${EARTH}" stroke-width="1.5" stroke-dasharray="4,3"/>
    <line x1="60" y1="${ySb + 49}" x2="100" y2="${ySb + 49}" stroke="${EARTH}" stroke-width="1.5" stroke-dasharray="4,3"/>
    <text x="32" y="${(yInverter + ySb) / 2}" font-size="9" font-weight="700" fill="${EARTH}" transform="rotate(-90, 32, ${(yInverter + ySb) / 2})">EARTH bond</text>
    <g transform="translate(40, ${ySb + 65})">
      <line x1="0" y1="0" x2="22" y2="0" stroke="${EARTH}" stroke-width="1.5"/>
      <line x1="3" y1="3" x2="19" y2="3" stroke="${EARTH}" stroke-width="1.5"/>
      <line x1="7" y1="6" x2="15" y2="6" stroke="${EARTH}" stroke-width="1.5"/>
    </g>
  `;

  const svgHeight = yGrid + 28;

  return `<section class="page">
    ${pageHead(d, 'Single Line Diagram — Electrical Schematic')}

    <h2>System single-line diagram (SLD)</h2>
    <p class="small">This electrical schematic shows how the solar array${hasBattery ? ', battery,' : ','} hybrid inverter, switchboard, smart meter and the grid interconnect. The SLD is required for your network operator's Distributed Generation (DG) application, the Certificate of Compliance (CoC), and the independent electrical inspection (ROI). The configuration below complies with <b>AS/NZS 4777.2:2020</b> (grid-connect inverters) and <b>AS/NZS 3000:2018</b> (wiring rules).</p>

    <div class="card" style="padding:12px;text-align:center;background:#fff;margin-top:6px">
      <svg viewBox="0 0 620 ${svgHeight}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-height:155mm">
        <!-- PV ARRAY -->
        <rect x="190" y="14" width="240" height="68" rx="8" fill="${PV_FILL}" stroke="#0B0F1A" stroke-width="1.8"/>
        <text x="310" y="36" text-anchor="middle" font-size="13" font-weight="800" fill="#0B0F1A">PV ARRAY</text>
        <text x="310" y="52" text-anchor="middle" font-size="10" fill="#5C6470">${escapeSvg(pvSubText)}</text>
        ${panelIcons.join('')}

        <!-- DC line down to (combiner or) isolator -->
        <line x1="310" y1="82" x2="310" y2="${isParallel ? 120 : 120}" stroke="${DC}" stroke-width="3"/>
        <text x="322" y="105" font-size="10" font-weight="700" fill="${DC}">DC</text>

        ${stringCombinerSvg}

        <!-- DC ISOLATOR -->
        <rect x="230" y="${yDcIso}" width="160" height="40" rx="6" fill="#fff" stroke="#0B0F1A" stroke-width="1.5"/>
        <text x="310" y="${yDcIso + 19}" text-anchor="middle" font-size="11" font-weight="700" fill="#0B0F1A">DC ISOLATOR</text>
        <text x="310" y="${yDcIso + 33}" text-anchor="middle" font-size="8.5" fill="#5C6470">${isParallel ? '40A · 1000Vdc · IP66 · lockable · at inverter input' : '32A · 1000Vdc · IP66 · lockable · at inverter input'}</text>

        <line x1="310" y1="${yDcIso + 40}" x2="310" y2="${yInverter}" stroke="${DC}" stroke-width="3"/>

        <!-- HYBRID INVERTER -->
        <rect x="190" y="${yInverter}" width="240" height="86" rx="8" fill="${INV_FILL}" stroke="#0B0F1A" stroke-width="2"/>
        <text x="310" y="${yInverter + 25}" text-anchor="middle" font-size="14" font-weight="800" fill="#0B0F1A">HYBRID INVERTER</text>
        <text x="310" y="${yInverter + 42}" text-anchor="middle" font-size="10.5" fill="#5C6470">${escapeSvg(inverterBrand)} ${escapeSvg(inverterName)}</text>
        <text x="310" y="${yInverter + 58}" text-anchor="middle" font-size="9" fill="#5C6470">DC/AC · ${hasBattery ? `${escapeSvg(batteryBrand)} battery interface · ` : ''}${mpptCount}× MPPT${uocMax ? ` · ${uocMax} V Uoc max` : ''}</text>
        <text x="310" y="${yInverter + 74}" text-anchor="middle" font-size="8.5" fill="#5C6470">AS/NZS 4777.2:2020 certified</text>

        ${batterySvg}

        <!-- AC line down -->
        <line x1="310" y1="${yAcLineTop}" x2="310" y2="${yAcIso}" stroke="${AC}" stroke-width="3"/>
        <text x="322" y="${(yAcLineTop + yAcIso) / 2 + 4}" font-size="10" font-weight="700" fill="${AC}">AC</text>

        <!-- AC ISOLATOR -->
        <rect x="230" y="${yAcIso}" width="160" height="40" rx="6" fill="#fff" stroke="#0B0F1A" stroke-width="1.5"/>
        <text x="310" y="${yAcIso + 19}" text-anchor="middle" font-size="11" font-weight="700" fill="#0B0F1A">AC ISOLATOR</text>
        <text x="310" y="${yAcIso + 33}" text-anchor="middle" font-size="8.5" fill="#5C6470">63A · 230V · IP66 · lockable</text>

        <line x1="310" y1="${yAcIso + 40}" x2="310" y2="${ySb}" stroke="${AC}" stroke-width="3"/>

        <!-- MAIN SWITCHBOARD with split house loads / backup circuit -->
        <rect x="100" y="${ySb}" width="420" height="98" rx="8" fill="${SB_FILL}" stroke="#0B0F1A" stroke-width="2"/>
        <text x="310" y="${ySb + 22}" text-anchor="middle" font-size="13" font-weight="800" fill="#0B0F1A">MAIN SWITCHBOARD</text>
        <text x="310" y="${ySb + 38}" text-anchor="middle" font-size="8.5" fill="#5C6470">Type A RCBO (AS/NZS 3000, if electrician recommends) · Type II SPD · ${meterPhase === 3 ? '50A' : '50A'} solar breaker</text>
        <line x1="310" y1="${ySb + 44}" x2="310" y2="${ySb + 92}" stroke="#0B0F1A" stroke-width="0.8" stroke-dasharray="4,3"/>
        <text x="205" y="${ySb + 62}" text-anchor="middle" font-size="10" font-weight="700" fill="#0B0F1A">HOUSE LOADS</text>
        <text x="205" y="${ySb + 76}" text-anchor="middle" font-size="8" fill="#5C6470">${escapeSvg(houseLoadsLine.split(' · ').slice(0, 3).join(' · '))}</text>
        <text x="205" y="${ySb + 88}" text-anchor="middle" font-size="8" fill="#5C6470">${escapeSvg(houseLoadsLine.split(' · ').slice(3).join(' · '))}</text>
        ${backupCircuitLine ? `
        <text x="415" y="${ySb + 62}" text-anchor="middle" font-size="10" font-weight="700" fill="#0B0F1A">BACKUP CIRCUIT</text>
        <text x="415" y="${ySb + 76}" text-anchor="middle" font-size="8" fill="#5C6470">${escapeSvg(backupCircuitLine.split(' · ').slice(0, 2).join(' · '))}</text>
        <text x="415" y="${ySb + 88}" text-anchor="middle" font-size="8" fill="#5C6470">${escapeSvg(backupCircuitLine.split(' · ').slice(2).join(' · '))}</text>
        ` : `
        <text x="415" y="${ySb + 62}" text-anchor="middle" font-size="10" font-weight="700" fill="#9CA3AF">NO BACKUP</text>
        <text x="415" y="${ySb + 80}" text-anchor="middle" font-size="8" fill="#9CA3AF" font-style="italic">solar-only — grid-tied only</text>
        `}

        <line x1="310" y1="${ySb + 98}" x2="310" y2="${ySmartMeter}" stroke="${AC}" stroke-width="3"/>

        <!-- SMART METER -->
        <rect x="230" y="${ySmartMeter}" width="160" height="40" rx="6" fill="#fff" stroke="#0B0F1A" stroke-width="1.5"/>
        <text x="310" y="${ySmartMeter + 19}" text-anchor="middle" font-size="11" font-weight="700" fill="#0B0F1A">SMART METER</text>
        <text x="310" y="${ySmartMeter + 33}" text-anchor="middle" font-size="8.5" fill="#5C6470">Bidirectional · import + export</text>

        <line x1="310" y1="${ySmartMeter + 40}" x2="310" y2="${yGrid}" stroke="${AC}" stroke-width="3"/>

        <!-- GRID -->
        <rect x="230" y="${yGrid}" width="160" height="26" rx="6" fill="${GRID_FILL}" stroke="${AC}" stroke-width="2"/>
        <text x="310" y="${yGrid + 18}" text-anchor="middle" font-size="12" font-weight="800" fill="${AC}">⚡ ELECTRICITY GRID</text>

        ${earthBond}
      </svg>
    </div>

    <div class="grid2" style="margin-top:8px">
      <div class="card">
        <h3>Legend</h3>
        <ul style="margin:4px 0 0 14px;padding:0;font-size:10px;line-height:1.7">
          <li><span style="display:inline-block;width:18px;height:3px;background:${DC};vertical-align:middle"></span> &nbsp;DC wiring · panels → inverter${hasBattery ? ', inverter ↔ battery' : ''}</li>
          <li><span style="display:inline-block;width:18px;height:3px;background:${AC};vertical-align:middle"></span> &nbsp;AC wiring · inverter → switchboard → grid</li>
          <li><span style="display:inline-block;width:18px;height:3px;background:${EARTH};vertical-align:middle"></span> &nbsp;Earth / equipotential bonding (dashed)</li>
          ${hasBattery ? '<li>↔ Bidirectional flow · battery charges or discharges as required</li>' : ''}
          <li>Smart meter is bidirectional — your retailer reads both import and export</li>
        </ul>
      </div>
      <div class="card">
        <h3>Protection &amp; compliance</h3>
        <table class="tight">
          <tr><td><b>Inverter</b></td><td>${escapeSvg(inverterBrand)} ${escapeSvg(inverterName)} (AS/NZS 4777.2:2020)</td></tr>
          <tr><td><b>String topology</b></td><td>${stringsDesc || `${panelCount} panels`} · ${isParallel ? `paralleled into ${mpptCount} MPPTs` : `${mpptCount} MPPT inputs`}${uocMax ? ` · Uoc max ${uocMax} V` : ''}</td></tr>
          <tr><td><b>DC isolators</b></td><td>${findBomRowByPattern(bosRows, /dc.*isolator|isolator.*dc/i)?.name || `${isParallel ? '40A' : '32A'} IP66 lockable`}</td></tr>
          <tr><td><b>DC cable</b></td><td>${escapeSvg(dcCableLine)}</td></tr>
          <tr><td><b>AC isolator</b></td><td>${findBomRowByPattern(bosRows, /ac.*isolator|isolator.*ac/i)?.name || `${meterPhase === 3 ? '63A 3-phase' : '63A single-phase'} IP66 lockable at switchboard`}</td></tr>
          <tr><td><b>Surge protection</b></td><td>${findBomRowByPattern(bosRows, /spd|surge/i)?.name || 'Type II SPD on DC + AC sides'}</td></tr>
          <tr><td><b>Earthing</b></td><td>${findBomRowByPattern(bosRows, /earth|bond/i)?.name || 'Frame + DC negative bonded to main earth bar'}</td></tr>
        </table>
      </div>
    </div>

    <p class="small disclaimer">This SLD is preliminary and reflects your installed system${inverterBrand ? ` (${escapeSvg(inverterBrand)} ${escapeSvg(inverterName)}${hasBattery ? ` + ${escapeSvg(batteryBrand)} ${escapeSvg(batterySeries)} ${batteryKwh} kWh` : ''})` : ''}. The final as-built SLD is issued with the Certificate of Compliance (CoC) after installation, showing actual cable sizes, breaker ratings and the switchboard schedule confirmed at the pre-install site visit.</p>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

function escapeSvg(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
