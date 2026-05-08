-- Phase 4 hotfix — widen text columns on bill_analyses that turned out
-- too tight for the analysis output.
--
-- recommended_orientation VARCHAR(40) was rejecting the engine's actual
-- 45-char description ('north (slight east of north for morning load)').
-- Widen to TEXT — same Postgres storage as VARCHAR but no artificial cap.
--
-- Also pre-emptively widen plan_name and switch_to_plan, since some
-- retailer plan names ('MoveMaster (free off-peak hour daily)') push
-- close to the existing 120-char limit and we don't want a future 121st
-- character to take the page down.

ALTER TABLE bill_analyses ALTER COLUMN recommended_orientation TYPE TEXT;
ALTER TABLE bill_analyses ALTER COLUMN plan_name              TYPE TEXT;
ALTER TABLE bill_analyses ALTER COLUMN switch_to_plan         TYPE TEXT;
ALTER TABLE bill_uploads  ALTER COLUMN plan_name              TYPE TEXT;
