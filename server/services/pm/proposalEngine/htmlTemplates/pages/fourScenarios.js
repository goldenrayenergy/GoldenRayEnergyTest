// Page — Four typical scenarios across the day (Phase H5)
//
// Conceptual: 4 cards showing how the hybrid inverter routes energy between
// home, battery, solar, and grid throughout a typical day. Matches the v2
// Krishna mockup design with HOME / BATTERY / SOLAR / GRID icon grids,
// a flow-arrows summary, and a per-scenario paragraph.

import { pageHead, pageFoot } from '../_shared.js';

// Each card varies by:
//   • whether battery is included (affects "Generating Excess Solar" + later cards)
//   • whether wattpilot adds to home loads
const SCENARIOS = [
  {
    title: 'Morning Off-Peak',
    nodes: [
      { icon: '🏠', label: 'HOME' },
      { icon: '🔋', label: 'BATTERY' },
      { icon: '☀️', label: 'SOLAR' },
      { icon: '⚡', label: 'GRID' },
    ],
    arrows: 'Grid → Home · Solar warming up',
    body: (ctx) => `Before the sun is strong, the home draws from the grid (or, with a smart tariff, from a low-cost morning rate)${ctx.hasBattery ? '. The battery has been depleted overnight.' : '.'}`,
  },
  {
    title: 'Generating Excess Solar',
    nodes: [
      { icon: '🏠', label: 'HOME' },
      { icon: '🔋', label: 'BATTERY' },
      { icon: '☀️', label: 'SOLAR' },
      { icon: '⚡', label: 'GRID' },
    ],
    arrows: (ctx) => ctx.hasBattery
      ? 'Solar → Home + Battery + Grid'
      : 'Solar → Home + Grid',
    body: (ctx) => ctx.hasBattery
      ? 'Midday: solar generation peaks. Surplus first charges the battery, then exports any remainder to the grid at the buyback rate.'
      : 'Midday: solar generation peaks. After running your home loads, the surplus exports to the grid at the buyback rate.',
  },
  {
    title: ctx => ctx.hasBattery ? 'Partially Offset Usage' : 'Late Afternoon',
    nodes: [
      { icon: '🏠', label: 'HOME' },
      { icon: '🔋', label: 'BATTERY' },
      { icon: '☀️', label: 'SOLAR' },
      { icon: '⚡', label: 'GRID' },
    ],
    arrows: (ctx) => ctx.hasBattery
      ? 'Solar + Battery → Home'
      : 'Solar + Grid → Home',
    body: (ctx) => ctx.hasBattery
      ? 'Late afternoon: solar tapers. The battery starts discharging to cover the gap — your home runs entirely on stored sunshine.'
      : 'Late afternoon: solar tapers. As generation falls below your home use, the gap is filled by the grid.',
  },
  {
    title: 'Night / Peak Times',
    nodes: [
      { icon: '🏠', label: 'HOME' },
      { icon: '🔋', label: 'BATTERY' },
      { icon: '☀️', label: 'SOLAR' },
      { icon: '⚡', label: 'GRID' },
    ],
    arrows: (ctx) => ctx.hasBattery
      ? 'Battery → Home · Grid only if depleted'
      : 'Grid → Home (full evening load)',
    body: (ctx) => ctx.hasBattery
      ? 'Evening peak (5–9 PM): the battery discharges to power dinner, TV, hot water. Only if the battery runs out does the home pull from the grid at peak rates.'
      : 'Evening peak (5–9 PM): without a battery, the home draws full power from the grid at peak rates. (A battery would shift this load to stored solar.)',
  },
];

export function pageFourScenarios(d, sectionNum, sectionsTotal) {
  const ctx = {
    hasBattery: !!d.hardware?.battery,
    hasWattpilot: !!d.system?.wattpilot_included,
  };

  const cards = SCENARIOS.map(s => {
    const title = typeof s.title === 'function' ? s.title(ctx) : s.title;
    const arrows = typeof s.arrows === 'function' ? s.arrows(ctx) : s.arrows;
    const body = typeof s.body === 'function' ? s.body(ctx) : s.body;
    const nodes = s.nodes.map(n => `
      <div class="hiw-node"><span class="icon">${n.icon}</span><span class="lbl">${n.label}</span></div>
    `).join('');
    return `
      <div class="hiw">
        <div class="hiw-title">${escapeHtml(title)}</div>
        <div class="hiw-diagram">
          ${nodes}
        </div>
        <div class="hiw-arrows">${escapeHtml(arrows)}</div>
        <div class="small" style="margin-top:4px;font-size:9px;line-height:1.45">${escapeHtml(body)}</div>
      </div>`;
  }).join('');

  return `<section class="page">
    ${pageHead(d, 'How Your System Works')}

    <h2>Four typical scenarios across the day</h2>
    <p class="small">Your hybrid inverter automatically routes energy between your panels, ${ctx.hasBattery ? 'battery, ' : ''}home and the grid — always prioritising the cheapest path. The following illustrates typical system operation in each scenario:</p>

    <div class="hiw-grid" style="margin-top:10px">
      ${cards}
    </div>

    <p class="small" style="margin-top:14px;color:#5C6470;font-style:italic">For the hour-by-hour shape of solar generation, ${ctx.hasBattery ? 'battery charge/discharge ' : ''}and grid interaction across typical summer and winter days, see the <b>Daily Energy Flows</b> page.</p>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
