-- Campaign drill-down must read dashboard periods as slices of the single
-- last_90d sync base, and aggregate daily entity metrics over the slice.
DO $$
DECLARE
  v_user UUID := '20000000-0000-0000-0000-000000000901';
  v_integration UUID := '20000000-0000-0000-0000-000000000902';
  v_asset UUID := '20000000-0000-0000-0000-000000000903';
  v_run UUID := '20000000-0000-0000-0000-000000000904';
  v_link UUID;
  v_today DATE := (timezone('America/Sao_Paulo', now()))::date;
  v_h JSONB;
  v_m JSONB;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user, 'hierarchy-slices@camply.test', '{}');

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  PERFORM public.save_camply_workspace_with_client_registry(
    jsonb_build_object('clients', jsonb_build_array(jsonb_build_object('id', 'client_slices', 'company', 'Slices Ltda'))),
    NULL
  );

  INSERT INTO public.meta_integrations (id, user_id, access_token_encrypted, status)
  VALUES (v_integration, v_user, 'token', 'active');
  INSERT INTO public.meta_assets (id, integration_id, asset_type, asset_id, asset_name, currency, timezone_name)
  VALUES (v_asset, v_integration, 'adaccount', 'act_slices', 'Conta Slices', 'BRL', 'America/Sao_Paulo');
  v_link := public.link_client_meta_asset('client_slices', v_asset);

  INSERT INTO public.meta_sync_runs (
    id, user_id, integration_id, ad_account_id, graph_api_version,
    requested_period, requested_level, run_scope, request_fingerprint,
    status, started_at, finished_at, termination_reason, currency, timezone,
    date_start, date_stop
  ) VALUES (
    v_run, v_user, v_integration, 'act_slices', 'v23.0',
    'last_90d', 'campaign', 'full_account', 'hierarchy-slices',
    'success', now() - interval '1 minute', now(), 'completed', 'BRL', 'America/Sao_Paulo',
    v_today - 89, v_today
  );

  INSERT INTO public.meta_campaign_snapshots (
    sync_run_id, user_id, integration_id, ad_account_id, campaign_id,
    campaign_name, raw_objective, classified_objective, meta_status, effective_status
  ) VALUES (
    v_run, v_user, v_integration, 'act_slices', 'camp_sales',
    'Vendas', 'OUTCOME_SALES', 'SALES', 'ACTIVE', 'ACTIVE'
  ), (
    -- ACTIVE in Meta but no delivery: sorts first by name, must be listed last.
    v_run, v_user, v_integration, 'act_slices', 'camp_idle',
    'AAA Sem entrega', 'OUTCOME_SALES', 'SALES', 'ACTIVE', 'ACTIVE'
  );

  -- Two delivery days: yesterday (inside every slice but today) and 40 days ago
  -- (only inside last_90d).
  INSERT INTO public.meta_normalized_metrics (
    user_id, sync_run_id, integration_id, ad_account_id, campaign_id,
    metric_id, metric_value, date_start, date_stop, timezone, source_level, completeness_status
  )
  SELECT v_user, v_run, v_integration, 'act_slices', 'camp_sales',
         d.metric_id, d.value, d.day, d.day, 'America/Sao_Paulo', 'campaign', 'complete'
  FROM (VALUES
    ('spend', 10::numeric, v_today - 1), ('impressions', 1000::numeric, v_today - 1),
    ('purchases', 2::numeric, v_today - 1), ('purchase_value', 50::numeric, v_today - 1),
    ('reach', 800::numeric, v_today - 1),
    ('spend', 100::numeric, v_today - 40), ('impressions', 4000::numeric, v_today - 40),
    ('purchases', 3::numeric, v_today - 40), ('purchase_value', 150::numeric, v_today - 40),
    ('reach', 3000::numeric, v_today - 40)
  ) AS d(metric_id, value, day);

  -- last_30d: previously period_not_synced because no run had requested_period = last_30d.
  v_h := public.get_meta_performance_hierarchy(v_link, 'last_30d', 'campaign', NULL, 1, 25);
  v_m := v_h->'items'->0->'metrics';
  IF v_h->>'state' <> 'ready' OR (v_h->>'total')::int <> 2 THEN
    RAISE EXCEPTION 'last_30d must read the last_90d base: %', v_h;
  END IF;
  IF v_h->'items'->0->>'id' <> 'camp_sales' OR v_h->'items'->1->>'id' <> 'camp_idle'
     OR (v_h->'items'->1->'metrics'->'spend'->>'value')::numeric <> 0
  THEN
    RAISE EXCEPTION 'campaigns that delivered in the slice must come first: %', v_h->'items';
  END IF;
  IF (v_m->'spend'->>'value')::numeric <> 10
     OR (v_m->'purchases'->>'value')::numeric <> 2
     OR (v_m->'cpa'->>'value')::numeric <> 5
     OR (v_m->'purchase_roas'->>'value')::numeric <> 5
     OR (v_m->'cpm'->>'value')::numeric <> 10
     OR v_m->'reach'->>'value' IS NOT NULL
     OR v_m->'spend'->>'dateStart' <> (v_today - 29)::text
     OR v_h->>'dateStart' <> (v_today - 29)::text
  THEN
    RAISE EXCEPTION 'last_30d slice metrics are wrong: %', v_m;
  END IF;

  -- last_90d sums both delivery days (the legacy reader returned a single row).
  v_h := public.get_meta_performance_hierarchy(v_link, 'last_90d', 'campaign', NULL, 1, 25);
  v_m := v_h->'items'->0->'metrics';
  IF (v_m->'spend'->>'value')::numeric <> 110
     OR (v_m->'purchases'->>'value')::numeric <> 5
     OR (v_m->'cpa'->>'value')::numeric <> 22
     OR (v_m->'cpm'->>'value')::numeric <> 22
  THEN
    RAISE EXCEPTION 'last_90d must aggregate the whole base: %', v_m;
  END IF;

  -- yesterday is a single day: reach is meaningful again.
  v_h := public.get_meta_performance_hierarchy(v_link, 'yesterday', 'campaign', NULL, 1, 25);
  v_m := v_h->'items'->0->'metrics';
  IF (v_m->'spend'->>'value')::numeric <> 10 OR (v_m->'reach'->>'value')::numeric <> 800 THEN
    RAISE EXCEPTION 'yesterday slice is wrong: %', v_m;
  END IF;

  -- today has no delivery rows: zero delivery, not missing data.
  v_h := public.get_meta_performance_hierarchy(v_link, 'today', 'campaign', NULL, 1, 25);
  v_m := v_h->'items'->0->'metrics';
  IF v_h->>'state' <> 'ready'
     OR (v_m->'spend'->>'value')::numeric <> 0
     OR v_m->'spend'->>'completenessStatus' <> 'zero_delivery'
     OR COALESCE((v_m->'cpa'->>'available')::boolean, false)
  THEN
    RAISE EXCEPTION 'today without delivery must report zero delivery: %', v_m;
  END IF;

  -- Periods outside the slice contract keep the exact-period behaviour.
  v_h := public.get_meta_performance_hierarchy(v_link, 'this_month', 'campaign', NULL, 1, 25);
  IF v_h->>'state' <> 'period_not_synced' THEN
    RAISE EXCEPTION 'this_month has no exact run and must stay period_not_synced: %', v_h;
  END IF;

  -- A base that does not cover the slice is not used.
  UPDATE public.meta_sync_runs SET date_stop = v_today - 2 WHERE id = v_run;
  v_h := public.get_meta_performance_hierarchy(v_link, 'last_7d', 'campaign', NULL, 1, 25);
  IF v_h->>'state' <> 'period_not_synced' THEN
    RAISE EXCEPTION 'stale base must not answer a slice it does not cover: %', v_h;
  END IF;

  IF has_function_privilege('authenticated', 'public.get_period_entity_metrics(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_hierarchy_entity_metrics(DATE, DATE, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Internal metric helpers must not be callable by clients';
  END IF;
END;
$$;

SELECT 'meta_hierarchy_period_slices_ok' AS result;
