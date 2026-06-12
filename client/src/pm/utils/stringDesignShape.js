// ────────────────────────────────────────────────────────────────────────────
// Client-side mirror of server/services/pm/proposalEngine/stringDesignShape.js.
//
// Pure helpers — no imports beyond JS. Kept in sync with the server file by
// hand (small surface area). If the canonical shape ever evolves, change both.
// ────────────────────────────────────────────────────────────────────────────

export function normalizeStringDesign(sd) {
  if (!sd || typeof sd !== 'object') return { groups: [] };

  if (Array.isArray(sd.groups)) {
    const groups = sd.groups
      .filter(g => g && (Number(g.panels_per_string) > 0) && (Number(g.string_count) > 0))
      .map(g => ({
        panels_per_string: Number(g.panels_per_string),
        string_count: Number(g.string_count),
      }));
    return { groups, topology: sd.topology || null };
  }

  const groups = [];
  if (Number(sd.panels_per_string) > 0 && Number(sd.string_count) > 0) {
    groups.push({
      panels_per_string: Number(sd.panels_per_string),
      string_count: Number(sd.string_count),
    });
  }
  const tail = sd.asymmetric_string;
  if (tail && Number(tail.panels_per_string) > 0) {
    groups.push({
      panels_per_string: Number(tail.panels_per_string),
      string_count: Number(tail.string_count) || 1,
    });
  }
  return { groups, topology: sd.topology || null };
}

export function totalPanelsFromStringDesign(sd) {
  return normalizeStringDesign(sd).groups.reduce(
    (sum, g) => sum + (g.panels_per_string || 0) * (g.string_count || 0),
    0,
  );
}

export function isAsymmetric(sd) {
  const norm = normalizeStringDesign(sd);
  if (norm.groups.length < 2) return false;
  const first = norm.groups[0];
  return norm.groups.some(g => g.panels_per_string !== first.panels_per_string);
}

export function buildStringDesign(groups, topology = 'series') {
  return {
    topology,
    groups: (groups || [])
      .filter(g => Number(g.panels_per_string) > 0 && Number(g.string_count) > 0)
      .map(g => ({
        panels_per_string: Number(g.panels_per_string),
        string_count: Number(g.string_count),
      })),
  };
}

// Returns at least one group (empty placeholder) so the form has a row to
// render even before any data is entered.
export function groupsForEditing(sd, panelCountForFallback) {
  const norm = normalizeStringDesign(sd);
  if (norm.groups.length > 0) return norm.groups;
  if (panelCountForFallback > 0) {
    return [{ panels_per_string: panelCountForFallback, string_count: 1 }];
  }
  return [{ panels_per_string: 0, string_count: 0 }];
}
