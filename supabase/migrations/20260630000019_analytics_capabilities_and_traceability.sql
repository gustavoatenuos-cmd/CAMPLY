-- Migration 000019: analytics capability negotiation and traceable dashboard metrics.
-- This migration is additive: the v1 dashboard remains available for rollback.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_analytics_capabilities()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'contractVersion', 2,
    'dashboardAvailable', true,
    'dashboardRpc', 'get_global_performance_dashboard_v2',
    'supportedPeriods', jsonb_build_array('today', 'last_7d', 'last_30d'),
    'supportedLevels', jsonb_build_array('campaign', 'adset', 'ad'),
    'targetsAvailable', true,
    'reconciliationAvailable', true,
    'traceableMetrics', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decorate_analytics_metric(
  p_metric_id TEXT,
  p_metric JSONB,
  p_context JSONB
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'metricId', p_metric_id,
    'value', CASE
      WHEN p_metric IS NULL
        OR jsonb_typeof(p_metric) <> 'object'
        OR COALESCE((p_metric->>'available')::boolean, false) IS NOT TRUE
        OR COALESCE(jsonb_typeof(p_metric->'value') = 'number', false) IS NOT TRUE
        THEN NULL
      ELSE p_metric->'value'
    END,
    'available', CASE
      WHEN p_metric IS NULL OR jsonb_typeof(p_metric) <> 'object' THEN false
      ELSE COALESCE((p_metric->>'available')::boolean, false)
        AND COALESCE(jsonb_typeof(p_metric->'value') = 'number', false)
    END,
    'completenessStatus', CASE
      WHEN p_metric IS NULL OR jsonb_typeof(p_metric) <> 'object' THEN 'unavailable'
      ELSE COALESCE(NULLIF(p_metric->>'completenessStatus', ''), 'unavailable')
    END,
    'currency', p_context->'currency',
    'dateStart', p_context->'dateStart',
    'dateStop', p_context->'dateStop',
    'timezone', p_context->'timezone',
    'sourceLevel', COALESCE(p_context->'sourceLevel', '"aggregated"'::jsonb),
    'attributionSetting', p_context->'attributionSetting',
    'classifiedObjective', p_context->'classifiedObjective',
    'destinationType', p_context->'destinationType',
    'syncRunId', p_context->'syncRunId',
    'collectedAt', p_context->'collectedAt',
    'clientMetaAssetId', p_context->'clientMetaAssetId',
    'accountId', p_context->'accountId',
    'accountName', p_context->'accountName',
    'campaignId', p_context->'campaignId',
    'adsetId', p_context->'adsetId',
    'adId', p_context->'adId'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_global_performance_dashboard_v2(
  p_period TEXT DEFAULT 'last_7d',
  p_client_ids TEXT[] DEFAULT NULL,
  p_asset_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_dashboard JSONB;
  v_result JSONB := '[]'::jsonb;
  v_client JSONB;
  v_account JSONB;
  v_accounts JSONB;
  v_group JSONB;
  v_groups JSONB;
  v_matching_account JSONB;
  v_single_account JSONB;
  v_metrics JSONB;
  v_client_metrics JSONB;
  v_metric JSONB;
  v_context JSONB;
  v_metric_id TEXT;
  v_account_count INTEGER;
  v_supported_metric_ids CONSTANT TEXT[] := ARRAY[
    'spend',
    'impressions',
    'cpm',
    'link_clicks',
    'link_ctr',
    'link_cpc',
    'cpa',
    'whatsapp_conversations_started',
    'messenger_conversations_started',
    'instagram_direct_conversations_started',
    'messaging_conversations_started_generic',
    'messaging_conversations_started_total',
    'cost_per_messaging_conversation',
    'purchases',
    'purchase_value',
    'purchase_roas',
    'leads',
    'landing_page_views',
    'page_load_rate',
    'profile_visits',
    'video_views',
    'thru_plays'
  ];
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_period NOT IN ('today', 'last_7d', 'last_30d') THEN
    RAISE EXCEPTION 'Invalid dashboard period: %', p_period USING ERRCODE = '22023';
  END IF;

  v_dashboard := public.get_global_performance_dashboard(p_period, p_client_ids, p_asset_ids);

  FOR v_client IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_dashboard, '[]'::jsonb))
  LOOP
    v_accounts := '[]'::jsonb;

    FOR v_account IN
      SELECT value FROM jsonb_array_elements(COALESCE(v_client->'accounts', '[]'::jsonb))
    LOOP
      v_context := jsonb_build_object(
        'currency', v_account->'currency',
        'dateStart', v_account->'dateStart',
        'dateStop', v_account->'dateStop',
        'timezone', v_account->'timezone',
        'sourceLevel', 'aggregated',
        'attributionSetting', NULL,
        'classifiedObjective', NULL,
        'destinationType', NULL,
        'syncRunId', v_account#>'{lastSuccessfulRun,id}',
        'collectedAt', v_account#>'{lastSuccessfulRun,finishedAt}',
        'clientMetaAssetId', v_account->'clientMetaAssetId',
        'accountId', v_account->'adAccountId',
        'accountName', v_account->'accountName',
        'campaignId', NULL,
        'adsetId', NULL,
        'adId', NULL
      );

      v_metrics := '{}'::jsonb;
      FOR v_metric_id, v_metric IN
        SELECT key, value FROM jsonb_each(COALESCE(v_account->'metrics', '{}'::jsonb))
      LOOP
        v_metrics := v_metrics || jsonb_build_object(
          v_metric_id,
          public.decorate_analytics_metric(v_metric_id, v_metric, v_context)
        );
      END LOOP;

      FOREACH v_metric_id IN ARRAY v_supported_metric_ids
      LOOP
        IF NOT (v_metrics ? v_metric_id) THEN
          v_metrics := v_metrics || jsonb_build_object(
            v_metric_id,
            public.decorate_analytics_metric(v_metric_id, NULL, v_context)
          );
        END IF;
      END LOOP;

      v_account := jsonb_set(v_account, '{metrics}', v_metrics, true);
      v_accounts := v_accounts || jsonb_build_array(v_account);
    END LOOP;

    v_account_count := jsonb_array_length(v_accounts);
    v_single_account := CASE WHEN v_account_count = 1 THEN v_accounts->0 ELSE '{}'::jsonb END;
    v_context := jsonb_build_object(
      'currency', CASE WHEN v_account_count = 1 THEN v_single_account->'currency' ELSE NULL END,
      'dateStart', CASE WHEN v_account_count = 1 THEN v_single_account->'dateStart' ELSE NULL END,
      'dateStop', CASE WHEN v_account_count = 1 THEN v_single_account->'dateStop' ELSE NULL END,
      'timezone', CASE WHEN v_account_count = 1 THEN v_single_account->'timezone' ELSE NULL END,
      'sourceLevel', 'aggregated',
      'attributionSetting', NULL,
      'classifiedObjective', NULL,
      'destinationType', NULL,
      'syncRunId', CASE WHEN v_account_count = 1 THEN v_single_account#>'{lastSuccessfulRun,id}' ELSE NULL END,
      'collectedAt', CASE WHEN v_account_count = 1 THEN v_single_account#>'{lastSuccessfulRun,finishedAt}' ELSE NULL END,
      'clientMetaAssetId', CASE WHEN v_account_count = 1 THEN v_single_account->'clientMetaAssetId' ELSE NULL END,
      'accountId', CASE WHEN v_account_count = 1 THEN v_single_account->'adAccountId' ELSE NULL END,
      'accountName', CASE WHEN v_account_count = 1 THEN v_single_account->'accountName' ELSE NULL END,
      'campaignId', NULL,
      'adsetId', NULL,
      'adId', NULL
    );

    v_metrics := '{}'::jsonb;
    FOR v_metric_id, v_metric IN
      SELECT key, value FROM jsonb_each(COALESCE(v_client->'metrics', '{}'::jsonb))
    LOOP
      v_metrics := v_metrics || jsonb_build_object(
        v_metric_id,
        public.decorate_analytics_metric(v_metric_id, v_metric, v_context)
      );
    END LOOP;

    FOREACH v_metric_id IN ARRAY v_supported_metric_ids
    LOOP
      IF NOT (v_metrics ? v_metric_id) THEN
        v_metrics := v_metrics || jsonb_build_object(
          v_metric_id,
          public.decorate_analytics_metric(v_metric_id, NULL, v_context)
        );
      END IF;
    END LOOP;

    v_client_metrics := v_metrics;

    v_groups := '[]'::jsonb;
    FOR v_group IN
      SELECT value FROM jsonb_array_elements(COALESCE(v_client->'metricGroups', '[]'::jsonb))
    LOOP
      SELECT value
      INTO v_matching_account
      FROM jsonb_array_elements(v_accounts)
      WHERE value->>'clientMetaAssetId' = v_group->>'clientMetaAssetId'
      LIMIT 1;

      v_matching_account := COALESCE(v_matching_account, '{}'::jsonb);
      v_context := jsonb_build_object(
        'currency', COALESCE(v_group->'currency', v_matching_account->'currency'),
        'dateStart', v_matching_account->'dateStart',
        'dateStop', v_matching_account->'dateStop',
        'timezone', v_matching_account->'timezone',
        'sourceLevel', 'campaign',
        'attributionSetting', v_group->'attributionSetting',
        'classifiedObjective', v_group->'classifiedObjective',
        'destinationType', v_group->'destinationType',
        'syncRunId', v_matching_account#>'{lastSuccessfulRun,id}',
        'collectedAt', v_matching_account#>'{lastSuccessfulRun,finishedAt}',
        'clientMetaAssetId', v_group->'clientMetaAssetId',
        'accountId', v_matching_account->'adAccountId',
        'accountName', v_matching_account->'accountName',
        'campaignId', v_group->'campaignId',
        'adsetId', NULL,
        'adId', NULL
      );

      v_metrics := '{}'::jsonb;
      FOR v_metric_id, v_metric IN
        SELECT key, value FROM jsonb_each(COALESCE(v_group->'metrics', '{}'::jsonb))
      LOOP
        v_metrics := v_metrics || jsonb_build_object(
          v_metric_id,
          public.decorate_analytics_metric(v_metric_id, v_metric, v_context)
        );
      END LOOP;

      FOREACH v_metric_id IN ARRAY v_supported_metric_ids
      LOOP
        IF NOT (v_metrics ? v_metric_id) THEN
          v_metrics := v_metrics || jsonb_build_object(
            v_metric_id,
            public.decorate_analytics_metric(v_metric_id, NULL, v_context)
          );
        END IF;
      END LOOP;

      v_group := jsonb_set(v_group, '{metrics}', v_metrics, true);
      v_groups := v_groups || jsonb_build_array(v_group);
      v_matching_account := NULL;
    END LOOP;

    v_client := jsonb_set(v_client, '{accounts}', v_accounts, true);
    v_client := jsonb_set(v_client, '{metrics}', v_client_metrics, true);
    v_client := jsonb_set(v_client, '{metricGroups}', v_groups, true);
    v_client := v_client || jsonb_build_object('analyticsContractVersion', 2);
    v_result := v_result || jsonb_build_array(v_client);
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.decorate_analytics_metric(TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decorate_analytics_metric(TEXT, JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.decorate_analytics_metric(TEXT, JSONB, JSONB) FROM authenticated;

REVOKE ALL ON FUNCTION public.get_analytics_capabilities() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_analytics_capabilities() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_capabilities() TO authenticated;

REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) TO authenticated;

COMMIT;
