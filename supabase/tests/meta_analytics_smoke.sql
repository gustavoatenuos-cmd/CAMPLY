\set ON_ERROR_STOP on

DO $$
DECLARE
  missing_tables text[] := ARRAY[]::text[];
  missing_columns text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.meta_sync_runs') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_sync_runs');
  END IF;
  IF to_regclass('public.meta_raw_snapshots') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_raw_snapshots');
  END IF;
  IF to_regclass('public.meta_campaign_entities') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_campaign_entities');
  END IF;
  IF to_regclass('public.meta_adset_entities') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_adset_entities');
  END IF;
  IF to_regclass('public.meta_normalized_metrics') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_normalized_metrics');
  END IF;

  IF cardinality(missing_tables) > 0 THEN
    RAISE EXCEPTION 'Missing Meta analytics tables: %', array_to_string(missing_tables, ', ');
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
  INTO missing_columns
  FROM (
    VALUES
      ('adset_id'),
      ('attribution_setting'),
      ('source_level'),
      ('source_field'),
      ('action_type'),
      ('calculation_metadata'),
      ('completeness_status'),
      ('timezone'),
      ('date_start'),
      ('date_stop')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'meta_normalized_metrics'
      AND c.column_name = required.column_name
  );

  IF cardinality(missing_columns) > 0 THEN
    RAISE EXCEPTION 'Missing meta_normalized_metrics columns: %', array_to_string(missing_columns, ', ');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'meta_objective'
      AND e.enumlabel = 'MIXED'
  ) THEN
    RAISE EXCEPTION 'meta_objective enum does not contain MIXED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'meta_normalized_metrics'
      AND indexname = 'meta_normalized_metrics_idempotency_key'
  ) THEN
    RAISE EXCEPTION 'Missing meta_normalized_metrics_idempotency_key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meta_normalized_metrics_source_level_check'
  ) THEN
    RAISE EXCEPTION 'Missing source_level check constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meta_normalized_metrics_completeness_check'
  ) THEN
    RAISE EXCEPTION 'Missing completeness_status check constraint';
  END IF;
END $$;

SELECT
  'meta_analytics_schema_ok' AS check_name,
  current_database() AS database_name,
  now() AS checked_at;
