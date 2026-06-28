-- Migration: Mixed Attribution Support
-- Description: Adds MIXED to meta_objective enum, extends normalized metrics, and enforces idempotency.

-- 1. Add MIXED to meta_objective enum safely
ALTER TYPE meta_objective ADD VALUE IF NOT EXISTS 'MIXED';

-- 2. Add new columns to meta_normalized_metrics
ALTER TABLE meta_normalized_metrics ADD COLUMN IF NOT EXISTS source_level TEXT DEFAULT 'campaign';
ALTER TABLE meta_normalized_metrics ADD COLUMN IF NOT EXISTS completeness_status TEXT DEFAULT 'complete';

-- Update existing rows to have default values for newly strictly required fields (if any are null)
UPDATE meta_normalized_metrics SET adset_id = 'N/A' WHERE adset_id IS NULL;
UPDATE meta_normalized_metrics SET attribution_setting = 'UNKNOWN' WHERE attribution_setting IS NULL;
UPDATE meta_normalized_metrics SET action_type = 'N/A' WHERE action_type IS NULL;
UPDATE meta_normalized_metrics SET source_field = 'N/A' WHERE source_field IS NULL;
UPDATE meta_normalized_metrics SET date_start = '2000-01-01' WHERE date_start IS NULL;
UPDATE meta_normalized_metrics SET date_stop = '2000-01-01' WHERE date_stop IS NULL;
UPDATE meta_normalized_metrics SET timezone = 'UTC' WHERE timezone IS NULL;

-- 3. Add idempotent unique constraint
-- To allow upsert, we need a UNIQUE constraint.
-- COALESCE is used in unique indexes if we want to allow nulls, but here we just ensure no nulls in the constraint by using a UNIQUE index or by adding a constraint.
-- A UNIQUE constraint constraint allows ON CONFLICT in INSERT.
ALTER TABLE meta_normalized_metrics 
ADD CONSTRAINT meta_normalized_metrics_idempotency_key 
UNIQUE (user_id, sync_run_id, ad_account_id, campaign_id, adset_id, metric_id, date_start, date_stop, attribution_setting, source_level);
