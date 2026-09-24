-- Creative Lab reads the same persisted Meta snapshots and date-sliced metrics
-- used by Analytics. It does not fetch performance directly from Graph/Claude.
-- One row represents one ad + creative relation; the frontend aggregates rows
-- by creative so reused creatives preserve all delivery without losing lineage.

CREATE OR REPLACE FUNCTION public.get_meta_creative_lab(
  p_client_meta_asset_id UUID,
  p_period TEXT DEFAULT 'last_30d',
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 100
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
  v_offset INTEGER;
  v_is_slice BOOLEAN := p_period IN ('today', 'yesterday', 'today_and_yesterday', 'last_7d', 'last_30d', 'last_90d');
  v_local_today DATE;
  v_date_start DATE;
  v_date_stop DATE;
  v_found BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb, 'total', 0);
  END IF;

  IF p_page < 1 OR p_page_size < 1 OR p_page_size > 200 THEN
    RAISE EXCEPTION 'Invalid creative lab pagination' USING ERRCODE = '22023';
  END IF;
  v_offset := (p_page - 1) * p_page_size;

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
    RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb, 'total', 0);
  END IF;

  IF v_is_slice THEN
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
        SELECT 1 FROM public.meta_ad_snapshots a
        WHERE a.sync_run_id = r.id AND a.user_id = v_user_id
      )
    ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
    LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    v_date_start := NULL;
    v_date_stop := NULL;
    SELECT r.* INTO v_run
    FROM public.meta_sync_runs r
    WHERE r.user_id = v_user_id
      AND r.integration_id = v_link.integration_id
      AND r.ad_account_id = v_link.ad_account_id
      AND r.requested_period = p_period
      AND r.run_scope = 'full_account'
      AND r.status IN ('success', 'partial')
      AND EXISTS (
        SELECT 1 FROM public.meta_ad_snapshots a
        WHERE a.sync_run_id = r.id AND a.user_id = v_user_id
      )
    ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
    LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    RETURN jsonb_build_object(
      'state', 'period_not_synced',
      'items', '[]'::jsonb,
      'total', 0,
      'page', p_page,
      'pageSize', p_page_size,
      'clientId', v_link.client_id,
      'clientMetaAssetId', v_link.id,
      'accountId', v_link.ad_account_id,
      'accountName', v_link.account_name
    );
  END IF;

  SELECT count(*) INTO v_total
  FROM public.meta_ad_snapshots a
  JOIN public.meta_creative_snapshots c
    ON c.sync_run_id = a.sync_run_id
   AND c.user_id = a.user_id
   AND c.creative_id = a.creative_id
  WHERE a.sync_run_id = v_run.id
    AND a.user_id = v_user_id
    AND a.creative_id IS NOT NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'campaignId', row.campaign_id,
      'campaignName', row.campaign_name,
      'campaignStatus', row.campaign_status,
      'campaignEffectiveStatus', row.campaign_effective_status,
      'classifiedObjective', row.classified_objective,
      'adsetId', row.adset_id,
      'adsetName', row.adset_name,
      'adsetStatus', row.adset_status,
      'adsetEffectiveStatus', row.adset_effective_status,
      'adId', row.ad_id,
      'adName', row.ad_name,
      'adStatus', row.ad_status,
      'adEffectiveStatus', row.ad_effective_status,
      'creativeId', row.creative_id,
      'creativeName', row.creative_name,
      'title', row.title,
      'body', row.body,
      'thumbnailUrl', row.thumbnail_url,
      'imageUrl', row.image_url,
      'objectStorySpec', row.object_story_spec,
      'updatedAt', row.updated_at,
      'metrics', public.get_hierarchy_entity_metrics(
        v_date_start, v_date_stop,
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency),
        COALESCE(v_run.timezone, v_link.timezone_name),
        'ad',
        row.campaign_id, row.adset_id, row.ad_id, row.creative_id,
        row.classified_objective::text, row.destination_type, row.attribution_setting
      )
    )
    ORDER BY row.structure_rank, row.creative_name NULLS LAST, row.ad_name
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      a.campaign_id,
      COALESCE(cs.campaign_name, a.campaign_id) AS campaign_name,
      cs.meta_status AS campaign_status,
      cs.effective_status AS campaign_effective_status,
      cs.classified_objective,
      a.adset_id,
      COALESCE(s.adset_name, a.adset_id) AS adset_name,
      s.meta_status AS adset_status,
      s.effective_status AS adset_effective_status,
      s.destination_type,
      s.attribution_setting,
      a.ad_id,
      a.ad_name,
      a.meta_status AS ad_status,
      a.effective_status AS ad_effective_status,
      c.creative_id,
      COALESCE(c.creative_name, c.title, a.ad_name, c.creative_id) AS creative_name,
      c.title,
      c.body,
      c.thumbnail_url,
      c.image_url,
      c.object_story_spec,
      c.asset_payload->>'updated_time' AS updated_at,
      CASE
        WHEN upper(COALESCE(cs.effective_status, cs.meta_status, '')) = 'ACTIVE'
         AND upper(COALESCE(s.effective_status, s.meta_status, '')) = 'ACTIVE'
         AND upper(COALESCE(a.effective_status, a.meta_status, '')) = 'ACTIVE'
        THEN 0 ELSE 1
      END AS structure_rank
    FROM public.meta_ad_snapshots a
    JOIN public.meta_creative_snapshots c
      ON c.sync_run_id = a.sync_run_id
     AND c.user_id = a.user_id
     AND c.creative_id = a.creative_id
    LEFT JOIN public.meta_campaign_snapshots cs
      ON cs.sync_run_id = a.sync_run_id
     AND cs.user_id = a.user_id
     AND cs.campaign_id = a.campaign_id
    LEFT JOIN public.meta_adset_snapshots s
      ON s.sync_run_id = a.sync_run_id
     AND s.user_id = a.user_id
     AND s.adset_id = a.adset_id
    WHERE a.sync_run_id = v_run.id
      AND a.user_id = v_user_id
      AND a.creative_id IS NOT NULL
    ORDER BY structure_rank, creative_name NULLS LAST, a.ad_name
    OFFSET v_offset LIMIT p_page_size
  ) row;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_total = 0 THEN 'empty' ELSE 'ready' END,
    'items', v_items,
    'total', v_total,
    'page', p_page,
    'pageSize', p_page_size,
    'clientId', v_link.client_id,
    'clientMetaAssetId', v_link.id,
    'accountId', v_link.ad_account_id,
    'accountName', v_link.account_name,
    'currency', COALESCE(v_run.currency, v_link.currency),
    'timezone', COALESCE(v_run.timezone, v_link.timezone_name),
    'dateStart', COALESCE(v_date_start, v_run.date_start),
    'dateStop', COALESCE(v_date_stop, v_run.date_stop),
    'runId', v_run.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_creative_lab(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_creative_lab(UUID, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_creative_lab(UUID, TEXT, INTEGER, INTEGER) TO authenticated;


-- One lightweight read powers the client list. Current media activity is
-- structural: campaign + ad set + ad must all be ACTIVE in the newest official
-- full-account snapshot. This intentionally does not treat an ACTIVE campaign
-- with paused ad sets as active media.
CREATE OR REPLACE FUNCTION public.get_meta_creative_lab_account_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_items JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'clientId', summary.client_id,
      'clientMetaAssetId', summary.client_meta_asset_id,
      'accountId', summary.ad_account_id,
      'accountName', summary.account_name,
      'activeCampaigns', summary.active_campaigns,
      'activeAdSets', summary.active_adsets,
      'activeAds', summary.active_ads,
      'hasActiveMedia', summary.active_ads > 0,
      'lastSyncedAt', summary.finished_at
    )
    ORDER BY summary.client_name, summary.account_name
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ci.display_name AS client_name,
      cma.client_id,
      cma.id AS client_meta_asset_id,
      ma.asset_id AS ad_account_id,
      ma.asset_name AS account_name,
      latest.finished_at,
      COALESCE(campaign_counts.active_campaigns, 0)::int AS active_campaigns,
      COALESCE(adset_counts.active_adsets, 0)::int AS active_adsets,
      COALESCE(ad_counts.active_ads, 0)::int AS active_ads
    FROM public.client_meta_assets cma
    JOIN public.client_identity ci
      ON ci.user_id = cma.user_id
     AND ci.client_id = cma.client_id
    JOIN public.meta_assets ma
      ON ma.id = cma.meta_asset_id
    LEFT JOIN LATERAL (
      SELECT r.id, r.finished_at
      FROM public.meta_sync_runs r
      WHERE r.user_id = v_user_id
        AND r.integration_id = ma.integration_id
        AND r.ad_account_id = ma.asset_id
        AND r.requested_period = 'last_90d'
        AND r.run_scope = 'full_account'
        AND r.status IN ('success', 'partial')
        AND EXISTS (
          SELECT 1 FROM public.meta_campaign_snapshots c
          WHERE c.sync_run_id = r.id AND c.user_id = v_user_id
        )
      ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS active_campaigns
      FROM public.meta_campaign_snapshots c
      WHERE c.sync_run_id = latest.id
        AND c.user_id = v_user_id
        AND upper(COALESCE(NULLIF(c.effective_status, ''), c.meta_status, '')) = 'ACTIVE'
    ) campaign_counts ON latest.id IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT count(*) AS active_adsets
      FROM public.meta_adset_snapshots s
      JOIN public.meta_campaign_snapshots c
        ON c.sync_run_id = s.sync_run_id
       AND c.user_id = s.user_id
       AND c.campaign_id = s.campaign_id
      WHERE s.sync_run_id = latest.id
        AND s.user_id = v_user_id
        AND upper(COALESCE(NULLIF(c.effective_status, ''), c.meta_status, '')) = 'ACTIVE'
        AND upper(COALESCE(NULLIF(s.effective_status, ''), s.meta_status, '')) = 'ACTIVE'
    ) adset_counts ON latest.id IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT count(*) AS active_ads
      FROM public.meta_ad_snapshots a
      JOIN public.meta_adset_snapshots s
        ON s.sync_run_id = a.sync_run_id
       AND s.user_id = a.user_id
       AND s.adset_id = a.adset_id
      JOIN public.meta_campaign_snapshots c
        ON c.sync_run_id = a.sync_run_id
       AND c.user_id = a.user_id
       AND c.campaign_id = a.campaign_id
      WHERE a.sync_run_id = latest.id
        AND a.user_id = v_user_id
        AND upper(COALESCE(NULLIF(c.effective_status, ''), c.meta_status, '')) = 'ACTIVE'
        AND upper(COALESCE(NULLIF(s.effective_status, ''), s.meta_status, '')) = 'ACTIVE'
        AND upper(COALESCE(NULLIF(a.effective_status, ''), a.meta_status, '')) = 'ACTIVE'
    ) ad_counts ON latest.id IS NOT NULL
    WHERE cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL
      AND ci.archived_at IS NULL
  ) summary;

  RETURN jsonb_build_object('state', 'ready', 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_creative_lab_account_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_creative_lab_account_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_creative_lab_account_summary() TO authenticated;
