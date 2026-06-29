\set ON_ERROR_STOP on

DO $$
DECLARE
  missing_tables text[] := ARRAY[]::text[];
  missing_columns text[] := ARRAY[]::text[];
  rpc_count int;
  rpc_security_type boolean;
  rpc_search_path text[];
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
  IF to_regclass('public.meta_campaign_snapshots') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_campaign_snapshots');
  END IF;
  IF to_regclass('public.meta_adset_snapshots') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_adset_snapshots');
  END IF;

  IF cardinality(missing_tables) > 0 THEN
    RAISE EXCEPTION 'Missing Meta analytics tables: %', array_to_string(missing_tables, ', ');
  END IF;

  -- Verify new integration_id and last_sync_run_id columns exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_campaign_entities' AND column_name='integration_id') THEN
    RAISE EXCEPTION 'Missing integration_id in meta_campaign_entities';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_campaign_entities' AND column_name='last_sync_run_id') THEN
    RAISE EXCEPTION 'Missing last_sync_run_id in meta_campaign_entities';
  END IF;
  
  -- Check composite UNIQUE on meta_sync_runs
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_sync_runs_cross_fk_unique') THEN
    RAISE EXCEPTION 'Missing composite UNIQUE meta_sync_runs_cross_fk_unique';
  END IF;

  -- Check composite FK on meta_campaign_entities
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_campaign_entities_cross_fk') THEN
    RAISE EXCEPTION 'Missing composite FK meta_campaign_entities_cross_fk';
  END IF;

  -- Check triggers for immutability
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'prevent_campaign_snapshot_update') THEN
    RAISE EXCEPTION 'Missing immutability trigger prevent_campaign_snapshot_update';
  END IF;

  -- RLS Checks
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'meta_campaign_snapshots') THEN
    RAISE EXCEPTION 'RLS not enabled on meta_campaign_snapshots';
  END IF;

  -- Check RPC single signature
  SELECT count(*) INTO rpc_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'persist_meta_sync_run';

  IF rpc_count != 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 signature for persist_meta_sync_run, found %', rpc_count;
  END IF;

  -- Check RPC privileges (SECURITY DEFINER and search_path)
  SELECT p.prosecdef, p.proconfig INTO rpc_security_type, rpc_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'persist_meta_sync_run';

  IF NOT rpc_security_type THEN
    RAISE EXCEPTION 'persist_meta_sync_run must be SECURITY DEFINER';
  END IF;
  
  IF rpc_search_path IS NULL OR NOT ('search_path=""' = ANY(rpc_search_path)) THEN
    RAISE EXCEPTION 'persist_meta_sync_run must have search_path=""';
  END IF;
  
  IF has_function_privilege('anon', 'public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, INTEGER, INTEGER)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon role has EXECUTE privilege on persist_meta_sync_run';
  END IF;

END $$;

SELECT
  'meta_analytics_schema_ok' AS check_name,
  current_database() AS database_name,
  now() AS checked_at;

-- Functional Immutability & Constraint Checks
DO $$
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_integration_id UUID := gen_random_uuid();
  v_run_id UUID := gen_random_uuid();
  v_ad_account_id TEXT := 'act_smoke_123';
  v_campaign_snapshot_id UUID := gen_random_uuid();
BEGIN
  -- 1. Setup mock context
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_user_id, 'smoke@camply.test', '{}');
  INSERT INTO meta_integrations (id, user_id, access_token_encrypted, status) VALUES (v_integration_id, v_user_id, 'token', 'active');
  INSERT INTO meta_sync_runs (id, user_id, integration_id, ad_account_id, graph_api_version, requested_period, run_scope)
  VALUES (v_run_id, v_user_id, v_integration_id, v_ad_account_id, 'v20.0', 'last_7d', 'full_account');

  -- 2. Insert campaign snapshot
  INSERT INTO public.meta_campaign_snapshots (id, sync_run_id, user_id, integration_id, ad_account_id, campaign_id, campaign_name, meta_status, effective_status)
  VALUES (v_campaign_snapshot_id, v_run_id, v_user_id, v_integration_id, v_ad_account_id, 'camp_smoke', 'Smoke', 'ACTIVE', 'ACTIVE');

  -- 3. Block Update test
  BEGIN
    UPDATE public.meta_campaign_snapshots SET campaign_name = 'tampered' WHERE id = v_campaign_snapshot_id;
    RAISE EXCEPTION 'Snapshot UPDATE was not blocked!';
  EXCEPTION WHEN OTHERS THEN
    -- Expected Exception
  END;

  -- 4. Block Direct Delete test
  BEGIN
    DELETE FROM public.meta_campaign_snapshots WHERE id = v_campaign_snapshot_id;
    RAISE EXCEPTION 'Snapshot direct DELETE was not blocked!';
  EXCEPTION WHEN OTHERS THEN
    -- Expected Exception
  END;

  -- 5. Cascade Delete test (should work)
  DELETE FROM public.meta_sync_runs WHERE id = v_run_id;
  IF EXISTS (SELECT 1 FROM public.meta_campaign_snapshots WHERE id = v_campaign_snapshot_id) THEN
    RAISE EXCEPTION 'Snapshot CASCADE delete failed!';
  END IF;

  -- Cleanup
  DELETE FROM meta_integrations WHERE id = v_integration_id;
  DELETE FROM auth.users WHERE id = v_user_id;

END $$;
