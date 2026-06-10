// Page — Financial outlook (Conservative / Expected / Optimistic)
//
// THE credibility page. Shows three scenarios side-by-side instead of a single
// 30-year projection, so customers see the range rather than just the best
// case. Expected column is highlighted as "recommended" planning case.

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$ } from '../proposalData.js';

const r0 = n => Math.round(n);

function scenarioCol(s, isExpected) {
  const classes = `scenario-col${isExpected ? ' expected' : ''}`;
  return `<div class="${classes}">
    ${isExpected ? `<div class="ribbon">★ RECOMMENDED PLANNING CASE</div>` : ''}
    <div class="scenario-name">${s.label}</div>
    <div class="scenario-desc">${s.description}</div>

    <div class="metric">
      <div class="metric-lbl">30-year net savings</div>
      <div class="metric-val big">${fmt$(s.lifetime_net_savings)}</div>
    </div>

    <div class="metric">
      <div class="metric-lbl">Year-1 savings</div>
      <div class="metric-val">${fmt$(s.yr1_savings)}</div>
    </div>

    <div class="metric">
      <div class="metric-lbl">Payback</div>
      <div class="metric-val">${s.payback_yrs} yrs</div>
    </div>

    <div class="metric">
      <div class="metric-lbl">Total return on investment</div>
      <div class="metric-val">${s.total_roi_pct}%</div>
    </div>

    <div class="metric">
      <div class="metric-lbl">Annualised return (IRR)</div>
      <div class="metric-val">${s.irr_pct}%</div>
    </div>

    <div class="scenario-assumes">
      <b>Assumes:</b><br/>
      • Energy inflation ${s.energy_inflation_pct}% / yr<br/>
      • Panel degradation ${s.panel_degradation_pct}% / yr
    </div>
  </div>`;
}

export function pageFinancialOutlook(d, sectionNum, sectionsTotal) {
  const cons = d.scenarios.summary.find(s => s.key === 'conservative');
  const exp = d.scenarios.summary.find(s => s.key === 'expected');
  const opt = d.scenarios.summary.find(s => s.key === 'optimistic');

  return `<section class="page">
    ${pageHead(d, 'Your financial outlook — three scenarios')}

    <div class="page-content-grow">
      <h2>Three scenarios — your savings outlook over 30 years</h2>
      <p>Single-number projections sound impressive but rarely tell the full story.
      We show you the same system under three sets of assumptions so you can plan
      with a realistic range. The middle column — <b>Expected</b> — is what we use
      throughout the rest of this proposal.</p>

      <div class="scenario-grid">
        ${scenarioCol(cons, false)}
        ${scenarioCol(exp, true)}
        ${scenarioCol(opt, false)}
      </div>

      <h3 style="margin-top:18px">What's the same across all three scenarios?</h3>
      <p>Your <b>system cost</b>, your <b>regional solar yield</b> (${d.system.yield_kwh_per_kwp || 'NIWA average'} kWh per kWp per year, from official data), your
      <b>current bill</b>, and the <b>hardware specs</b>. These are knowns — not predictions. The differences
      between scenarios reflect uncertainty in the <i>future</i>: how fast electricity prices rise, how
      panels age, and how buyback rates change.</p>

      <h3 style="margin-top:14px">Why we show this</h3>
      <p>NZ financial-adviser convention is to show ranges, not point estimates. We follow the same approach.
      If our <b>Conservative</b> projection still makes financial sense for you, the upside above that is real
      additional value — not the headline number we hope to hit.</p>

      <div class="disclaimer">All scenarios use today's GST rate (15%), present-day catalogue pricing, and your bill data
      as supplied. Actual buyback rates, retailer plans, and energy prices are out of Goldenray's control. We do not
      guarantee any projection — these are forecasts based on disclosed assumptions, not financial advice.</div>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
