-- get_meta_performance_hierarchy only ever picked a run with status = 'success',
-- falling back to a previous "clean" run whenever the account's latest sync came
-- back 'partial' - which is common (rate limits/timeouts on a few insight pages)
-- and can persist for accounts that never manage a 100%-complete run again.
-- Confirmed live: an account's latest run was 'partial' but had already written
-- 100 campaign snapshots (94 active) from today, while this function kept serving
-- a 'success' run from 12 days earlier with only 25 campaigns - stale structure
-- and status shown as if current, including campaigns that had since been paused
-- on Meta's side.
--
-- 'partial' runs still write real, more-current snapshots for whatever they did
-- collect; only 'failed'/'running' runs have no usable data. Prefer the latest
-- 'success' or 'partial' run instead of requiring a perfect one.
--
-- Body otherwise unchanged from 20260710000000_stabilize_upsert_client_analysis_profile_and_hierarchy.sql.
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

  -- run_scope = 'full_account' keeps selective_campaigns runs from shadowing the
  -- last full-account sync. status IN ('success','partial') prefers the most
  -- recent run with usable snapshots over an older, fully-complete one.
  SELECT * INTO v_run
  FROM public.meta_sync_runs
  WHERE user_id = v_user_id
    AND integration_id = v_link.integration_id
    AND ad_account_id = v_link.ad_account_id
    AND requested_period = p_period
    AND run_scope = 'full_account'
    AND status IN ('success', 'partial')
  ORDER BY finished_at DESC NULLS LAST, started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
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
    'dateStart', v_run.date_start,
    'dateStop', v_run.date_stop,
    'run', jsonb_build_object(
      'id', v_run.id,
      'status', v_run.status,
      'startedAt', v_run.started_at,
      'finishedAt', v_run.finished_at
    )
  );
END;
$$;
