// Page — Premium hardware — why we picked this kit
//
// Customer-facing "WHY this brand" page. Sits right after the Components
// (technical specs) page and BEFORE the Pricing page so the customer reads
// the credibility story before the number.
//
// Content is DATA-DRIVEN — every claim comes from products.marketing_claims
// (JSONB) seeded by admin. Adding a new brand is a JSON edit, not a code
// change. When marketing_claims is empty for either product, the page
// silently returns '' and drops out of the PDF (lazy page).

import { pageHead, pageFoot } from '../_shared.js';

// Industry-typical competitor reference values (the "vs typical" column).
// These are inline rather than DB-seeded because they describe an industry
// average, not a specific product. Update here when market shifts.
const COMPETITOR_REFERENCE = {
  inverter: {
    origin: 'Generic offshore',
    warranty_yrs: '5 – 10',
    peak_efficiency_pct: '95 – 96',
    backup_capability: 'PV Point only',
    vpp_ready: 'No',
  },
  battery: {
    chemistry: 'NMC (higher fire risk)',
    year10_capacity_pct: '30 – 50',
    cycle_life: '3,000 – 5,000',
    scalability: 'Often fixed at install',
    ip_rating: 'IP54 typical',
    warranty_yrs: '5 – 7',
  },
};

export function pagePremiumHardware(d, sectionNum, sectionsTotal) {
  const inv = d.hardware?.inverter;
  const bat = d.hardware?.battery;

  const invClaims = inv?.marketing_claims;
  const batClaims = bat?.marketing_claims;

  // Lazy page — drop out when nothing to say.
  if (!invClaims && !batClaims) return '';

  return `<section class="page">
    ${pageHead(d, 'Premium hardware — why we picked this kit')}

    <div class="page-content-grow">
      <p style="font-size:10.5px;color:#5C6470;margin:0 0 12px;line-height:1.5">
        Solar systems live on your roof for 20-30 years. The difference between premium kit and budget kit
        isn't visible at install — it shows up in year 8, year 10, year 15. Here's why we chose your hardware.
      </p>

      ${invClaims ? brandSection({
        kind: 'INVERTER',
        productName: `${inv.brand} ${inv.name || ''}`,
        accent: '#FF6A00',
        bgAccent: 'linear-gradient(135deg,#FFF7ED,#FFE4CC)',
        borderAccent: '#FED7AA',
        claims: invClaims,
      }) : ''}

      ${batClaims ? brandSection({
        kind: 'BATTERY',
        productName: `${bat.brand} ${bat.series || ''} ${bat.total_usable_kwh ? bat.total_usable_kwh + ' kWh' : ''}`.trim(),
        accent: '#0EA5E9',
        bgAccent: 'linear-gradient(135deg,#F0F9FF,#DBEAFE)',
        borderAccent: '#BAE6FD',
        claims: batClaims,
      }) : ''}

      ${comparisonTable(invClaims, batClaims)}

      ${manufacturerBlurbs(inv, bat, invClaims, batClaims)}
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

// ── Per-brand section (inverter or battery) ───────────────────────────────
function brandSection({ kind, productName, accent, bgAccent, borderAccent, claims }) {
  const badges = (claims.badges || []).map(b => `
    <span style="display:inline-block;font-size:8.5px;font-weight:800;color:${accent};
                 background:${bgAccent};border:1px solid ${borderAccent};
                 border-radius:3px;padding:2px 7px;margin:0 4px 4px 0;
                 letter-spacing:.4px">★ ${escape(b)}</span>
  `).join('');

  const bullets = (claims.bullets || []).slice(0, 7).map(b => `
    <li style="margin-bottom:4px">
      <b>${escape(b.claim)}</b>${b.detail ? ` <span style="color:#5C6470">— ${escape(b.detail)}</span>` : ''}
    </li>
  `).join('');

  return `
    <div style="border:1.5px solid ${borderAccent};border-radius:8px;padding:12px 14px;margin-bottom:12px;background:#fff">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;border-bottom:1px solid #F1F5F9;padding-bottom:6px">
        <div>
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#5C6470;font-weight:700">${kind}</div>
          <div style="font-size:14px;font-weight:800;color:#0B0F1A;letter-spacing:-0.2px">${escape(productName)}</div>
        </div>
        ${claims.headline ? `<div style="font-size:10px;font-style:italic;color:${accent};text-align:right;max-width:60%">"${escape(claims.headline)}"</div>` : ''}
      </div>

      ${badges ? `<div style="margin-bottom:8px">${badges}</div>` : ''}

      <ul style="margin:0;padding-left:18px;font-size:10px;line-height:1.5;color:#0B0F1A">
        ${bullets}
      </ul>
    </div>
  `;
}

// ── Side-by-side comparison table ──────────────────────────────────────────
function comparisonTable(invClaims, batClaims) {
  const rows = [];

  if (invClaims?.comparison) {
    const c = invClaims.comparison;
    const ref = COMPETITOR_REFERENCE.inverter;
    if (c.origin) rows.push({ label: 'Inverter origin', yours: c.origin, theirs: ref.origin });
    if (c.warranty_yrs) rows.push({ label: 'Inverter warranty', yours: `${c.warranty_yrs} yrs`, theirs: `${ref.warranty_yrs} yrs` });
    if (c.peak_efficiency_pct) rows.push({ label: 'Peak efficiency', yours: `${c.peak_efficiency_pct}%`, theirs: `${ref.peak_efficiency_pct}%` });
    if (c.backup_capability) rows.push({ label: 'Backup capability', yours: c.backup_capability, theirs: ref.backup_capability });
    if (c.vpp_ready) rows.push({ label: 'VPP-ready (future income)', yours: c.vpp_ready, theirs: ref.vpp_ready });
  }
  if (batClaims?.comparison) {
    const c = batClaims.comparison;
    const ref = COMPETITOR_REFERENCE.battery;
    if (c.chemistry) rows.push({ label: 'Battery chemistry', yours: c.chemistry, theirs: ref.chemistry });
    if (c.year10_capacity_pct) rows.push({ label: 'Capacity at year 10', yours: `${c.year10_capacity_pct}%`, theirs: `${ref.year10_capacity_pct}%` });
    if (c.cycle_life) rows.push({ label: 'Battery cycle life', yours: typeof c.cycle_life === 'number' ? `${c.cycle_life.toLocaleString('en-NZ')}+ cycles` : c.cycle_life, theirs: ref.cycle_life });
    if (c.scalability) rows.push({ label: 'Battery scalability', yours: c.scalability, theirs: ref.scalability });
    if (c.warranty_yrs) rows.push({ label: 'Battery warranty', yours: `${c.warranty_yrs} yrs`, theirs: `${ref.warranty_yrs} yrs` });
  }

  if (rows.length === 0) return '';

  return `
    <div style="margin-top:6px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;padding:11px 14px">
      <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;color:#5C6470;font-weight:800;margin-bottom:6px">
        Your install vs typical budget kit
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:9.5px">
        <thead>
          <tr style="border-bottom:1.5px solid #CBD5E1">
            <th style="text-align:left;padding:5px 8px 5px 0;color:#5C6470;font-weight:700;width:35%"></th>
            <th style="text-align:left;padding:5px 8px;color:#16A34A;font-weight:800">YOUR INSTALL</th>
            <th style="text-align:left;padding:5px 8px;color:#9CA3AF;font-weight:700">Typical budget alternative</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr style="${i % 2 === 1 ? 'background:#fff' : ''}">
              <td style="padding:4px 8px 4px 0;color:#0B0F1A;font-weight:600">${escape(r.label)}</td>
              <td style="padding:4px 8px;color:#14532D;font-weight:700">${escape(r.yours)}</td>
              <td style="padding:4px 8px;color:#5C6470">${escape(r.theirs)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ── "Built by global leaders" footer ───────────────────────────────────────
function manufacturerBlurbs(inv, bat, invClaims, batClaims) {
  const items = [];
  if (invClaims?.manufacturer_blurb) {
    items.push({ brand: inv.brand, blurb: invClaims.manufacturer_blurb });
  }
  if (batClaims?.manufacturer_blurb) {
    items.push({ brand: bat.brand, blurb: batClaims.manufacturer_blurb });
  }
  if (!items.length) return '';

  return `
    <div style="margin-top:8px;display:grid;grid-template-columns:${items.length > 1 ? '1fr 1fr' : '1fr'};gap:10px">
      ${items.map(it => `
        <div style="background:#fff7ed;border-left:3px solid #FF6A00;padding:8px 11px;border-radius:0 4px 4px 0">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#92400e;font-weight:800;margin-bottom:2px">
            About ${escape(it.brand)}
          </div>
          <div style="font-size:9.5px;color:#0B0F1A;line-height:1.45">${escape(it.blurb)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function escape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
