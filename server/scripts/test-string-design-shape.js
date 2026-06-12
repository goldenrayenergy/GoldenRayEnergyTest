// Smoke test for the stringDesignShape helpers — normalize both shapes,
// compute totals, detect asymmetric, build canonical.

import {
  normalizeStringDesign, totalPanelsFromStringDesign, totalStringCount,
  isAsymmetric, buildStringDesign, groupsForEditing,
} from '../services/pm/proposalEngine/stringDesignShape.js';

let failed = 0;
const ok = (label, cond) => { if (cond) console.log(`  ✅ ${label}`); else { console.log(`  ❌ FAIL: ${label}`); failed++; } };
const eq = (label, a, b) => ok(`${label}  →  ${JSON.stringify(a)} === ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

console.log('\n══ Legacy shape (1 main string) ══');
{
  const sd = { topology: 'series', panels_per_string: 8, string_count: 2 };
  const n = normalizeStringDesign(sd);
  eq('groups.length', n.groups.length, 1);
  eq('groups[0]', n.groups[0], { panels_per_string: 8, string_count: 2 });
  eq('totalPanels', totalPanelsFromStringDesign(sd), 16);
  eq('totalStringCount', totalStringCount(sd), 2);
  ok('not asymmetric', !isAsymmetric(sd));
}

console.log('\n══ Legacy shape (main + asymmetric tail — 1×10 + 1×7) ══');
{
  const sd = {
    topology: 'series',
    panels_per_string: 10,
    string_count: 1,
    asymmetric: true,
    asymmetric_string: { panels_per_string: 7, string_count: 1 },
  };
  const n = normalizeStringDesign(sd);
  eq('groups.length', n.groups.length, 2);
  eq('total panels', totalPanelsFromStringDesign(sd), 17);
  eq('total strings', totalStringCount(sd), 2);
  ok('is asymmetric', isAsymmetric(sd));
}

console.log('\n══ Canonical shape (groups[]) — 3-group multi-MPPT ══');
{
  const sd = {
    topology: 'parallel',
    groups: [
      { panels_per_string: 8, string_count: 2 },
      { panels_per_string: 6, string_count: 1 },
      { panels_per_string: 5, string_count: 1 },
    ],
  };
  const n = normalizeStringDesign(sd);
  eq('groups.length', n.groups.length, 3);
  eq('totalPanels', totalPanelsFromStringDesign(sd), 8*2 + 6 + 5);
  eq('totalStringCount', totalStringCount(sd), 4);
  ok('is asymmetric', isAsymmetric(sd));
}

console.log('\n══ Canonical shape (groups[]) — symmetric 4×6 ══');
{
  const sd = { topology: 'parallel', groups: [{ panels_per_string: 6, string_count: 4 }] };
  ok('not asymmetric (single group)', !isAsymmetric(sd));
  eq('totalPanels', totalPanelsFromStringDesign(sd), 24);
}

console.log('\n══ Edge — null / empty ══');
{
  eq('null sd → empty groups', normalizeStringDesign(null), { groups: [] });
  eq('null sd → 0 panels', totalPanelsFromStringDesign(null), 0);
  eq('empty sd → empty groups', normalizeStringDesign({}), { groups: [], topology: null });
  ok('not asymmetric for empty', !isAsymmetric({}));
}

console.log('\n══ buildStringDesign + groupsForEditing ══');
{
  const built = buildStringDesign([{ panels_per_string: 8, string_count: 2 }], 'series');
  eq('built shape', built, {
    topology: 'series',
    groups: [{ panels_per_string: 8, string_count: 2 }],
  });
  const editGroups = groupsForEditing(null, 16);
  eq('groupsForEditing(null, 16) → 1 group of 16×1', editGroups, [{ panels_per_string: 16, string_count: 1 }]);
}

console.log('\n══ Strange/defensive cases ══');
{
  // groups with garbage entries are filtered out
  const sd = { topology: 'series', groups: [
    { panels_per_string: 8, string_count: 2 },
    { panels_per_string: 0, string_count: 1 },   // garbage — filtered
    { panels_per_string: 'x', string_count: 'y' }, // garbage — filtered
    { panels_per_string: 4, string_count: 1 },
  ] };
  const n = normalizeStringDesign(sd);
  eq('garbage filtered', n.groups.length, 2);
  eq('valid panels', totalPanelsFromStringDesign(sd), 20);
}

console.log(`\n──── Summary ────`);
console.log(`  ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
