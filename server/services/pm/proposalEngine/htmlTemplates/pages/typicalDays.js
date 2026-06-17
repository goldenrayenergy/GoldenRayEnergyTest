// Page — Daily Energy Flows / Typical days across the year (Phase H5)
//
// 2×2 grid of stacked-area charts matching the v2 Krishna mockup:
//   • Summer Weekday / Weekend (Dec–Feb)
//   • Winter Weekday / Weekend (Jun–Aug)
//
// Each chart shows hour-by-hour:
//   • Solar generation (yellow, above 0)
//   • Battery charge above 0 / discharge below 0 (blue)
//   • Home consumption (grey, plotted below 0)
//   • Export to grid (red, above 0 — solar surplus after battery + home)
//
// Time axis: 4am, 8am, 12pm, 4pm, 8pm (showing daylight + evening window).
// Y-axis: -ymax..+ymax kW, auto-scaled per chart (~4 kW summer, ~2 kW winter).

import { pageHead, pageFoot } from '../_shared.js';
import { monitoringPortalForBrand } from '../proposalData.js';

const CHART_W = 320;
const CHART_H = 130;
const PAD = { left: 32, right: 8, top: 16, bottom: 26 };
const PLOT_W = CHART_W - PAD.left - PAD.right;
const PLOT_H = CHART_H - PAD.top - PAD.bottom;

// X axis: show 4am→8pm window (16 hours). Each chart has 5 tick marks:
// 4am, 8am, 12pm, 4pm, 8pm. So 4 segments → 4 hours per segment.
const X_WINDOW_START = 4;
const X_WINDOW_END = 20;
const X_RANGE = X_WINDOW_END - X_WINDOW_START;

function xFor(hour) {
  // Clamp to window
  const clamped = Math.max(X_WINDOW_START, Math.min(X_WINDOW_END, hour));
  return PAD.left + ((clamped - X_WINDOW_START) / X_RANGE) * PLOT_W;
}

function chart(day) {
  if (!day) return '';
  const { hours, summary, label } = day;

  // Build the windowed series (only 4am-8pm hours plus boundary endpoints)
  const series = hours.filter(h => h.hour >= X_WINDOW_START - 1 && h.hour <= X_WINDOW_END);

  // Auto-scale Y: max of generation, |consumption|, |battery|, export
  const maxAbs = Math.max(
    ...hours.map(h => Math.max(h.gen_kw, h.use_kw, Math.abs(h.batt_kw),
                                Math.max(0, -h.grid_kw))),
    0.5
  );
  // Nice round number — 2, 3, 4, 5, 6, 8, 10
  const yNice = [2, 3, 4, 5, 6, 8, 10].find(v => v >= maxAbs) || 12;

  // Y scaling: 0 sits at the chart midline. Above 0 = generation, battery
  // charge (negative batt_kw becomes positive above 0… we'll plot
  // batt_kw>0 (discharge) as negative for intuition: contribution to home).
  //
  // Mockup visual interpretation:
  //   gen      → positive area above 0
  //   battery  → +kW (charging, above 0) or -kW (discharging, below 0)
  //   home use → below 0 (always negative)
  //   export   → positive area above 0 (red, stacked on solar surplus)
  //
  // In dailyProfile.js we encoded:
  //   gen_kw   ≥ 0
  //   use_kw   ≥ 0 (we'll plot as -use_kw)
  //   batt_kw  >0 = discharging (home consumption helped by battery)
  //          <0 = charging (battery soaking up solar excess)
  //         → plot as is: charging above 0, discharging below 0
  //         Wait — in dailyProfile resolveBatteryAndGrid: + drain (discharge), - charge.
  //         So flip sign for chart: chart_batt = -batt_kw (charging > 0, discharging < 0)
  //   grid_kw >0 = import (we'll plot as -grid; grid drawn at the same level as home use, below)
  //          <0 = export → plot positive

  const yFor = v => PAD.top + PLOT_H / 2 - (v / yNice) * (PLOT_H / 2);

  // Generation area (yellow) — above zero
  const genPts = series.map(h => `${xFor(h.hour)},${yFor(h.gen_kw)}`);
  const genArea = `M${xFor(series[0]?.hour ?? X_WINDOW_START)},${yFor(0)} ${
    genPts.map(p => `L${p}`).join(' ')
  } L${xFor(series[series.length - 1]?.hour ?? X_WINDOW_END)},${yFor(0)} Z`;

  // Battery area: chart_batt = -batt_kw → charging is positive, discharging negative
  const battPts = series.map(h => `${xFor(h.hour)},${yFor(-h.batt_kw)}`);
  const battArea = `M${xFor(series[0]?.hour ?? X_WINDOW_START)},${yFor(0)} ${
    battPts.map(p => `L${p}`).join(' ')
  } L${xFor(series[series.length - 1]?.hour ?? X_WINDOW_END)},${yFor(0)} Z`;

  // Home consumption area — plotted as negative
  const usePts = series.map(h => `${xFor(h.hour)},${yFor(-h.use_kw)}`);
  const useArea = `M${xFor(series[0]?.hour ?? X_WINDOW_START)},${yFor(0)} ${
    usePts.map(p => `L${p}`).join(' ')
  } L${xFor(series[series.length - 1]?.hour ?? X_WINDOW_END)},${yFor(0)} Z`;

  // Export — only the portion of grid_kw that's negative (= exporting)
  // Plotted positive above 0; stacked visually on the solar area
  const exportPts = series.map(h => `${xFor(h.hour)},${yFor(Math.max(0, -h.grid_kw))}`);
  const exportArea = `M${xFor(series[0]?.hour ?? X_WINDOW_START)},${yFor(0)} ${
    exportPts.map(p => `L${p}`).join(' ')
  } L${xFor(series[series.length - 1]?.hour ?? X_WINDOW_END)},${yFor(0)} Z`;

  return `
    <div style="border:1px solid #E5E7EB;border-radius:6px;padding:8px 10px;background:#fff">
      <div style="font-size:10px;font-weight:700;color:#0B0F1A;margin-bottom:4px">${label}</div>
      <svg viewBox="0 0 ${CHART_W} ${CHART_H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
        <!-- Zero line -->
        <line x1="${PAD.left}" y1="${yFor(0)}" x2="${PAD.left + PLOT_W}" y2="${yFor(0)}"
              stroke="#9CA3AF" stroke-width="0.8"/>
        <!-- Y-axis labels -->
        <text x="${PAD.left - 3}" y="${yFor(yNice) + 4}" text-anchor="end" font-size="8" fill="#6B7280">${yNice.toFixed(1)}</text>
        <text x="${PAD.left - 3}" y="${yFor(0) + 3}" text-anchor="end" font-size="8" fill="#6B7280">0</text>
        <text x="${PAD.left - 3}" y="${yFor(-yNice) + 4}" text-anchor="end" font-size="8" fill="#6B7280">-${yNice.toFixed(1)}</text>
        <!-- Solar generation (yellow) -->
        <path d="${genArea}" fill="#FBBF24" opacity="0.65"/>
        <!-- Export to grid (red, stacked above solar visually — drawn after gen) -->
        <path d="${exportArea}" fill="#EF4444" opacity="0.75"/>
        <!-- Battery (blue) — above 0 = charging, below = discharging -->
        <path d="${battArea}" fill="#3B82F6" opacity="0.55"/>
        <!-- Home consumption (grey) — below 0 -->
        <path d="${useArea}" fill="#9CA3AF" opacity="0.55"/>
        <!-- X-axis labels -->
        <text x="${xFor(4)}"  y="${CHART_H - 4}" text-anchor="middle" font-size="8" fill="#6B7280">4am</text>
        <text x="${xFor(8)}"  y="${CHART_H - 4}" text-anchor="middle" font-size="8" fill="#6B7280">8am</text>
        <text x="${xFor(12)}" y="${CHART_H - 4}" text-anchor="middle" font-size="8" fill="#6B7280">12pm</text>
        <text x="${xFor(16)}" y="${CHART_H - 4}" text-anchor="middle" font-size="8" fill="#6B7280">4pm</text>
        <text x="${xFor(20)}" y="${CHART_H - 4}" text-anchor="middle" font-size="8" fill="#6B7280">8pm</text>
        <!-- Axis hints -->
        <text x="${PAD.left + 2}" y="${PAD.top - 4}" font-size="7.5" fill="#9CA3AF">↑ Gen (kW)</text>
        <text x="${PAD.left + 2}" y="${PAD.top + PLOT_H + 12}" font-size="7.5" fill="#9CA3AF">↓ Use (kW)</text>
      </svg>
    </div>`;
}

export function pageTypicalDays(d, sectionNum, sectionsTotal) {
  const td = d.insights?.typical_days;
  if (!td) return '';

  // Pull the 4 day-types in the right order — fall back to the older
  // sunny/cloudy keys if dailyProfile.js hasn't been updated to weekday/weekend.
  const sw = td.summer_weekday || td.summer_sunny;
  const sx = td.summer_weekend || td.summer_cloudy;
  const ww = td.winter_weekday || td.winter_sunny;
  const wx = td.winter_weekend || td.winter_cloudy;

  return `<section class="page">
    ${pageHead(d, 'Daily Energy Flows — Detailed')}

    <h2>Typical days across the year</h2>
    <p class="small">These charts show the <b>typical hour-by-hour shape</b> of the interaction between your panels${d.hardware?.battery ? ', battery' : ''}, home and grid for four representative day types. The <b>shape</b> (when solar peaks${d.hardware?.battery ? ', when battery charges/discharges' : ''}, when grid is drawn) is accurate to NZ residential physics for a ${d.system?.kw || '?'} kW${d.hardware?.battery ? ' + battery' : ''} system. The <b>exact hourly kW values</b> are not derived from your bill data — most NZ residential bills only show monthly totals, not half-hourly profiles. If you'd like personalised hour-by-hour modelling, the ${d.hardware?.smart_meter?.brand || ''} ${d.hardware?.smart_meter?.name || 'smart meter'} we install at Stage 2 will start logging your real profile from day 1 (visible in the ${monitoringPortalForBrand(d.hardware?.inverter?.brand).app}).</p>

    <div class="flow-legend" style="margin-top:10px">
      <span><span class="sw" style="background:#FBBF24"></span> Solar generation</span>
      <span><span class="sw" style="background:#3B82F6"></span> Battery charge (above 0) / discharge (below 0)</span>
      <span><span class="sw" style="background:#9CA3AF"></span> Home consumption (below 0)</span>
      <span><span class="sw" style="background:#EF4444"></span> Export to grid</span>
    </div>

    <div class="grid2" style="margin-top:8px">
      ${chart(sw)}
      ${chart(sx)}
    </div>
    <div class="grid2" style="margin-top:10px">
      ${chart(ww)}
      ${chart(wx)}
    </div>

    <h3 style="margin-top:14px">What this tells you</h3>
    <ul style="margin:4px 0 0 16px;padding:0;font-size:10px;line-height:1.6">
      <li><b>Summer weekdays:</b> with the family out during the day, surplus solar charges the battery by mid-morning and exports significant kWh from 11am–3pm. The battery covers most of the evening cooking + entertainment peak.</li>
      <li><b>Summer weekends:</b> higher daytime use (washing, cooking, kids home) means less export and the battery may end the day partly discharged${d.hardware?.battery ? ' — still no grid import in most cases' : ''}.</li>
      <li><b>Winter weekdays:</b> shorter sun hours + heat-pump load means the battery rarely fully charges. You'll draw from the grid late evening when stored solar runs out — but this is the minority of your annual kWh.</li>
      <li><b>Winter weekends:</b> the toughest scenario for the system. Plan to run dishwasher / washing during midday solar generation to maximise self-consumption.</li>
    </ul>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
