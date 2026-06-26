// ────────────────────────────────────────────────────────────────────────────
// Root-cause fix test — site_survey is deferred to GENERATE time.
//
// "Convert to firm" collapses a quote to a Stage-2 draft the rep then refines
// (adds the survey) before generating. So:
//   • Stage-2 spec WITHOUT survey, no generate intent  → NO site_survey error
//     (convert / save / preview can hold the draft)
//   • Same spec WITH requireSiteSurvey:true             → site_survey error
//     (the generate gate enforces it)
//   • Stage-1 spec                                      → never a site_survey error
//   • Stage-2 spec WITH a survey                        → no "required" error
//
// Pure validateSpec — uses the bundled catalogue, no DB.
// ────────────────────────────────────────────────────────────────────────────
import { validateSpec } from '../services/pm/proposalEngine/configValidator.js';

let pass = 0, fail = 0;
const check = (l, c, h = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${c ? '' : '  — ' + h}`); c ? pass++ : fail++; };
// Any error under the site_survey section (the "required" error is path
// 'site_survey'; field errors are 'site_survey.<field>').
const hasSiteSurveyErr = (r) => r.errors.some(e => e.path === 'site_survey' || e.path.startsWith('site_survey.'));

const baseStage2 = { pricing: { stage: 'stage_2_firm', customer_price_inc_gst: 50000 } };
const baseStage1 = { pricing: { stage: 'stage_1_estimate', customer_price_inc_gst: 50000 } };
const survey = { cable_run_metres_measured: 18, switchboard: { spare_rcbo_slots: 3 } };

console.log('━'.repeat(70));
console.log('  Convert-to-firm: site_survey deferred to generate-time');
console.log('━'.repeat(70));

// 1. Stage-2 draft, no survey, NO generate intent → must NOT require survey
check('Stage-2 draft without survey → no site_survey error (convert allowed)',
  !hasSiteSurveyErr(validateSpec(baseStage2, {})));

// 2. Stage-2, no survey, generate intent → MUST require survey
check('Stage-2 without survey + requireSiteSurvey → site_survey error (generate blocks)',
  hasSiteSurveyErr(validateSpec(baseStage2, { requireSiteSurvey: true })));

// 3. Stage-1 never requires a survey, even with the intent
check('Stage-1 + requireSiteSurvey → no site_survey error',
  !hasSiteSurveyErr(validateSpec(baseStage1, { requireSiteSurvey: true })));

// 4. Stage-2 WITH a survey present → no "required" error at generate
check('Stage-2 with a survey + requireSiteSurvey → no site_survey error',
  !hasSiteSurveyErr(validateSpec({ ...baseStage2, site_survey: survey }, { requireSiteSurvey: true })));

// 5. A present-but-out-of-range survey field still validates (not silently skipped)
check('Stage-2 with an out-of-range survey field → site_survey error (fields still checked)',
  hasSiteSurveyErr(validateSpec(
    { ...baseStage2, site_survey: { cable_run_metres_measured: 9999 } },
    { requireSiteSurvey: true })));

console.log('━'.repeat(70));
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('━'.repeat(70));
process.exit(fail ? 1 : 0);
