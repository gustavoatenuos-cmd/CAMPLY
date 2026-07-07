BEGIN;

-- Create a safe cast function if not exists
CREATE OR REPLACE FUNCTION public.safe_cast_numeric(text_val text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN text_val::numeric;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- Re-create get_global_performance_dashboard_v2 to use safe_cast_numeric
CREATE OR REPLACE FUNCTION public.get_global_performance_dashboard_v2(
  p_period TEXT DEFAULT 'this_month',
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
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_period NOT IN ('this_month', 'this_week', 'today', 'last_7d', 'last_30d', 'last_90d') THEN
    RAISE EXCEPTION 'Invalid dashboard period: %', p_period USING ERRCODE = '22023';
  END IF;

  WITH supported_metric_ids(metric_id) AS (
    VALUES
      ('spend'),
      ('impressions'),
      ('reach'),
      ('frequency'),
      ('cpm'),
      ('clicks'),
      ('link_clicks'),
      ('link_ctr'),
      ('link_cpc'),
      ('cpa'),
      ('whatsapp_conversations_started'),
      ('messenger_conversations_started'),
      ('instagram_direct_conversations_started'),
      ('messaging_conversations_started_generic'),
      ('messaging_conversations_started_total'),
      ('cost_per_messaging_conversation'),
      ('purchases'),
      ('purchase_value'),
      ('purchase_roas'),
      ('leads'),
      ('landing_page_views'),
      ('page_load_rate'),
      ('profile_visits'),
      ('video_views'),
      ('thru_plays')
  ),
  active_clients AS (
    SELECT ci.client_id, ci.display_name
    FROM public.client_identity ci
    WHERE ci.user_id = v_user_id
      AND ci.archived_at IS NULL
      AND (p_client_ids IS NULL OR ci.client_id = ANY(p_client_ids))
  ),
  active_links AS (
    SELECT cma.id AS client_meta_asset_id, cma.client_id, cma.meta_asset_id
    FROM public.client_meta_assets cma
    JOIN active_clients ac ON ac.client_id = cma.client_id
    WHERE cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL
      AND (p_asset_ids IS NULL OR cma.meta_asset_id = ANY(p_asset_ids))
  ),
  accounts AS (
    SELECT
      al.client_meta_asset_id,
      al.client_id,
      ma.id AS meta_asset_id,
      ma.integration_id,
      ma.asset_id AS ad_account_id,
      ma.asset_name AS account_name,
      ma.currency,
      ma.timezone_name AS timezone
    FROM active_links al
    JOIN public.meta_assets ma ON ma.id = al.meta_asset_id
    JOIN public.meta_integrations mi
      ON mi.id = ma.integration_id
     AND mi.user_id::text = v_user_id::text
  ),
  any_sync AS (
    SELECT DISTINCT ON (a.client_meta_asset_id)
      a.client_meta_asset_id,
      a.client_id,
      r.id,
      r.requested_period
    FROM accounts a
    JOIN public.meta_sync_runs r
      ON r.user_id = v_user_id
     AND r.integration_id = a.integration_id
     AND r.ad_account_id = a.ad_account_id
     AND r.requested_period = p_period
     AND r.run_scope = 'full_account'
    ORDER BY a.client_meta_asset_id, r.finished_at DESC NULLS LAST, r.started_at DESC
  ),
  latest_sync AS (
    SELECT *
    FROM any_sync
    WHERE any_sync.id IN (
      SELECT id
      FROM public.meta_sync_runs
      WHERE status = 'success'
    )
  ),
  client_profiles AS (
    SELECT
      a.client_id,
      a.client_meta_asset_id,
      p.id AS profile_id,
      p.budget_period,
      p.planned_budget,
      p.budget_pacing_strategy,
      COALESCE(p.primary_conversion_metric, 'purchases') AS primary_metric,
      p.metrics_config,
      p.effective_from,
      p.effective_to
    FROM accounts a
    LEFT JOIN public.analysis_profiles p
      ON p.client_id = a.client_id
     AND p.client_meta_asset_id = a.client_meta_asset_id
     AND (p.effective_to IS NULL OR p.effective_to >= CURRENT_DATE)
  ),
  profile_targets AS (
    SELECT
      p.client_meta_asset_id,
      m.metric_id,
      COALESCE(
        p.metrics_config->m.metric_id->>'targetKind',
        CASE
          WHEN m.metric_id IN ('cpa', 'cost_per_messaging_conversation', 'cpm', 'link_cpc') THEN 'maximum_metric'
          WHEN m.metric_id IN ('purchase_roas', 'link_ctr', 'page_load_rate') THEN 'minimum_metric'
          WHEN m.metric_id IN ('frequency') THEN 'target_range'
          ELSE 'minimum_metric'
        END
      ) AS target_kind,
      public.safe_cast_numeric(p.metrics_config->m.metric_id->>'targetValue') AS target_value,
      public.safe_cast_numeric(p.metrics_config->m.metric_id->>'targetMin') AS target_min,
      public.safe_cast_numeric(p.metrics_config->m.metric_id->>'targetMax') AS target_max,
      COALESCE(public.safe_cast_numeric(p.metrics_config->m.metric_id->>'warningTolerancePercent'), 15) AS warning_tolerance,
      COALESCE(public.safe_cast_numeric(p.metrics_config->m.metric_id->>'criticalTolerancePercent'), 30) AS critical_tolerance,
      COALESCE(public.safe_cast_numeric(p.metrics_config->m.metric_id->>'priorityWeight'), 1) AS priority_weight,
      (p.metrics_config->m.metric_id->>'evaluationPeriod') AS evaluation_period,
      p.effective_from,
      p.effective_to
    FROM accounts a
    JOIN public.analysis_profiles p
      ON p.client_id = a.client_id AND p.client_meta_asset_id = a.client_meta_asset_id
    CROSS JOIN supported_metric_ids m
    WHERE (p.effective_to IS NULL OR p.effective_to >= CURRENT_DATE)
  ),
  aggregated_targets AS (
    SELECT
      client_meta_asset_id,
      jsonb_agg(
        jsonb_build_object(
          'metricId', metric_id,
          'targetKind', target_kind,
          'targetValue', target_value,
          'targetMin', target_min,
          'targetMax', target_max,
          'warningTolerancePercent', warning_tolerance,
          'criticalTolerancePercent', critical_tolerance,
          'priorityWeight', priority_weight,
          'evaluationPeriod', evaluation_period
        )
      ) AS targets
    FROM profile_targets
    GROUP BY client_meta_asset_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'clientId', ac.client_id,
      'clientName', ac.display_name,
      'clientStatus',
        CASE
          WHEN ls.id IS NOT NULL THEN 'synced'
          WHEN ans.id IS NOT NULL THEN 'failed'
          ELSE 'period_not_synced'
        END,
      'clientMetaAssetId', a.client_meta_asset_id,
      'metaAssetId', a.meta_asset_id,
      'integrationId', a.integration_id,
      'accountName', a.account_name,
      'adAccountId', a.ad_account_id,
      'currency', COALESCE(r.currency, a.currency),
      'timezone', COALESCE(r.timezone, a.timezone),
      'dateStart', r.date_start,
      'dateStop', r.date_stop,
      'profile', CASE
        WHEN cp.profile_id IS NOT NULL THEN
          jsonb_build_object(
            'id', cp.profile_id,
            'clientId', cp.client_id,
            'clientMetaAssetId', cp.client_meta_asset_id,
            'budgetPeriod', cp.budget_period,
            'plannedBudget', cp.planned_budget,
            'budgetPacingStrategy', cp.budget_pacing_strategy,
            'primaryConversionMetric', cp.primary_metric,
            'effectiveFrom', cp.effective_from,
            'effectiveTo', cp.effective_to
          )
        ELSE NULL
      END,
      'budgetPacing', CASE
        WHEN ls.id IS NOT NULL AND cp.planned_budget IS NOT NULL THEN
          public.calculate_budget_pacing(
            cp.planned_budget,
            (SELECT sum(v.metric_value)
             FROM public.meta_campaign_groups g
             CROSS JOIN LATERAL jsonb_each(g.metrics) m(metric_key, metric_obj)
             CROSS JOIN LATERAL (SELECT public.safe_cast_numeric(metric_obj->>'value') AS metric_value) v
             WHERE g.sync_run_id = ls.id AND metric_key = 'spend' AND v.metric_value IS NOT NULL
            ),
            cp.budget_pacing_strategy
          )
        ELSE NULL
      END,
      'metrics', public.get_traceable_entity_metrics(
        ls.id, a.client_meta_asset_id, a.ad_account_id, a.account_name,
        COALESCE(r.currency, a.currency), COALESCE(r.timezone, a.timezone),
        'account', NULL, NULL, NULL, NULL, NULL, NULL, NULL
      ),
      'targets', COALESCE(at.targets, '[]'::jsonb),
      'lastSuccessfulRun', CASE WHEN ls.id IS NOT NULL THEN
        jsonb_build_object(
          'id', r.id,
          'status', r.status,
          'startedAt', r.started_at,
          'finishedAt', r.finished_at,
          'recordsFetched', r.records_fetched
        )
      ELSE NULL END,
      'anyRun', CASE WHEN ans.id IS NOT NULL THEN
        jsonb_build_object(
          'id', run_any.id,
          'status', run_any.status,
          'startedAt', run_any.started_at,
          'finishedAt', run_any.finished_at,
          'errorMessage', run_any.error_message
        )
      ELSE NULL END
    )
    ORDER BY ac.display_name
  ), '[]'::jsonb) INTO v_result
  FROM active_clients ac
  JOIN accounts a ON a.client_id = ac.client_id
  LEFT JOIN any_sync ans ON ans.client_meta_asset_id = a.client_meta_asset_id
  LEFT JOIN public.meta_sync_runs run_any ON run_any.id = ans.id
  LEFT JOIN latest_sync ls ON ls.client_meta_asset_id = a.client_meta_asset_id
  LEFT JOIN public.meta_sync_runs r ON r.id = ls.id
  LEFT JOIN client_profiles cp ON cp.client_meta_asset_id = a.client_meta_asset_id
  LEFT JOIN aggregated_targets at ON at.client_meta_asset_id = a.client_meta_asset_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) TO authenticated;

-- Also fix get_meta_performance_hierarchy
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
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb, 'total', 0);
  END IF;

  IF p_period NOT IN ('this_month', 'this_week', 'today', 'last_7d', 'last_30d', 'last_90d') THEN
    RAISE EXCEPTION 'Invalid dashboard period: %', p_period USING ERRCODE = '22023';
  END IF;

  IF p_level NOT IN ('campaign', 'adset', 'ad', 'creative') THEN
    RAISE EXCEPTION 'Invalid level: %', p_level USING ERRCODE = '22023';
  END IF;

  SELECT cma.*, ma.asset_id AS ad_account_id, ma.asset_name AS account_name,
         ma.currency, ma.timezone_name, ma.integration_id
    INTO v_link
    FROM public.client_meta_assets cma
    JOIN public.meta_assets ma ON ma.id = cma.meta_asset_id
    WHERE cma.id = p_client_meta_asset_id
      AND cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'empty', 'items', '[]'::jsonb, 'total', 0);
  END IF;

  SELECT *
    INTO v_run
    FROM public.meta_sync_runs
    WHERE user_id = v_user_id
      AND integration_id = v_link.integration_id
      AND ad_account_id = v_link.ad_account_id
      AND requested_period = p_period
      AND run_scope = 'full_account'
      AND status = 'success'
    ORDER BY finished_at DESC NULLS LAST, started_at DESC
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'period_not_synced', 'items', '[]'::jsonb, 'total', 0);
  END IF;

  IF p_level = 'campaign' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_campaign_snapshots
    WHERE sync_run_id = v_run.id
      AND user_id = v_user_id
        AND COALESCE(NULLIF(upper(effective_status), ''), NULLIF(upper(meta_status), ''), '') = 'ACTIVE'
      AND EXISTS (
        SELECT 1
        FROM public.meta_campaign_groups g
        WHERE g.sync_run_id = meta_campaign_snapshots.sync_run_id
          AND g.user_id = meta_campaign_snapshots.user_id
          AND g.campaign_id = meta_campaign_snapshots.campaign_id
          AND COALESCE(public.safe_cast_numeric(g.metrics->'spend'->>'value'), 0) > 0
      )
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.meta_adset_snapshots any_adset
          WHERE any_adset.sync_run_id = meta_campaign_snapshots.sync_run_id
            AND any_adset.user_id = meta_campaign_snapshots.user_id
            AND any_adset.campaign_id = meta_campaign_snapshots.campaign_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.meta_adset_snapshots active_adset
          WHERE active_adset.sync_run_id = meta_campaign_snapshots.sync_run_id
            AND active_adset.user_id = meta_campaign_snapshots.user_id
            AND active_adset.campaign_id = meta_campaign_snapshots.campaign_id
            AND COALESCE(NULLIF(upper(active_adset.effective_status), ''), NULLIF(upper(active_adset.meta_status), ''), '') = 'ACTIVE'
        )
      );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.campaign_id, 'name', s.campaign_name, 'status', s.meta_status,
      'effectiveStatus', s.effective_status, 'objective', s.raw_objective,
      'classifiedObjective', s.classified_objective, 'destinationType', NULL,
      'attributionSetting', NULL, 'creativeId', NULL,
      'metrics', public.get_traceable_entity_metrics(
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
        AND EXISTS (
          SELECT 1
          FROM public.meta_campaign_groups g
          WHERE g.sync_run_id = meta_campaign_snapshots.sync_run_id
            AND g.user_id = meta_campaign_snapshots.user_id
            AND g.campaign_id = meta_campaign_snapshots.campaign_id
            AND COALESCE(public.safe_cast_numeric(g.metrics->'spend'->>'value'), 0) > 0
        )
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.meta_adset_snapshots any_adset
            WHERE any_adset.sync_run_id = meta_campaign_snapshots.sync_run_id
              AND any_adset.user_id = meta_campaign_snapshots.user_id
              AND any_adset.campaign_id = meta_campaign_snapshots.campaign_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.meta_adset_snapshots active_adset
            WHERE active_adset.sync_run_id = meta_campaign_snapshots.sync_run_id
              AND active_adset.user_id = meta_campaign_snapshots.user_id
              AND active_adset.campaign_id = meta_campaign_snapshots.campaign_id
              AND COALESCE(NULLIF(upper(active_adset.effective_status), ''), NULLIF(upper(active_adset.meta_status), ''), '') = 'ACTIVE'
          )
        )
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
      'metrics', public.get_traceable_entity_metrics(
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
      'metrics', public.get_traceable_entity_metrics(
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
      'metrics', public.get_traceable_entity_metrics(
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
    'dateStart', v_run.date_start, 'dateStop', v_run.date_stop,
    'run', jsonb_build_object(
      'id', v_run.id, 'status', v_run.status, 'scope', v_run.run_scope,
      'requestedLevel', v_run.requested_level, 'startedAt', v_run.started_at,
      'finishedAt', v_run.finished_at, 'terminationReason', v_run.termination_reason,
      'pagesFetched', v_run.pages_fetched, 'recordsFetched', v_run.records_fetched
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

COMMIT;
