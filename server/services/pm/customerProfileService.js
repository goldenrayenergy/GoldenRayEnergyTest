// ────────────────────────────────────────────────────────────────────────────
// Customer Profile Normaliser (Phase 1.5)
//
// Single source of truth for everything downstream — the 3-quote engine,
// proposal generator, sales-exec view, and PM Tool lead view all read from
// `customer_profiles`. No service queries raw form data or raw bill uploads
// after this point.
//
// Two entry points:
//   1. normaliseFromBillAnalysis(billAnalysisId, analysisData)
//      For Door A (12-bill upload) — pulls measured kWh, retailer-verified
//      rates, optionally seasonal profile from the parsed bills. Confidence
//      band defaults to 'high' (12 bills) or 'medium' (<6 bills).
//
//   2. normaliseFromEstimate(billAnalysisId, formInputs, analysisData)
//      For Door B (no-bill estimate) — uses form inputs, applies region
//      defaults from the region_defaults table where data is missing,
//      stamps confidence as 'medium'.
//
// Both functions UPSERT by lead_id — a single customer = a single profile.
// If the same customer comes back via a different door, the profile gets
// recomputed in-place rather than duplicated.
//
// Failures are logged but never thrown — the bill-analysis flow MUST NOT
// break if the normaliser fails (e.g. the customer_profiles table hasn't
// been created yet because migration 019 hasn't been applied). The flag
// `profile_normalised` on the response tells callers whether it worked.
// ────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '../../config/supabase.js';

// ── Defaults table (in-memory fallback if region_defaults table is empty) ──
// These values are NIWA-derived for NZ. If the region_defaults DB table is
// populated (via the workbook importer), those values take precedence.
const REGION_FALLBACKS = {
  auckland:      { sun_hours_daily: 4.2, avg_household_kwh_yearly: 7500, typical_self_consumption_pct: 35, with_battery_self_consumption_pct: 75 },
  waikato:       { sun_hours_daily: 4.1, avg_household_kwh_yearly: 8200, typical_self_consumption_pct: 35, with_battery_self_consumption_pct: 75 },
  bay_of_plenty: { sun_hours_daily: 4.3, avg_household_kwh_yearly: 7800, typical_self_consumption_pct: 36, with_battery_self_consumption_pct: 76 },
  hawkes_bay:    { sun_hours_daily: 4.2, avg_household_kwh_yearly: 8000, typical_self_consumption_pct: 35, with_battery_self_consumption_pct: 75 },
  manawatu:      { sun_hours_daily: 4.0, avg_household_kwh_yearly: 8500, typical_self_consumption_pct: 33, with_battery_self_consumption_pct: 73 },
  wellington:    { sun_hours_daily: 3.9, avg_household_kwh_yearly: 8500, typical_self_consumption_pct: 32, with_battery_self_consumption_pct: 72 },
  tasman:        { sun_hours_daily: 4.0, avg_household_kwh_yearly: 9000, typical_self_consumption_pct: 33, with_battery_self_consumption_pct: 73 },
  canterbury:    { sun_hours_daily: 4.1, avg_household_kwh_yearly: 9500, typical_self_consumption_pct: 38, with_battery_self_consumption_pct: 78 },
  westland:      { sun_hours_daily: 3.7, avg_household_kwh_yearly: 9500, typical_self_consumption_pct: 30, with_battery_self_consumption_pct: 70 },
  otago:         { sun_hours_daily: 3.7, avg_household_kwh_yearly: 10000, typical_self_consumption_pct: 32, with_battery_self_consumption_pct: 72 },
  southland:     { sun_hours_daily: 3.5, avg_household_kwh_yearly: 10500, typical_self_consumption_pct: 30, with_battery_self_consumption_pct: 70 },
  northland:     { sun_hours_daily: 4.4, avg_household_kwh_yearly: 7000, typical_self_consumption_pct: 37, with_battery_self_consumption_pct: 77 },
};

async function getRegionDefaults(region) {
  if (!region) region = 'auckland';
  // Try the DB table first — if populated by the workbook importer, it
  // overrides the in-memory fallbacks.
  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('region_defaults')
        .select('*')
        .ilike('region_name', `%${region}%`)
        .eq('is_active', true)
        .maybeSingle();
      if (data) {
        return {
          sun_hours_daily:                   Number(data.sun_hours_daily) || 4.0,
          avg_household_kwh_yearly:          data.avg_household_kwh_yearly || 8000,
          typical_self_consumption_pct:      Number(data.typical_self_consumption_pct) || 35,
          with_battery_self_consumption_pct: Number(data.with_battery_self_consumption_pct) || 75,
        };
      }
    } catch (e) {
      // Table doesn't exist yet (migration 019 not applied) → use fallback
    }
  }
  return REGION_FALLBACKS[region] || REGION_FALLBACKS.auckland;
}

// ── Confidence band rules ─────────────────────────────────────────────────
function determineConfidence(sourceDoor, billCount, usableBills) {
  if (sourceDoor === 'bill_upload_12' && billCount >= 12 && usableBills >= 10) return 'high';
  if (sourceDoor === 'bill_upload_12' && usableBills >= 6) return 'medium';
  if (sourceDoor === 'bill_upload_partial') return 'medium';
  if (sourceDoor === 'quote_form') return 'medium';
  if (sourceDoor === 'manual_entry') return 'low';
  return 'low';
}

// ── Load pattern inference from bill peak/off-peak split ──────────────────
function inferLoadPattern(peakKwh, offPeakKwh) {
  if (peakKwh == null || offPeakKwh == null) return 'unknown';
  const total = peakKwh + offPeakKwh;
  if (total === 0) return 'unknown';
  const peakShare = peakKwh / total;
  if (peakShare > 0.55) return 'daytime_heavy';
  if (peakShare < 0.35) return 'evening_heavy';
  return 'flat';
}

// ── Build monthly profile from N bills (Door A) ───────────────────────────
function buildMonthlyProfile(bills) {
  // Initialize 12 months with 0
  const months = Array(12).fill(0);
  if (!bills || !bills.length) return { profile: months, swing: null };

  for (const b of bills) {
    if (!b.period_end || b.kwh_total == null) continue;
    const idx = new Date(b.period_end + 'T00:00:00Z').getUTCMonth(); // 0-11
    months[idx] += b.kwh_total;
  }
  // If fewer than 12 bills, the months they don't cover stay at 0.
  // The downstream engine knows to scale from months_covered.
  const nonZero = months.filter(m => m > 0);
  const swing = nonZero.length >= 2
    ? +(Math.max(...nonZero) / Math.min(...nonZero)).toFixed(2)
    : null;
  return { profile: months, swing };
}

// ── Apply seasonal default to a single-bill / no-bill profile ─────────────
// Auckland average NZ household seasonal split, normalised to sum to 1.0.
// Use it to spread an annual_kwh figure into a 12-month estimated profile.
const SEASONAL_SHARE = {
  auckland:      [0.092, 0.087, 0.077, 0.062, 0.078, 0.092, 0.099, 0.091, 0.080, 0.075, 0.082, 0.085],  // peak winter Jul
  wellington:    [0.090, 0.085, 0.077, 0.065, 0.080, 0.095, 0.103, 0.093, 0.080, 0.073, 0.080, 0.079],
  canterbury:    [0.085, 0.078, 0.075, 0.068, 0.085, 0.105, 0.115, 0.103, 0.085, 0.072, 0.067, 0.062],  // colder, bigger winter spike
};
function applySeasonalDefault(annualKwh, region) {
  const share = SEASONAL_SHARE[region] || SEASONAL_SHARE.auckland;
  return share.map(s => +(annualKwh * s).toFixed(1));
}

// ── Customer signal inference from bill spend ─────────────────────────────
function inferPriceSensitivity(annualSpendNzd, householdSize) {
  // Rough heuristic: low spend per person → more price-sensitive
  if (annualSpendNzd == null) return null;
  let perPerson;
  if (householdSize === '1-2') perPerson = annualSpendNzd / 2;
  else if (householdSize === '3-4') perPerson = annualSpendNzd / 4;
  else if (householdSize === '5+') perPerson = annualSpendNzd / 5;
  else perPerson = annualSpendNzd / 3;
  if (perPerson < 600)  return 'high';      // < $600/yr per person → very tight
  if (perPerson < 1200) return 'medium';
  return 'low';
}

// ── PUBLIC: normalise from a Door A bill upload ───────────────────────────
//
// Inputs:
//   billAnalysisId  — UUID of the row in bill_analyses
//   analysisData    — the full analysis object returned by analyzeBills()
//   parsedBills     — array of parsed bill objects from billOcrService
//
// Returns: { profile, ok }   — ok=false if write failed (logged, not thrown)
export async function normaliseFromBillAnalysis(billAnalysisId, analysisData, parsedBills) {
  try {
    const billCount   = parsedBills.length;
    const usableBills = parsedBills.filter(b => b.kwh_total != null && b.total_nzd != null).length;
    const sourceDoor  = billCount >= 6 ? 'bill_upload_12' : 'bill_upload_partial';
    const region      = analysisData.region || 'auckland';
    const regionDefaults = await getRegionDefaults(region);

    const { profile: monthlyProfile, swing } = buildMonthlyProfile(parsedBills);
    const monthsCovered = analysisData.aggregate.months_covered || usableBills;
    const peakSum    = parsedBills.reduce((s, b) => s + (b.kwh_peak     || 0), 0);
    const offPeakSum = parsedBills.reduce((s, b) => s + (b.kwh_off_peak || 0), 0);
    const annualSpend = analysisData.aggregate.annual_spend_nzd;

    // If we have fewer than 12 months of data, fill the missing months with
    // seasonal-default-shaped estimates so the engine has a full year.
    let fullYearProfile = monthlyProfile;
    if (monthsCovered < 12) {
      const seasonal = applySeasonalDefault(analysisData.aggregate.annual_kwh, region);
      fullYearProfile = monthlyProfile.map((m, i) => m > 0 ? m : seasonal[i]);
    }

    const profile = {
      lead_id:                            billAnalysisId,  // use bill_analysis id as the lead identifier
      source_door:                        sourceDoor,
      confidence_band:                    determineConfidence(sourceDoor, billCount, usableBills),

      annual_kwh:                         analysisData.aggregate.annual_kwh,
      annual_kwh_source:                  'measured_from_bills',
      monthly_kwh_profile:                fullYearProfile,
      seasonal_swing_ratio:               swing,
      seasonality_source:                 monthsCovered >= 12 ? 'measured' : 'regional_default',

      current_retailer:                   analysisData.aggregate.retailer,
      current_plan:                       analysisData.aggregate.plan_name,
      effective_rate_per_kwh:             analysisData.aggregate.effective_rate_nzd,
      tou_split_available:                peakSum > 0 || offPeakSum > 0,
      peak_pct:                           peakSum + offPeakSum > 0 ? +(peakSum / (peakSum + offPeakSum) * 100).toFixed(2) : null,
      off_peak_pct:                       peakSum + offPeakSum > 0 ? +(offPeakSum / (peakSum + offPeakSum) * 100).toFixed(2) : null,
      annual_spend_nzd:                   annualSpend,

      self_consumption_pct:               regionDefaults.typical_self_consumption_pct,
      self_consumption_with_battery_pct:  regionDefaults.with_battery_self_consumption_pct,
      self_consumption_confidence:        peakSum + offPeakSum > 0 ? 'high' : 'medium',
      inferred_load_pattern:              inferLoadPattern(peakSum, offPeakSum),

      postcode:                           null,                                  // bill PDFs don't typically have it
      region,
      sun_hours_daily:                    regionDefaults.sun_hours_daily,

      bill_uploads_count:                 billCount,
      highest_month_kwh:                  swing ? +Math.max(...fullYearProfile.filter(m => m > 0)).toFixed(1) : null,
      lowest_month_kwh:                   swing ? +Math.min(...fullYearProfile.filter(m => m > 0)).toFixed(1) : null,
      average_monthly_spend_nzd:          annualSpend != null ? +(annualSpend / 12).toFixed(2) : null,
      price_sensitivity:                  inferPriceSensitivity(annualSpend, null),

      normaliser_version:                 'v1',
      normalised_at:                      new Date().toISOString(),
    };

    if (!supabaseAdmin) return { profile, ok: false, reason: 'no_supabase_client' };

    const { error } = await supabaseAdmin
      .from('customer_profiles')
      .upsert(profile, { onConflict: 'lead_id' });
    if (error) {
      console.warn('[normaliser] write failed (non-fatal):', error.message);
      return { profile, ok: false, reason: error.message };
    }
    return { profile, ok: true };
  } catch (e) {
    console.warn('[normaliser] unexpected error (non-fatal):', e.message);
    return { profile: null, ok: false, reason: e.message };
  }
}

// ── PUBLIC: normalise from a Door B estimate (no-bill form) ────────────────
//
// Inputs:
//   billAnalysisId — UUID of the row in bill_analyses (saved by the route)
//   formInputs     — { monthly_spend, retailer_id, postcode, region, household_size, email }
//   analysisData   — output of analyzeBills() against the synthesized bill
export async function normaliseFromEstimate(billAnalysisId, formInputs, analysisData) {
  try {
    const region = analysisData.region || 'auckland';
    const regionDefaults = await getRegionDefaults(region);
    const annualKwh = analysisData.aggregate.annual_kwh;
    const annualSpend = (formInputs.monthly_spend || 0) * 12;

    const profile = {
      lead_id:                            billAnalysisId,
      source_door:                        'quote_form',
      confidence_band:                    'medium',

      annual_kwh:                         annualKwh,
      annual_kwh_source:                  'computed_from_spend',
      monthly_kwh_profile:                applySeasonalDefault(annualKwh, region),
      seasonal_swing_ratio:               null,
      seasonality_source:                 'regional_default',

      current_retailer:                   analysisData.aggregate.retailer,
      current_plan:                       analysisData.aggregate.plan_name,
      effective_rate_per_kwh:             analysisData.aggregate.effective_rate_nzd,
      tou_split_available:                false,
      annual_spend_nzd:                   annualSpend,

      self_consumption_pct:               regionDefaults.typical_self_consumption_pct,
      self_consumption_with_battery_pct:  regionDefaults.with_battery_self_consumption_pct,
      self_consumption_confidence:        'low',                               // form-only — we don't know their daily pattern
      inferred_load_pattern:              'unknown',

      postcode:                           formInputs.postcode || null,
      region,
      sun_hours_daily:                    regionDefaults.sun_hours_daily,
      household_size:                     formInputs.household_size || null,
      bill_uploads_count:                 0,
      average_monthly_spend_nzd:          formInputs.monthly_spend || null,
      price_sensitivity:                  inferPriceSensitivity(annualSpend, formInputs.household_size),

      normaliser_version:                 'v1',
      normalised_at:                      new Date().toISOString(),
    };

    if (!supabaseAdmin) return { profile, ok: false, reason: 'no_supabase_client' };

    const { error } = await supabaseAdmin
      .from('customer_profiles')
      .upsert(profile, { onConflict: 'lead_id' });
    if (error) {
      console.warn('[normaliser] estimate write failed (non-fatal):', error.message);
      return { profile, ok: false, reason: error.message };
    }
    return { profile, ok: true };
  } catch (e) {
    console.warn('[normaliser] estimate unexpected error (non-fatal):', e.message);
    return { profile: null, ok: false, reason: e.message };
  }
}
