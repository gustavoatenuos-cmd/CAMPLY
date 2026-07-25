

DO $$
DECLARE
  v_user_id UUID := '00000000-0000-0000-0000-000000000001';
  v_workspace_id UUID := v_user_id;
  v_integration_id UUID := '55555555-5555-5555-5555-555555555555';
  v_asset_id UUID := '66666666-6666-6666-6666-666666666666';
  v_client_meta_asset_id UUID := '77777777-7777-7777-7777-777777777777';
  v_run_id_success UUID := '11111111-1111-1111-1111-111111111111';
  v_run_id_failed UUID := '11111111-1111-1111-1111-111111111112';
  v_run_id_partial UUID := '11111111-1111-1111-1111-111111111113';
  v_run_id_outside UUID := '11111111-1111-1111-1111-111111111114';
  
  v_today DATE := (timezone('America/Sao_Paulo', now()))::date;
  v_yesterday DATE := v_today - interval '1 day';
  v_90d_ago DATE := v_today - interval '89 days';
  
  v_result JSONB;
  v_client_obj JSONB;
  v_status TEXT;
  v_spend NUMERIC;
  v_impressions NUMERIC;
BEGIN
  -- Cleanup any existing
  DELETE FROM public.client_meta_assets WHERE user_id = v_user_id;
  DELETE FROM public.client_identity WHERE user_id = v_user_id;
  DELETE FROM public.meta_normalized_metrics WHERE user_id = v_user_id;
  DELETE FROM public.meta_sync_runs WHERE user_id = v_user_id;
  DELETE FROM public.meta_assets WHERE id = v_asset_id;
  DELETE FROM public.meta_integrations WHERE id = v_integration_id;
  DELETE FROM auth.users WHERE id = v_user_id;

  -- Setup
  INSERT INTO auth.users (id, aud, role, email) VALUES (v_user_id, 'authenticated', 'authenticated', 'zero@test.com');
  
  INSERT INTO public.meta_integrations (id, user_id, status, access_token_encrypted) VALUES (v_integration_id, v_user_id, 'active', 'dummy');
  INSERT INTO public.meta_assets (id, integration_id, asset_id, asset_type, asset_name, currency, timezone_name)
  VALUES (v_asset_id, v_integration_id, 'act_123', 'adaccount', 'Test Account', 'BRL', 'America/Sao_Paulo');
  
  INSERT INTO public.client_identity (user_id, client_id, display_name) VALUES (v_user_id, 'client_1', 'Client 1');
  INSERT INTO public.client_meta_assets (id, user_id, client_id, meta_asset_id) VALUES (v_client_meta_asset_id, v_user_id, 'client_1', v_asset_id);
  
  -- We must bypass RLS by setting the auth jwt
  PERFORM set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001"}', true);

  --------------------------------------------------
  -- CENÁRIO E: RUN NÃO COBRE O PERÍODO
  --------------------------------------------------
  INSERT INTO public.meta_sync_runs (id, user_id, integration_id, ad_account_id, status, requested_period, date_start, date_stop, graph_api_version)
  VALUES (v_run_id_outside, v_user_id, v_integration_id, 'act_123', 'success', 'last_7d', v_today - interval '6 days', v_today, 'v20.0');
  
  -- Query last_90d (run doesn't cover)
  v_result := public.get_global_performance_dashboard_v2('last_90d');
  v_status := v_result->0->>'clientStatus';
  IF v_status NOT IN ('period_not_synced', 'never_synced') THEN
    RAISE EXCEPTION 'Scenario E failed: expected period_not_synced or never_synced, got %', v_status;
  END IF;

  --------------------------------------------------
  -- CENÁRIO C: RUN FAILED
  --------------------------------------------------
  DELETE FROM public.meta_sync_runs WHERE id = v_run_id_outside;
  
  INSERT INTO public.meta_sync_runs (id, user_id, integration_id, ad_account_id, status, requested_period, date_start, date_stop, started_at, graph_api_version)
  VALUES (v_run_id_failed, v_user_id, v_integration_id, 'act_123', 'failed', 'last_90d', v_90d_ago, v_today, now(), 'v20.0');
  
  v_result := public.get_global_performance_dashboard_v2('today');
  v_status := v_result->0->>'clientStatus';
  IF v_status != 'failed' THEN
    RAISE EXCEPTION 'Scenario C failed: expected failed, got %', v_status;
  END IF;

  --------------------------------------------------
  -- CENÁRIO D: RUN PARTIAL
  --------------------------------------------------
  DELETE FROM public.meta_sync_runs WHERE id = v_run_id_failed;
  
  INSERT INTO public.meta_sync_runs (id, user_id, integration_id, ad_account_id, status, requested_period, date_start, date_stop, started_at, graph_api_version)
  VALUES (v_run_id_partial, v_user_id, v_integration_id, 'act_123', 'partial', 'last_90d', v_90d_ago, v_today, now(), 'v20.0');
  
  v_result := public.get_global_performance_dashboard_v2('today');
  v_status := v_result->0->>'clientStatus';
  IF v_status != 'partial' THEN
    RAISE EXCEPTION 'Scenario D failed: expected partial, got %', v_status;
  END IF;

  --------------------------------------------------
  -- CENÁRIO A: ZERO DELIVERY NO DIA
  --------------------------------------------------
  DELETE FROM public.meta_sync_runs WHERE id = v_run_id_partial;
  
  INSERT INTO public.meta_sync_runs (id, user_id, integration_id, ad_account_id, status, requested_period, date_start, date_stop, started_at, finished_at, graph_api_version)
  VALUES (v_run_id_success, v_user_id, v_integration_id, 'act_123', 'success', 'last_90d', v_90d_ago, v_today, now() - interval '1 hour', now(), 'v20.0');
  
  -- Insert metrics ONLY for yesterday
  INSERT INTO public.meta_normalized_metrics (user_id, sync_run_id, integration_id, ad_account_id, metric_id, metric_value, source_level, date_start, date_stop)
  VALUES 
    (v_user_id, v_run_id_success, v_integration_id, 'act_123', 'spend', 10.0, 'account', v_yesterday, v_yesterday),
    (v_user_id, v_run_id_success, v_integration_id, 'act_123', 'impressions', 1000, 'account', v_yesterday, v_yesterday);

  -- Query 'today', no metrics exist for today
  v_result := public.get_global_performance_dashboard_v2('today');
  v_client_obj := v_result->0;
  v_status := v_client_obj->>'clientStatus';
  
  IF v_status != 'no_delivery' THEN
    RAISE EXCEPTION 'Scenario A failed: expected no_delivery, got %', v_status;
  END IF;
  
  IF v_client_obj->'lastSuccessfulRun' IS NULL THEN
    RAISE EXCEPTION 'Scenario A failed: lastSuccessfulRun is null';
  END IF;
  
  v_spend := (v_client_obj->'metrics'->'spend'->>'value')::numeric;
  IF v_spend IS DISTINCT FROM 0.0 THEN
    RAISE EXCEPTION 'Scenario A failed: expected spend=0, got %', v_spend;
  END IF;
  
  IF (v_client_obj->'metrics'->'cpm'->>'available')::boolean = true THEN
    RAISE EXCEPTION 'Scenario A failed: expected cpm available=false';
  END IF;
  
  IF v_client_obj->'dataQuality'->>'status' = 'unavailable' THEN
    RAISE EXCEPTION 'Scenario A failed: expected dataQuality not to be unavailable';
  END IF;

  --------------------------------------------------
  -- CENÁRIO B & F: COM ENTREGA / MÚLTIPLOS DIAS
  --------------------------------------------------
  -- Insert metrics for today as well
  INSERT INTO public.meta_normalized_metrics (user_id, sync_run_id, integration_id, ad_account_id, metric_id, metric_value, source_level, date_start, date_stop)
  VALUES 
    (v_user_id, v_run_id_success, v_integration_id, 'act_123', 'spend', 50.0, 'account', v_today, v_today),
    (v_user_id, v_run_id_success, v_integration_id, 'act_123', 'impressions', 5000, 'account', v_today, v_today);
    
  v_result := public.get_global_performance_dashboard_v2('today');
  v_client_obj := v_result->0;
  
  IF v_client_obj->>'clientStatus' != 'available' THEN
    RAISE EXCEPTION 'Scenario B failed: expected available, got %', v_client_obj->>'clientStatus';
  END IF;
  
  v_spend := (v_client_obj->'metrics'->'spend'->>'value')::numeric;
  IF v_spend IS DISTINCT FROM 50.0 THEN
    RAISE EXCEPTION 'Scenario B failed: expected spend=50, got %', v_spend;
  END IF;
  
  v_result := public.get_global_performance_dashboard_v2('today_and_yesterday');
  v_client_obj := v_result->0;
  
  v_spend := (v_client_obj->'metrics'->'spend'->>'value')::numeric;
  IF v_spend IS DISTINCT FROM 60.0 THEN
    RAISE EXCEPTION 'Scenario F failed: expected spend=60, got %', v_spend;
  END IF;
  
  -- Cleanup
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.client_meta_assets WHERE user_id = v_user_id;
  DELETE FROM public.client_identity WHERE user_id = v_user_id;
  DELETE FROM public.meta_normalized_metrics WHERE user_id = v_user_id;
  DELETE FROM public.meta_sync_runs WHERE user_id = v_user_id;
  DELETE FROM public.meta_assets WHERE id = v_asset_id;
  DELETE FROM public.meta_integrations WHERE id = v_integration_id;
  DELETE FROM auth.users WHERE id = v_user_id;

END $$;
