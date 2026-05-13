-- ────────────────────────────────────────────────────────────────────────────
-- Migration 020 — Data Validation Hardening
--
-- Adds CHECK constraints to enforce data quality at the DB level:
--   - Email format        (simple, practical regex)
--   - Phone format        (digits + common separators, 7-20 chars)
--   - NZ postcode         (exactly 4 digits)
--   - Money fields        (>= 0)
--   - Percentage fields   (0-100)
--   - Date order          (period_end >= period_start)
--   - Other sanity bounds (lead score 0-100, OCR confidence 0-1, etc.)
--
-- All constraints allow NULL — existing nulls don't break.
-- All constraints use NOT VALID — existing rows are not back-checked.
-- This means:
--   ✓ The migration applies cleanly even if there's bad data already.
--   ✓ All new INSERTs and UPDATEs are validated.
--   ✗ Pre-existing dirty rows survive — clean them up + run
--     `ALTER TABLE ... VALIDATE CONSTRAINT name` to enforce retroactively.
--
-- Migration is idempotent — re-running adds nothing.
-- ────────────────────────────────────────────────────────────────────────────


-- ── Helper: add a CHECK constraint only if it doesn't already exist ───────
DO $$
BEGIN

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. CONTACTS — CRM contact records                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contacts_email_format') THEN
  ALTER TABLE contacts ADD CONSTRAINT chk_contacts_email_format
    CHECK (email IS NULL OR email = '' OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contacts_phone_format') THEN
  ALTER TABLE contacts ADD CONSTRAINT chk_contacts_phone_format
    CHECK (phone IS NULL OR phone = '' OR phone ~ '^[0-9+\-\s\(\)]{7,20}$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contacts_monthly_bill_nonneg') THEN
  ALTER TABLE contacts ADD CONSTRAINT chk_contacts_monthly_bill_nonneg
    CHECK (monthly_bill IS NULL OR monthly_bill >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contacts_estimated_value_nonneg') THEN
  ALTER TABLE contacts ADD CONSTRAINT chk_contacts_estimated_value_nonneg
    CHECK (estimated_value IS NULL OR estimated_value >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contacts_lead_score_range') THEN
  ALTER TABLE contacts ADD CONSTRAINT chk_contacts_lead_score_range
    CHECK (lead_score IS NULL OR (lead_score >= 0 AND lead_score <= 100)) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. WEBSITE_ENQUIRIES — public quote form submissions                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_email_format') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_email_format
    CHECK (email IS NULL OR email = '' OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_phone_format') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_phone_format
    CHECK (phone IS NULL OR phone = '' OR phone ~ '^[0-9+\-\s\(\)]{7,20}$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_referrer_phone_format') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_referrer_phone_format
    CHECK (referrer_phone IS NULL OR referrer_phone = '' OR referrer_phone ~ '^[0-9+\-\s\(\)]{7,20}$') NOT VALID;
END IF;

-- NZ postcode: exactly 4 digits (added in migration 008 schema extensions)
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_postcode_nz') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_postcode_nz
    CHECK (postcode IS NULL OR postcode = '' OR postcode ~ '^[0-9]{4}$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_monthly_bill_nonneg') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_monthly_bill_nonneg
    CHECK (monthly_bill IS NULL OR monthly_bill >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_floors_positive') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_floors_positive
    CHECK (floors IS NULL OR (floors >= 1 AND floors <= 10)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_system_size_range') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_system_size_range
    CHECK (system_size_kw IS NULL OR (system_size_kw >= 0 AND system_size_kw <= 1000)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_panels_nonneg') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_panels_nonneg
    CHECK (panels IS NULL OR panels >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_battery_nonneg') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_battery_nonneg
    CHECK (battery_kwh IS NULL OR battery_kwh >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_total_cost_nonneg') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_total_cost_nonneg
    CHECK (total_cost IS NULL OR total_cost >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_savings_nonneg') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_savings_nonneg
    CHECK ((monthly_savings IS NULL OR monthly_savings >= 0) AND
           (annual_savings  IS NULL OR annual_savings  >= 0)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_payback_range') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_payback_range
    CHECK (payback_years IS NULL OR (payback_years >= 0 AND payback_years <= 100)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquiries_lead_score_range') THEN
  ALTER TABLE website_enquiries ADD CONSTRAINT chk_enquiries_lead_score_range
    CHECK (lead_score IS NULL OR (lead_score >= 0 AND lead_score <= 100)) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. BILL_ANALYSES — 25-year scenario engine results                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_email_format') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_email_format
    CHECK (email IS NULL OR email = '' OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_postcode_nz') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_postcode_nz
    CHECK (postcode IS NULL OR postcode = '' OR postcode ~ '^[0-9]{4}$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_bills_uploaded_nonneg') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_bills_uploaded_nonneg
    CHECK (bills_uploaded >= 0 AND bills_uploaded <= 12) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_period_order') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_period_order
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_months_range') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_months_range
    CHECK (months_covered IS NULL OR (months_covered >= 0 AND months_covered <= 24)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_kwh_nonneg') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_kwh_nonneg
    CHECK (annual_kwh IS NULL OR annual_kwh >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_spend_nonneg') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_spend_nonneg
    CHECK ((annual_spend_nzd          IS NULL OR annual_spend_nzd          >= 0) AND
           (fixed_charge_total_nzd    IS NULL OR fixed_charge_total_nzd    >= 0) AND
           (variable_charge_total_nzd IS NULL OR variable_charge_total_nzd >= 0)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_effective_rate_range') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_effective_rate_range
    CHECK (effective_rate_nzd IS NULL OR (effective_rate_nzd >= 0 AND effective_rate_nzd <= 10)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_system_recommend_nonneg') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_system_recommend_nonneg
    CHECK ((recommended_system_kw   IS NULL OR recommended_system_kw   >= 0) AND
           (recommended_battery_kwh IS NULL OR recommended_battery_kwh >= 0)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_analyses_switch_saving_nonneg') THEN
  ALTER TABLE bill_analyses ADD CONSTRAINT chk_bill_analyses_switch_saving_nonneg
    CHECK (switch_annual_saving IS NULL OR switch_annual_saving >= 0) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. BILL_UPLOADS — per-PDF parse results                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_uploads_ocr_confidence_range') THEN
  ALTER TABLE bill_uploads ADD CONSTRAINT chk_bill_uploads_ocr_confidence_range
    CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_uploads_period_order') THEN
  ALTER TABLE bill_uploads ADD CONSTRAINT chk_bill_uploads_period_order
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_uploads_days_range') THEN
  ALTER TABLE bill_uploads ADD CONSTRAINT chk_bill_uploads_days_range
    CHECK (days_in_period IS NULL OR (days_in_period >= 1 AND days_in_period <= 90)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_uploads_kwh_nonneg') THEN
  ALTER TABLE bill_uploads ADD CONSTRAINT chk_bill_uploads_kwh_nonneg
    CHECK ((kwh_total    IS NULL OR kwh_total    >= 0) AND
           (kwh_peak     IS NULL OR kwh_peak     >= 0) AND
           (kwh_off_peak IS NULL OR kwh_off_peak >= 0) AND
           (kwh_exported IS NULL OR kwh_exported >= 0)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_uploads_charges_nonneg') THEN
  ALTER TABLE bill_uploads ADD CONSTRAINT chk_bill_uploads_charges_nonneg
    CHECK ((fixed_charge_nzd    IS NULL OR fixed_charge_nzd    >= 0) AND
           (variable_charge_nzd IS NULL OR variable_charge_nzd >= 0) AND
           (export_credit_nzd   IS NULL OR export_credit_nzd   >= 0) AND
           (gst_nzd             IS NULL OR gst_nzd             >= 0) AND
           (total_nzd           IS NULL OR total_nzd           >= 0)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_uploads_file_size_nonneg') THEN
  ALTER TABLE bill_uploads ADD CONSTRAINT chk_bill_uploads_file_size_nonneg
    CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. CUSTOMER_PROFILES — (Phase 1.5 normaliser)                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_postcode_nz') THEN
  ALTER TABLE customer_profiles ADD CONSTRAINT chk_profiles_postcode_nz
    CHECK (postcode IS NULL OR postcode = '' OR postcode ~ '^[0-9]{4}$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_annual_kwh_nonneg') THEN
  ALTER TABLE customer_profiles ADD CONSTRAINT chk_profiles_annual_kwh_nonneg
    CHECK (annual_kwh IS NULL OR annual_kwh >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_annual_spend_nonneg') THEN
  ALTER TABLE customer_profiles ADD CONSTRAINT chk_profiles_annual_spend_nonneg
    CHECK (annual_spend_nzd IS NULL OR annual_spend_nzd >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_effective_rate_range') THEN
  ALTER TABLE customer_profiles ADD CONSTRAINT chk_profiles_effective_rate_range
    CHECK (effective_rate_per_kwh IS NULL OR (effective_rate_per_kwh >= 0 AND effective_rate_per_kwh <= 10)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_tou_split_range') THEN
  ALTER TABLE customer_profiles ADD CONSTRAINT chk_profiles_tou_split_range
    CHECK ((peak_pct     IS NULL OR (peak_pct     >= 0 AND peak_pct     <= 100)) AND
           (off_peak_pct IS NULL OR (off_peak_pct >= 0 AND off_peak_pct <= 100))) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_self_consumption_range') THEN
  ALTER TABLE customer_profiles ADD CONSTRAINT chk_profiles_self_consumption_range
    CHECK ((self_consumption_pct              IS NULL OR (self_consumption_pct              >= 0 AND self_consumption_pct              <= 100)) AND
           (self_consumption_with_battery_pct IS NULL OR (self_consumption_with_battery_pct >= 0 AND self_consumption_with_battery_pct <= 100))) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_sun_hours_range') THEN
  ALTER TABLE customer_profiles ADD CONSTRAINT chk_profiles_sun_hours_range
    CHECK (sun_hours_daily IS NULL OR (sun_hours_daily >= 0 AND sun_hours_daily <= 24)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_bill_metrics_nonneg') THEN
  ALTER TABLE customer_profiles ADD CONSTRAINT chk_profiles_bill_metrics_nonneg
    CHECK ((bill_uploads_count        IS NULL OR bill_uploads_count        >= 0) AND
           (highest_month_kwh         IS NULL OR highest_month_kwh         >= 0) AND
           (lowest_month_kwh          IS NULL OR lowest_month_kwh          >= 0) AND
           (average_monthly_spend_nzd IS NULL OR average_monthly_spend_nzd >= 0)) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. SUPPLIERS — (Phase 1.1)                                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_email_format') THEN
  ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_email_format
    CHECK (rep_email IS NULL OR rep_email = '' OR rep_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_phone_format') THEN
  ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_phone_format
    CHECK (rep_phone IS NULL OR rep_phone = '' OR rep_phone ~ '^[0-9+\-\s\(\)]{7,20}$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_cofund_range') THEN
  ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_cofund_range
    CHECK (marketing_cofund_pct IS NULL OR (marketing_cofund_pct >= 0 AND marketing_cofund_pct <= 100)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_margin_range') THEN
  ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_margin_range
    CHECK (default_margin_target_pct IS NULL OR (default_margin_target_pct >= 0 AND default_margin_target_pct <= 100)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_volume_target_nonneg') THEN
  ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_volume_target_nonneg
    CHECK (min_volume_target_yearly IS NULL OR min_volume_target_yearly >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_contract_date_order') THEN
  ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_contract_date_order
    CHECK (contract_renewal_date IS NULL OR contract_start_date IS NULL OR contract_renewal_date >= contract_start_date) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 7. PRODUCTS — including 019 extensions                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_wholesale_nonneg') THEN
  ALTER TABLE products ADD CONSTRAINT chk_products_wholesale_nonneg
    CHECK (wholesale_cost_nzd IS NULL OR wholesale_cost_nzd >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_margin_range') THEN
  ALTER TABLE products ADD CONSTRAINT chk_products_margin_range
    CHECK (margin_target_pct IS NULL OR (margin_target_pct >= 0 AND margin_target_pct <= 100)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_lead_time_nonneg') THEN
  ALTER TABLE products ADD CONSTRAINT chk_products_lead_time_nonneg
    CHECK (lead_time_days IS NULL OR (lead_time_days >= 0 AND lead_time_days <= 365)) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 8. REGION_DEFAULTS — (Phase 1.1)                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_regions_sun_hours_range') THEN
  ALTER TABLE region_defaults ADD CONSTRAINT chk_regions_sun_hours_range
    CHECK (sun_hours_daily IS NULL OR (sun_hours_daily >= 0 AND sun_hours_daily <= 24)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_regions_kwh_nonneg') THEN
  ALTER TABLE region_defaults ADD CONSTRAINT chk_regions_kwh_nonneg
    CHECK ((avg_household_kwh_yearly IS NULL OR avg_household_kwh_yearly >= 0) AND
           (irradiance_kwh_m2_yearly IS NULL OR irradiance_kwh_m2_yearly >= 0)) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_regions_self_consumption_range') THEN
  ALTER TABLE region_defaults ADD CONSTRAINT chk_regions_self_consumption_range
    CHECK ((typical_self_consumption_pct      IS NULL OR (typical_self_consumption_pct      >= 0 AND typical_self_consumption_pct      <= 100)) AND
           (with_battery_self_consumption_pct IS NULL OR (with_battery_self_consumption_pct >= 0 AND with_battery_self_consumption_pct <= 100))) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_regions_monthly_bill_nonneg') THEN
  ALTER TABLE region_defaults ADD CONSTRAINT chk_regions_monthly_bill_nonneg
    CHECK (avg_monthly_bill_nzd IS NULL OR avg_monthly_bill_nzd >= 0) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 9. COST_DEFAULTS — (Phase 1.1)                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_costs_amount_nonneg') THEN
  ALTER TABLE cost_defaults ADD CONSTRAINT chk_costs_amount_nonneg
    CHECK (cost_nzd >= 0) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 10. QUOTE_RECOMMENDATIONS — (Phase 1.1)                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_qrec_scores_range') THEN
  ALTER TABLE quote_recommendations ADD CONSTRAINT chk_qrec_scores_range
    CHECK ((quote_a_score IS NULL OR (quote_a_score >= 0 AND quote_a_score <= 100)) AND
           (quote_b_score IS NULL OR (quote_b_score >= 0 AND quote_b_score <= 100)) AND
           (quote_c_score IS NULL OR (quote_c_score >= 0 AND quote_c_score <= 100))) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_qrec_outcome_nonneg') THEN
  ALTER TABLE quote_recommendations ADD CONSTRAINT chk_qrec_outcome_nonneg
    CHECK (outcome_value_nzd IS NULL OR outcome_value_nzd >= 0) NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_qrec_outcome_margin_range') THEN
  ALTER TABLE quote_recommendations ADD CONSTRAINT chk_qrec_outcome_margin_range
    CHECK (outcome_margin_pct IS NULL OR (outcome_margin_pct >= -100 AND outcome_margin_pct <= 100)) NOT VALID;
END IF;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 11. FINANCE_APPLICATIONS — legacy CRM table                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_finance_email_format') THEN
  ALTER TABLE finance_applications ADD CONSTRAINT chk_finance_email_format
    CHECK (email IS NULL OR email = '' OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') NOT VALID;
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_finance_phone_format') THEN
  ALTER TABLE finance_applications ADD CONSTRAINT chk_finance_phone_format
    CHECK (phone IS NULL OR phone = '' OR phone ~ '^[0-9+\-\s\(\)]{7,20}$') NOT VALID;
END IF;

END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Migration 020 complete.
--
-- All constraints applied with NOT VALID — new writes are checked, but
-- existing rows are not back-validated. To enforce on existing data after
-- cleaning it up, run e.g.:
--
--   ALTER TABLE contacts VALIDATE CONSTRAINT chk_contacts_email_format;
--
-- Failures will list the offending rows. Fix them, then re-run VALIDATE.
-- ────────────────────────────────────────────────────────────────────────────
