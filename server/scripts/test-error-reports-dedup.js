// ────────────────────────────────────────────────────────────────────────────
// Report-it backend — dedup logic test.
//
//   • First report of a code        → new row, occurrences 1
//   • Repeat of the same code        → SAME row, occurrences increments (deduped)
//   • Different code                 → separate row
//   • Re-report after resolve        → row reopens (status back to open)
//   • fingerprint override           → groups separately from the bare code
//
// Pure: upsertErrorReport(client, payload) with an in-memory fake supabase.
// ────────────────────────────────────────────────────────────────────────────
import { upsertErrorReport } from '../routes/pm/error-reports.js';

let pass = 0, fail = 0;
const check = (l, c, h = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${c ? '' : '  — ' + h}`); c ? pass++ : fail++; };

// Minimal fake supabase supporting the chains upsertErrorReport uses.
function makeFakeSb() {
  const rows = [];
  let seq = 0;
  function from() {
    let mode = 'select', filterCol, filterVal, payload;
    const ctx = {
      select() { return ctx; },
      insert(r) { mode = 'insert'; payload = r; return ctx; },
      update(p) { mode = 'update'; payload = p; return ctx; },
      eq(col, val) { filterCol = col; filterVal = val; return ctx; },
      async maybeSingle() {
        if (mode === 'select') return { data: rows.find(r => r[filterCol] === filterVal) || null, error: null };
        if (mode === 'insert') { const row = { id: `id-${++seq}`, ...payload }; rows.push(row); return { data: row, error: null }; }
        if (mode === 'update') { const row = rows.find(r => r[filterCol] === filterVal); if (row) Object.assign(row, payload); return { data: row || null, error: null }; }
        return { data: null, error: null };
      },
    };
    return ctx;
  }
  return { from, _rows: rows };
}

console.log('━'.repeat(70));
console.log('  Report-it backend — dedup');
console.log('━'.repeat(70));

const sb = makeFakeSb();
const T = '2026-06-26T00:00:00.000Z';

// 1. First report
const r1 = await upsertErrorReport(sb, { code: 'kwh_double_count_suspect', area: 'bill', owner: 'rep', severity: 'flag', screen: 'bill-review' }, T);
check('first report → stored, not deduped, occurrences 1', r1.stored && !r1.deduped && r1.report.occurrences === 1, JSON.stringify(r1));

// 2. Same code again → deduped, occurrences 2, still ONE row
const r2 = await upsertErrorReport(sb, { code: 'kwh_double_count_suspect', screen: 'bill-review' }, T);
check('repeat same code → deduped, occurrences 2', r2.stored && r2.deduped && r2.report.occurrences === 2);
check('repeat did NOT create a second row', sb._rows.length === 1, `rows=${sb._rows.length}`);

// 3. Different code → new row
const r3 = await upsertErrorReport(sb, { code: 'convert_failed', area: 'sales', owner: 'rep' }, T);
check('different code → new row (2 total)', r3.stored && !r3.deduped && sb._rows.length === 2);

// 4. Resolve then re-report → reopens
sb._rows.find(r => r.code === 'convert_failed').status = 'resolved';
const r4 = await upsertErrorReport(sb, { code: 'convert_failed' }, T);
check('re-report after resolve → reopened (status open) + occurrences 2',
  r4.report.status === 'open' && r4.report.occurrences === 2, JSON.stringify({ s: r4.report.status, o: r4.report.occurrences }));

// 5. fingerprint override → groups separately even with same code
const r5a = await upsertErrorReport(sb, { code: 'render_crash', fingerprint: 'render_crash:/pm/quotes/1' }, T);
const r5b = await upsertErrorReport(sb, { code: 'render_crash', fingerprint: 'render_crash:/pm/projects/2' }, T);
check('distinct fingerprints → distinct rows', r5a.report.id !== r5b.report.id && !r5a.deduped && !r5b.deduped);

console.log('━'.repeat(70));
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('━'.repeat(70));
process.exit(fail ? 1 : 0);
