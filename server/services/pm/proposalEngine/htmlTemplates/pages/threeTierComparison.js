// Page — 3-tier comparison (P4.5)
//
// Renders all 1–3 tiers side-by-side with the recommended tier highlighted.
// Becomes page 2 of the customer proposal when spec.tiers is present.

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$, fmtNum } from '../proposalData.js';

function tierCard(t) {
  const isRec = t.is_recommended === true;
  const ringClass = isRec ? 'ring-2 ring-amber-500' : 'ring-1 ring-slate-200';
  return `<div class="tier-card${isRec ? ' tier-card-recommended' : ''}">
    ${isRec ? `<div class="tier-ribbon">★ RECOMMENDED</div>` : ''}
    <div class="tier-name">${t.label}</div>

    <div class="tier-price">
      <div class="tier-price-amount">${fmt$(t.pricing.customer_inc_gst)}</div>
      <div class="tier-price-sub">inc GST · installed${
        t.pricing.discount_inc_gst > 0
          ? ` · ${t.pricing.discount_pct_of_list}% off list`
          : ''
      }</div>
    </div>

    <ul class="tier-specs">
      <li><span class="lbl">Solar</span><span class="val">${t.system.kw} kW · ${t.system.panels} panels</span></li>
      <li><span class="lbl">Battery</span><span class="val">${
        t.system.battery_kwh > 0 ? `${t.system.battery_kwh} kWh` : '—'
      }</span></li>
      ${t.system.wattpilot_included ? `<li><span class="lbl">EV charger</span><span class="val">Wattpilot 11 kW</span></li>` : ''}
    </ul>

    <hr class="tier-divider" />

    <ul class="tier-financials">
      <li><span class="lbl">Year-1 savings</span><span class="val">${fmt$(t.headline_savings_yr1 || 0)}</span></li>
      <li><span class="lbl">Payback</span><span class="val">${t.headline_payback_yrs || '—'} yrs</span></li>
      <li><span class="lbl">30-yr net (Expected)</span><span class="val">${fmt$(t.headline_30yr_net || 0)}</span></li>
      <li><span class="lbl">IRR / annualised return</span><span class="val">${t.headline_irr_pct || '—'}%</span></li>
    </ul>
  </div>`;
}

export function pageThreeTierComparison(d, sectionNum, sectionsTotal) {
  const tiers = d.tiers || [];
  const recLabel = d.recommended_tier_label || 'the recommended option';

  return `<section class="page">
    ${pageHead(d, 'Your options — three packages at a glance')}

    <div class="page-content-grow">
      <h2>Three packages — pick what fits</h2>
      <p>Each option below covers your full ${fmtNum(d.bills.annual_kwh)} kWh / year usage.
      We differentiate by <b>battery size, backup capability, and future-load readiness</b>
      — never by under-sizing the solar.</p>

      <p style="font-size:10px;color:#5C6470;margin-top:2px">
        The rest of this proposal goes into the detail of <b>${recLabel}</b>
        (our recommendation). The other two stay as alternatives you can pick instead.
      </p>

      <div class="tier-grid">
        ${tiers.map(tierCard).join('')}
      </div>

      <div class="tier-fineprint">
        <p>Savings, payback and IRR are based on the <b>Expected scenario</b> (5% energy inflation,
        0.4%/yr panel degradation, current buyback curve). The full <b>Conservative / Expected /
        Optimistic</b> range is on the Financial Outlook page later in this proposal — those numbers
        reflect <b>${recLabel}</b> specifically; equivalent ranges for the other tiers are available
        on request.</p>
        <p>All prices in NZD inclusive of 15% GST, installed. Final pricing confirmed at Stage 2 (site survey).</p>
      </div>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

// CSS this page injects — added to PROPOSAL_CSS by _shared.js
export const TIER_COMPARISON_CSS = `
  .tier-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
  .tier-grid:has(.tier-card:nth-child(2):last-child){grid-template-columns:repeat(2,1fr)}
  .tier-grid:has(.tier-card:only-child){grid-template-columns:1fr}

  .tier-card{position:relative;border:1.5px solid #D9DCE1;border-radius:10px;padding:14px;background:#fff;display:flex;flex-direction:column}
  .tier-card-recommended{border:2.5px solid #FF6A00;background:linear-gradient(180deg,#fff,#fff7ed);box-shadow:0 4px 12px rgba(255,106,0,.10)}
  .tier-ribbon{position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:#FF6A00;color:#fff;font-size:9px;font-weight:900;padding:2px 10px;border-radius:4px;letter-spacing:.5px;white-space:nowrap}
  .tier-name{font-size:14px;font-weight:800;color:#0B0F1A;text-align:center;margin-top:4px}
  .tier-price{margin-top:10px;padding:8px 0;border-top:1px solid #E5E7EB;border-bottom:1px solid #E5E7EB;text-align:center}
  .tier-price-amount{font-size:22px;font-weight:900;letter-spacing:-0.6px;color:#92400e}
  .tier-card-recommended .tier-price-amount{color:#FF6A00}
  .tier-price-sub{font-size:9px;color:#5C6470;margin-top:1px}
  .tier-specs,.tier-financials{list-style:none;padding:0;margin:10px 0 0;font-size:10px;display:flex;flex-direction:column;gap:5px}
  .tier-specs li,.tier-financials li{display:flex;justify-content:space-between;align-items:baseline;gap:6px}
  .tier-specs .lbl,.tier-financials .lbl{color:#5C6470}
  .tier-specs .val,.tier-financials .val{font-weight:700;color:#0B0F1A;text-align:right}
  .tier-divider{border:none;border-top:1px dashed #E5E7EB;margin:10px 0 0}
  .tier-fineprint{margin-top:18px;font-size:9.5px;color:#5C6470;line-height:1.5}
  .tier-fineprint p{margin:4px 0}
`;
