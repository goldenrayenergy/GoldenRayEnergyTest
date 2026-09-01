// ────────────────────────────────────────────────────────────────────────────
// Regression baseline — the SINGLE source of "what is expected-red and why".
//
// The runner (run-regression.mjs) compares every test suite against this.
//   • A suite that fails AND is in knownFailures → expected (does not block).
//   • A suite that fails and is NOT listed → NEW FAILURE → blocks (exit 1).
//   • A knownFailure that now PASSES → "FIXED — remove from baseline" notice.
//
// Goal: shrink knownFailures to {} over time (see project_test_suite_debt_baseline).
// Every entry MUST carry a reason + category, so the debt is visible, not hidden.
//
// Audit basis: 2026-06-26 full-suite sweep — ZERO real bugs; all entries below
// are test-debt or environment, never application defects.
// ────────────────────────────────────────────────────────────────────────────

export const baseline = {
  // ── Known failures: expected-red until the test-debt is burned down ───────
  knownFailures: {
    'test-quote-actions-routes': {
      category: 'stub-drift',
      reason: 'In-memory stub seeds no catalogue tables → engine falls back to JS-default prices → phantom discount → ship-gate 409 cascade. Also stub lacks .neq()/embedded-join. Fix: seed products/inverter_battery_compat/battery_systems in makeStub.',
    },
    'test-quotes-routes': {
      category: 'stub-drift',
      reason: 'Same catalogue-stub drift as quote-actions-routes, plus GET-list needs .neq() + embedded-join the stub builder lacks.',
    },
    'test-engine-boundary-failures': {
      category: 'rule-moved',
      reason: 'Assertion #8 expects owner_approved as a config_error, but that gate intentionally moved config→cost stage (now blocks via can_ship). Update the assertion.',
    },
    'test-engine-cross-customer': {
      category: 'rule-moved',
      reason: 'Locked price below list creates an implicit discount with owner_approved=false → cost-stage gate blocks can_ship. Test predates the implicit-discount gate. Set discount.owner_approved+reason in the spec.',
    },
    'test-engine-multi-tier': {
      category: 'rule-moved',
      reason: '(a) customer_price_inc_gst became optional (null = auto-price); (b) tier-2 locked below list → implicit-discount gate blocks. Both are test-only updates.',
    },
    'test-mercury-bill': {
      category: 'bad-fixture',
      reason: 'Multi-rate FIXTURE numbers do not reconcile ($5.02 off); parser correctly flags suspect. Fix the fixture, NOT the parser.',
    },
  },

  // ── Skipped by default (run with flags): need things a bare run lacks ──────
  // A running local HTTP server on :5000. Run with --with-server.
  requiresServer: [
    'test-e2e-quote-lifecycle',
    'test-e2e-quote-day7-lifecycle',
    'test-e2e-two-customers',
    // POC e2e suites — need Vite (:5173) + Express (:5000) up. Added to the
    // list after 2026-06-26 baseline was written; they were slipping through
    // as NEW-FAIL in every default `npm test` run because Google Solar +
    // LiDAR cold-start makes the puppeteer/http flow easily exceed the
    // runner's 120s per-suite budget. Both pass standalone (~15-30s each)
    // with the servers up — run with `--with-server`.
    'test-e2e-roof-analyse',
    'test-e2e-browser',
  ],
  // Read PDF fixtures from machine-specific absolute paths (C:/Users/.../Downloads).
  // Non-portable until vendored into the repo. Run with --with-fixtures.
  requiresLocalFixtures: [
    'test-ecotricity-parser',
    'test-mercury-bundled',
  ],
  // Performs live writes to Supabase (self-reverts, but a crash could strand data).
  // Run with --with-dbwrite.
  mutatesLiveDb: [
    'test-field-limits-cache',
  ],

  // ── Advisory: these exit 0 always (no pass/fail assertions). Reported as
  //    "advisory" so a green here isn't mistaken for real coverage. ──────────
  noAssertions: [
    'test-bill-ocr',
    'test-fronius-client',
    'test-field-hints',
    'test-package-validator',
  ],
};
