// ────────────────────────────────────────────────────────────────────────────
// stringDesignShape.js — pure helpers for the spec.system.string_design field.
//
// Background: the spec originally modelled string layout as ONE symmetric
// group plus an optional asymmetric tail:
//
//   string_design = {
//     panels_per_string: 10,
//     string_count: 1,
//     asymmetric: true,
//     asymmetric_string: { panels_per_string: 7, string_count: 1 },
//   }
//
// This shape can only express up to TWO groups (the main + the tail), and
// it leaks "asymmetric is a special case" into every consumer. The canonical
// shape promotes the layout to a first-class array:
//
//   string_design = {
//     topology: 'series' | 'parallel',
//     groups: [
//       { panels_per_string: 10, string_count: 1 },
//       { panels_per_string: 7,  string_count: 1 },
//       ...
//     ],
//   }
//
// Every validator/engine consumer goes through these helpers so both shapes
// are accepted uniformly. Composers emit the canonical (groups[]) shape going
// forward; legacy specs in the DB continue to work without migration.
//
// Pure functions — no I/O.
// ────────────────────────────────────────────────────────────────────────────

// Returns { groups: [{ panels_per_string, string_count }], topology? } regardless
// of which shape `sd` is in. Legacy specs are converted on the fly. Empty / null
// inputs return { groups: [] } so downstream code can iterate without guards.
export function normalizeStringDesign(sd) {
  if (!sd || typeof sd !== 'object') return { groups: [] };

  // New shape — pass through, defensively filtering invalid entries.
  if (Array.isArray(sd.groups)) {
    const groups = sd.groups
      .filter(g => g && (Number(g.panels_per_string) > 0) && (Number(g.string_count) > 0))
      .map(g => ({
        panels_per_string: Number(g.panels_per_string),
        string_count: Number(g.string_count),
      }));
    return {
      groups,
      topology: sd.topology || null,
    };
  }

  // Legacy shape — main + optional asymmetric tail.
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
  return {
    groups,
    topology: sd.topology || null,
  };
}

// Sum of panels across every group in the layout. Works for both shapes.
export function totalPanelsFromStringDesign(sd) {
  const norm = normalizeStringDesign(sd);
  return norm.groups.reduce(
    (sum, g) => sum + (g.panels_per_string || 0) * (g.string_count || 0),
    0,
  );
}

// Total string COUNT (number of physical strings, not panels). Engineering
// validator uses this to compute parallel-strings-per-MPPT.
export function totalStringCount(sd) {
  const norm = normalizeStringDesign(sd);
  return norm.groups.reduce((sum, g) => sum + (g.string_count || 0), 0);
}

// Convenience: returns true when the layout has more than one distinct
// (panels_per_string × string_count) configuration. UI uses this to decide
// whether to surface the "asymmetric" label.
export function isAsymmetric(sd) {
  const norm = normalizeStringDesign(sd);
  if (norm.groups.length < 2) return false;
  const first = norm.groups[0];
  return norm.groups.some(g => g.panels_per_string !== first.panels_per_string);
}

// Build the canonical shape from a list of groups + topology. Use when an
// engine module needs to emit a new string_design.
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

// Used by SystemSection.jsx-side helper too — bridges legacy data into
// editable groups[] for the UI without forcing a save-time migration.
// Always returns at LEAST one group (so the user has a row to edit) when
// panelCount is known, even if the stored string_design is empty.
export function groupsForEditing(sd, panelCountForFallback) {
  const norm = normalizeStringDesign(sd);
  if (norm.groups.length > 0) return norm.groups;
  if (panelCountForFallback > 0) {
    return [{ panels_per_string: panelCountForFallback, string_count: 1 }];
  }
  return [{ panels_per_string: 0, string_count: 0 }];
}
