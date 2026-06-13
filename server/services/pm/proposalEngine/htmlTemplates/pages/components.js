// ────────────────────────────────────────────────────────────────────────────
// Page — Your Solution — Components (Phase C-1)
//
// Hardware deep-dive: one block per kind (panel / inverter / battery / smart
// meter). Each block shows a product photo + name + technical specs +
// warranty. Image + datasheet URLs come from products.image_url /
// products.datasheet_url (set by admin or seeded). When a URL is missing, the
// block renders a placeholder swatch instead of breaking.
//
// Battery block is hidden when the spec has no battery (solar-only tier).
// ────────────────────────────────────────────────────────────────────────────

import { pageHead, pageFoot } from '../_shared.js';
import { fmtNum } from '../proposalData.js';

export function pageComponents(d, sectionNum, sectionsTotal) {
  const h = d.hardware || {};

  return `<section class="page">
    ${pageHead(d, 'Your solution — components')}

    <div class="page-content-grow">
      <p style="font-size:10.5px;color:#5C6470;margin:0 0 12px">
        Every component in your system, in detail. Manufacturer datasheets are appended at the back of this proposal.
      </p>

      ${componentBlock({
        kind: 'Solar panels',
        countLabel: h.panel?.count ? `× ${h.panel.count}` : '',
        product: h.panel,
        specRows: panelSpecRows(h.panel),
      })}

      ${componentBlock({
        kind: 'Inverter',
        countLabel: '× 1',
        product: h.inverter,
        specRows: inverterSpecRows(h.inverter),
      })}

      ${h.battery ? componentBlock({
        kind: 'Battery',
        countLabel: h.battery.module_count ? `× ${h.battery.module_count} modules` : '',
        product: h.battery,
        specRows: batterySpecRows(h.battery),
      }) : ''}

      ${componentBlock({
        kind: 'Smart meter & monitoring',
        countLabel: '× 1',
        product: h.smart_meter,
        specRows: smartMeterSpecRows(h.smart_meter),
      })}
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

// ── Layout primitives ──────────────────────────────────────────────────────
function componentBlock({ kind, countLabel, product, specRows }) {
  if (!product) {
    return `<div class="comp-block">
      <div class="comp-photo placeholder"><span>${kind}</span></div>
      <div class="comp-body">
        <div class="comp-kind">${kind}</div>
        <div class="comp-name">— (SKU not in catalogue)</div>
      </div>
    </div>`;
  }
  const photo = product.image_url
    ? `<img src="${escapeAttr(product.image_url)}" alt="${escapeAttr(product.name)}" />`
    : `<span>${kind}<br/><small style="opacity:.6">photo coming</small></span>`;
  const datasheetLink = product.datasheet_url
    ? ` · <a href="${escapeAttr(product.datasheet_url)}" style="color:#FF6A00;text-decoration:none">Datasheet ↗</a>`
    : '';

  return `<div class="comp-block">
    <div class="comp-photo${product.image_url ? '' : ' placeholder'}">${photo}</div>
    <div class="comp-body">
      <div class="comp-kind">${kind} ${countLabel ? `<span class="comp-qty">${countLabel}</span>` : ''}</div>
      <div class="comp-name">${product.brand ? product.brand + ' — ' : ''}${product.name}${datasheetLink}</div>
      <div class="comp-specs">
        ${specRows.filter(Boolean).map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
      </div>
      ${product.warranty ? `<div class="comp-warranty">Warranty — ${product.warranty}</div>` : ''}
    </div>
  </div>`;
}

// ── Per-kind spec row builders ─────────────────────────────────────────────
// Each returns an array of [label, value] tuples (falsy values skipped).
function panelSpecRows(p) {
  if (!p) return [];
  return [
    p.watts ? ['Rated power',        `${p.watts}W per panel`] : null,
    p.total_kwp ? ['System DC capacity', `${p.total_kwp} kWp`] : null,
    p.voc_stc ? ['Open-circuit Voc',  `${p.voc_stc} V @ STC`] : null,
    p.imp_stc ? ['Current at Pmax',   `${p.imp_stc} A @ STC`] : null,
    p.peak_efficiency_pct ? ['Module efficiency', `${p.peak_efficiency_pct}%`] : null,
  ];
}

function inverterSpecRows(i) {
  if (!i) return [];
  return [
    i.ac_kw ? ['AC output',         `${i.ac_kw} kW`] : null,
    i.phase ? ['Phase',             `${i.phase}-phase`] : null,
    i.dc_ac_ratio ? ['DC/AC sizing ratio', `${i.dc_ac_ratio} (within envelope ≤ 1.50)`] : null,
    i.mppt_count ? ['MPPT inputs',  `${i.mppt_count}`] : null,
    i.uoc_max_v ? ['Max input Voc', `${i.uoc_max_v} V`] : null,
    i.peak_efficiency_pct ? ['Peak efficiency', `${i.peak_efficiency_pct}%`] : null,
    ['Configuration',
      i.is_plus_variant ? 'Plus (battery-ready out of box)'
                        : i.battery_capable ? 'Battery-capable via upgrade license'
                                            : 'Solar-only'],
  ];
}

function batterySpecRows(b) {
  if (!b) return [];
  return [
    b.total_usable_kwh ? ['Total usable capacity', `${b.total_usable_kwh} kWh`] : null,
    b.module_count && b.module_kwh
      ? ['Configuration', `${b.module_count} × ${b.module_kwh} kWh modules`]
      : null,
    b.series ? ['Series',     b.series] : null,
    b.chemistry ? ['Chemistry', `${b.chemistry} (Lithium Iron Phosphate — safest residential battery chemistry)`] : null,
  ];
}

function smartMeterSpecRows(m) {
  if (!m) return [];
  return [
    m.phase ? ['Phase',  `${m.phase}-phase`] : null,
    m.amps ? ['Capacity', `${m.amps}A`] : null,
    ['Monitoring', 'Real-time generation + export tracking via SolarWeb cloud portal'],
    ['Required for', 'Self-consumption optimisation, export limiting, buyback metering'],
  ];
}

// Avoid HTML-injection from product names / URLs.
function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── CSS injected when this page is present ─────────────────────────────────
// Scoped to .comp-block / .comp-* so it doesn't collide with the existing
// .comp-card chrome from _shared.js used by the system summary page.
export const COMPONENTS_PAGE_CSS = `
  .comp-block{display:grid;grid-template-columns:130px 1fr;gap:14px;
              border:1px solid #D9DCE1;border-radius:8px;padding:11px 13px;
              background:#fff;margin-bottom:10px}
  .comp-photo{display:flex;align-items:center;justify-content:center;
              min-height:115px;background:#F7F8FA;border-radius:6px;
              overflow:hidden}
  .comp-photo img{max-width:100%;max-height:115px;object-fit:contain}
  .comp-photo.placeholder{background:linear-gradient(135deg,#fef3c7,#fff7ed);
                           color:#92400e;font-size:10px;font-weight:700;
                           text-align:center;padding:8px;line-height:1.4}
  .comp-body{display:flex;flex-direction:column;gap:3px}
  .comp-kind{font-size:9px;color:#5C6470;text-transform:uppercase;
             letter-spacing:.5px;font-weight:700}
  .comp-kind .comp-qty{margin-left:5px;color:#FF6A00;font-weight:800}
  .comp-name{font-size:12.5px;font-weight:800;color:#0B0F1A;margin-bottom:4px}
  .comp-specs{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;
              font-size:10px;margin-top:2px}
  .comp-specs > div{display:flex;justify-content:space-between;gap:6px;
                    border-bottom:1px dotted #E5E7EB;padding:2px 0}
  .comp-specs .k{color:#5C6470}
  .comp-specs .v{color:#0B0F1A;font-weight:600;text-align:right}
  .comp-warranty{font-size:9.5px;color:#16A34A;font-weight:600;margin-top:6px;
                 padding-top:5px;border-top:1px solid #E5E7EB}
`;
