-- Migration: Mixed Attribution Support
-- Keeps unknown source data nullable, records explicit completeness states and
-- builds an idempotency index after deterministic exact-key deduplication.

ALTER TYPE meta_objective ADD VALUE IF NOT EXISTS 'MIXED';

ALTER TABLE meta_adset_entities
  ADD COLUMN IF NOT EXISTS classified_objective meta_objective;

ALTER TABLE meta_normalized_metrics
  ADD COLUMN IF NOT EXISTS source_level TEXT;

ALTER TABLE meta_normalized_metrics
  ADD COLUMN IF NOT EXISTS completeness_status TEXT;

-- Repair placeholder values written by the earlier draft of this migration.
-- UTC is only cleared when it accompanied the synthetic date placeholders, so
-- a legitimate UTC account remains intact.
UPDATE meta_normalized_metrics
SET
  source_level = NULL,
  completeness_status = NULL
WHERE adset_id = 'N/A'
  AND action_type = 'N/A'
  AND source_field = 'N/A'
  AND date_start = DATE '2000-01-01'
  AND date_stop = DATE '2000-01-01';

UPDATE meta_normalized_metrics
SET timezone = NULL
WHERE timezone = 'UTC'
  AND (date_start = DATE '2000-01-01' OR date_stop = DATE '2000-01-01');

UPDATE meta_normalized_metrics
SET
  adset_id = NULLIF(adset_id, 'N/A'),
  action_type = NULLIF(action_type, 'N/A'),
  source_field = NULLIF(source_field, 'N/A'),
  date_start = CASE WHEN date_start = DATE '2000-01-01' THEN NULL ELSE date_start END,
  date_stop = CASE WHEN date_stop = DATE '2000-01-01' THEN NULL ELSE date_stop END;

UPDATE meta_normalized_metrics
SET source_level = NULL
WHERE source_level IS NOT NULL
  AND source_level NOT IN ('campaign', 'adset', 'ad');

UPDATE meta_normalized_metrics
SET completeness_status = 'validation_error'
WHERE completeness_status IS NOT NULL
  AND completeness_status NOT IN (
    'zero_delivery',
    'missing_insight_row',
    'partial_page',
    'timeout',
    'api_error',
    'validation_error',
    'complete'
  );

ALTER TABLE meta_normalized_metrics
  ALTER COLUMN source_level DROP DEFAULT;

ALTER TABLE meta_normalized_metrics
  ALTER COLUMN completeness_status DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meta_normalized_metrics_source_level_check'
  ) THEN
    ALTER TABLE meta_normalized_metrics
      ADD CONSTRAINT meta_normalized_metrics_source_level_check
      CHECK (source_level IS NULL OR source_level IN ('campaign', 'adset', 'ad'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meta_normalized_metrics_completeness_check'
  ) THEN
    ALTER TABLE meta_normalized_metrics
      ADD CONSTRAINT meta_normalized_metrics_completeness_check
      CHECK (
        completeness_status IS NULL OR completeness_status IN (
          'zero_delivery',
          'missing_insight_row',
          'partial_page',
          'timeout',
          'api_error',
          'validation_error',
          'complete'
        )
      );
  END IF;
END $$;

-- The old draft created a constraint after replacing nulls with fake values.
-- Remove it first, then keep the newest exact duplicate for each natural key.
ALTER TABLE meta_normalized_metrics
  DROP CONSTRAINT IF EXISTS meta_normalized_metrics_idempotency_key;

DROP INDEX IF EXISTS meta_normalized_metrics_idempotency_key;

WITH ranked_duplicates AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        user_id,
        sync_run_id,
        ad_account_id,
        campaign_id,
        adset_id,
        metric_id,
        date_start,
        date_stop,
        attribution_setting,
        source_level
      ORDER BY created_at DESC, id DESC
    ) AS duplicate_rank
  FROM meta_normalized_metrics
)
DELETE FROM meta_normalized_metrics AS metrics
USING ranked_duplicates AS duplicates
WHERE metrics.id = duplicates.id
  AND duplicates.duplicate_rank > 1;

-- PostgreSQL 15+ treats nulls as equal for this uniqueness rule without
-- polluting stored analytics data with sentinel values.
CREATE UNIQUE INDEX IF NOT EXISTS meta_normalized_metrics_idempotency_key
ON meta_normalized_metrics (
  user_id,
  sync_run_id,
  ad_account_id,
  campaign_id,
  adset_id,
  metric_id,
  date_start,
  date_stop,
  attribution_setting,
  source_level
) NULLS NOT DISTINCT;
