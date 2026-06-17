// Page — Environmental impact
//
// Derived: lifetime kWh × NZ grid emission factor → CO2 saved.
// Equivalents: trees planted, cars off road, AKL→LON return flights.

import { pageHead, pageFoot } from '../_shared.js';
import { fmtNum } from '../proposalData.js';

export function pageEnvironmentalImpact(d, sectionNum, sectionsTotal) {
  const e = d.insights?.environmental;
  if (!e) return '';

  // Convert kg → tonnes for the headline
  const lifetimeTonnesCo2 = (e.lifetime_co2_kg / 1000).toFixed(1);

  return `<section class="page">
    ${pageHead(d, 'Environmental impact')}

    <div class="page-content-grow">
      <p style="font-size:11px;color:#5C6470;margin:0 0 18px">
        Beyond the money, your system displaces grid electricity — most of which still comes
        from a mix of hydro, gas, and coal. Here's what 25 years of clean generation looks
        like in tangible terms.
      </p>

      <div style="background:linear-gradient(135deg,#ECFDF5,#F0FDF4);border:1px solid #BBF7D0;border-radius:8px;padding:18px;margin-bottom:18px;text-align:center">
        <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;color:#15803D;font-weight:700;margin-bottom:6px">
          Lifetime CO₂ avoided (25 years)
        </div>
        <div style="font-size:36px;font-weight:800;color:#14532D;line-height:1">
          ${lifetimeTonnesCo2}<span style="font-size:18px;margin-left:4px">tonnes</span>
        </div>
        <div style="font-size:11px;color:#166534;margin-top:4px">
          ${fmtNum(e.lifetime_kwh)} kWh of clean generation displacing grid electricity
        </div>
      </div>

      <h3 style="font-size:13px;margin:0 0 10px;color:#0B0F1A">In equivalents</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px">

        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:6px;padding:12px;text-align:center">
          <div style="font-size:28px;line-height:1">🌳</div>
          <div style="font-size:18px;font-weight:800;color:#0B0F1A;margin-top:6px;line-height:1">
            ${fmtNum(e.equiv_trees)}
          </div>
          <div style="font-size:10px;color:#5C6470;margin-top:3px;line-height:1.3">
            mature trees absorbing CO₂ for a year
          </div>
        </div>

        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:6px;padding:12px;text-align:center">
          <div style="font-size:28px;line-height:1">🚗</div>
          <div style="font-size:18px;font-weight:800;color:#0B0F1A;margin-top:6px;line-height:1">
            ${fmtNum(e.equiv_cars_off_road_years)}
          </div>
          <div style="font-size:10px;color:#5C6470;margin-top:3px;line-height:1.3">
            average NZ car taken off the road for a year
          </div>
        </div>

        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:6px;padding:12px;text-align:center">
          <div style="font-size:28px;line-height:1">✈️</div>
          <div style="font-size:18px;font-weight:800;color:#0B0F1A;margin-top:6px;line-height:1">
            ${fmtNum(e.equiv_flights_AKL_LON)}
          </div>
          <div style="font-size:10px;color:#5C6470;margin-top:3px;line-height:1.3">
            Auckland → London return flights avoided
          </div>
        </div>

      </div>

      <h3 style="font-size:13px;margin:0 0 8px;color:#0B0F1A">Generation milestones</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px">
        <tbody>
          <tr style="border-bottom:1px solid #E5E7EB">
            <td style="padding:6px 0;color:#5C6470">Year-1 generation</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:#0B0F1A">${fmtNum(e.yr1_kwh_generated)} kWh</td>
          </tr>
          <tr style="border-bottom:1px solid #E5E7EB">
            <td style="padding:6px 0;color:#5C6470">25-year lifetime generation</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:#0B0F1A">${fmtNum(e.lifetime_kwh)} kWh</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#5C6470">Annual CO₂ saved (Year-1)</td>
            <td style="padding:6px 0;text-align:right;font-weight:700;color:#0B0F1A">${fmtNum(Math.round(e.yr1_kwh_generated * 0.085))} kg</td>
          </tr>
        </tbody>
      </table>

      <p style="font-size:10px;color:#6B7280;font-style:italic;line-height:1.5">
        Emission factor: 0.085 kg CO₂ / kWh — NZ MBIE 2024 average grid intensity.
        Tree equivalent: 22 kg CO₂/yr absorbed by a typical mature tree.
        Car equivalent: 4,600 kg CO₂/yr from an average NZ petrol vehicle.
        Flight equivalent: ~3,500 kg CO₂ for a return economy AKL→LON.
      </p>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
