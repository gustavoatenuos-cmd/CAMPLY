BEGIN;

CREATE OR REPLACE FUNCTION public.get_global_performance_dashboard_v2(
  p_period TEXT DEFAULT 'this_month',
  p_client_ids TEXT[] DEFAULT NULL,
  p_asset_ids UUID[] DEFAULT NULL
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

  WITH active_clients AS (
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
      p.client_id AS profile_id,
      p.budget_period,
      p.planned_budget,
      COALESCE(p.primary_conversion_metric, 'purchases') AS primary_metric
    FROM accounts a
    LEFT JOIN public.client_analysis_profiles p
      ON p.client_id = a.client_id
     AND p.user_id = v_user_id
  ),
  profile_targets AS (
    SELECT
      a.client_meta_asset_id,
      t.metric_id,
      t.target_kind,
      t.target_value,
      NULL::numeric AS target_min,
      NULL::numeric AS target_max,
      15::numeric AS warning_tolerance,
      30::numeric AS critical_tolerance,
      1::numeric AS priority_weight,
      NULL::text AS evaluation_period,
      t.effective_from,
      t.effective_to
    FROM accounts a
    JOIN public.client_performance_targets t
      ON t.client_meta_asset_id = a.client_meta_asset_id
     AND t.user_id = v_user_id
    WHERE (t.effective_to IS NULL OR t.effective_to >= CURRENT_DATE)
      AND t.campaign_id IS NULL
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
          WHEN a.client_id IS NULL THEN 'not_connected'
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
            'budgetPacingStrategy', NULL,
            'primaryConversionMetric', cp.primary_metric,
            'effectiveFrom', NULL,
            'effectiveTo', NULL
          )
        ELSE NULL
      END,
      'budgetPacing', NULL,
      'metrics', CASE WHEN a.client_meta_asset_id IS NOT NULL THEN public.get_traceable_entity_metrics(
        ls.id, a.client_meta_asset_id, a.ad_account_id, a.account_name,
        COALESCE(r.currency, a.currency), COALESCE(r.timezone, a.timezone),
        'account', NULL, NULL, NULL, NULL, NULL, NULL, NULL
      ) ELSE '{}'::jsonb END,
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
  LEFT JOIN accounts a ON a.client_id = ac.client_id
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

COMMIT;
