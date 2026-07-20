-- Add real run-period evidence to get_global_performance_dashboard_v2 RunSummary JSON.
-- This migration intentionally redefines the function with CREATE OR REPLACE
-- because older 20260717000000 may already be applied in production and will
-- not run again after file edits.

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
    UNION
    SELECT
      (c->>'id') AS client_id,
      (c->>'name') AS display_name
    FROM public.camply_workspace w,
         jsonb_array_elements(w.data->'clients') c
    WHERE w.id = v_user_id::text
      AND (c->>'status') = 'active'
      AND (p_client_ids IS NULL OR (c->>'id') = ANY(p_client_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.client_identity ci2
        WHERE ci2.client_id = (c->>'id')
          AND ci2.user_id = v_user_id
      )
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
    ORDER BY a.client_meta_asset_id, r.started_at DESC, r.created_at DESC
  ),
  latest_attempt AS (
    SELECT DISTINCT ON (a.client_meta_asset_id)
      a.client_meta_asset_id,
      a.client_id,
      r.id,
      r.status,
      r.requested_period,
      r.run_scope,
      r.started_at,
      r.finished_at,
      r.termination_reason,
      r.error_message,
      r.date_start,
      r.date_stop,
      COALESCE(r.timezone, a.timezone) AS timezone,
      COALESCE(r.currency, a.currency) AS currency
    FROM accounts a
    JOIN public.meta_sync_runs r
      ON r.user_id = v_user_id
     AND r.integration_id = a.integration_id
     AND r.ad_account_id = a.ad_account_id
     AND r.requested_period = p_period
    ORDER BY a.client_meta_asset_id, r.started_at DESC, r.created_at DESC
  ),
  latest_success AS (
    SELECT DISTINCT ON (a.client_meta_asset_id)
      a.client_meta_asset_id,
      a.client_id,
      a.meta_asset_id,
      a.integration_id,
      a.ad_account_id,
      r.id,
      r.status,
      r.requested_period,
      r.run_scope,
      r.started_at,
      r.finished_at,
      r.termination_reason,
      r.date_start,
      r.date_stop,
      COALESCE(r.timezone, a.timezone) AS timezone,
      COALESCE(r.currency, a.currency) AS currency
    FROM accounts a
    JOIN public.meta_sync_runs r
      ON r.user_id = v_user_id
     AND r.integration_id = a.integration_id
     AND r.ad_account_id = a.ad_account_id
     AND r.requested_period = p_period
     AND r.status = 'success'
    WHERE EXISTS (
      SELECT 1
      FROM public.meta_normalized_metrics m
      WHERE m.user_id = v_user_id
        AND m.sync_run_id = r.id
        AND m.integration_id = a.integration_id
        AND m.ad_account_id = a.ad_account_id
    )
    ORDER BY a.client_meta_asset_id, r.finished_at DESC NULLS LAST, r.started_at DESC, r.created_at DESC
  ),
  account_metric_values AS (
    SELECT
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.integration_id,
      ls.ad_account_id,
      ls.currency,
      ls.timezone,
      ls.date_start,
      ls.date_stop,
      ls.id AS sync_run_id,
      ls.finished_at,
      m.metric_id,
      SUM(m.metric_value)::numeric AS metric_value,
      CASE
        WHEN bool_or(COALESCE(m.completeness_status, 'complete') NOT IN ('complete', 'zero_delivery'))
          THEN max(m.completeness_status) FILTER (
            WHERE m.completeness_status IS NOT NULL
              AND m.completeness_status NOT IN ('complete', 'zero_delivery')
          )
        WHEN bool_and(COALESCE(m.completeness_status, 'complete') = 'zero_delivery')
          THEN 'zero_delivery'
        ELSE 'complete'
      END AS completeness_status
    FROM latest_success ls
    JOIN public.meta_normalized_metrics m
      ON m.sync_run_id = ls.id
     AND m.user_id = v_user_id
     AND m.integration_id = ls.integration_id
     AND m.ad_account_id = ls.ad_account_id
     AND m.source_level = 'account'
    WHERE EXISTS (SELECT 1 FROM supported_metric_ids sm WHERE sm.metric_id = m.metric_id)
    GROUP BY
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.integration_id,
      ls.ad_account_id,
      ls.currency,
      ls.timezone,
      ls.date_start,
      ls.date_stop,
      ls.id,
      ls.finished_at,
      m.metric_id
  ),
  account_metric_json AS (
    SELECT
      a.client_meta_asset_id,
      COALESCE(jsonb_object_agg(
        sm.metric_id,
        public.decorate_analytics_metric(
          sm.metric_id,
          CASE WHEN amv.metric_id IS NULL THEN NULL ELSE jsonb_build_object(
            'value', amv.metric_value,
            'available', true,
            'completenessStatus', amv.completeness_status
          ) END,
          jsonb_build_object(
            'currency', COALESCE(amv.currency, ls.currency, a.currency),
            'dateStart', ls.date_start,
            'dateStop', ls.date_stop,
            'timezone', COALESCE(amv.timezone, ls.timezone, a.timezone),
            'sourceLevel', 'account',
            'attributionSetting', NULL,
            'classifiedObjective', NULL,
            'destinationType', NULL,
            'syncRunId', ls.id,
            'collectedAt', ls.finished_at,
            'clientMetaAssetId', a.client_meta_asset_id,
            'accountId', a.ad_account_id,
            'accountName', a.account_name,
            'campaignId', NULL,
            'adsetId', NULL,
            'adId', NULL
          )
        )
        ORDER BY sm.metric_id
      ), '{}'::jsonb) AS metrics,
      bool_or(amv.completeness_status NOT IN ('complete', 'zero_delivery')) AS has_partial,
      max(amv.completeness_status) FILTER (
        WHERE amv.completeness_status NOT IN ('complete', 'zero_delivery')
      ) AS partial_reason
    FROM accounts a
    LEFT JOIN latest_success ls ON ls.client_meta_asset_id = a.client_meta_asset_id
    CROSS JOIN supported_metric_ids sm
    LEFT JOIN account_metric_values amv
      ON amv.client_meta_asset_id = a.client_meta_asset_id
     AND amv.metric_id = sm.metric_id
    GROUP BY a.client_meta_asset_id
  ),
  client_metric_values AS (
    SELECT
      amv.client_id,
      amv.metric_id,
      CASE
        WHEN amv.metric_id IN ('spend', 'purchase_value')
         AND count(DISTINCT amv.currency) FILTER (WHERE amv.currency IS NOT NULL) > 1
          THEN NULL
        ELSE SUM(amv.metric_value)::numeric
      END AS metric_value,
      CASE
        WHEN amv.metric_id IN ('spend', 'purchase_value')
         AND count(DISTINCT amv.currency) FILTER (WHERE amv.currency IS NOT NULL) > 1
          THEN false
        ELSE true
      END AS available,
      CASE
        WHEN amv.metric_id IN ('spend', 'purchase_value')
         AND count(DISTINCT amv.currency) FILTER (WHERE amv.currency IS NOT NULL) > 1
          THEN 'mixed_currency'
        WHEN bool_or(amv.completeness_status NOT IN ('complete', 'zero_delivery'))
          THEN max(amv.completeness_status) FILTER (
            WHERE amv.completeness_status NOT IN ('complete', 'zero_delivery')
          )
        WHEN bool_and(amv.completeness_status = 'zero_delivery') THEN 'zero_delivery'
        ELSE 'complete'
      END AS completeness_status
    FROM account_metric_values amv
    GROUP BY amv.client_id, amv.metric_id
  ),
  client_context AS (
    SELECT
      ac.client_id,
      count(DISTINCT a.client_meta_asset_id) AS account_count,
      min(a.currency) FILTER (WHERE a.currency IS NOT NULL) AS single_currency,
      min(a.timezone) FILTER (WHERE a.timezone IS NOT NULL) AS single_timezone,
      min(ls.date_start) AS date_start,
      max(ls.date_stop) AS date_stop,
      (min(ls.id::text) FILTER (WHERE ls.id IS NOT NULL))::uuid AS sync_run_id,
      max(ls.finished_at) AS collected_at,
      min(a.client_meta_asset_id::text)::uuid AS single_client_meta_asset_id,
      min(a.ad_account_id) AS single_ad_account_id,
      min(a.account_name) AS single_account_name
    FROM active_clients ac
    LEFT JOIN accounts a ON a.client_id = ac.client_id
    LEFT JOIN latest_success ls ON ls.client_meta_asset_id = a.client_meta_asset_id
    GROUP BY ac.client_id
  ),
  client_metric_json AS (
    SELECT
      cc.client_id,
      jsonb_object_agg(
        sm.metric_id,
        public.decorate_analytics_metric(
          sm.metric_id,
          CASE WHEN cmv.metric_id IS NULL THEN NULL ELSE jsonb_build_object(
            'value', cmv.metric_value,
            'available', cmv.available,
            'completenessStatus', cmv.completeness_status
          ) END,
          jsonb_build_object(
            'currency', CASE WHEN cc.account_count = 1 THEN cc.single_currency ELSE NULL END,
            'dateStart', CASE WHEN cc.account_count = 1 THEN cc.date_start ELSE NULL END,
            'dateStop', CASE WHEN cc.account_count = 1 THEN cc.date_stop ELSE NULL END,
            'timezone', CASE WHEN cc.account_count = 1 THEN cc.single_timezone ELSE NULL END,
            'sourceLevel', 'account',
            'attributionSetting', NULL,
            'classifiedObjective', NULL,
            'destinationType', NULL,
            'syncRunId', CASE WHEN cc.account_count = 1 THEN cc.sync_run_id ELSE NULL END,
            'collectedAt', CASE WHEN cc.account_count = 1 THEN cc.collected_at ELSE NULL END,
            'clientMetaAssetId', CASE WHEN cc.account_count = 1 THEN cc.single_client_meta_asset_id ELSE NULL END,
            'accountId', CASE WHEN cc.account_count = 1 THEN cc.single_ad_account_id ELSE NULL END,
            'accountName', CASE WHEN cc.account_count = 1 THEN cc.single_account_name ELSE NULL END,
            'campaignId', NULL,
            'adsetId', NULL,
            'adId', NULL
          )
        )
        ORDER BY sm.metric_id
      ) AS metrics,
      bool_or(cmv.completeness_status NOT IN ('complete', 'zero_delivery', 'mixed_currency')) AS has_partial,
      max(cmv.completeness_status) FILTER (
        WHERE cmv.completeness_status NOT IN ('complete', 'zero_delivery', 'mixed_currency')
      ) AS partial_reason
    FROM client_context cc
    CROSS JOIN supported_metric_ids sm
    LEFT JOIN client_metric_values cmv
      ON cmv.client_id = cc.client_id
     AND cmv.metric_id = sm.metric_id
    GROUP BY cc.client_id
  ),
  group_metric_values AS (
    SELECT
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.ad_account_id,
      ls.currency,
      ls.timezone,
      ls.date_start,
      ls.date_stop,
      ls.id AS sync_run_id,
      ls.finished_at,
      m.campaign_id,
      COALESCE(cs.campaign_name, m.campaign_id, 'Campanha sem nome') AS campaign_name,
      cs.classified_objective::text AS classified_objective,
      COALESCE(m.calculation_metadata->>'destination_type', ads.destination_type) AS destination_type,
      COALESCE(m.attribution_setting, ads.attribution_setting) AS attribution_setting,
      m.metric_id,
      SUM(m.metric_value)::numeric AS metric_value,
      CASE
        WHEN bool_or(COALESCE(m.completeness_status, 'complete') NOT IN ('complete', 'zero_delivery'))
          THEN max(m.completeness_status) FILTER (
            WHERE m.completeness_status IS NOT NULL
              AND m.completeness_status NOT IN ('complete', 'zero_delivery')
          )
        WHEN bool_and(COALESCE(m.completeness_status, 'complete') = 'zero_delivery')
          THEN 'zero_delivery'
        ELSE 'complete'
      END AS completeness_status
    FROM latest_success ls
    JOIN public.meta_normalized_metrics m
      ON m.sync_run_id = ls.id
     AND m.user_id = v_user_id
     AND m.integration_id = ls.integration_id
     AND m.ad_account_id = ls.ad_account_id
     AND m.source_level = 'campaign'
     AND m.campaign_id IS NOT NULL
    LEFT JOIN public.meta_campaign_snapshots cs
      ON cs.sync_run_id = m.sync_run_id
     AND cs.campaign_id = m.campaign_id
    LEFT JOIN public.meta_adset_snapshots ads
      ON ads.sync_run_id = m.sync_run_id
     AND ads.campaign_id = m.campaign_id
     AND ads.adset_id = m.adset_id
    WHERE EXISTS (SELECT 1 FROM supported_metric_ids sm WHERE sm.metric_id = m.metric_id)
    GROUP BY
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.ad_account_id,
      ls.currency,
      ls.timezone,
      ls.date_start,
      ls.date_stop,
      ls.id,
      ls.finished_at,
      m.campaign_id,
      COALESCE(cs.campaign_name, m.campaign_id, 'Campanha sem nome'),
      cs.classified_objective::text,
      COALESCE(m.calculation_metadata->>'destination_type', ads.destination_type),
      COALESCE(m.attribution_setting, ads.attribution_setting),
      m.metric_id
  ),
  campaign_groups AS (
    SELECT
      gmv.client_id,
      gmv.client_meta_asset_id,
      gmv.meta_asset_id,
      gmv.currency,
      gmv.campaign_id,
      gmv.campaign_name,
      gmv.classified_objective,
      gmv.destination_type,
      gmv.attribution_setting,
      SUM(gmv.metric_value) FILTER (WHERE gmv.metric_id = 'spend') AS spend,
      CASE
        WHEN bool_or(gmv.completeness_status NOT IN ('complete', 'zero_delivery'))
          THEN max(gmv.completeness_status) FILTER (
            WHERE gmv.completeness_status NOT IN ('complete', 'zero_delivery')
          )
        WHEN bool_and(gmv.completeness_status = 'zero_delivery') THEN 'zero_delivery'
        ELSE 'complete'
      END AS completeness_status,
      jsonb_object_agg(
        gmv.metric_id,
        public.decorate_analytics_metric(
          gmv.metric_id,
          jsonb_build_object(
            'value', gmv.metric_value,
            'available', true,
            'completenessStatus', gmv.completeness_status
          ),
          jsonb_build_object(
            'currency', gmv.currency,
            'dateStart', gmv.date_start,
            'dateStop', gmv.date_stop,
            'timezone', gmv.timezone,
            'sourceLevel', 'campaign',
            'attributionSetting', gmv.attribution_setting,
            'classifiedObjective', gmv.classified_objective,
            'destinationType', gmv.destination_type,
            'syncRunId', gmv.sync_run_id,
            'collectedAt', gmv.finished_at,
            'clientMetaAssetId', gmv.client_meta_asset_id,
            'accountId', gmv.ad_account_id,
            'accountName', NULL,
            'campaignId', gmv.campaign_id,
            'adsetId', NULL,
            'adId', NULL
          )
        )
        ORDER BY gmv.metric_id
      ) AS metrics
    FROM group_metric_values gmv
    GROUP BY
      gmv.client_id,
      gmv.client_meta_asset_id,
      gmv.meta_asset_id,
      gmv.currency,
      gmv.campaign_id,
      gmv.campaign_name,
      gmv.classified_objective,
      gmv.destination_type,
      gmv.attribution_setting
  ),
  active_targets AS (
    SELECT
      al.client_id,
      t.id,
      t.client_meta_asset_id,
      t.campaign_id,
      t.metric_id,
      t.target_kind,
      t.target_value,
      t.target_min,
      t.target_max,
      t.warning_tolerance_percent,
      t.critical_tolerance_percent,
      t.priority_weight,
      t.evaluation_period,
      t.effective_from,
      t.effective_to
    FROM active_links al
    JOIN public.client_performance_targets t
      ON t.user_id = v_user_id
     AND t.client_meta_asset_id = al.client_meta_asset_id
     AND t.effective_from <= now()
     AND (t.effective_to IS NULL OR t.effective_to > now())
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'clientId', ac.client_id,
        'clientName', ac.display_name,
        'clientStatus',
          CASE
            WHEN NOT EXISTS (SELECT 1 FROM accounts a WHERE a.client_id = ac.client_id) THEN 'not_connected'
            WHEN EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'running') THEN 'syncing'
            WHEN NOT EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id) AND EXISTS (SELECT 1 FROM any_sync a_s WHERE a_s.client_id = ac.client_id) THEN 'period_not_synced'
            WHEN NOT EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id) THEN 'never_synced'
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id)
             AND EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'success') THEN 'sync_without_metrics'
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id)
             AND EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'failed') THEN 'failed'
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id)
             AND EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'partial') THEN 'partial'
            -- Intentionally no "newer attempt failed/partial" demotion here anymore:
            -- when latest_success exists, a newer incomplete attempt for the same
            -- period does not erase the already-synced, still-usable data. That
            -- nuance is carried by dataQuality.status/reason and
            -- hasNewerPartial/hasNewerFailure below instead of by clientStatus.
            WHEN EXISTS (
              SELECT 1
              FROM client_metric_values cmv
              WHERE cmv.client_id = ac.client_id
                AND cmv.metric_id IN ('spend', 'impressions')
                AND cmv.available
            )
             AND COALESCE((cmj.metrics->'spend'->>'value')::numeric, 0) = 0
             AND COALESCE((cmj.metrics->'impressions'->>'value')::numeric, 0) = 0 THEN 'no_delivery'
            WHEN (
              SELECT max(ls.finished_at)
              FROM latest_success ls
              WHERE ls.client_id = ac.client_id
            ) < now() - interval '36 hours' THEN 'stale'
            ELSE 'available'
          END,
        'accounts', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'clientMetaAssetId', a.client_meta_asset_id,
              'metaAssetId', a.meta_asset_id,
              'integrationId', a.integration_id,
              'adAccountId', a.ad_account_id,
              'accountName', a.account_name,
              'currency', COALESCE(ls.currency, a.currency),
              'timezone', COALESCE(ls.timezone, a.timezone),
              'dateStart', ls.date_start,
              'dateStop', ls.date_stop,
              'metrics', COALESCE(amj.metrics, '{}'::jsonb),
              'budgetPacing', NULL,
              'dataQuality', jsonb_build_object(
                'status', CASE
                  WHEN ls.id IS NULL THEN 'unavailable'
                  WHEN COALESCE(amj.has_partial, false) THEN 'partial'
                  WHEN la.status IN ('partial', 'failed') AND la.started_at > ls.started_at THEN 'partial'
                  ELSE 'complete'
                END,
                'reason', CASE
                  WHEN ls.id IS NULL THEN 'no_successful_run'
                  WHEN COALESCE(amj.has_partial, false) THEN amj.partial_reason
                  WHEN la.status IN ('partial', 'failed') AND la.started_at > ls.started_at THEN COALESCE(la.termination_reason, la.error_message, 'newer_incomplete_attempt')
                  ELSE NULL
                END
              ),
              'lastSuccessfulRun', CASE WHEN ls.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', ls.id,
                'status', ls.status,
                'startedAt', ls.started_at,
                'finishedAt', ls.finished_at,
                'terminationReason', ls.termination_reason,
                'requestedPeriod', ls.requested_period,
                'runScope', ls.run_scope,
                'dateStart', ls.date_start,
                'dateStop', ls.date_stop,
                'metricsCount', (
                  SELECT count(DISTINCT m.metric_id)::int
                  FROM public.meta_normalized_metrics m
                  WHERE m.user_id = v_user_id
                    AND m.sync_run_id = ls.id
                    AND m.integration_id = ls.integration_id
                    AND m.ad_account_id = ls.ad_account_id
                ),
                'metricGroupsCount', (
                  SELECT count(*)::int
                  FROM campaign_groups cg
                  WHERE cg.client_meta_asset_id = ls.client_meta_asset_id
                )
              ) END,
              'lastAttempt', CASE WHEN la.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', la.id,
                'status', la.status,
                'startedAt', la.started_at,
                'finishedAt', la.finished_at,
                'terminationReason', la.termination_reason,
                'requestedPeriod', la.requested_period,
                'runScope', la.run_scope,
                'dateStart', la.date_start,
                'dateStop', la.date_stop,
                'metricsCount', (
                  SELECT count(DISTINCT m.metric_id)::int
                  FROM public.meta_normalized_metrics m
                  WHERE m.user_id = v_user_id
                    AND m.sync_run_id = la.id
                ),
                'metricGroupsCount', (
                  SELECT count(*)::int
                  FROM campaign_groups cg
                  WHERE cg.client_meta_asset_id = la.client_meta_asset_id
                )
              ) END
            )
            ORDER BY a.account_name, a.meta_asset_id
          )
          FROM accounts a
          LEFT JOIN latest_success ls ON ls.client_meta_asset_id = a.client_meta_asset_id
          LEFT JOIN latest_attempt la ON la.client_meta_asset_id = a.client_meta_asset_id
          LEFT JOIN account_metric_json amj ON amj.client_meta_asset_id = a.client_meta_asset_id
          WHERE a.client_id = ac.client_id
        ), '[]'::jsonb),
        'metrics', COALESCE(cmj.metrics, '{}'::jsonb),
        'metricGroups', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'clientMetaAssetId', cg.client_meta_asset_id,
              'metaAssetId', cg.meta_asset_id,
              'currency', cg.currency,
              'campaignId', cg.campaign_id,
              'campaignName', cg.campaign_name,
              'classifiedObjective', cg.classified_objective,
              'destinationType', cg.destination_type,
              'attributionSetting', cg.attribution_setting,
              'spend', cg.spend,
              'completenessStatus', cg.completeness_status,
              'metrics', cg.metrics
            )
            ORDER BY cg.campaign_name, cg.campaign_id, cg.classified_objective, cg.destination_type, cg.attribution_setting
          )
          FROM campaign_groups cg
          WHERE cg.client_id = ac.client_id
        ), '[]'::jsonb),
        'resolvedTargets', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', at.id,
              'clientMetaAssetId', at.client_meta_asset_id,
              'campaignId', at.campaign_id,
              'metricId', at.metric_id,
              'targetKind', at.target_kind,
              'targetValue', at.target_value,
              'targetMin', at.target_min,
              'targetMax', at.target_max,
              'warningTolerancePercent', at.warning_tolerance_percent,
              'criticalTolerancePercent', at.critical_tolerance_percent,
              'priorityWeight', at.priority_weight,
              'evaluationPeriod', at.evaluation_period,
              'effectiveFrom', at.effective_from,
              'effectiveTo', at.effective_to
            )
            ORDER BY at.client_meta_asset_id, at.metric_id, at.target_kind, at.campaign_id NULLS FIRST
          )
          FROM active_targets at
          WHERE at.client_id = ac.client_id
        ), '[]'::jsonb),
        'evaluations', '[]'::jsonb,
        'budgetPacing', NULL,
        'dataQuality', jsonb_build_object(
          'status', CASE
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'unavailable'
            WHEN COALESCE(cmj.has_partial, false) THEN 'partial'
            WHEN EXISTS (
              SELECT 1
              FROM latest_attempt la
              JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
              WHERE la.client_id = ac.client_id
                AND la.status IN ('partial', 'failed')
                AND la.started_at > ls.started_at
            ) THEN 'partial'
            ELSE 'complete'
          END,
          'reason', CASE
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'no_successful_run'
            WHEN COALESCE(cmj.has_partial, false) THEN cmj.partial_reason
            WHEN EXISTS (
              SELECT 1
              FROM latest_attempt la
              JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
              WHERE la.client_id = ac.client_id
                AND la.status IN ('partial', 'failed')
                AND la.started_at > ls.started_at
            ) THEN 'newer_incomplete_attempt'
            ELSE NULL
          END
        ),
        'lastSuccessfulRun', (
          SELECT jsonb_build_object(
            'id', ls.id,
            'status', ls.status,
            'startedAt', ls.started_at,
            'finishedAt', ls.finished_at,
            'terminationReason', ls.termination_reason,
            'requestedPeriod', ls.requested_period,
            'runScope', ls.run_scope,
            'dateStart', ls.date_start,
            'dateStop', ls.date_stop,
            'metricsCount', (
              SELECT count(DISTINCT m.metric_id)::int
              FROM public.meta_normalized_metrics m
              WHERE m.user_id = v_user_id
                AND m.sync_run_id = ls.id
            ),
            'metricGroupsCount', (
              SELECT count(*)::int
              FROM campaign_groups cg
              WHERE cg.client_id = ls.client_id
            )
          )
          FROM latest_success ls
          WHERE ls.client_id = ac.client_id
          ORDER BY ls.finished_at DESC NULLS LAST, ls.started_at DESC
          LIMIT 1
        ),
        'lastAttempt', (
          SELECT jsonb_build_object(
            'id', la.id,
            'status', la.status,
            'startedAt', la.started_at,
            'finishedAt', la.finished_at,
            'terminationReason', la.termination_reason,
            'requestedPeriod', la.requested_period,
            'runScope', la.run_scope,
            'dateStart', la.date_start,
            'dateStop', la.date_stop,
            'metricsCount', (
              SELECT count(DISTINCT m.metric_id)::int
              FROM public.meta_normalized_metrics m
              WHERE m.user_id = v_user_id
                AND m.sync_run_id = la.id
            ),
            'metricGroupsCount', (
              SELECT count(*)::int
              FROM campaign_groups cg
              WHERE cg.client_id = la.client_id
            )
          )
          FROM latest_attempt la
          WHERE la.client_id = ac.client_id
          ORDER BY la.started_at DESC
          LIMIT 1
        ),
        'hasNewerPartial', EXISTS (
          SELECT 1
          FROM latest_attempt la
          JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
          WHERE la.client_id = ac.client_id
            AND la.status = 'partial'
            AND la.started_at > ls.started_at
        ),
        'hasNewerFailure', EXISTS (
          SELECT 1
          FROM latest_attempt la
          JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
          WHERE la.client_id = ac.client_id
            AND la.status = 'failed'
            AND la.started_at > ls.started_at
        ),
        'analyticsContractVersion', 5
      )
      ORDER BY ac.display_name, ac.client_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM active_clients ac
  LEFT JOIN client_metric_json cmj ON cmj.client_id = ac.client_id;

  RETURN v_result;
END;
$$;

COMMIT;
