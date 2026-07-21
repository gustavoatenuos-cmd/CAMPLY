-- Migration: Single Sync 90-day Coverage
-- This migration restructures the dashboard RPC to:
-- 1. Always read from the latest successful last_90d sync run
-- 2. Filter metrics by date range (date_start/date_stop) within the 90-day base
-- 3. Support new periods: yesterday, today_and_yesterday
-- 4. Remove dependency on requested_period = p_period exact match
-- 5. Update analytics capabilities for new period set

-- Step 1: Update get_analytics_capabilities to support new periods
CREATE OR REPLACE FUNCTION public.get_analytics_capabilities()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'contractVersion', 5,
    'dashboardAvailable', true,
    'dashboardRpc', 'get_global_performance_dashboard_v2',
    'supportedPeriods', jsonb_build_array('today', 'yesterday', 'today_and_yesterday', 'last_7d', 'last_30d', 'last_90d'),
    'supportedLevels', jsonb_build_array('campaign', 'adset', 'ad'),
    'targetsAvailable', true,
    'reconciliationAvailable', true,
    'traceableMetrics', true
  );
$$;

-- Step 2: Rewrite get_global_performance_dashboard_v2 to use last_90d base with date range filtering
CREATE OR REPLACE FUNCTION public.get_global_performance_dashboard_v2(
  p_period TEXT DEFAULT 'last_90d',
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
  v_date_start DATE;
  v_date_stop DATE;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_period NOT IN ('today', 'yesterday', 'today_and_yesterday', 'last_7d', 'last_30d', 'last_90d') THEN
    RAISE EXCEPTION 'Invalid dashboard period: %', p_period USING ERRCODE = '22023';
  END IF;

  -- Calculate date range for filtering daily rows
  v_date_stop := CURRENT_DATE;
  v_date_start := CASE p_period
    WHEN 'today' THEN CURRENT_DATE
    WHEN 'yesterday' THEN CURRENT_DATE - 1
    WHEN 'today_and_yesterday' THEN CURRENT_DATE - 1
    WHEN 'last_7d' THEN CURRENT_DATE - 6
    WHEN 'last_30d' THEN CURRENT_DATE - 29
    WHEN 'last_90d' THEN CURRENT_DATE - 89
  END;

  -- For 'yesterday', date_stop is also yesterday
  IF p_period = 'yesterday' THEN
    v_date_stop := CURRENT_DATE - 1;
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
  -- Changed: always look for last_90d runs regardless of selected period
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
  -- Changed: latest_attempt always looks for last_90d base
  latest_attempt AS (
    SELECT DISTINCT ON (a.client_meta_asset_id)
      a.client_meta_asset_id,
      a.client_id,
      r.id,
      r.status,
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
     AND r.requested_period = 'last_90d'
    ORDER BY a.client_meta_asset_id, r.started_at DESC, r.created_at DESC
  ),
  -- Changed: latest_success always looks for last_90d base
  latest_success AS (
    SELECT DISTINCT ON (a.client_meta_asset_id)
      a.client_meta_asset_id,
      a.client_id,
      a.meta_asset_id,
      a.integration_id,
      a.ad_account_id,
      r.id,
      r.status,
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
     AND r.requested_period = 'last_90d'
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
  -- Changed: filter metrics by date range within the 90-day base
  account_metric_values AS (
    SELECT
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.integration_id,
      ls.ad_account_id,
      ls.currency,
      ls.timezone,
      v_date_start::text AS date_start,
      v_date_stop::text AS date_stop,
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
     AND m.date_start IS NOT NULL
     AND m.date_start::date >= v_date_start
     AND m.date_stop IS NOT NULL
     AND m.date_stop::date <= v_date_stop
    WHERE EXISTS (SELECT 1 FROM supported_metric_ids sm WHERE sm.metric_id = m.metric_id)
    GROUP BY
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.integration_id,
      ls.ad_account_id,
      ls.currency,
      ls.timezone,
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
            'dateStart', v_date_start::text,
            'dateStop', v_date_stop::text,
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
      v_date_start::text AS date_start,
      v_date_stop::text AS date_stop,
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
            'dateStart', cc.date_start,
            'dateStop', cc.date_stop,
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
  -- Changed: campaign group metrics also filter by date range
  group_metric_values AS (
    SELECT
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.ad_account_id,
      ls.currency,
      ls.timezone,
      v_date_start::text AS date_start,
      v_date_stop::text AS date_stop,
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
     AND m.date_start IS NOT NULL
     AND m.date_start::date >= v_date_start
     AND m.date_stop IS NOT NULL
     AND m.date_stop::date <= v_date_stop
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
      g.client_meta_asset_id,
      jsonb_agg(
        jsonb_build_object(
          'clientMetaAssetId', g.client_meta_asset_id,
          'metaAssetId', g.meta_asset_id,
          'currency', g.currency,
          'campaignId', g.campaign_id,
          'campaignName', g.campaign_name,
          'classifiedObjective', g.classified_objective,
          'destinationType', g.destination_type,
          'attributionSetting', g.attribution_setting,
          'spend', (SELECT SUM(g2.metric_value)::numeric FROM group_metric_values g2 WHERE g2.client_meta_asset_id = g.client_meta_asset_id AND g2.campaign_id = g.campaign_id AND g2.metric_id = 'spend'),
          'completenessStatus', max(g.completeness_status),
          'metrics', jsonb_object_agg(
            g.metric_id,
            public.decorate_analytics_metric(
              g.metric_id,
              jsonb_build_object(
                'value', g.metric_value,
                'available', true,
                'completenessStatus', g.completeness_status
              ),
              jsonb_build_object(
                'currency', g.currency,
                'dateStart', g.date_start,
                'dateStop', g.date_stop,
                'timezone', g.timezone,
                'sourceLevel', 'campaign',
                'attributionSetting', g.attribution_setting,
                'classifiedObjective', g.classified_objective,
                'destinationType', g.destination_type,
                'syncRunId', g.sync_run_id,
                'collectedAt', g.finished_at,
                'clientMetaAssetId', g.client_meta_asset_id,
                'accountId', g.ad_account_id,
                'accountName', NULL,
                'campaignId', g.campaign_id,
                'adsetId', NULL,
                'adId', NULL
              )
            )
          )
        )
      ) AS groups
    FROM group_metric_values g
    GROUP BY g.client_meta_asset_id, g.meta_asset_id, g.currency, g.campaign_id, g.campaign_name,
             g.classified_objective, g.destination_type, g.attribution_setting, g.ad_account_id
  ),
  all_campaign_groups AS (
    SELECT
      a.client_meta_asset_id,
      COALESCE(jsonb_agg(elem ORDER BY elem->>'campaignName') FILTER (WHERE elem IS NOT NULL), '[]'::jsonb) AS metric_groups
    FROM accounts a
    LEFT JOIN campaign_groups cg ON cg.client_meta_asset_id = a.client_meta_asset_id
    LEFT JOIN LATERAL jsonb_array_elements(cg.groups) AS elem ON true
    GROUP BY a.client_meta_asset_id
  ),
  resolved_targets AS (
    SELECT
      t.client_meta_asset_id,
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'clientMetaAssetId', t.client_meta_asset_id,
          'campaignId', t.campaign_id,
          'metricId', t.metric_id,
          'targetKind', t.target_kind,
          'targetValue', t.target_value,
          'targetMin', t.target_min,
          'targetMax', t.target_max,
          'warningTolerancePercent', t.warning_tolerance_percent,
          'criticalTolerancePercent', t.critical_tolerance_percent,
          'priorityWeight', t.priority_weight,
          'effectiveFrom', t.effective_from,
          'evaluationPeriod', COALESCE(t.evaluation_period, 'inherit')
        )
      ) AS targets
    FROM public.meta_performance_targets t
    WHERE t.user_id = v_user_id
      AND t.active = true
      AND EXISTS (SELECT 1 FROM accounts a WHERE a.client_meta_asset_id = t.client_meta_asset_id)
    GROUP BY t.client_meta_asset_id
  ),
  all_targets AS (
    SELECT
      a.client_meta_asset_id,
      COALESCE(rt.targets, '[]'::jsonb) AS targets
    FROM accounts a
    LEFT JOIN resolved_targets rt ON rt.client_meta_asset_id = a.client_meta_asset_id
  ),
  newer_attempts AS (
    SELECT
      a.client_meta_asset_id,
      bool_or(r.status = 'partial') AS has_newer_partial,
      bool_or(r.status = 'failed') AS has_newer_failure
    FROM accounts a
    JOIN latest_success ls ON ls.client_meta_asset_id = a.client_meta_asset_id
    JOIN public.meta_sync_runs r
      ON r.user_id = v_user_id
     AND r.integration_id = a.integration_id
     AND r.ad_account_id = a.ad_account_id
     AND r.requested_period = 'last_90d'
     AND r.status IN ('partial', 'failed')
     AND r.started_at > ls.started_at
    GROUP BY a.client_meta_asset_id
  ),
  client_rows AS (
    SELECT
      ac.client_id,
      ac.display_name AS client_name,
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM accounts a WHERE a.client_id = ac.client_id) THEN 'not_connected'
        WHEN NOT EXISTS (SELECT 1 FROM any_sync s WHERE s.client_id = ac.client_id) THEN 'never_synced'
        WHEN EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'running') THEN 'syncing'
        WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'period_not_synced'
        WHEN EXISTS (
          SELECT 1 FROM account_metric_values amv WHERE amv.client_id = ac.client_id
        ) THEN 'available'
        ELSE 'sync_without_metrics'
      END AS client_status,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'clientMetaAssetId', a.client_meta_asset_id,
            'metaAssetId', a.meta_asset_id,
            'integrationId', a.integration_id,
            'adAccountId', a.ad_account_id,
            'accountName', a.account_name,
            'currency', COALESCE(ls.currency, a.currency),
            'timezone', COALESCE(ls.timezone, a.timezone),
            'dateStart', v_date_start::text,
            'dateStop', v_date_stop::text,
            'metrics', COALESCE(amj.metrics, '{}'::jsonb),
            'budgetPacing', NULL,
            'dataQuality', jsonb_build_object(
              'status', CASE
                WHEN ls.id IS NULL THEN 'unavailable'
                WHEN amj.has_partial THEN 'partial'
                ELSE 'complete'
              END,
              'reason', CASE
                WHEN ls.id IS NULL THEN 'no_successful_sync'
                WHEN amj.has_partial THEN amj.partial_reason
                ELSE NULL
              END
            ),
            'lastSuccessfulRun', CASE WHEN ls.id IS NOT NULL THEN jsonb_build_object(
              'id', ls.id,
              'status', ls.status,
              'startedAt', ls.started_at,
              'finishedAt', ls.finished_at,
              'terminationReason', ls.termination_reason
            ) ELSE NULL END,
            'lastAttempt', CASE WHEN la.id IS NOT NULL THEN jsonb_build_object(
              'id', la.id,
              'status', la.status,
              'startedAt', la.started_at,
              'finishedAt', la.finished_at,
              'terminationReason', la.termination_reason
            ) ELSE NULL END
          )
        )
        FROM accounts a
        LEFT JOIN latest_success ls ON ls.client_meta_asset_id = a.client_meta_asset_id
        LEFT JOIN latest_attempt la ON la.client_meta_asset_id = a.client_meta_asset_id
        LEFT JOIN account_metric_json amj ON amj.client_meta_asset_id = a.client_meta_asset_id
        WHERE a.client_id = ac.client_id
      ), '[]'::jsonb) AS accounts,
      COALESCE(cmj.metrics, '{}'::jsonb) AS metrics,
      COALESCE(acg.metric_groups, '[]'::jsonb) AS "metricGroups",
      COALESCE(at.targets, '[]'::jsonb) AS "resolvedTargets",
      '[]'::jsonb AS evaluations,
      NULL::jsonb AS "budgetPacing",
      jsonb_build_object(
        'value', NULL,
        'status', 'unavailable',
        'confidence', 0,
        'coveragePercent', 0,
        'summary', 'Pontuação ainda não calculada.',
        'signals', '[]'::jsonb
      ) AS score,
      jsonb_build_object(
        'status', CASE
          WHEN NOT EXISTS (SELECT 1 FROM accounts a WHERE a.client_id = ac.client_id) THEN 'unavailable'
          WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'unavailable'
          WHEN cmj.has_partial THEN 'partial'
          ELSE 'complete'
        END,
        'reason', CASE
          WHEN NOT EXISTS (SELECT 1 FROM accounts a WHERE a.client_id = ac.client_id) THEN 'account_not_connected'
          WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'no_successful_sync'
          WHEN cmj.has_partial THEN cmj.partial_reason
          ELSE NULL
        END
      ) AS "dataQuality",
      (SELECT jsonb_build_object('id', ls.id, 'status', ls.status, 'startedAt', ls.started_at, 'finishedAt', ls.finished_at, 'terminationReason', ls.termination_reason)
       FROM latest_success ls WHERE ls.client_id = ac.client_id LIMIT 1) AS "lastSuccessfulRun",
      (SELECT jsonb_build_object('id', la.id, 'status', la.status, 'startedAt', la.started_at, 'finishedAt', la.finished_at, 'terminationReason', la.termination_reason)
       FROM latest_attempt la WHERE la.client_id = ac.client_id LIMIT 1) AS "lastAttempt",
      COALESCE((SELECT na.has_newer_partial FROM newer_attempts na JOIN accounts a ON a.client_meta_asset_id = na.client_meta_asset_id WHERE a.client_id = ac.client_id LIMIT 1), false) AS "hasNewerPartial",
      COALESCE((SELECT na.has_newer_failure FROM newer_attempts na JOIN accounts a ON a.client_meta_asset_id = na.client_meta_asset_id WHERE a.client_id = ac.client_id LIMIT 1), false) AS "hasNewerFailure"
    FROM active_clients ac
    LEFT JOIN client_metric_json cmj ON cmj.client_id = ac.client_id
    LEFT JOIN all_campaign_groups acg ON acg.client_meta_asset_id = (
      SELECT a.client_meta_asset_id FROM accounts a WHERE a.client_id = ac.client_id LIMIT 1
    )
    LEFT JOIN all_targets at ON at.client_meta_asset_id = (
      SELECT a.client_meta_asset_id FROM accounts a WHERE a.client_id = ac.client_id LIMIT 1
    )
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'clientId', cr.client_id,
      'clientName', cr.client_name,
      'clientStatus', cr.client_status,
      'accounts', cr.accounts,
      'metrics', cr.metrics,
      'metricGroups', cr."metricGroups",
      'resolvedTargets', cr."resolvedTargets",
      'evaluations', cr.evaluations,
      'budgetPacing', cr."budgetPacing",
      'score', cr.score,
      'dataQuality', cr."dataQuality",
      'lastSuccessfulRun', cr."lastSuccessfulRun",
      'lastAttempt', cr."lastAttempt",
      'hasNewerPartial', cr."hasNewerPartial",
      'hasNewerFailure', cr."hasNewerFailure"
    )
    ORDER BY cr.client_name
  ) INTO v_result
  FROM client_rows cr;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Security grants
REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) TO authenticated;