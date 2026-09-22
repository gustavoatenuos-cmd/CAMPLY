-- Campaign drill-down ("Ver campanhas") reads the single last_90d sync base.
--
-- Since 20260720020000 the Meta sync only writes the official last_90d daily base
-- and the dashboard reads every period as a date slice of it. The hierarchy RPC
-- was never moved to that contract: it still required a run whose
-- requested_period matched p_period, so opening campaigns from Analytics
-- (default last_30d) always answered period_not_synced even with fresh data.
--
-- It also read entity metrics with get_traceable_entity_metrics, which takes the
-- single newest row per metric. Campaign/adset/ad metrics are stored per day, so
-- that showed one day instead of the period.
--
-- Fix:
--   * dashboard periods pick the newest full_account last_90d run that covers
--     the slice and has campaign data (same rule as the dashboard);
--   * metrics are aggregated over the slice with rollup_analytics_metric:
--     additive metrics summed, ratios recalculated from totals, reach/frequency
--     only for single-day slices; an entity with no rows in the slice reports
--     zero delivery;
--   * other periods keep the exact-period behaviour of 20260714230000.

CREATE OR REPLACE FUNCTION public.get_period_entity_metrics(
  p_sync_run_id UUID,
  p_client_meta_asset_id UUID,
  p_account_id TEXT,
  p_account_name TEXT,
  p_currency TEXT,
  p_timezone TEXT,
  p_source_level TEXT,
  p_campaign_id TEXT,
  p_adset_id TEXT,
  p_ad_id TEXT,
  p_creative_id TEXT,
  p_classified_objective TEXT,
  p_destination_type TEXT,
  p_attribution_setting TEXT,
  p_date_start DATE,
  p_date_stop DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_sums JSONB;
  v_result JSONB := '{}'::jsonb;
  v_context JSONB;
  v_metric JSONB;
  v_metric_id TEXT;
  v_value NUMERIC;
  v_status TEXT;
  v_has_rows BOOLEAN;
  v_single_day BOOLEAN := p_date_start = p_date_stop;
  v_metric_ids CONSTANT TEXT[] := ARRAY[
    'spend', 'impressions', 'reach', 'frequency', 'clicks', 'link_clicks', 'link_ctr',
    'link_cpc', 'cpm', 'landing_page_views', 'page_load_rate',
    'whatsapp_conversations_started', 'messenger_conversations_started',
    'instagram_direct_conversations_started', 'messaging_conversations_started_generic',
    'messaging_conversations_started_total', 'cost_per_messaging_conversation',
    'leads', 'cpa', 'purchases', 'purchase_value', 'purchase_roas'
  ];
  v_additive CONSTANT TEXT[] := ARRAY[
    'spend', 'impressions', 'clicks', 'link_clicks', 'landing_page_views',
    'whatsapp_conversations_started', 'messenger_conversations_started',
    'instagram_direct_conversations_started', 'messaging_conversations_started_generic',
    'messaging_conversations_started_total', 'leads', 'purchases', 'purchase_value'
  ];
BEGIN
  IF v_user_id IS NULL OR p_source_level NOT IN ('campaign', 'adset', 'ad') THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_object_agg(s.metric_id, jsonb_build_object('sum', s.total, 'status', s.status)), '{}'::jsonb)
  INTO v_sums
  FROM (
    SELECT
      m.metric_id,
      SUM(m.metric_value) AS total,
      CASE
        WHEN bool_or(COALESCE(m.completeness_status, 'complete') NOT IN ('complete', 'zero_delivery'))
          THEN max(m.completeness_status) FILTER (
            WHERE m.completeness_status IS NOT NULL
              AND m.completeness_status NOT IN ('complete', 'zero_delivery')
          )
        WHEN bool_and(COALESCE(m.completeness_status, 'complete') = 'zero_delivery')
          THEN 'zero_delivery'
        ELSE 'complete'
      END AS status
    FROM public.meta_normalized_metrics m
    WHERE m.user_id = v_user_id
      AND m.sync_run_id = p_sync_run_id
      AND m.source_level = p_source_level
      AND m.date_start >= p_date_start
      AND m.date_stop <= p_date_stop
      AND (p_campaign_id IS NULL OR m.campaign_id = p_campaign_id)
      AND (p_adset_id IS NULL OR m.adset_id = p_adset_id)
      AND (p_ad_id IS NULL OR m.ad_id = p_ad_id)
      AND (p_creative_id IS NULL OR m.creative_id = p_creative_id)
      AND (p_source_level <> 'campaign' OR (m.adset_id IS NULL AND m.ad_id IS NULL))
    GROUP BY m.metric_id
  ) s;

  v_has_rows := v_sums <> '{}'::jsonb;

  v_context := jsonb_build_object(
    'currency', p_currency,
    'timezone', p_timezone,
    'sourceLevel', p_source_level,
    'attributionSetting', p_attribution_setting,
    'classifiedObjective', p_classified_objective,
    'destinationType', p_destination_type,
    'syncRunId', p_sync_run_id,
    'collectedAt', (SELECT r.finished_at FROM public.meta_sync_runs r WHERE r.id = p_sync_run_id),
    'clientMetaAssetId', p_client_meta_asset_id,
    'accountId', p_account_id,
    'accountName', p_account_name,
    'campaignId', p_campaign_id,
    'adsetId', p_adset_id,
    'adId', p_ad_id,
    'dateStart', p_date_start,
    'dateStop', p_date_stop
  );

  FOREACH v_metric_id IN ARRAY v_metric_ids LOOP
    v_metric := NULL;
    IF NOT v_has_rows THEN
      IF v_metric_id = ANY(v_additive) THEN
        v_metric := jsonb_build_object('value', 0, 'available', true, 'completenessStatus', 'zero_delivery');
      END IF;
    ELSE
      v_value := public.rollup_analytics_metric(
        v_metric_id,
        (v_sums->v_metric_id->>'sum')::numeric,
        COALESCE((v_sums->'spend'->>'sum')::numeric, 0),
        COALESCE((v_sums->'impressions'->>'sum')::numeric, 0),
        (v_sums->'reach'->>'sum')::numeric,
        COALESCE((v_sums->'link_clicks'->>'sum')::numeric, 0),
        COALESCE((v_sums->'messaging_conversations_started_total'->>'sum')::numeric, 0),
        COALESCE((v_sums->'purchases'->>'sum')::numeric, 0),
        COALESCE((v_sums->'purchase_value'->>'sum')::numeric, 0),
        COALESCE((v_sums->'leads'->>'sum')::numeric, 0),
        COALESCE((v_sums->'landing_page_views'->>'sum')::numeric, 0),
        v_single_day,
        p_classified_objective
      );
      IF v_value IS NULL AND v_metric_id = ANY(v_additive) THEN
        -- The entity delivered in the slice but never produced this action.
        v_value := 0;
      END IF;
      IF v_value IS NOT NULL THEN
        v_status := COALESCE(v_sums->v_metric_id->>'status', v_sums->'spend'->>'status', 'complete');
        v_metric := jsonb_build_object('value', v_value, 'available', true, 'completenessStatus', v_status);
      END IF;
    END IF;

    v_result := v_result || jsonb_build_object(
      v_metric_id,
      public.decorate_analytics_metric(v_metric_id, v_metric, v_context)
    );
  END LOOP;

  RETURN v_result;
END;
$$;

-- Dispatches to the slice aggregation when a period window is known, and to the
-- legacy whole-run reader otherwise.
CREATE OR REPLACE FUNCTION public.get_hierarchy_entity_metrics(
  p_date_start DATE,
  p_date_stop DATE,
  p_sync_run_id UUID,
  p_client_meta_asset_id UUID,
  p_account_id TEXT,
  p_account_name TEXT,
  p_currency TEXT,
  p_timezone TEXT,
  p_source_level TEXT,
  p_campaign_id TEXT DEFAULT NULL,
  p_adset_id TEXT DEFAULT NULL,
  p_ad_id TEXT DEFAULT NULL,
  p_creative_id TEXT DEFAULT NULL,
  p_classified_objective TEXT DEFAULT NULL,
  p_destination_type TEXT DEFAULT NULL,
  p_attribution_setting TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_date_start IS NOT NULL AND p_date_stop IS NOT NULL THEN
      public.get_period_entity_metrics(
        p_sync_run_id, p_client_meta_asset_id, p_account_id, p_account_name, p_currency, p_timezone,
        p_source_level, p_campaign_id, p_adset_id, p_ad_id, p_creative_id,
        p_classified_objective, p_destination_type, p_attribution_setting, p_date_start, p_date_stop
      )
    ELSE
      public.get_traceable_entity_metrics(
        p_sync_run_id, p_client_meta_asset_id, p_account_id, p_account_name, p_currency, p_timezone,
        p_source_level, p_campaign_id, p_adset_id, p_ad_id, p_creative_id,
        p_classified_objective, p_destination_type, p_attribution_setting
      )
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_meta_performance_hierarchy(
  p_client_meta_asset_id UUID,
  p_period TEXT,
  p_level TEXT,
  p_parent_id TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_link RECORD;
  v_run RECORD;
  v_items JSONB := '[]'::jsonb;
  v_total INTEGER := 0;
  v_offset INTEGER := (p_page - 1) * p_page_size;
  v_is_slice BOOLEAN := p_period IN ('today', 'yesterday', 'today_and_yesterday', 'last_7d', 'last_30d', 'last_90d');
  v_local_today DATE;
  v_date_start DATE;
  v_date_stop DATE;
  v_found BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT cma.id, cma.client_id, ma.id AS meta_asset_id, ma.integration_id,
         ma.asset_id AS ad_account_id, ma.asset_name AS account_name,
         ma.currency, ma.timezone_name
  INTO v_link
  FROM public.client_meta_assets cma
  JOIN public.meta_assets ma ON ma.id = cma.meta_asset_id
  WHERE cma.id = p_client_meta_asset_id
    AND cma.user_id = v_user_id
    AND cma.unlinked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'asset_not_found');
  END IF;

  IF v_is_slice THEN
    -- Single sync contract: Meta sync only writes the official last_90d daily
    -- base. Every dashboard period is a date slice of that base, exactly like
    -- get_global_performance_dashboard_v2. Requiring requested_period = p_period
    -- here made every period except last_90d report period_not_synced.
    v_local_today := (timezone(COALESCE(v_link.timezone_name, 'America/Sao_Paulo'), now()))::date;
    v_date_stop := CASE WHEN p_period = 'yesterday' THEN v_local_today - 1 ELSE v_local_today END;
    v_date_start := CASE p_period
      WHEN 'today' THEN v_local_today
      WHEN 'yesterday' THEN v_local_today - 1
      WHEN 'today_and_yesterday' THEN v_local_today - 1
      WHEN 'last_7d' THEN v_local_today - 6
      WHEN 'last_30d' THEN v_local_today - 29
      ELSE v_local_today - 89
    END;

    SELECT r.* INTO v_run
    FROM public.meta_sync_runs r
    WHERE r.user_id = v_user_id
      AND r.integration_id = v_link.integration_id
      AND r.ad_account_id = v_link.ad_account_id
      AND r.requested_period = 'last_90d'
      AND r.run_scope = 'full_account'
      AND r.status IN ('success', 'partial')
      AND (r.date_start IS NULL OR r.date_start <= v_date_start)
      AND (r.date_stop IS NULL OR r.date_stop >= v_date_stop)
      AND EXISTS (
        SELECT 1 FROM public.meta_campaign_snapshots cs
        WHERE cs.sync_run_id = r.id AND cs.user_id = v_user_id
      )
    ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
    LIMIT 1;
    v_found := FOUND;
  END IF;

  -- Legacy periods (and slices with no last_90d base yet): exact-period run,
  -- whole-run metrics, unchanged from 20260714230000.
  IF NOT v_found THEN
    v_date_start := NULL;
    v_date_stop := NULL;
    -- run_scope = 'full_account' keeps selective_campaigns runs from shadowing the
    -- last full-account sync. status IN ('success','partial') prefers the most
    -- recent run with usable snapshots over an older, fully-complete one - but only
    -- among runs that actually wrote campaign-level data, so an empty partial run
    -- never shadows an older run that has real snapshots.
    SELECT r.* INTO v_run
    FROM public.meta_sync_runs r
    WHERE r.user_id = v_user_id
      AND r.integration_id = v_link.integration_id
      AND r.ad_account_id = v_link.ad_account_id
      AND r.requested_period = p_period
      AND r.run_scope = 'full_account'
      AND r.status IN ('success', 'partial')
      AND EXISTS (
        SELECT 1 FROM public.meta_campaign_snapshots cs
        WHERE cs.sync_run_id = r.id AND cs.user_id = v_user_id
      )
    ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
    LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    RETURN jsonb_build_object(
      'state', 'period_not_synced',
      'level', p_level, 'period', p_period, 'page', p_page, 'pageSize', p_page_size,
      'total', 0, 'items', '[]'::jsonb,
      'clientId', v_link.client_id, 'clientMetaAssetId', v_link.id,
      'metaAssetId', v_link.meta_asset_id, 'integrationId', v_link.integration_id,
      'adAccountId', v_link.ad_account_id
    );
  END IF;

  IF p_level = 'campaign' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_campaign_snapshots
    WHERE sync_run_id = v_run.id
      AND user_id = v_user_id
      AND COALESCE(NULLIF(upper(effective_status), ''), NULLIF(upper(meta_status), ''), '') = 'ACTIVE';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.campaign_id, 'name', s.campaign_name, 'status', s.meta_status,
      'effectiveStatus', s.effective_status, 'objective', s.raw_objective,
      'classifiedObjective', s.classified_objective, 'destinationType', NULL,
      'attributionSetting', NULL, 'creativeId', NULL,
      'metrics', public.get_hierarchy_entity_metrics(v_date_start, v_date_stop,
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'campaign', s.campaign_id, NULL, NULL, NULL, s.classified_objective::text, NULL, NULL
      )
    ) ORDER BY s.campaign_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT *
      FROM public.meta_campaign_snapshots
      WHERE sync_run_id = v_run.id
        AND user_id = v_user_id
        AND COALESCE(NULLIF(upper(effective_status), ''), NULLIF(upper(meta_status), ''), '') = 'ACTIVE'
      ORDER BY campaign_name OFFSET v_offset LIMIT p_page_size
    ) s;
  ELSIF p_level = 'adset' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_adset_snapshots s
    WHERE s.sync_run_id = v_run.id AND s.user_id = v_user_id AND s.campaign_id = p_parent_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.adset_id, 'name', s.adset_name, 'parentId', s.campaign_id,
      'status', s.meta_status, 'effectiveStatus', s.effective_status,
      'objective', s.optimization_goal, 'classifiedObjective', NULL,
      'destinationType', s.destination_type, 'attributionSetting', s.attribution_setting,
      'dailyBudget', public.safe_cast_numeric(s.promoted_object->>'_camply_daily_budget') / 100,
      'lifetimeBudget', public.safe_cast_numeric(s.promoted_object->>'_camply_lifetime_budget') / 100,
      'creativeId', NULL,
      'metrics', public.get_hierarchy_entity_metrics(v_date_start, v_date_stop,
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'adset', s.campaign_id, s.adset_id, NULL, NULL, NULL, s.destination_type, s.attribution_setting
      )
    ) ORDER BY s.adset_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT * FROM public.meta_adset_snapshots
      WHERE sync_run_id = v_run.id AND user_id = v_user_id AND campaign_id = p_parent_id
      ORDER BY adset_name OFFSET v_offset LIMIT p_page_size
    ) s;
  ELSIF p_level = 'ad' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_ad_snapshots s
    WHERE s.sync_run_id = v_run.id AND s.user_id = v_user_id AND s.adset_id = p_parent_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.ad_id, 'name', s.ad_name, 'parentId', s.adset_id,
      'campaignId', s.campaign_id, 'status', s.meta_status,
      'effectiveStatus', s.effective_status, 'creativeId', s.creative_id,
      'metrics', public.get_hierarchy_entity_metrics(v_date_start, v_date_stop,
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'ad', s.campaign_id, s.adset_id, s.ad_id, NULL, NULL, NULL, NULL
      )
    ) ORDER BY s.ad_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT * FROM public.meta_ad_snapshots
      WHERE sync_run_id = v_run.id AND user_id = v_user_id AND adset_id = p_parent_id
      ORDER BY ad_name OFFSET v_offset LIMIT p_page_size
    ) s;
  ELSE
    SELECT count(*) INTO v_total
    FROM public.meta_ad_snapshots a
    JOIN public.meta_creative_snapshots c
      ON c.sync_run_id = a.sync_run_id AND c.creative_id = a.creative_id
    WHERE a.sync_run_id = v_run.id AND a.user_id = v_user_id AND a.ad_id = p_parent_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', creative.creative_id, 'name', creative.creative_name, 'parentId', creative.ad_id,
      'creativeId', creative.creative_id, 'title', creative.title, 'body', creative.body,
      'thumbnailUrl', creative.thumbnail_url, 'imageUrl', creative.image_url,
      'objectStorySpec', creative.object_story_spec, 'updatedAt', creative.updated_at,
      'metrics', public.get_hierarchy_entity_metrics(v_date_start, v_date_stop,
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'ad', creative.campaign_id, creative.adset_id, creative.ad_id, creative.creative_id, NULL, NULL, NULL
      )
    ) ORDER BY creative.creative_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT a.ad_id, a.campaign_id, a.adset_id,
             c.creative_id, c.creative_name, c.title, c.body,
             c.thumbnail_url, c.image_url, c.object_story_spec,
             c.asset_payload->>'updated_time' AS updated_at
      FROM public.meta_ad_snapshots a
      JOIN public.meta_creative_snapshots c
        ON c.sync_run_id = a.sync_run_id AND c.creative_id = a.creative_id
      WHERE a.sync_run_id = v_run.id AND a.user_id = v_user_id AND a.ad_id = p_parent_id
      ORDER BY c.creative_name
      OFFSET v_offset LIMIT p_page_size
    ) creative;
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_total = 0 THEN 'empty' ELSE 'ready' END,
    'level', p_level, 'period', p_period, 'page', p_page, 'pageSize', p_page_size,
    'total', v_total, 'items', v_items,
    'clientId', v_link.client_id, 'clientMetaAssetId', v_link.id,
    'metaAssetId', v_link.meta_asset_id, 'integrationId', v_link.integration_id,
    'adAccountId', v_link.ad_account_id,
    'currency', COALESCE(v_run.currency, v_link.currency),
    'timezone', COALESCE(v_run.timezone, v_link.timezone_name),
    'dateStart', COALESCE(v_date_start, v_run.date_start),
    'dateStop', COALESCE(v_date_stop, v_run.date_stop),
    'run', jsonb_build_object(
      'id', v_run.id,
      'status', v_run.status,
      'startedAt', v_run.started_at,
      'finishedAt', v_run.finished_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_period_entity_metrics(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_period_entity_metrics(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.get_period_entity_metrics(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_hierarchy_entity_metrics(DATE, DATE, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_hierarchy_entity_metrics(DATE, DATE, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_hierarchy_entity_metrics(DATE, DATE, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
