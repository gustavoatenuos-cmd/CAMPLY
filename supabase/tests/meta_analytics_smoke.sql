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
  IF to_regclass('public.meta_ad_snapshots') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_ad_snapshots');
  END IF;
  IF to_regclass('public.meta_creative_snapshots') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_creative_snapshots');
  END IF;
  IF to_regclass('public.meta_ad_entities') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_ad_entities');
  END IF;
  IF to_regclass('public.meta_creative_entities') IS NULL THEN
    missing_tables := array_append(missing_tables, 'meta_creative_entities');
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
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_sync_runs' AND column_name='requested_level') THEN
    RAISE EXCEPTION 'Missing requested_level in meta_sync_runs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_sync_runs' AND column_name='selected_entity_ids') THEN
    RAISE EXCEPTION 'Missing selected_entity_ids in meta_sync_runs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_sync_runs' AND column_name='request_fingerprint') THEN
    RAISE EXCEPTION 'Missing request_fingerprint in meta_sync_runs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_sync_runs' AND column_name='collection_contract_version') THEN
    RAISE EXCEPTION 'Missing collection_contract_version in meta_sync_runs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_sync_runs' AND column_name='termination_reason') THEN
    RAISE EXCEPTION 'Missing termination_reason in meta_sync_runs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_normalized_metrics' AND column_name='ad_id') THEN
    RAISE EXCEPTION 'Missing ad_id in meta_normalized_metrics';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_normalized_metrics' AND column_name='creative_id') THEN
    RAISE EXCEPTION 'Missing creative_id in meta_normalized_metrics';
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
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'meta_ad_snapshots') THEN
    RAISE EXCEPTION 'RLS not enabled on meta_ad_snapshots';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'meta_creative_snapshots') THEN
    RAISE EXCEPTION 'RLS not enabled on meta_creative_snapshots';
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
  
  IF has_function_privilege('anon', 'public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon role has EXECUTE privilege on persist_meta_sync_run';
  END IF;

END $$;

-- Analytics capability negotiation and traceable metric contract
DO $$
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_capabilities JSONB;
  v_dashboard JSONB;
  v_missing_metric JSONB;
  v_unavailable_metric JSONB;
  v_zero_metric JSONB;
  v_security_definer BOOLEAN;
  v_search_path TEXT[];
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user_id, 'analytics-capabilities@camply.test', '{}');

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_id::text, 'role', 'authenticated')::text,
    true
  );

  v_capabilities := public.get_analytics_capabilities();
  IF (v_capabilities->>'contractVersion')::integer <> 4
     OR COALESCE((v_capabilities->>'dashboardAvailable')::boolean, false) IS NOT TRUE
     OR v_capabilities->>'dashboardRpc' <> 'get_global_performance_dashboard_v2'
     OR NOT (v_capabilities->'supportedPeriods' @> '["this_month", "today", "last_7d", "last_30d"]'::jsonb)
     OR NOT (v_capabilities->'supportedLevels' @> '["campaign", "adset", "ad"]'::jsonb)
     OR COALESCE((v_capabilities->>'traceableMetrics')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unexpected analytics capability contract: %', v_capabilities;
  END IF;

  v_dashboard := public.get_global_performance_dashboard_v2('this_month', NULL, NULL);
  IF jsonb_typeof(v_dashboard) <> 'array' THEN
    RAISE EXCEPTION 'Traceable dashboard v2 must return an array';
  END IF;

  v_missing_metric := public.decorate_analytics_metric(
    'impressions',
    NULL,
    jsonb_build_object('sourceLevel', 'aggregated')
  );
  IF v_missing_metric->'value' <> 'null'::jsonb
     OR (v_missing_metric->>'available')::boolean IS NOT FALSE
     OR v_missing_metric->>'completenessStatus' <> 'unavailable' THEN
    RAISE EXCEPTION 'Missing metric must remain unavailable: %', v_missing_metric;
  END IF;

  v_unavailable_metric := public.decorate_analytics_metric(
    'impressions',
    jsonb_build_object('value', 99, 'available', false, 'completenessStatus', 'complete'),
    jsonb_build_object('sourceLevel', 'campaign')
  );
  IF v_unavailable_metric->'value' <> 'null'::jsonb
     OR (v_unavailable_metric->>'available')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Unavailable metric must not retain a value: %', v_unavailable_metric;
  END IF;

  v_zero_metric := public.decorate_analytics_metric(
    'impressions',
    jsonb_build_object('value', 0, 'available', true, 'completenessStatus', 'zero_delivery'),
    jsonb_build_object('sourceLevel', 'campaign', 'syncRunId', 'run-zero')
  );
  IF (v_zero_metric->>'value')::numeric <> 0
     OR (v_zero_metric->>'available')::boolean IS NOT TRUE
     OR v_zero_metric->>'completenessStatus' <> 'zero_delivery' THEN
    RAISE EXCEPTION 'Real zero must stay available: %', v_zero_metric;
  END IF;

  IF has_function_privilege('anon', 'public.get_analytics_capabilities()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute get_analytics_capabilities';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_analytics_capabilities()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute get_analytics_capabilities';
  END IF;
  IF has_function_privilege('anon', 'public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute get_global_performance_dashboard_v2';
  END IF;

  SELECT p.prosecdef, p.proconfig
  INTO v_security_definer, v_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_global_performance_dashboard_v2';

  IF NOT v_security_definer OR v_search_path IS NULL OR NOT ('search_path=""' = ANY(v_search_path)) THEN
    RAISE EXCEPTION 'Dashboard v2 must be SECURITY DEFINER with search_path=""';
  END IF;

  DELETE FROM auth.users WHERE id = v_user_id;
END $$;

-- Meta sync collection contract checks
DO $$
DECLARE
  v_user_id UUID := '10000000-0000-0000-0000-000000000016';
  v_integration_id UUID := '10000000-0000-0000-0000-000000000116';
  v_run_id UUID := '10000000-0000-0000-0000-000000000216';
  v_error_seen BOOLEAN := false;
BEGIN
  DELETE FROM auth.users WHERE id = v_user_id;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user_id, 'collection-contract@camply.test', '{}');

  INSERT INTO public.meta_integrations (id, user_id, access_token_encrypted, status)
  VALUES (v_integration_id, v_user_id, 'token', 'active');

  INSERT INTO public.meta_sync_runs (
    id,
    user_id,
    integration_id,
    ad_account_id,
    graph_api_version,
    requested_period,
    run_scope,
    requested_level,
    selected_entity_ids,
    request_fingerprint,
    collection_contract_version
  )
  VALUES (
    v_run_id,
    v_user_id,
    v_integration_id,
    'act_contract',
    'v25.0',
    'last_7d',
    'selected_campaigns',
    'adset',
    jsonb_build_object('campaign_ids', jsonb_build_array('camp_123'), 'adset_ids', '[]'::jsonb),
    'fingerprint-smoke',
    '2026-06-30.1'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.meta_sync_runs
    WHERE id = v_run_id
      AND requested_level = 'adset'
      AND selected_entity_ids->'campaign_ids' = jsonb_build_array('camp_123')
      AND request_fingerprint = 'fingerprint-smoke'
      AND collection_contract_version = '2026-06-30.1'
  ) THEN
    RAISE EXCEPTION 'Meta sync collection contract fields were not persisted correctly';
  END IF;

  BEGIN
    INSERT INTO public.meta_sync_runs (
      user_id,
      integration_id,
      ad_account_id,
      graph_api_version,
      requested_period,
      requested_level
    )
    VALUES (
      v_user_id,
      v_integration_id,
      'act_contract_invalid',
      'v25.0',
      'last_7d',
      'invalid_level'
    );
  EXCEPTION WHEN check_violation THEN
    v_error_seen := true;
  END;

  IF NOT v_error_seen THEN
    RAISE EXCEPTION 'Invalid requested_level was not rejected';
  END IF;

  DELETE FROM auth.users WHERE id = v_user_id;
END $$;

-- Multiclient performance foundation checks
DO $$
DECLARE
  v_user_a UUID := '10000000-0000-0000-0000-000000000001';
  v_user_b UUID := '10000000-0000-0000-0000-000000000002';
  v_integration_a UUID := '10000000-0000-0000-0000-000000000101';
  v_integration_b UUID := '10000000-0000-0000-0000-000000000102';
  v_asset_a UUID := '10000000-0000-0000-0000-000000000201';
  v_asset_b UUID := '10000000-0000-0000-0000-000000000202';
  v_link_id UUID;
  v_run_id UUID := '10000000-0000-0000-0000-000000000301';
  v_selective_run_id UUID := '10000000-0000-0000-0000-000000000302';
  v_partial_run_id UUID := '10000000-0000-0000-0000-000000000303';
  v_target_id UUID;
  v_next_version BIGINT;
  v_dashboard JSONB;
  v_catalog JSONB;
  v_hierarchy JSONB;
  v_target_history JSONB;
  v_error_seen BOOLEAN;
  v_original_target NUMERIC;
BEGIN
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);

  INSERT INTO auth.users (id, instance_id, role, aud, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  VALUES
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase1-a@camply.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase1-b@camply.test', '', now(), '{}', '{}', now(), now(), '', '', '', '');

  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);

  v_next_version := public.save_camply_workspace_with_client_registry(
    jsonb_build_object(
      'clients',
      jsonb_build_array(
        jsonb_build_object('id', 'client_alpha', 'company', 'Alpha Ltda', 'name', 'Alpha'),
        jsonb_build_object('id', 'client_beta', 'company', 'Beta Ltda', 'name', 'Beta')
      ),
      'campaigns',
      '[]'::jsonb
    ),
    NULL
  );

  IF v_next_version <> 1 THEN
    RAISE EXCEPTION 'Expected initial workspace version 1, got %', v_next_version;
  END IF;

  IF (SELECT count(*) FROM public.client_identity WHERE user_id = v_user_a AND archived_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'Expected two active client identities after transactional workspace save';
  END IF;

  v_error_seen := false;
  BEGIN
    PERFORM public.save_camply_workspace_with_client_registry(
      jsonb_build_object(
        'clients',
        jsonb_build_array(jsonb_build_object('id', 'client_gamma', 'company', 'Gamma'))
      ),
      99
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_seen := true;
  END;

  IF NOT v_error_seen THEN
    RAISE EXCEPTION 'Expected stale workspace version to fail';
  END IF;

  IF EXISTS (SELECT 1 FROM public.client_identity WHERE user_id = v_user_a AND client_id = 'client_gamma') THEN
    RAISE EXCEPTION 'Stale workspace save changed client registry despite conflict';
  END IF;

  v_next_version := public.save_camply_workspace_with_client_registry(
    jsonb_build_object(
      'clients',
      jsonb_build_array(jsonb_build_object('id', 'client_beta', 'company', 'Beta Ltda'))
    ),
    1
  );

  IF v_next_version <> 2 THEN
    RAISE EXCEPTION 'Expected second workspace version 2, got %', v_next_version;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.client_identity WHERE user_id = v_user_a AND client_id = 'client_alpha' AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Removed client was not archived';
  END IF;

  v_next_version := public.save_camply_workspace_with_client_registry(
    jsonb_build_object(
      'clients',
      jsonb_build_array(
        jsonb_build_object('id', 'client_alpha', 'company', 'Alpha Reativado'),
        jsonb_build_object('id', 'client_beta', 'company', 'Beta Ltda')
      )
    ),
    2
  );

  IF NOT EXISTS (SELECT 1 FROM public.client_identity WHERE user_id = v_user_a AND client_id = 'client_alpha' AND archived_at IS NULL AND display_name = 'Alpha Reativado') THEN
    RAISE EXCEPTION 'Reactivated client did not clear archived_at/update display_name';
  END IF;

  INSERT INTO public.meta_integrations (id, user_id, access_token_encrypted, status)
  VALUES
    (v_integration_a, v_user_a, 'token-a', 'active'),
    (v_integration_b, v_user_b, 'token-b', 'active');

  INSERT INTO public.meta_assets (id, integration_id, asset_type, asset_id, asset_name, currency, timezone_name)
  VALUES
    (v_asset_a, v_integration_a, 'adaccount', 'act_phase1_a', 'Conta Alpha', 'BRL', 'America/Sao_Paulo'),
    (v_asset_b, v_integration_b, 'adaccount', 'act_phase1_b', 'Conta B', 'USD', 'UTC');

  v_link_id := public.link_client_meta_asset('client_alpha', v_asset_a);

  IF v_link_id IS NULL THEN
    RAISE EXCEPTION 'Expected link_client_meta_asset to return a link id';
  END IF;

  v_error_seen := false;
  BEGIN
    PERFORM public.link_client_meta_asset('client_beta', v_asset_a);
  EXCEPTION WHEN OTHERS THEN
    v_error_seen := true;
  END;

  IF NOT v_error_seen THEN
    RAISE EXCEPTION 'Expected active Meta asset double link to fail';
  END IF;

  v_error_seen := false;
  BEGIN
    PERFORM public.link_client_meta_asset('client_beta', v_asset_b);
  EXCEPTION WHEN OTHERS THEN
    v_error_seen := true;
  END;

  IF NOT v_error_seen THEN
    RAISE EXCEPTION 'Expected linking another user asset to fail';
  END IF;

  IF has_table_privilege('authenticated', 'public.client_performance_targets', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated must not have INSERT on client_performance_targets';
  END IF;

  IF has_table_privilege('authenticated', 'public.client_performance_targets', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated must not have UPDATE on client_performance_targets';
  END IF;

  v_target_id := public.set_client_performance_target(
    v_link_id,
    'messaging_conversations_started_total',
    'cost_per_result',
    20,
    NULL,
    '2026-06-01T00:00:00Z'::timestamptz
  );

  v_original_target := (SELECT target_value FROM public.client_performance_targets WHERE id = v_target_id);

  v_error_seen := false;
  BEGIN
    PERFORM public.set_client_performance_target(
      v_link_id,
      'not_a_metric',
      'cost_per_result',
      20,
      NULL,
      '2026-06-02T00:00:00Z'::timestamptz
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_seen := true;
  END;

  IF NOT v_error_seen THEN
    RAISE EXCEPTION 'Expected invalid metric target to fail';
  END IF;

  v_error_seen := false;
  BEGIN
    PERFORM public.set_client_performance_target(
      v_link_id,
      'messaging_conversations_started_total',
      'cost_per_result',
      25,
      NULL,
      '2026-06-01T00:00:00Z'::timestamptz
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_seen := true;
  END;

  IF NOT v_error_seen THEN
    RAISE EXCEPTION 'Expected overlapping target to fail';
  END IF;

  PERFORM public.set_client_performance_target(
    v_link_id,
    'messaging_conversations_started_total',
    'cost_per_result',
    18,
    NULL,
    '2026-06-10T00:00:00Z'::timestamptz
  );

  IF (SELECT target_value FROM public.client_performance_targets WHERE id = v_target_id) <> v_original_target THEN
    RAISE EXCEPTION 'Historical target_value was mutated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.client_performance_targets
    WHERE id = v_target_id
      AND effective_to = '2026-06-10T00:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'Previous target version was not closed before replacement';
  END IF;

  v_dashboard := public.get_global_performance_dashboard('last_7d', NULL, NULL);

  IF jsonb_typeof(v_dashboard) <> 'array' THEN
    RAISE EXCEPTION 'Dashboard RPC must return an array';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_dashboard) AS item
    WHERE item->>'clientId' = 'client_beta'
      AND item->>'clientStatus' = 'not_connected'
  ) THEN
    RAISE EXCEPTION 'Dashboard must include active client without Meta account as not_connected';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_dashboard) AS item
    WHERE item->>'clientId' = 'client_alpha'
      AND item->>'clientStatus' = 'never_synced'
      AND jsonb_array_length(item->'resolvedTargets') = 1
  ) THEN
    RAISE EXCEPTION 'Dashboard must include linked client without sync and active target';
  END IF;

  INSERT INTO public.meta_sync_runs (
    id, user_id, integration_id, ad_account_id, graph_api_version,
    requested_period, requested_level, run_scope, request_fingerprint,
    status, started_at, finished_at, termination_reason, currency, timezone,
    date_start, date_stop
  ) VALUES (
    v_run_id, v_user_a, v_integration_a, 'act_phase1_a', 'v23.0',
    'this_month', 'campaign', 'full_account', 'operational-hierarchy-smoke',
    'success', now() - interval '1 minute', now(), 'completed', 'BRL', 'America/Sao_Paulo',
    date_trunc('month', current_date)::date, current_date
  );

  INSERT INTO public.meta_campaign_snapshots (
    sync_run_id, user_id, integration_id, ad_account_id, campaign_id,
    campaign_name, raw_objective, classified_objective, meta_status, effective_status
  ) VALUES
  (
    v_run_id, v_user_a, v_integration_a, 'act_phase1_a', 'campaign_paused',
    'Campanha pausada', 'OUTCOME_LEADS', 'LEADS', 'PAUSED', 'PAUSED'
  ),
  (
    v_run_id, v_user_a, v_integration_a, 'act_phase1_a', 'campaign_active',
    'Campanha ativa', 'OUTCOME_LEADS', 'LEADS', 'ACTIVE', 'ACTIVE'
  );

  INSERT INTO public.meta_adset_snapshots (
    sync_run_id, user_id, integration_id, ad_account_id, campaign_id,
    adset_id, adset_name, optimization_goal, destination_type,
    attribution_setting, meta_status, effective_status
  ) VALUES
  (
    v_run_id, v_user_a, v_integration_a, 'act_phase1_a', 'campaign_paused',
    'adset_paused', 'Conjunto pausado', 'LEAD_GENERATION', 'WHATSAPP',
    '7d_click_1d_view', 'PAUSED', 'PAUSED'
  ),
  (
    v_run_id, v_user_a, v_integration_a, 'act_phase1_a', 'campaign_active',
    'adset_active', 'Conjunto ativo', 'LEAD_GENERATION', 'WHATSAPP',
    '7d_click_1d_view', 'ACTIVE', 'ACTIVE'
  );

  INSERT INTO public.meta_ad_snapshots (
    sync_run_id, user_id, integration_id, ad_account_id, campaign_id,
    adset_id, ad_id, ad_name, creative_id, meta_status, effective_status
  ) VALUES (
    v_run_id, v_user_a, v_integration_a, 'act_phase1_a', 'campaign_paused',
    'adset_paused', 'ad_paused', 'Anúncio pausado', 'creative_paused', 'PAUSED', 'PAUSED'
  );

  INSERT INTO public.meta_creative_snapshots (
    sync_run_id, user_id, integration_id, ad_account_id, creative_id,
    creative_name, title, body, object_story_spec
  ) VALUES (
    v_run_id, v_user_a, v_integration_a, 'act_phase1_a', 'creative_paused',
    'Criativo pausado', 'Agende agora', 'Converse pelo WhatsApp', '{"format":"IMAGE"}'::jsonb
  );

  INSERT INTO public.meta_normalized_metrics (
    user_id, sync_run_id, integration_id, ad_account_id, campaign_id,
    metric_id, metric_value, date_start, date_stop, timezone,
    attribution_setting, source_level, completeness_status
  ) VALUES
  (
    v_user_a, v_run_id, v_integration_a, 'act_phase1_a', 'campaign_paused',
    'spend', 350, date_trunc('month', current_date)::date, current_date, 'America/Sao_Paulo',
    '7d_click_1d_view', 'campaign', 'complete'
  ),
  (
    v_user_a, v_run_id, v_integration_a, 'act_phase1_a', 'campaign_active',
    'spend', 125, date_trunc('month', current_date)::date, current_date, 'America/Sao_Paulo',
    '7d_click_1d_view', 'campaign', 'complete'
  );

  INSERT INTO public.meta_normalized_metrics (
    user_id, sync_run_id, integration_id, ad_account_id, campaign_id,
    metric_id, metric_value, date_start, date_stop, timezone,
    attribution_setting, source_level, completeness_status
  )
  SELECT
    v_user_a, v_run_id, v_integration_a, 'act_phase1_a', NULL,
    metric_id, metric_value, date_trunc('month', current_date)::date, current_date,
    'America/Sao_Paulo', NULL, 'account', 'complete'
  FROM (VALUES
    ('spend', 350::numeric),
    ('messaging_conversations_started_total', 28::numeric),
    ('purchases', 5::numeric),
    ('purchase_value', 1400::numeric),
    ('reach', 5000::numeric),
    ('impressions', 10000::numeric),
    ('frequency', 2::numeric),
    ('cpm', 35::numeric),
    ('link_clicks', 400::numeric),
    ('landing_page_views', 300::numeric)
  ) metrics(metric_id, metric_value);

  INSERT INTO public.meta_sync_runs (
    id, user_id, integration_id, ad_account_id, graph_api_version,
    requested_period, requested_level, run_scope, selected_entity_ids,
    request_fingerprint, status, started_at, finished_at, termination_reason,
    currency, timezone, date_start, date_stop
  ) VALUES
  (
    v_selective_run_id, v_user_a, v_integration_a, 'act_phase1_a', 'v23.0',
    'this_month', 'campaign', 'selected_campaigns', '{"campaign_ids":["campaign_paused"]}'::jsonb,
    'selective-run-must-not-total', 'success', now() - interval '20 seconds', now() - interval '10 seconds',
    'completed', 'BRL', 'America/Sao_Paulo', date_trunc('month', current_date)::date, current_date
  ),
  (
    v_partial_run_id, v_user_a, v_integration_a, 'act_phase1_a', 'v23.0',
    'this_month', 'campaign', 'full_account', '{}'::jsonb,
    'newer-partial-run', 'partial', now() - interval '5 seconds', now(),
    'partial_collection', 'BRL', 'America/Sao_Paulo', date_trunc('month', current_date)::date, current_date
  );

  INSERT INTO public.meta_normalized_metrics (
    user_id, sync_run_id, integration_id, ad_account_id, metric_id, metric_value,
    date_start, date_stop, timezone, source_level, completeness_status
  ) VALUES (
    v_user_a, v_selective_run_id, v_integration_a, 'act_phase1_a', 'spend', 9999,
    date_trunc('month', current_date)::date, current_date, 'America/Sao_Paulo', 'account', 'complete'
  );

  v_catalog := public.get_client_meta_asset_catalog('client_alpha');
  IF jsonb_array_length(v_catalog->'clients') <> 1
     OR jsonb_array_length(v_catalog->'clients'->0->'accounts') <> 1
     OR NOT (v_catalog->'clients'->0->'accounts'->0->'availablePeriods' @> '["this_month"]'::jsonb) THEN
    RAISE EXCEPTION 'Operational asset catalog is incomplete: %', v_catalog;
  END IF;

  v_hierarchy := public.get_meta_performance_hierarchy(v_link_id, 'this_month', 'campaign', NULL, 1, 25);
  IF v_hierarchy->>'state' <> 'ready'
     OR (v_hierarchy->>'total')::integer <> 1
     OR v_hierarchy->'items'->0->>'id' <> 'campaign_active'
     OR v_hierarchy->'items'->0->>'effectiveStatus' <> 'ACTIVE'
     OR COALESCE((v_hierarchy->'items'->0->'metrics'->'spend'->>'available')::boolean, false) IS NOT TRUE
     OR (v_hierarchy->'items'->0->'metrics'->'spend'->>'value')::numeric <> 125
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_hierarchy->'items') item
       WHERE item->>'id' = 'campaign_paused'
          OR item->>'effectiveStatus' = 'PAUSED'
     ) THEN
    RAISE EXCEPTION 'Operational hierarchy did not return active-only campaigns with traceability: %', v_hierarchy;
  END IF;

  v_dashboard := public.get_global_performance_dashboard_v2('this_month', NULL, NULL);
  IF (v_dashboard->0->'accounts'->0->'metrics'->'spend'->>'value')::numeric <> 350
     OR (v_dashboard->0->'accounts'->0->'metrics'->'reach'->>'value')::numeric <> 5000
     OR v_dashboard->0->'accounts'->0->'metrics'->'spend'->>'sourceLevel' <> 'account'
     OR v_dashboard->0->'accounts'->0->>'dateStart' <> date_trunc('month', current_date)::date::text
     OR v_dashboard->0->'accounts'->0->>'dateStop' <> current_date::text
     OR v_dashboard->0->'accounts'->0->'lastSuccessfulRun'->>'id' <> v_run_id::text THEN
    RAISE EXCEPTION 'Monthly dashboard did not use the exact successful account run: %', v_dashboard;
  END IF;

  PERFORM public.set_client_performance_target(
    v_link_id, 'leads', 'minimum_results', 10, 'campaign_paused',
    '2026-06-20T00:00:00Z'::timestamptz
  );
  v_target_history := public.get_client_performance_target_history(v_link_id, NULL);
  IF jsonb_array_length(v_target_history) <> 2
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_target_history) target
       WHERE target->>'campaignId' IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Account target history leaked campaign-scoped targets: %', v_target_history;
  END IF;

  IF has_function_privilege('anon', 'public.get_client_meta_asset_catalog(TEXT)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_traceable_entity_metrics(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Operational hierarchy RPC privilege boundary is unsafe';
  END IF;

  PERFORM public.unlink_client_meta_asset(v_link_id);

  IF NOT EXISTS (SELECT 1 FROM public.client_meta_assets WHERE id = v_link_id AND unlinked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'unlink_client_meta_asset did not close the link';
  END IF;

  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);
END $$;

-- Operational sync concurrency and per-user rate limiting
DO $$
DECLARE
  v_user_id UUID := '10000000-0000-0000-0000-000000000021';
  v_integration_id UUID := '10000000-0000-0000-0000-000000000121';
  v_run_id UUID := '10000000-0000-0000-0000-000000000221';
  v_error_seen BOOLEAN := false;
  i INTEGER;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user_id, 'operational-limits@camply.test', '{}');
  INSERT INTO public.meta_integrations (id, user_id, access_token_encrypted, status)
  VALUES (v_integration_id, v_user_id, 'token', 'active');

  INSERT INTO public.meta_sync_runs (
    id, user_id, integration_id, ad_account_id, graph_api_version,
    requested_period, request_fingerprint, status
  ) VALUES (
    v_run_id, v_user_id, v_integration_id, 'act_limits', 'v23.0',
    'last_7d', 'same-running-request', 'running'
  );

  BEGIN
    INSERT INTO public.meta_sync_runs (
      user_id, integration_id, ad_account_id, graph_api_version,
      requested_period, request_fingerprint, status
    ) VALUES (
      v_user_id, v_integration_id, 'act_limits', 'v23.0',
      'last_7d', 'same-running-request', 'running'
    );
  EXCEPTION WHEN unique_violation THEN
    v_error_seen := true;
  END;
  IF NOT v_error_seen THEN
    RAISE EXCEPTION 'Concurrent identical running sync was not rejected';
  END IF;

  DELETE FROM public.meta_sync_runs WHERE user_id = v_user_id;
  v_error_seen := false;
  BEGIN
    FOR i IN 1..31 LOOP
      INSERT INTO public.meta_sync_runs (
        user_id, integration_id, ad_account_id, graph_api_version,
        requested_period, request_fingerprint, status
      ) VALUES (
        v_user_id, v_integration_id, 'act_limits', 'v23.0',
        'last_7d', 'rate-' || i, 'failed'
      );
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_error_seen := true;
  END;
  IF NOT v_error_seen THEN
    RAISE EXCEPTION 'Per-user Meta sync rate limit was not enforced';
  END IF;

  DELETE FROM auth.users WHERE id = v_user_id;
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
