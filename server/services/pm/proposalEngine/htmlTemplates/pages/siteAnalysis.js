// ────────────────────────────────────────────────────────────────────────────
// Page — Your Roof Assessment (customer-facing site analysis)
//
// Google Solar API auto-analysis surfaced to the customer as a proposal page.
// Follows the same "return '' when data missing" pattern as other insight
// pages — the page drops out of the PDF (with automatic section renumbering)
// when d.roof_analysis is null OR when status != 'ok'.
//
// We deliberately omit failed/skipped_* states from the customer PDF to
// avoid an awkward "we tried but couldn't analyse your roof" surface. The
// engineer-facing SiteSurveySection UI DOES render those states so internal
// staff can act on them.
//
// Position in the proposal (registered in customerProposal.js): BEFORE the
// System Summary page so the narrative flow reads "here's your roof →
// therefore here's the system we recommend".
// ────────────────────────────────────────────────────────────────────────────

import { pageHead, pageFoot } from '../_shared.js';

export function pageSiteAnalysis(d, sectionNum, sectionsTotal) {
  const a = d.roof_analysis;
  if (!a || a.status !== 'ok') return '';

  const panelsMax = a.max_array_panels_count;
  const sunshineHrs = a.max_sunshine_hours_per_year != null
    ? Math.round(a.max_sunshine_hours_per_year)
    : null;
  const areaM2 = a.max_array_area_m2 != null
    ? Number(a.max_array_area_m2).toFixed(1)
    : null;
  const segCount = Array.isArray(a.roof_segments) ? a.roof_segments.length : 0;

  const qualityLabel = customerFriendlyQuality(a.imagery_quality);
  const imageryDatePhrase = a.imagery_date
    ? ` captured ${formatMonthYear(a.imagery_date)}`
    : '';

  // Compute the best segment's orientation compass-name for the copy —
  // only if we can read pitch/azimuth from at least one segment.
  const bestSegment = pickBestSegment(a.roof_segments);
  const bestOrientationLine = bestSegment
    ? `The most productive facing on your roof is <b>${compassFromAzimuth(bestSegment.azimuthDegrees)}</b> at approximately <b>${Math.round(bestSegment.pitchDegrees)}° pitch</b> — well-suited to solar generation in New Zealand.`
    : '';

  return `<section class="page">
    ${pageHead(d, 'Your roof assessment')}

    <div class="page-content-grow">
      <div class="customer-strip">
        <div>
          <div class="name">${d.customer.name}</div>
          <div class="addr">${d.customer.address_one_line}${d.customer.icp ? ' · ICP ' + d.customer.icp : ''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#5C6470">Quote ${d.meta.quote_ref}</div>
          <div style="font-size:11px;color:#5C6470">${d.meta.quote_date}</div>
        </div>
      </div>

      <h2>What we found on your roof</h2>
      <p>
        We analysed your property using <b>${qualityLabel} aerial imagery</b>${imageryDatePhrase}
        to inform this proposal. This lets us estimate the maximum system size that will fit and
        the sunshine your roof receives before we visit the site.
      </p>

      <div class="grid4" style="margin-top:12px">
        <div class="card kpi">
          <div class="lbl">Usable roof segments</div>
          <div class="val">${segCount}</div>
          <div class="sub">separate facings identified</div>
        </div>
        <div class="card kpi">
          <div class="lbl">Max panels that fit</div>
          <div class="val">${panelsMax ?? '—'}</div>
          <div class="sub">upper bound before shading</div>
        </div>
        <div class="card kpi">
          <div class="lbl">Total usable roof area</div>
          <div class="val">${areaM2 ?? '—'}</div>
          <div class="sub">square metres</div>
        </div>
        <div class="card kpi">
          <div class="lbl">Annual sunshine</div>
          <div class="val">${sunshineHrs ?? '—'}</div>
          <div class="sub">hours per year at this site</div>
        </div>
      </div>

      ${bestOrientationLine ? `<p style="margin-top:14px">${bestOrientationLine}</p>` : ''}

      <h3 style="margin-top:14px">How this shaped your proposal</h3>
      <p>
        The system we recommend on the next page sits well within these limits — leaving room
        for future expansion if your energy needs grow. Final placement is confirmed at the
        pre-install site survey, where our engineer accounts for any shading, obstructions or
        structural constraints not visible from aerial imagery.
      </p>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Google's HIGH / MEDIUM / LOW isn't customer-meaningful. Translate to
// friendly phrasing while staying honest — LOW imagery IS lower resolution
// and a customer should know a site visit will refine the analysis.
function customerFriendlyQuality(q) {
  const s = String(q || '').toUpperCase();
  if (s === 'HIGH')   return 'high-resolution';
  if (s === 'MEDIUM') return 'standard-resolution';
  if (s === 'LOW')    return 'aerial';
  return 'aerial';
}

function formatMonthYear(isoDate) {
  if (!isoDate) return '';
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

// Pick the roof segment with the biggest usable area — that's the one the
// customer's "best facing" copy should refer to. Falls back to null if
// segments are empty or malformed.
function pickBestSegment(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const withArea = segments.filter(s =>
    typeof s?.stats?.areaMeters2 === 'number' &&
    typeof s?.pitchDegrees === 'number' &&
    typeof s?.azimuthDegrees === 'number'
  );
  if (withArea.length === 0) return null;
  return withArea.reduce((best, cur) =>
    cur.stats.areaMeters2 > best.stats.areaMeters2 ? cur : best,
    withArea[0]
  );
}

// Azimuth is degrees clockwise from north. 0 = N, 90 = E, 180 = S, 270 = W.
// Return the nearest 8-compass point.
function compassFromAzimuth(deg) {
  if (typeof deg !== 'number' || Number.isNaN(deg)) return 'unspecified';
  const normalised = ((deg % 360) + 360) % 360;
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(normalised / 45) % 8;
  return points[idx];
}
