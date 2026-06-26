// ────────────────────────────────────────────────────────────────────────────
// Regression runner — one command to answer "did we break anything?".
//
// Runs every server/scripts/test-*.{js,mjs} from the repo root, compares each
// result against regression-baseline.mjs, and prints a single table:
//   ✓ PASS        exit 0
//   ⚠ KNOWN-FAIL  fails, but listed in baseline.knownFailures (expected debt)
//   ✗ NEW-FAIL    fails and NOT in the baseline  ← blocks (runner exits 1)
//   ★ FIXED       a knownFailure that now passes  ← remove it from the baseline
//   ⊘ SKIP        needs server / fixtures / db-write (run with the flag)
//   · ADVISORY    passes but has no assertions (not real coverage)
//
// Usage:
//   node scripts/run-regression.mjs                 (default: offline-safe set)
//   node scripts/run-regression.mjs --with-server   (also run e2e suites)
//   node scripts/run-regression.mjs --with-fixtures (also run fixture suites)
//   node scripts/run-regression.mjs --with-dbwrite  (also run live-write suites)
//   node scripts/run-regression.mjs --only test-engine-rules,test-engine-multi-tier
//
// Exit code: 0 if no NEW-FAIL, else 1. Designed to gate the push process.
// ────────────────────────────────────────────────────────────────────────────
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { baseline } from './regression-baseline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '../../');   // run tests from repo root
const PER_TEST_TIMEOUT_MS = 120_000;

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const onlyArg = args.find(a => a.startsWith('--only'));
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1] || '')
      .split(',').map(s => s.trim()).filter(Boolean)
  : null;

const knownFailures = baseline.knownFailures || {};
const skipSets = {
  requiresServer:        { list: baseline.requiresServer || [],        enabled: has('--with-server'),   why: 'needs server (:5000)' },
  requiresLocalFixtures: { list: baseline.requiresLocalFixtures || [], enabled: has('--with-fixtures'), why: 'needs local fixtures' },
  mutatesLiveDb:         { list: baseline.mutatesLiveDb || [],         enabled: has('--with-dbwrite'),  why: 'writes to live DB' },
};
const advisory = new Set(baseline.noAssertions || []);

const stem = (file) => file.replace(/\.(js|mjs)$/, '');

// Discover suites
let suites = readdirSync(SCRIPTS_DIR)
  .filter(f => /^test-.*\.(js|mjs)$/.test(f))
  .sort();
if (only) suites = suites.filter(f => only.includes(stem(f)));

function skipReason(name) {
  for (const s of Object.values(skipSets)) {
    if (s.list.includes(name) && !s.enabled) return s.why;
  }
  return null;
}

function summaryLine(out) {
  const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/RESULT:|passed|pass ·|✅|❌|pass\b.*fail/i.test(lines[i])) return lines[i].slice(0, 80);
  }
  return lines[lines.length - 1]?.slice(0, 80) || '';
}

const results = [];
console.log('━'.repeat(78));
console.log(`  REGRESSION RUNNER — ${suites.length} suite(s)  (cwd: repo root)`);
console.log('━'.repeat(78));

for (const file of suites) {
  const name = stem(file);
  const why = skipReason(name);
  if (why) { results.push({ name, status: 'SKIP', note: why }); continue; }

  const proc = spawnSync('node', [path.join('server', 'scripts', file)], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: PER_TEST_TIMEOUT_MS,
  });
  const timedOut = proc.error && proc.error.code === 'ETIMEDOUT';
  const code = timedOut ? 124 : (proc.status ?? 1);
  const out = (proc.stdout || '') + '\n' + (proc.stderr || '');
  const passed = code === 0 && !timedOut;
  const known = !!knownFailures[name];

  let status;
  if (passed && known)            status = 'FIXED';         // was expected to fail
  else if (passed && advisory.has(name)) status = 'ADVISORY';
  else if (passed)                status = 'PASS';
  else if (known)                 status = 'KNOWN-FAIL';
  else                            status = timedOut ? 'NEW-FAIL(timeout)' : 'NEW-FAIL';

  results.push({ name, status, note: summaryLine(out) });
}

// ── Print table ─────────────────────────────────────────────────────────────
const ICON = {
  'PASS': '✓', 'ADVISORY': '·', 'KNOWN-FAIL': '⚠', 'NEW-FAIL': '✗',
  'NEW-FAIL(timeout)': '✗', 'FIXED': '★', 'SKIP': '⊘',
};
console.log('');
for (const r of results) {
  const icon = ICON[r.status] || '?';
  console.log(`  ${icon} ${r.status.padEnd(17)} ${r.name.padEnd(38)} ${r.note || ''}`);
}

// ── Tallies + verdict ───────────────────────────────────────────────────────
const count = (s) => results.filter(r => r.status === s).length;
const newFails = results.filter(r => r.status.startsWith('NEW-FAIL'));
const fixed = results.filter(r => r.status === 'FIXED');

console.log('');
console.log('━'.repeat(78));
console.log(`  PASS ${count('PASS')}  ·  ADVISORY ${count('ADVISORY')}  ·  KNOWN-FAIL ${count('KNOWN-FAIL')}  ·  ` +
            `NEW-FAIL ${newFails.length}  ·  FIXED ${fixed.length}  ·  SKIP ${count('SKIP')}`);

if (fixed.length) {
  console.log('');
  console.log('  ★ These were expected to fail but now PASS — remove from baseline.knownFailures:');
  for (const r of fixed) console.log(`      ${r.name}`);
}
if (newFails.length) {
  console.log('');
  console.log('  ✗ NEW FAILURES — a previously-green suite went red. DO NOT PUSH until resolved:');
  for (const r of newFails) console.log(`      ${r.name}  ${r.note}`);
  console.log('━'.repeat(78));
  process.exit(1);
}
console.log('  ✓ No new failures. Safe to proceed (reconcile KNOWN-FAILs against the baseline).');
console.log('━'.repeat(78));
process.exit(0);
