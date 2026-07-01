-- Migration 000020: operational Meta hierarchy and safe client asset catalog.
-- Additive only. Existing analytics RPCs remain available for rollback.

BEGIN;

WITH ranked_running AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, request_fingerprint
           ORDER BY started_at DESC, created_at DESC, id DESC
         ) AS position
  FROM public.meta_sync_runs
  WHERE status = 'running' AND request_fingerprint IS NOT NULL
)
UPDATE public.meta_sync_runs r
SET status = 'failed',
    finished_at = COALESCE(r.finished_at, now()),
    termination_reason = 'validation_error',
    error_message = 'Superseded duplicate running synchronization'
FROM ranked_running ranked
WHERE r.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS meta_sync_runs_one_running_fingerprint
ON public.meta_sync_runs (user_id, request_fingerprint)
WHERE status = 'running' AND request_fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_meta_sync_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.meta_sync_runs r
  SET status = 'failed',
      finished_at = COALESCE(r.finished_at, now()),
      termination_reason = 'unexpected_error',
      error_message = COALESCE(r.error_message, 'Synchronization lease expired')
  WHERE r.user_id = NEW.user_id
    AND r.status = 'running'
    AND r.started_at < now() - interval '30 minutes';

  IF (
    SELECT count(*)
    FROM public.meta_sync_runs r
    WHERE r.user_id = NEW.user_id
      AND r.started_at >= now() - interval '1 minute'
  ) >= 30 THEN
    RAISE EXCEPTION 'Meta synchronization rate limit exceeded'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meta_sync_rate_limit ON public.meta_sync_runs;
CREATE TRIGGER trg_meta_sync_rate_limit
BEFORE INSERT ON public.meta_sync_runs
FOR EACH ROW EXECUTE FUNCTION public.enforce_meta_sync_rate_limit();

REVOKE ALL ON FUNCTION public.enforce_meta_sync_rate_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_meta_sync_rate_limit() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_meta_sync_rate_limit() FROM authenticated;

CREATE OR REPLACE FUNCTION public.populate_meta_sync_run_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_date_start DATE;
  v_date_stop DATE;
  v_attributions JSONB;
BEGIN
  IF NEW.status IN ('success', 'partial', 'failed') AND OLD.status = 'running' THEN
    SELECT min(m.date_start), max(m.date_stop),
           COALESCE(jsonb_agg(DISTINCT m.attribution_setting)
             FILTER (WHERE m.attribution_setting IS NOT NULL), '[]'::jsonb)
    INTO v_date_start, v_date_stop, v_attributions
    FROM public.meta_normalized_metrics m
    WHERE m.sync_run_id = NEW.id AND m.user_id = NEW.user_id;

    NEW.date_start := COALESCE(NEW.date_start, v_date_start);
    NEW.date_stop := COALESCE(NEW.date_stop, v_date_stop);
    NEW.attribution_config := COALESCE(NEW.attribution_config, v_attributions);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_meta_sync_run_contract ON public.meta_sync_runs;
CREATE TRIGGER trg_populate_meta_sync_run_contract
BEFORE UPDATE OF status ON public.meta_sync_runs
FOR EACH ROW EXECUTE FUNCTION public.populate_meta_sync_run_contract();

REVOKE ALL ON FUNCTION public.populate_meta_sync_run_contract() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.populate_meta_sync_run_contract() FROM anon;
REVOKE ALL ON FUNCTION public.populate_meta_sync_run_contract() FROM authenticated;

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
    'unavailableReason', CASE
      WHEN p_metric IS NULL OR jsonb_typeof(p_metric) <> 'object' THEN 'metric_unavailable'
      ELSE p_metric->>'unavailableReason'
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

REVOKE ALL ON FUNCTION public.decorate_analytics_metric(TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decorate_analytics_metric(TEXT, JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.decorate_analytics_metric(TEXT, JSONB, JSONB) FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_client_meta_asset_catalog(
  p_client_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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

  SELECT jsonb_build_object(
    'clients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'clientId', ci.client_id,
        'clientName', ci.display_name,
        'accounts', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'clientMetaAssetId', cma.id,
            'metaAssetId', ma.id,
            'integrationId', ma.integration_id,
            'adAccountId', ma.asset_id,
            'accountName', ma.asset_name,
            'currency', ma.currency,
            'timezone', ma.timezone_name,
            'assetStatus', ma.asset_status,
            'linkedAt', cma.linked_at,
            'availablePeriods', COALESCE((
              SELECT jsonb_agg(period_value ORDER BY period_value)
              FROM (
                SELECT DISTINCT r.requested_period AS period_value
                FROM public.meta_sync_runs r
                WHERE r.user_id = v_user_id
                  AND r.integration_id = ma.integration_id
                  AND r.ad_account_id = ma.asset_id
                  AND r.run_scope = 'full_account'
                  AND r.status = 'success'
                  AND r.requested_period IN ('this_month', 'today', 'last_7d', 'last_30d')
              ) periods
            ), '[]'::jsonb),
            'lastAttempt', (
              SELECT jsonb_build_object(
                'id', r.id,
                'status', r.status,
                'period', r.requested_period,
                'level', r.requested_level,
                'scope', r.run_scope,
                'startedAt', r.started_at,
                'finishedAt', r.finished_at,
                'terminationReason', r.termination_reason,
                'pagesFetched', r.pages_fetched,
                'recordsFetched', r.records_fetched
              )
              FROM public.meta_sync_runs r
              WHERE r.user_id = v_user_id
                AND r.integration_id = ma.integration_id
                AND r.ad_account_id = ma.asset_id
              ORDER BY r.started_at DESC
              LIMIT 1
            ),
            'lastSuccess', (
              SELECT jsonb_build_object(
                'id', r.id,
                'period', r.requested_period,
                'level', r.requested_level,
                'scope', r.run_scope,
                'startedAt', r.started_at,
                'finishedAt', r.finished_at,
                'pagesFetched', r.pages_fetched,
                'recordsFetched', r.records_fetched
              )
              FROM public.meta_sync_runs r
              WHERE r.user_id = v_user_id
                AND r.integration_id = ma.integration_id
                AND r.ad_account_id = ma.asset_id
                AND r.status = 'success'
              ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
              LIMIT 1
            )
          ) ORDER BY ma.asset_name)
          FROM public.client_meta_assets cma
          JOIN public.meta_assets ma ON ma.id = cma.meta_asset_id
          JOIN public.meta_integrations mi ON mi.id = ma.integration_id
          WHERE cma.user_id = v_user_id
            AND cma.client_id = ci.client_id
            AND cma.unlinked_at IS NULL
            AND mi.user_id = v_user_id
        ), '[]'::jsonb)
      ) ORDER BY ci.display_name)
      FROM public.client_identity ci
      WHERE ci.user_id = v_user_id
        AND ci.archived_at IS NULL
        AND (p_client_id IS NULL OR ci.client_id = p_client_id)
    ), '[]'::jsonb),
    'availableAssets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'metaAssetId', ma.id,
        'integrationId', ma.integration_id,
        'adAccountId', ma.asset_id,
        'accountName', ma.asset_name,
        'currency', ma.currency,
        'timezone', ma.timezone_name,
        'assetStatus', ma.asset_status,
        'linkedClientId', cma.client_id,
        'clientMetaAssetId', cma.id
      ) ORDER BY ma.asset_name)
      FROM public.meta_assets ma
      JOIN public.meta_integrations mi ON mi.id = ma.integration_id
      LEFT JOIN public.client_meta_assets cma
        ON cma.meta_asset_id = ma.id
       AND cma.user_id = v_user_id
       AND cma.unlinked_at IS NULL
      WHERE mi.user_id = v_user_id
        AND mi.status = 'active'
        AND ma.asset_type = 'adaccount'
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_traceable_entity_metrics(
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_metric_id TEXT;
  v_metric JSONB;
  v_result JSONB := '{}'::jsonb;
  v_context JSONB;
  v_base_context JSONB;
  v_metric_ids CONSTANT TEXT[] := ARRAY[
    'spend', 'impressions', 'reach', 'frequency', 'clicks', 'link_clicks', 'link_ctr',
    'link_cpc', 'cpm', 'landing_page_views', 'page_load_rate',
    'whatsapp_conversations_started', 'messenger_conversations_started',
    'instagram_direct_conversations_started', 'messaging_conversations_started_generic',
    'messaging_conversations_started_total', 'cost_per_messaging_conversation',
    'leads', 'cpa', 'purchases', 'purchase_value', 'purchase_roas'
  ];
BEGIN
  IF v_user_id IS NULL OR p_source_level NOT IN ('campaign', 'adset', 'ad') THEN
    RETURN '{}'::jsonb;
  END IF;

  v_base_context := jsonb_build_object(
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
    'adId', p_ad_id
  );

  FOREACH v_metric_id IN ARRAY v_metric_ids LOOP
    v_context := v_base_context;
    SELECT jsonb_build_object(
      'value', m.metric_value,
      'available', true,
      'completenessStatus', COALESCE(m.completeness_status, 'complete')
    )
    INTO v_metric
    FROM public.meta_normalized_metrics m
    WHERE m.user_id = v_user_id
      AND m.sync_run_id = p_sync_run_id
      AND m.metric_id = v_metric_id
      AND m.source_level = p_source_level
      AND (p_campaign_id IS NULL OR m.campaign_id = p_campaign_id)
      AND (p_adset_id IS NULL OR m.adset_id = p_adset_id)
      AND (p_ad_id IS NULL OR m.ad_id = p_ad_id)
      AND (p_creative_id IS NULL OR m.creative_id = p_creative_id)
      AND (p_source_level <> 'campaign' OR (m.adset_id IS NULL AND m.ad_id IS NULL))
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF v_metric IS NOT NULL THEN
      SELECT v_context || jsonb_build_object(
        'dateStart', m.date_start,
        'dateStop', m.date_stop,
        'attributionSetting', COALESCE(m.attribution_setting, p_attribution_setting)
      )
      INTO v_context
      FROM public.meta_normalized_metrics m
      WHERE m.user_id = v_user_id
        AND m.sync_run_id = p_sync_run_id
        AND m.metric_id = v_metric_id
        AND m.source_level = p_source_level
        AND (p_campaign_id IS NULL OR m.campaign_id = p_campaign_id)
        AND (p_adset_id IS NULL OR m.adset_id = p_adset_id)
        AND (p_ad_id IS NULL OR m.ad_id = p_ad_id)
        AND (p_creative_id IS NULL OR m.creative_id = p_creative_id)
      ORDER BY m.created_at DESC
      LIMIT 1;
    END IF;

    v_result := v_result || jsonb_build_object(
      v_metric_id,
      public.decorate_analytics_metric(v_metric_id, v_metric, v_context)
    );
    v_metric := NULL;
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_meta_performance_hierarchy(
  p_client_meta_asset_id UUID,
  p_period TEXT,
  p_level TEXT,
  p_parent_id TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_link RECORD;
  v_run RECORD;
  v_items JSONB := '[]'::jsonb;
  v_total INTEGER := 0;
  v_offset INTEGER;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_period NOT IN ('this_month', 'today', 'last_7d', 'last_30d') THEN
    RAISE EXCEPTION 'Invalid hierarchy period' USING ERRCODE = '22023';
  END IF;
  IF p_level NOT IN ('campaign', 'adset', 'ad', 'creative') THEN
    RAISE EXCEPTION 'Invalid hierarchy level' USING ERRCODE = '22023';
  END IF;
  IF p_page < 1 OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'Invalid hierarchy pagination' USING ERRCODE = '22023';
  END IF;
  IF p_level <> 'campaign' AND NULLIF(btrim(COALESCE(p_parent_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'parent_id is required for this level' USING ERRCODE = '22023';
  END IF;

  SELECT cma.id, cma.client_id, ma.id AS meta_asset_id, ma.integration_id,
         ma.asset_id AS ad_account_id, ma.asset_name AS account_name,
         ma.currency, ma.timezone_name
  INTO v_link
  FROM public.client_meta_assets cma
  JOIN public.meta_assets ma ON ma.id = cma.meta_asset_id
  JOIN public.meta_integrations mi ON mi.id = ma.integration_id
  WHERE cma.id = p_client_meta_asset_id
    AND cma.user_id = v_user_id
    AND cma.unlinked_at IS NULL
    AND mi.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client Meta asset link not found' USING ERRCODE = '42501';
  END IF;

  SELECT r.* INTO v_run
  FROM public.meta_sync_runs r
  WHERE r.user_id = v_user_id
    AND r.integration_id = v_link.integration_id
    AND r.ad_account_id = v_link.ad_account_id
    AND r.requested_period = p_period
    AND r.status IN ('success', 'partial')
    AND (
      (p_level = 'campaign' AND r.run_scope = 'full_account')
      OR (p_level = 'adset' AND r.requested_level IN ('adset', 'ad', 'creative')
          AND (r.run_scope = 'full_account' OR r.selected_entity_ids->'campaign_ids' ? p_parent_id))
      OR (p_level = 'ad' AND r.requested_level IN ('ad', 'creative')
          AND (r.run_scope = 'full_account' OR r.selected_entity_ids->'adset_ids' ? p_parent_id))
      OR (p_level = 'creative' AND r.requested_level IN ('ad', 'creative')
          AND (r.run_scope = 'full_account' OR r.selected_entity_ids->'ad_ids' ? p_parent_id))
    )
  ORDER BY (r.status = 'success') DESC, r.finished_at DESC NULLS LAST, r.started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'period_not_synced', 'level', p_level, 'period', p_period,
      'page', p_page, 'pageSize', p_page_size, 'total', 0, 'items', '[]'::jsonb,
      'clientId', v_link.client_id, 'clientMetaAssetId', v_link.id,
      'metaAssetId', v_link.meta_asset_id, 'integrationId', v_link.integration_id,
      'adAccountId', v_link.ad_account_id, 'currency', v_link.currency,
      'timezone', v_link.timezone_name
    );
  END IF;

  v_offset := (p_page - 1) * p_page_size;

  IF p_level = 'campaign' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_campaign_snapshots s WHERE s.sync_run_id = v_run.id AND s.user_id = v_user_id;

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
      SELECT * FROM public.meta_campaign_snapshots
      WHERE sync_run_id = v_run.id AND user_id = v_user_id
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
      'dailyBudget', CASE
        WHEN s.promoted_object->>'_camply_daily_budget' ~ '^[0-9]+([.][0-9]+)?$'
          THEN (s.promoted_object->>'_camply_daily_budget')::numeric / 100
        ELSE NULL
      END,
      'lifetimeBudget', CASE
        WHEN s.promoted_object->>'_camply_lifetime_budget' ~ '^[0-9]+([.][0-9]+)?$'
          THEN (s.promoted_object->>'_camply_lifetime_budget')::numeric / 100
        ELSE NULL
      END,
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

CREATE OR REPLACE FUNCTION public.get_client_performance_target_history(
  p_client_meta_asset_id UUID,
  p_campaign_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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
  IF NOT EXISTS (
    SELECT 1 FROM public.client_meta_assets cma
    WHERE cma.id = p_client_meta_asset_id AND cma.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Client Meta asset link not found' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'clientMetaAssetId', t.client_meta_asset_id,
    'campaignId', t.campaign_id, 'metricId', t.metric_id,
    'targetKind', t.target_kind, 'targetValue', t.target_value,
    'effectiveFrom', t.effective_from, 'effectiveTo', t.effective_to,
    'active', t.effective_to IS NULL
  ) ORDER BY t.effective_from DESC), '[]'::jsonb)
  INTO v_result
  FROM public.client_performance_targets t
  WHERE t.user_id = v_user_id
    AND t.client_meta_asset_id = p_client_meta_asset_id
    AND (
      (p_campaign_id IS NULL AND t.campaign_id IS NULL)
      OR t.campaign_id = p_campaign_id
    );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_client_meta_asset_catalog(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_client_meta_asset_catalog(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_client_meta_asset_catalog(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_traceable_entity_metrics(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_traceable_entity_metrics(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_traceable_entity_metrics(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.get_client_performance_target_history(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_client_performance_target_history(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_client_performance_target_history(UUID, TEXT) TO authenticated;

COMMIT;
