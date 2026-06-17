// Page — Typical days across the year (usage patterns)
//
// Surfaces bill_analyses.patterns[] — usage patterns the bill engine
// detected (e.g. winter_spike, high_baseline, weekend_heavy). Each pattern
// carries a label, details paragraph, severity flag, and a recommendation.

import { pageHead, pageFoot } from '../_shared.js';

const SEVERITY_STYLE = {
  info:    { border: '#0EA5E9', bg: '#F0F9FF', text: '#0C4A6E', tag: 'INSIGHT'  },
  warn:    { border: '#F59E0B', bg: '#FFFBEB', text: '#78350F', tag: 'WORTH WATCHING' },
  alert:   { border: '#DC2626', bg: '#FEF2F2', text: '#7F1D1D', tag: 'NEEDS ATTENTION' },
};

export function pagePatternsAcrossYear(d, sectionNum, sectionsTotal) {
  const patterns = d.insights?.patterns;
  if (!patterns || patterns.length === 0) return '';

  const cards = patterns.map(p => {
    const style = SEVERITY_STYLE[p.severity] || SEVERITY_STYLE.info;
    return `
      <div style="border-left:4px solid ${style.border};background:${style.bg};padding:12px 14px;border-radius:4px;margin-bottom:12px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:5px">
          <div style="font-size:12.5px;font-weight:700;color:${style.text};line-height:1.3">
            ${escapeHtml(p.label || p.code)}
          </div>
          <span style="font-size:8.5px;letter-spacing:.5px;font-weight:700;color:${style.text};opacity:.8">
            ${style.tag}
          </span>
        </div>
        <div style="font-size:11px;color:${style.text};line-height:1.5;margin-bottom:${p.recommendation ? '8px' : '0'}">
          ${escapeHtml(p.details || '')}
        </div>
        ${p.recommendation ? `
          <div style="font-size:10.5px;color:${style.text};padding-top:6px;border-top:1px dashed ${style.border};opacity:.85">
            <b>What we'd suggest:</b> ${escapeHtml(p.recommendation)}
          </div>` : ''}
      </div>`;
  }).join('');

  return `<section class="page">
    ${pageHead(d, 'Typical days across the year')}

    <div class="page-content-grow">
      <p style="font-size:11px;color:#5C6470;margin:0 0 14px">
        Your bills tell a story about HOW you use power — when, why, and whether anything
        unusual stands out. Here's what the engine flagged from your 12 months of data.
      </p>

      ${cards}

      <div style="margin-top:20px;padding:11px 13px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:4px;font-size:10.5px;color:#5C6470;line-height:1.6">
        These observations come from comparing your monthly kWh + spend against typical NZ
        residential patterns. They don't change the system we've recommended — they're
        context to make sure your solar design + sizing matches how you actually live.
      </div>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
