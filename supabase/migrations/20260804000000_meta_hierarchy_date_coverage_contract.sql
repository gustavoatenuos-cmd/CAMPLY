-- Read a selected analytics range from the persisted daily 90-day base.
-- This is intentionally additive: the legacy hierarchy RPC remains available
-- while clients migrate to the explicit date coverage contract below.

CREATE OR REPLACE FUNCTION public.get_traceable_entity_metrics_for_range(
  p_sync_run_id UUID,
  p_client_meta_asset_id UUID,
  p_account_id TEXT,
  p_account_name TEXT,
  p_currency TEXT,
  p_timezone TEXT,
  p_source_level TEXT,
  p_date_start DATE,
  p_date_stop DATE,
  p_campaign_id TEXT DEFAULT NULL,
  p_adset_id TEXT DEFAULT NULL,
  p_ad_id TEXT DEFAULT NULL,
  p_creative_id TEXT DEFAULT NULL,
  p_classified_objective TEXT DEFAULT NULL,
  p_destination_type TEXT DEFAULT NULL,
  p_attribution_setting TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_metric_id TEXT;
  v_value NUMERIC;
  v_row_count INTEGER;
  v_incomplete BOOLEAN;
  v_zero_delivery BOOLEAN;
  v_attribution_count INTEGER;
  v_attribution_setting TEXT;
  v_metric JSONB;
  v_result JSONB := '{}'::jsonb;
  v_values JSONB := '{}'::jsonb;
  v_availability JSONB := '{}'::jsonb;
  v_context JSONB;
  v_base_metric_ids CONSTANT TEXT[] := ARRAY[
    'spend', 'impressions', 'reach', 'clicks', 'link_clicks',
    'landing_page_views', 'profile_visits', 'video_views', 'thru_plays',
    'whatsapp_conversations_started', 'messenger_conversations_started',
    'instagram_direct_conversations_started', 'messaging_conversations_started_generic',
    'messaging_conversations_started_total', 'leads', 'purchases', 'purchase_value'
  ];
  v_output_metric_ids CONSTANT TEXT[] := ARRAY[
    'spend', 'impressions', 'reach', 'frequency', 'clicks', 'link_clicks', 'link_ctr',
    'link_cpc', 'cpm', 'landing_page_views', 'page_load_rate',
    'whatsapp_conversations_started', 'messenger_conversations_started',
    'instagram_direct_conversations_started', 'messaging_conversations_started_generic',
    'messaging_conversations_started_total', 'cost_per_messaging_conversation',
    'leads', 'cpa', 'purchases', 'purchase_value', 'purchase_roas',
    'profile_visits', 'video_views', 'thru_plays'
  ];
  v_spend NUMERIC;
  v_impressions NUMERIC;
  v_reach NUMERIC;
  v_link_clicks NUMERIC;
  v_landing_page_views NUMERIC;
  v_messages NUMERIC;
  v_leads NUMERIC;
  v_purchases NUMERIC;
  v_purchase_value NUMERIC;
BEGIN
  IF v_user_id IS NULL
     OR p_source_level NOT IN ('campaign', 'adset', 'ad')
     OR p_date_start IS NULL
     OR p_date_stop IS NULL
     OR p_date_start > p_date_stop THEN
    RETURN '{}'::jsonb;
  END IF;

  FOREACH v_metric_id IN ARRAY v_base_metric_ids LOOP
    SELECT
      SUM(m.metric_value)::numeric,
      count(*)::integer,
      bool_or(COALESCE(m.completeness_status, 'complete') NOT IN ('complete', 'zero_delivery')),
      bool_and(COALESCE(m.completeness_status, 'complete') = 'zero_delivery'),
      count(DISTINCT NULLIF(m.attribution_setting, ''))::integer,
      min(NULLIF(m.attribution_setting, ''))
    INTO v_value, v_row_count, v_incomplete, v_zero_delivery, v_attribution_count, v_attribution_setting
    FROM public.meta_normalized_metrics m
    WHERE m.user_id = v_user_id
      AND m.sync_run_id = p_sync_run_id
      AND m.metric_id = v_metric_id
      AND m.source_level = p_source_level
      AND m.date_start >= p_date_start
      AND m.date_stop <= p_date_stop
      AND (p_campaign_id IS NULL OR m.campaign_id = p_campaign_id)
      AND (p_adset_id IS NULL OR m.adset_id = p_adset_id)
      AND (p_ad_id IS NULL OR m.ad_id = p_ad_id)
      AND (p_creative_id IS NULL OR m.creative_id = p_creative_id)
      AND (p_source_level <> 'campaign' OR (m.adset_id IS NULL AND m.ad_id IS NULL));

    IF v_row_count > 0 THEN
      v_values := v_values || jsonb_build_object(v_metric_id, v_value);
      v_availability := v_availability || jsonb_build_object(
        v_metric_id,
        jsonb_build_object(
          'available', true,
          'completenessStatus', CASE
            WHEN v_attribution_count > 1 THEN 'mixed_attribution'
            WHEN v_incomplete THEN 'partial'
            WHEN v_zero_delivery THEN 'zero_delivery'
            ELSE 'complete'
          END,
          'attributionSetting', CASE
            WHEN v_attribution_count > 1 THEN 'MIXED'
            ELSE COALESCE(v_attribution_setting, p_attribution_setting)
          END
        )
      );
    END IF;
  END LOOP;

  -- Daily reach is not additive: summing it across dates would double-count
  -- people and manufacture an invalid frequency. Keep both metrics unavailable
  -- for multi-day reads until Meta provides a de-duplicated range aggregate.
  IF p_date_stop > p_date_start THEN
    v_values := v_values - 'reach';
    v_availability := v_availability - 'reach';
  END IF;

  v_spend := (v_values->>'spend')::numeric;
  v_impressions := (v_values->>'impressions')::numeric;
  v_reach := (v_values->>'reach')::numeric;
  v_link_clicks := (v_values->>'link_clicks')::numeric;
  v_landing_page_views := (v_values->>'landing_page_views')::numeric;
  v_messages := (v_values->>'messaging_conversations_started_total')::numeric;
  v_leads := (v_values->>'leads')::numeric;
  v_purchases := (v_values->>'purchases')::numeric;
  v_purchase_value := (v_values->>'purchase_value')::numeric;

  v_values := v_values || jsonb_build_object(
    'frequency', CASE WHEN v_reach > 0 THEN v_impressions / v_reach ELSE NULL END,
    'cpm', CASE WHEN v_impressions > 0 THEN v_spend * 1000 / v_impressions ELSE NULL END,
    'link_ctr', CASE WHEN v_impressions > 0 THEN v_link_clicks * 100 / v_impressions ELSE NULL END,
    'link_cpc', CASE WHEN v_link_clicks > 0 THEN v_spend / v_link_clicks ELSE NULL END,
    'page_load_rate', CASE WHEN v_link_clicks > 0 THEN v_landing_page_views * 100 / v_link_clicks ELSE NULL END,
    'cost_per_messaging_conversation', CASE WHEN v_messages > 0 THEN v_spend / v_messages ELSE NULL END,
    'cpa', CASE
      WHEN v_purchases > 0 THEN v_spend / v_purchases
      WHEN v_leads > 0 THEN v_spend / v_leads
      ELSE NULL
    END,
    'purchase_roas', CASE WHEN v_spend > 0 THEN v_purchase_value / v_spend ELSE NULL END
  );

  v_context := jsonb_build_object(
    'currency', p_currency,
    'timezone', p_timezone,
    'sourceLevel', p_source_level,
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

  FOREACH v_metric_id IN ARRAY v_output_metric_ids LOOP
    v_value := (v_values->>v_metric_id)::numeric;
    IF v_values ? v_metric_id AND v_value IS NOT NULL THEN
      v_metric := jsonb_build_object(
        'value', v_value,
        'available', true,
        'completenessStatus', COALESCE(v_availability->v_metric_id->>'completenessStatus', 'complete')
      );
      v_context := v_context || jsonb_build_object(
        'attributionSetting', COALESCE(v_availability->v_metric_id->>'attributionSetting', p_attribution_setting)
      );
    ELSE
      v_metric := NULL;
    END IF;

    v_result := v_result || jsonb_build_object(
      v_metric_id,
      public.decorate_analytics_metric(v_metric_id, v_metric, v_context)
    );
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_meta_performance_hierarchy_v2(
  p_client_meta_asset_id UUID,
  p_period TEXT,
  p_date_start DATE,
  p_date_stop DATE,
  p_level TEXT,
  p_parent_id TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_include_historical BOOLEAN DEFAULT FALSE
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
  v_partial_run RECORD;
  v_items JSONB := '[]'::jsonb;
  v_total INTEGER := 0;
  v_offset INTEGER := (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_page_size, 1), 100);
  v_missing_days INTEGER := 0;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_date_start IS NULL OR p_date_stop IS NULL OR p_date_start > p_date_stop OR p_date_stop > current_date THEN
    RAISE EXCEPTION 'Invalid analytics date range' USING ERRCODE = '22023';
  END IF;
  IF p_level NOT IN ('campaign', 'adset', 'ad', 'creative') THEN
    RAISE EXCEPTION 'Invalid hierarchy level' USING ERRCODE = '22023';
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

  SELECT r.* INTO v_run
  FROM public.meta_sync_runs r
  WHERE r.user_id = v_user_id
    AND r.integration_id = v_link.integration_id
    AND r.ad_account_id = v_link.ad_account_id
    AND r.run_scope = 'full_account'
    AND r.status = 'success'
    AND r.date_start <= p_date_start
    AND r.date_stop >= p_date_stop
    AND EXISTS (
      SELECT 1 FROM public.meta_campaign_snapshots cs
      WHERE cs.sync_run_id = r.id AND cs.user_id = v_user_id
    )
  ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT r.* INTO v_partial_run
    FROM public.meta_sync_runs r
    WHERE r.user_id = v_user_id
      AND r.integration_id = v_link.integration_id
      AND r.ad_account_id = v_link.ad_account_id
      AND r.run_scope = 'full_account'
      AND r.status IN ('success', 'partial')
      AND r.date_start <= p_date_stop
      AND r.date_stop >= p_date_start
    ORDER BY (r.status = 'success') DESC, r.finished_at DESC NULLS LAST, r.started_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_missing_days := (p_date_stop - p_date_start + 1)
        - (LEAST(p_date_stop, v_partial_run.date_stop) - GREATEST(p_date_start, v_partial_run.date_start) + 1);
      RETURN jsonb_build_object(
        'state', 'partial_coverage',
        'level', p_level, 'period', p_period, 'page', p_page, 'pageSize', p_page_size,
        'total', 0, 'items', '[]'::jsonb,
        'clientId', v_link.client_id, 'clientMetaAssetId', v_link.id,
        'metaAssetId', v_link.meta_asset_id, 'integrationId', v_link.integration_id,
        'adAccountId', v_link.ad_account_id,
        'coverage', jsonb_build_object(
          'status', 'partial_coverage',
          'requestedDateStart', p_date_start,
          'requestedDateStop', p_date_stop,
          'coveredDateStart', GREATEST(p_date_start, v_partial_run.date_start),
          'coveredDateStop', LEAST(p_date_stop, v_partial_run.date_stop),
          'missingDays', GREATEST(v_missing_days, 0),
          'reason', COALESCE(v_partial_run.termination_reason, v_partial_run.error_message, 'O run disponível não cobre todo o período solicitado.')
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'state', 'period_not_synced',
      'level', p_level, 'period', p_period, 'page', p_page, 'pageSize', p_page_size,
      'total', 0, 'items', '[]'::jsonb,
      'clientId', v_link.client_id, 'clientMetaAssetId', v_link.id,
      'metaAssetId', v_link.meta_asset_id, 'integrationId', v_link.integration_id,
      'adAccountId', v_link.ad_account_id,
      'coverage', jsonb_build_object(
        'status', 'not_covered',
        'requestedDateStart', p_date_start,
        'requestedDateStop', p_date_stop,
        'coveredDateStart', NULL,
        'coveredDateStop', NULL,
        'missingDays', p_date_stop - p_date_start + 1,
        'reason', 'Nenhum run confiável cobre o intervalo solicitado.'
      )
    );
  END IF;

  IF p_level = 'campaign' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_campaign_snapshots s
    WHERE s.sync_run_id = v_run.id
      AND s.user_id = v_user_id
      AND (
        COALESCE(NULLIF(upper(s.effective_status), ''), NULLIF(upper(s.meta_status), ''), '') = 'ACTIVE'
        OR (
          p_include_historical
          AND EXISTS (
            SELECT 1 FROM public.meta_normalized_metrics m
            WHERE m.user_id = v_user_id
              AND m.sync_run_id = v_run.id
              AND m.source_level = 'campaign'
              AND m.campaign_id = s.campaign_id
              AND m.metric_id = 'spend'
              AND m.metric_value > 0
              AND m.date_start >= p_date_start
              AND m.date_stop <= p_date_stop
          )
        )
      );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.campaign_id, 'name', s.campaign_name, 'status', s.meta_status,
      'effectiveStatus', s.effective_status, 'objective', s.raw_objective,
      'classifiedObjective', s.classified_objective, 'destinationType', NULL,
      'attributionSetting', NULL, 'creativeId', NULL,
      'metrics', public.get_traceable_entity_metrics_for_range(
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'campaign', p_date_start, p_date_stop,
        s.campaign_id, NULL, NULL, NULL, s.classified_objective::text, NULL, NULL
      )
    ) ORDER BY s.campaign_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT cs.*
      FROM public.meta_campaign_snapshots cs
      WHERE cs.sync_run_id = v_run.id
        AND cs.user_id = v_user_id
        AND (
          COALESCE(NULLIF(upper(cs.effective_status), ''), NULLIF(upper(cs.meta_status), ''), '') = 'ACTIVE'
          OR (
            p_include_historical
            AND EXISTS (
              SELECT 1 FROM public.meta_normalized_metrics m
              WHERE m.user_id = v_user_id
                AND m.sync_run_id = v_run.id
                AND m.source_level = 'campaign'
                AND m.campaign_id = cs.campaign_id
                AND m.metric_id = 'spend'
                AND m.metric_value > 0
                AND m.date_start >= p_date_start
                AND m.date_stop <= p_date_stop
            )
          )
        )
      ORDER BY cs.campaign_name OFFSET v_offset LIMIT LEAST(GREATEST(p_page_size, 1), 100)
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
      'metrics', public.get_traceable_entity_metrics_for_range(
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'adset', p_date_start, p_date_stop,
        s.campaign_id, s.adset_id, NULL, NULL, NULL, s.destination_type, s.attribution_setting
      )
    ) ORDER BY s.adset_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT * FROM public.meta_adset_snapshots
      WHERE sync_run_id = v_run.id AND user_id = v_user_id AND campaign_id = p_parent_id
      ORDER BY adset_name OFFSET v_offset LIMIT LEAST(GREATEST(p_page_size, 1), 100)
    ) s;
  ELSIF p_level = 'ad' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_ad_snapshots s
    WHERE s.sync_run_id = v_run.id AND s.user_id = v_user_id AND s.adset_id = p_parent_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.ad_id, 'name', s.ad_name, 'parentId', s.adset_id,
      'campaignId', s.campaign_id, 'status', s.meta_status,
      'effectiveStatus', s.effective_status, 'creativeId', s.creative_id,
      'metrics', public.get_traceable_entity_metrics_for_range(
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'ad', p_date_start, p_date_stop,
        s.campaign_id, s.adset_id, s.ad_id, NULL, NULL, NULL, NULL
      )
    ) ORDER BY s.ad_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT * FROM public.meta_ad_snapshots
      WHERE sync_run_id = v_run.id AND user_id = v_user_id AND adset_id = p_parent_id
      ORDER BY ad_name OFFSET v_offset LIMIT LEAST(GREATEST(p_page_size, 1), 100)
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
      'metrics', public.get_traceable_entity_metrics_for_range(
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'ad', p_date_start, p_date_stop,
        creative.campaign_id, creative.adset_id, creative.ad_id, creative.creative_id, NULL, NULL, NULL
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
      ORDER BY c.creative_name OFFSET v_offset LIMIT LEAST(GREATEST(p_page_size, 1), 100)
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
    'dateStart', v_run.date_start,
    'dateStop', v_run.date_stop,
    'coverage', jsonb_build_object(
      'status', 'covered',
      'requestedDateStart', p_date_start,
      'requestedDateStop', p_date_stop,
      'coveredDateStart', p_date_start,
      'coveredDateStop', p_date_stop,
      'missingDays', 0,
      'reason', NULL
    ),
    'run', jsonb_build_object(
      'id', v_run.id,
      'status', v_run.status,
      'period', v_run.requested_period,
      'level', v_run.requested_level,
      'scope', v_run.run_scope,
      'startedAt', v_run.started_at,
      'finishedAt', v_run.finished_at,
      'dateStart', v_run.date_start,
      'dateStop', v_run.date_stop,
      'timezone', COALESCE(v_run.timezone, v_link.timezone_name),
      'currency', COALESCE(v_run.currency, v_link.currency)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_traceable_entity_metrics_for_range(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_traceable_entity_metrics_for_range(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_traceable_entity_metrics_for_range(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy_v2(UUID, TEXT, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy_v2(UUID, TEXT, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_performance_hierarchy_v2(UUID, TEXT, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.get_meta_performance_hierarchy_v2(UUID, TEXT, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN)
IS 'Reads an exact selected range from a covering persisted run; historical mode includes paused campaigns only when they delivered in that range.';
