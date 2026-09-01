// Pure-JS helper that translates a roof-analysis error state (either a raw
// HTTP error string OR a structured diagnostics payload) into customer-
// facing copy for the Step3Analysis heading + SiteSurveyFallback card.
//
// Extracted from Step3Analysis.jsx so it can run under Node for unit tests
// (`.jsx` isn't Node-importable).
//
// Fix (2026-09-01) — replaces the earlier `friendlyDiagnostic` which only
// returned a single body-copy string. The old design left the page-level
// h2 hardcoded to "We couldn't analyse this roof" regardless of cause,
// which read as a technical glitch when the ACTUAL cause was a daily
// quota / rural coverage gap / new-subdivision maps-not-updated.
//
// Now returns { class, title, subtitle } where:
//   • `class` drives conditional UI (e.g., hide the "Try a different
//     address" button for rate-limit since trying a different address
//     hits the same cap)
//   • `title` replaces the h2 heading + amber-card bold line
//   • `subtitle` replaces the h2 sub-copy AND the card body detail

export function errorCopy(diagnostics, rawError) {
  const d = diagnostics;
  const errStr = typeof rawError === 'string' ? rawError : '';

  // ── 1. Rate limit — daily quota hit. Not a technical failure. ──
  // Server response body includes the "You've explored N different
  // addresses today" string; client's error state prepends " [HTTP 429]".
  // Match either signal so we're robust to response-shape drift.
  if (d?.fallback_reason === 'daily_quote_limit'
      || /You've explored \d+ different addresses today/i.test(errStr)
      || /\[HTTP 429\]/.test(errStr)) {
    return {
      class: 'rate-limit',
      title: "You've used today's 3 free quotes",
      subtitle: "Loved what you saw? Book a free 30-minute site survey — our engineers turn your favourite address into an exact, signable quote. Or come back tomorrow for 3 fresh explorer quotes.",
    };
  }

  // ── 2. Rural coverage gap — LiDAR + Google Solar both empty. ──
  // Common in remote areas (Hira, Rai Valley, some Marlborough Sounds
  // + Fiordland). Reframed as a positive: "you get the human touch".
  const isRural = /\d+\s*points?\s*above/i.test(errStr)
    || /RANSAC.*no roof planes/i.test(errStr)
    || /LiDAR.*failed/i.test(errStr)
    || (d?.fallback_reason === 'both_pipelines_failed'
        && (/\d+\s*points?\s*above/i.test(d?.lidar_error || '')
            || /RANSAC.*no roof planes/i.test(d?.lidar_error || '')));
  if (isRural) {
    return {
      class: 'rural',
      title: 'Your address is a job for our engineers',
      subtitle: "Public satellite data isn't detailed enough for your area yet — but that's actually a good thing. An on-site survey with our team gives you a more accurate quote than any automated tool could. Free, and usually about 30 minutes.",
    };
  }

  // ── 3. Missing building on OSM/LINZ — new subdivision typical. ──
  // Reassuring copy that doesn't blame the customer's shiny new house.
  if (d?.fallback_reason === 'both_pipelines_failed'
      && d.building_source == null
      && d.building_candidates
      && (d.building_candidates.osm || 0) + (d.building_candidates.linz || 0) === 0) {
    return {
      class: 'missing-building',
      title: "New build? Let's design your system in person",
      subtitle: "Public mapping data catches up in 3–12 months. Meanwhile, book a free site survey — our engineers design directly from the actual building. Fastest path to an exact quote.",
    };
  }

  // ── 4. Default — genuine analysis failure. Rarest class. ──
  // RANSAC weirdness, obstructions, unusual roof shape, or an upstream
  // provider hiccup. The only class where the old "we couldn't analyse
  // this roof" wording is actually accurate.
  return {
    class: 'genuine-failure',
    title: "We couldn't read this roof automatically",
    subtitle: "Unusual roof shape, heavy obstructions, or an imagery quirk. Book a free site survey — our engineers will confirm your roof in person and get you a signed quote, usually within a week.",
  };
}
