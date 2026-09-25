-- Automatic Meta freshness status and independent structure/deep-sync evidence.
--
-- Lightweight campaign refreshes may be newer than deep creative syncs. Treat
-- these clocks independently so a fresh structure sync does not erase verified
-- ad/creative depth.

CREATE OR REPLACE FUNCTION public.get_meta_freshness_status(
  p_structure_max_age_minutes INTEGER DEFAULT 60,
  p_creative_max_age_minutes INTEGER DEFAULT 360
)
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
      'clientId', row.client_id,
      'clientMetaAssetId', row.client_meta_asset_id,
      'accountId', row.ad_account_id,
      'accountName', row.account_name,
      'timezone', row.timezone_name,
      'localToday', row.local_today,
      'structureLastSyncedAt', row.structure_finished_at,
      'structureDateStop', row.structure_date_stop,
      'creativeLastSyncedAt', row.creative_finished_at,
      'creativeDateStop', row.creative_date_stop,
      'structureFresh', row.structure_fresh,
      'creativeFresh', row.creative_fresh,
      'needsStructureRefresh', NOT row.structure_fresh,
      'needsCreativeRefresh', NOT row.creative_fresh
    )
    ORDER BY row.client_name, row.account_name
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ci.display_name AS client_name,
      cma.client_id,
      cma.id AS client_meta_asset_id,
      ma.asset_id AS ad_account_id,
      ma.asset_name AS account_name,
      ma.timezone_name,
      (timezone(COALESCE(ma.timezone_name, 'America/Sao_Paulo'), now()))::date AS local_today,
      structure_run.finished_at AS structure_finished_at,
      structure_run.date_stop AS structure_date_stop,
      creative_run.finished_at AS creative_finished_at,
      creative_run.date_stop AS creative_date_stop,
      (
        structure_run.id IS NOT NULL
        AND structure_run.date_stop >= (timezone(COALESCE(ma.timezone_name, 'America/Sao_Paulo'), now()))::date
        AND structure_run.finished_at >= now() - make_interval(mins => GREATEST(p_structure_max_age_minutes, 1))
      ) AS structure_fresh,
      (
        creative_run.id IS NOT NULL
        AND creative_run.date_stop >= (timezone(COALESCE(ma.timezone_name, 'America/Sao_Paulo'), now()))::date
        AND creative_run.finished_at >= now() - make_interval(mins => GREATEST(p_creative_max_age_minutes, 1))
      ) AS creative_fresh
    FROM public.client_meta_assets cma
    JOIN public.client_identity ci
      ON ci.user_id = cma.user_id
     AND ci.client_id = cma.client_id
    JOIN public.meta_assets ma
      ON ma.id = cma.meta_asset_id
    LEFT JOIN LATERAL (
      SELECT r.id, r.finished_at, r.date_stop
      FROM public.meta_sync_runs r
      WHERE r.user_id = v_user_id
        AND r.integration_id = ma.integration_id
        AND r.ad_account_id = ma.asset_id
        AND r.requested_period = 'last_90d'
        AND r.run_scope = 'full_account'
        AND r.status IN ('success', 'partial')
        AND EXISTS (
          SELECT 1
          FROM public.meta_campaign_snapshots c
          WHERE c.sync_run_id = r.id
            AND c.user_id = v_user_id
        )
      ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
      LIMIT 1
    ) structure_run ON true
    LEFT JOIN LATERAL (
      SELECT r.id, r.finished_at, r.date_stop
      FROM public.meta_sync_runs r
      WHERE r.user_id = v_user_id
        AND r.integration_id = ma.integration_id
        AND r.ad_account_id = ma.asset_id
        AND r.requested_period = 'last_90d'
        AND r.run_scope = 'full_account'
        AND r.status IN ('success', 'partial')
        AND lower(COALESCE(r.requested_level, '')) IN ('ad', 'creative')
        AND (
          r.status = 'success'
          OR EXISTS (
            SELECT 1
            FROM public.meta_ad_snapshots a
            WHERE a.sync_run_id = r.id
              AND a.user_id = v_user_id
          )
        )
      ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
      LIMIT 1
    ) creative_run ON true
    WHERE cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL
      AND ci.archived_at IS NULL
  ) row;

  RETURN jsonb_build_object(
    'state', 'ready',
    'checkedAt', now(),
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_freshness_status(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_freshness_status(INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_freshness_status(INTEGER, INTEGER) TO authenticated;

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
      'dataAvailable', summary.structure_run_id IS NOT NULL,
      'adDataAvailable', summary.creative_run_id IS NOT NULL,
      'hasActiveMedia', summary.creative_run_id IS NOT NULL AND summary.active_ads > 0,
      'lastSyncedAt', summary.structure_finished_at,
      'adLastSyncedAt', summary.creative_finished_at
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
      structure_run.id AS structure_run_id,
      structure_run.finished_at AS structure_finished_at,
      creative_run.id AS creative_run_id,
      creative_run.finished_at AS creative_finished_at,
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
          SELECT 1
          FROM public.meta_campaign_snapshots c
          WHERE c.sync_run_id = r.id
            AND c.user_id = v_user_id
        )
      ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
      LIMIT 1
    ) structure_run ON true
    LEFT JOIN LATERAL (
      SELECT r.id, r.finished_at
      FROM public.meta_sync_runs r
      WHERE r.user_id = v_user_id
        AND r.integration_id = ma.integration_id
        AND r.ad_account_id = ma.asset_id
        AND r.requested_period = 'last_90d'
        AND r.run_scope = 'full_account'
        AND r.status IN ('success', 'partial')
        AND lower(COALESCE(r.requested_level, '')) IN ('ad', 'creative')
        AND (
          r.status = 'success'
          OR EXISTS (
            SELECT 1
            FROM public.meta_ad_snapshots a
            WHERE a.sync_run_id = r.id
              AND a.user_id = v_user_id
          )
        )
      ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
      LIMIT 1
    ) creative_run ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS active_campaigns
      FROM public.meta_campaign_snapshots c
      WHERE c.sync_run_id = structure_run.id
        AND c.user_id = v_user_id
        AND upper(COALESCE(NULLIF(c.effective_status, ''), c.meta_status, '')) = 'ACTIVE'
    ) campaign_counts ON structure_run.id IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT count(*) AS active_adsets
      FROM public.meta_adset_snapshots s
      JOIN public.meta_campaign_snapshots c
        ON c.sync_run_id = s.sync_run_id
       AND c.user_id = s.user_id
       AND c.campaign_id = s.campaign_id
      WHERE s.sync_run_id = creative_run.id
        AND s.user_id = v_user_id
        AND upper(COALESCE(NULLIF(c.effective_status, ''), c.meta_status, '')) = 'ACTIVE'
        AND upper(COALESCE(NULLIF(s.effective_status, ''), s.meta_status, '')) = 'ACTIVE'
    ) adset_counts ON creative_run.id IS NOT NULL
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
      WHERE a.sync_run_id = creative_run.id
        AND a.user_id = v_user_id
        AND upper(COALESCE(NULLIF(c.effective_status, ''), c.meta_status, '')) = 'ACTIVE'
        AND upper(COALESCE(NULLIF(s.effective_status, ''), s.meta_status, '')) = 'ACTIVE'
        AND upper(COALESCE(NULLIF(a.effective_status, ''), a.meta_status, '')) = 'ACTIVE'
    ) ad_counts ON creative_run.id IS NOT NULL
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
