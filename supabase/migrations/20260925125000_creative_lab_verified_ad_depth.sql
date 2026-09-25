-- Distinguish a verified zero-ad result from a partial deep sync that never
-- persisted ad-level rows. Run metadata says what was requested; snapshot
-- existence says what was actually persisted.

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
      'dataAvailable', summary.data_available,
      'adDataAvailable', summary.ad_data_available,
      'hasActiveMedia', summary.ad_data_available AND summary.active_ads > 0,
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
      latest.id IS NOT NULL AS data_available,
      CASE
        WHEN latest.id IS NULL THEN false
        WHEN latest.status = 'success'
          AND lower(COALESCE(latest.requested_level, '')) IN ('ad', 'creative')
          THEN true
        WHEN EXISTS (
          SELECT 1
          FROM public.meta_ad_snapshots persisted_ad
          WHERE persisted_ad.sync_run_id = latest.id
            AND persisted_ad.user_id = v_user_id
        ) THEN true
        ELSE false
      END AS ad_data_available,
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
      SELECT r.id, r.finished_at, r.status, r.requested_level
      FROM public.meta_sync_runs r
      WHERE r.user_id = v_user_id
        AND r.integration_id = ma.integration_id
        AND r.ad_account_id = ma.asset_id
        AND r.requested_period = 'last_90d'
        AND r.run_scope = 'full_account'
        AND r.status IN ('success', 'partial')
        AND (
          r.status = 'success'
          OR EXISTS (
            SELECT 1
            FROM public.meta_campaign_snapshots persisted_campaign
            WHERE persisted_campaign.sync_run_id = r.id
              AND persisted_campaign.user_id = v_user_id
          )
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
