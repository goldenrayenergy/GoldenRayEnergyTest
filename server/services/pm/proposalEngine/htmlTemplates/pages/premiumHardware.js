// Page — Premium hardware — why we picked this kit
//
// Single-page magazine-style spread covering panels, inverter, battery in
// vertically stacked sections (Path 1, condensed magazine layout). Every
// section is driven by products.marketing_claims (JSONB) + image_url +
// the brand-origin map below. Goldenray accent (#FF6A00) throughout —
// brand colours intentionally NOT used per section, for consistency with
// the rest of the proposal.
//
// Layout per section (~280 px tall):
//   ┌──────────────────────────────────────────────────────────────────┐
//   │  [hero photo]  PANELS                                            │
//   │   100×100      Phono Solar Draco 595W   [🇨🇳 China]              │
//   │                "N-TopCon Bifacial • Tier 1"                       │
//   │                ⚡ Higher year-25 output                            │
//   │                🛡 30-year performance warranty                     │
//   │                ❄ Lower temp coefficient                            │
//   │                💧 Bifacial — extra 8% energy                       │
//   │                ─────────────────────────────────                   │
//   │                Efficiency  22.6% ████████ vs 19.5% █████          │
//   └──────────────────────────────────────────────────────────────────┘
//
// When marketing_claims is empty for all 3 components, the page returns ''
// and silently drops out of the PDF (lazy page).

import { pageHead, pageFoot } from '../_shared.js';

// ── Goldenray brand accent ──────────────────────────────────────────────────
const ACCENT       = '#FF6A00';
const ACCENT_DARK  = '#9A3412';
const ACCENT_LIGHT = '#FFF7ED';
const ACCENT_BORDER = '#FED7AA';

// ── Feature icon set — monochrome SVG, uses currentColor (Goldenray orange) ─
// Each ~150-300 bytes. Sized to 14×14 so they sit inline with text. Stroke
// based for crisp rendering at any DPR.
const ICONS = {
  power: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  warranty: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  thermal: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><circle cx="12" cy="16" r="4"/><path d="M14 8h-4M14 5h-4M14 11h-4"/></svg>`,
  weather: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6M8 5l4 4 4-4M5 16c0-3 3-6 7-6s7 3 7 6"/><path d="M3 20h18"/></svg>`,
  battery: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="18" height="10" rx="1"/><line x1="22" y1="11" x2="22" y2="13"/><rect x="5" y="10" width="11" height="4" fill="currentColor"/></svg>`,
  hybrid: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l-3 6h4v6"/><path d="M17 20l3-6h-4V8"/></svg>`,
  monitoring: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12a10 10 0 0 1 10-10"/><path d="M5 12a7 7 0 0 1 7-7"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`,
  tier: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M9 13l-2 9 5-3 5 3-2-9"/></svg>`,
  efficiency: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>`,
  install: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 7l3-3 4 4-3 3-4-4z"/><path d="M14 7L4 17l3 3 10-10"/></svg>`,
  sustainability: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21c5-5 10-10 14-14-1 6-2 11-7 14"/><path d="M7 21c-2-3-2-7 0-10 4-4 9-5 14-4"/></svg>`,
  safe: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L4 5v7c0 5 4 9 8 10 4-1 8-5 8-10V5l-8-3z"/><polyline points="9 12 11 14 15 10"/></svg>`,
};

// Heuristic — pick an icon for each bullet based on keywords. Falls back
// to "power" if nothing matches.
function iconForBullet(text) {
  const t = (text || '').toLowerCase();
  if (/warranty|guarantee|year.*coverage|extension/.test(t)) return ICONS.warranty;
  if (/temperature|thermal|heat|hot|cooling|cold/.test(t))    return ICONS.thermal;
  if (/bifacial|rain|hail|water|weather|wind|dust|ip\d/.test(t)) return ICONS.weather;
  if (/capacity|kwh|cycles|degradation|year.*10|year.*25/.test(t)) return ICONS.battery;
  if (/hybrid|battery.ready|backup|grid/.test(t))             return ICONS.hybrid;
  if (/monitor|solarweb|wifi|ethernet|app|portal/.test(t))    return ICONS.monitoring;
  if (/tier|bloomberg|certif|rank|award/.test(t))             return ICONS.tier;
  if (/efficien|output|yield|n-?topcon|hjt|perc/.test(t))     return ICONS.efficiency;
  if (/install|engineer|design|build|manufactur/.test(t))     return ICONS.install;
  if (/sustain|recycl|carbon|emission|green/.test(t))         return ICONS.sustainability;
  if (/safe|safety|lfp|lifepo|fire|chemistry/.test(t))        return ICONS.safe;
  return ICONS.power;
}

// ── Public entry point ─────────────────────────────────────────────────────
export function pagePremiumHardware(d, sectionNum, sectionsTotal) {
  const pan = d.hardware?.panel;
  const inv = d.hardware?.inverter;
  const bat = d.hardware?.battery;

  const panClaims = pan?.marketing_claims;
  const invClaims = inv?.marketing_claims;
  const batClaims = bat?.marketing_claims;

  // Lazy page — drop out when nothing to say.
  if (!panClaims && !invClaims && !batClaims) return '';

  const sections = [
    panClaims ? componentSection({
      kind: 'SOLAR PANELS',
      countLabel: pan.count && pan.watts ? `${pan.count} × ${pan.watts} W` : '',
      product: pan,
      claims: panClaims,
      comparisonRow: panelComparison(panClaims),
    }) : '',
    invClaims ? componentSection({
      kind: 'INVERTER',
      countLabel: inv.ac_kw ? `${inv.ac_kw} kW` : '',
      product: inv,
      claims: invClaims,
      comparisonRow: inverterComparison(invClaims),
    }) : '',
    batClaims ? componentSection({
      kind: 'BATTERY',
      countLabel: bat.total_usable_kwh ? `${bat.total_usable_kwh} kWh` : '',
      product: bat,
      claims: batClaims,
      comparisonRow: batteryComparison(batClaims),
    }) : '',
  ].filter(Boolean).join('');

  return `<section class="page">
    ${pageHead(d, 'Premium hardware — why we picked this kit')}

    <div class="page-content-grow">
      <p style="font-size:10.5px;color:#5C6470;margin:0 0 10px;line-height:1.5">
        Solar systems live on your roof for 20-30 years. The difference between premium and
        budget hardware does not show at install — it shows in year 8, year 10, year 15.
        Here is why we chose each component in your kit.
      </p>

      ${sections}

      ${brandAssuranceStrip()}
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

// ── Single component section (panel / inverter / battery) ───────────────────
function componentSection({ kind, countLabel, product, claims, comparisonRow }) {
  const photo = product.image_url
    ? `<img src="${escapeAttr(product.image_url)}" alt="${escapeAttr(product.name || kind)}" style="max-width:100%;max-height:96px;object-fit:contain"/>`
    : `<div style="width:100%;height:96px;background:linear-gradient(135deg,${ACCENT_LIGHT},#fff7ed);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;color:${ACCENT_DARK};font-weight:700;text-align:center;padding:4px">${kind}</div>`;

  // Country/origin flag chip removed per user request — warranty chip alone
  // sits on the right side of the section header.
  const warrantyChip = product.warranty ? `
    <span style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;background:${ACCENT_LIGHT};border:1px solid ${ACCENT_BORDER};border-radius:10px;font-size:9.5px;color:${ACCENT_DARK};font-weight:700;vertical-align:middle">
      <span style="color:${ACCENT}">${ICONS.warranty}</span><span>${escape(product.warranty)}</span>
    </span>` : '';

  // Pick top 4 bullets (page real estate is tight in a 3-section stack)
  const bullets = (claims.bullets || []).slice(0, 4).map(b => `
    <div style="display:flex;align-items:flex-start;gap:7px;margin-bottom:3px;font-size:10px;line-height:1.4;color:#0B0F1A">
      <span style="color:${ACCENT};flex-shrink:0;margin-top:1px">${iconForBullet(b.claim)}</span>
      <span><b>${escape(b.claim)}</b>${b.detail ? ` <span style="color:#5C6470">— ${escape(b.detail)}</span>` : ''}</span>
    </div>`).join('');

  return `
    <div style="display:grid;grid-template-columns:110px 1fr;gap:14px;padding:10px 12px;
                border:1px solid #E5E7EB;border-radius:8px;background:#fff;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:center;background:#F8FAFC;border-radius:6px;padding:6px">
        ${photo}
      </div>
      <div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:3px">
          <div>
            <span style="font-size:8.5px;text-transform:uppercase;letter-spacing:.6px;color:#5C6470;font-weight:800">${kind}</span>
            ${countLabel ? `<span style="font-size:9px;color:${ACCENT};font-weight:800;margin-left:6px">${countLabel}</span>` : ''}
          </div>
          <div style="flex-shrink:0">${warrantyChip}</div>
        </div>
        <div style="font-size:12.5px;font-weight:800;color:#0B0F1A;letter-spacing:-0.2px;margin-bottom:4px">
          ${escape(product.brand || '')}${product.brand && product.name ? ' — ' : ''}${escape(product.name || '')}
        </div>
        ${claims.headline ? `<div style="font-size:9.5px;font-style:italic;color:${ACCENT_DARK};margin-bottom:6px">"${escape(claims.headline)}"</div>` : ''}
        ${bullets}
        ${comparisonRow}
      </div>
    </div>`;
}

// ── Per-kind one-row comparison bar (yours vs typical) ──────────────────────
function panelComparison(claims) {
  const c = claims.comparison || {};
  // Prefer efficiency; fall back to bloomberg_tier as a categorical
  if (c.peak_efficiency_pct) {
    return comparisonBar({
      label: 'Module efficiency',
      yours: Number(c.peak_efficiency_pct),
      yoursDisplay: `${c.peak_efficiency_pct}%`,
      theirs: 19.5,
      theirsDisplay: '19.5%',
      maxValue: 25,
    });
  }
  return '';
}

function inverterComparison(claims) {
  const c = claims.comparison || {};
  if (c.peak_efficiency_pct) {
    return comparisonBar({
      label: 'Peak efficiency',
      yours: Number(c.peak_efficiency_pct),
      yoursDisplay: `${c.peak_efficiency_pct}%`,
      theirs: 95.5,
      theirsDisplay: '95.5%',
      maxValue: 100,
    });
  }
  return '';
}

function batteryComparison(claims) {
  const c = claims.comparison || {};
  if (c.year10_capacity_pct) {
    return comparisonBar({
      label: 'Capacity remaining at year 10',
      yours: Number(c.year10_capacity_pct),
      yoursDisplay: `${c.year10_capacity_pct}%`,
      theirs: 40,
      theirsDisplay: '~40%',
      maxValue: 100,
    });
  }
  return '';
}

// ── Compact horizontal bar (yours vs typical, single row) ───────────────────
function comparisonBar({ label, yours, yoursDisplay, theirs, theirsDisplay, maxValue }) {
  const yoursPct = Math.max(0, Math.min(100, (yours / maxValue) * 100));
  const theirsPct = Math.max(0, Math.min(100, (theirs / maxValue) * 100));
  return `
    <div style="margin-top:7px;padding-top:6px;border-top:1px solid #F1F5F9">
      <div style="font-size:9px;color:#5C6470;font-weight:700;margin-bottom:3px">${escape(label)}</div>
      <div style="display:grid;grid-template-columns:60px 1fr 38px;gap:6px;align-items:center;margin-bottom:2px">
        <span style="font-size:9px;color:${ACCENT_DARK};font-weight:700">Yours</span>
        <div style="position:relative;height:6px;background:#F1F5F9;border-radius:3px">
          <div style="position:absolute;left:0;top:0;height:6px;width:${yoursPct}%;background:${ACCENT};border-radius:3px"></div>
        </div>
        <span style="font-size:9px;color:${ACCENT_DARK};font-weight:800;text-align:right">${escape(yoursDisplay)}</span>
      </div>
      <div style="display:grid;grid-template-columns:60px 1fr 38px;gap:6px;align-items:center">
        <span style="font-size:9px;color:#9CA3AF;font-weight:600">Typical</span>
        <div style="position:relative;height:6px;background:#F1F5F9;border-radius:3px">
          <div style="position:absolute;left:0;top:0;height:6px;width:${theirsPct}%;background:#9CA3AF;border-radius:3px"></div>
        </div>
        <span style="font-size:9px;color:#5C6470;font-weight:600;text-align:right">${escape(theirsDisplay)}</span>
      </div>
    </div>`;
}

// ── Brand-assurance footer strip — 4 trust pills ───────────────────────────
function brandAssuranceStrip() {
  const pill = (icon, label) => `
    <div style="display:flex;align-items:center;gap:6px;padding:7px 11px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:6px;font-size:9.5px;color:#334155;font-weight:700">
      <span style="color:${ACCENT}">${icon}</span><span>${label}</span>
    </div>`;
  return `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px">
      ${pill(ICONS.safe, 'NZ compliant — AS/NZS 4777 + 5033')}
      ${pill(ICONS.tier, 'Bloomberg Tier 1 hardware')}
      ${pill(ICONS.safe, 'LFP chemistry — safest residential')}
      ${pill(ICONS.sustainability, 'Manufacturer-backed warranties')}
    </div>`;
}

// ── HTML escape helpers ────────────────────────────────────────────────────
function escape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
