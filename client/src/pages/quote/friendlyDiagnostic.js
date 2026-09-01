// Pure-JS helper that translates roof-analysis error signals into a
// customer-friendly sentence. Extracted from Step3Analysis.jsx so it can
// run under Node for unit tests (`.jsx` isn't Node-importable).
//
// Signals it considers, in priority order:
//   1. `rawError` string — HTTP-level error body (P4 fix 2026-08-31 for
//      Hira addresses which surface as `{error: "N points above..."}`
//      with NO roof_analysis_diagnostics payload).
//   2. `diagnostics.fallback_reason` — server-side categorised reasons.
//   3. `diagnostics.lidar_error` — sub-signal inside both_pipelines_failed.
//
// Returns null when no rule matches; caller shows the generic fallback.
export function friendlyDiagnostic(d, rawError) {
  const errStr = typeof rawError === 'string' ? rawError : '';
  if (errStr) {
    if (/\d+\s*points?\s*above/i.test(errStr)
        || /RANSAC detected no roof planes/i.test(errStr)
        || /LiDAR.*failed/i.test(errStr)) {
      return 'This address is outside our automatic-analysis coverage — public roof-imagery data for this area isn’t detailed enough. A technician site visit is the accurate path to a quote here, and often faster than we can do online for rural properties.';
    }
  }
  if (!d) return null;
  if (d.fallback_reason === 'daily_quote_limit') {
    return `You've explored ${d.quotes_used_today || d.max_per_day || 3} different addresses today. Come back tomorrow for more, or book a site survey now to talk to a real person about your best option.`;
  }
  if (d.fallback_reason === 'both_pipelines_failed') {
    if (d.building_source == null && d.building_candidates
        && (d.building_candidates.osm || 0) + (d.building_candidates.linz || 0) === 0) {
      return 'We couldn’t find your building in our reference maps (OSM/LINZ have no polygon for this address yet — common for new subdivisions). A technician site survey is the fastest path to an accurate quote.';
    }
    if (/\d+\s*points?\s*above/i.test(d.lidar_error || '')
        || /RANSAC detected no roof planes/i.test(d.lidar_error || '')) {
      return 'This address is outside our automatic-analysis coverage — public roof-imagery data for this area isn’t detailed enough. A technician site visit is the accurate path to a quote here, and often faster than we can do online for rural properties.';
    }
    return 'Both roof-analysis providers came back empty for this coord. Try refining the address, or book a technician survey.';
  }
  if (d.fallback_reason === 'lidar_failed_reverted_to_stale_google') {
    return 'The LiDAR fallback couldn’t detect roof planes for this address. We’re showing Google’s older imagery result — book a site survey to confirm on the current roof.';
  }
  return null;
}
