-- Campaign drill-down lists campaigns that delivered in the period first.
--
-- After 20260922000000 the drill-down reads the right period, but campaigns are
-- still ordered by name. Meta keeps many campaigns ACTIVE without delivery (one
-- production account: 219 ACTIVE, 3 with spend in the last 30 days), so the
-- first page was mostly zeros and the campaigns that spent could fall off it.
--
-- Campaign level of get_meta_performance_hierarchy now orders by spend in the
-- slice (desc, no delivery last), then by name. Legacy exact-period reads have
-- no slice and keep name order. Body otherwise unchanged from 20260922000000.

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
    ) ORDER BY s.slice_spend DESC NULLS LAST, s.campaign_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT cs.*,
        -- Campaigns that delivered in the slice come first, by spend. Meta keeps
        -- many campaigns ACTIVE with no delivery; alphabetical order buried the
        -- few that actually spent behind a page of zeros.
        (
          SELECT SUM(m.metric_value)
          FROM public.meta_normalized_metrics m
          WHERE v_date_start IS NOT NULL
            AND m.user_id = v_user_id
            AND m.sync_run_id = v_run.id
            AND m.source_level = 'campaign'
            AND m.campaign_id = cs.campaign_id
            AND m.adset_id IS NULL
            AND m.ad_id IS NULL
            AND m.metric_id = 'spend'
            AND m.date_start >= v_date_start
            AND m.date_stop <= v_date_stop
        ) AS slice_spend
      FROM public.meta_campaign_snapshots cs
      WHERE cs.sync_run_id = v_run.id
        AND cs.user_id = v_user_id
        AND COALESCE(NULLIF(upper(cs.effective_status), ''), NULLIF(upper(cs.meta_status), ''), '') = 'ACTIVE'
      ORDER BY slice_spend DESC NULLS LAST, cs.campaign_name OFFSET v_offset LIMIT p_page_size
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

REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
