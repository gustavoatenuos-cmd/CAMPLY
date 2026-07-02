-- Migration 000021: exact current-month dashboard contract.
-- Extends the already deployed dashboard functions without replacing their
-- ownership/RLS model, and makes account-level Meta insights the sole source
-- for consolidated account totals.

BEGIN;

ALTER TABLE public.meta_normalized_metrics
  DROP CONSTRAINT IF EXISTS meta_normalized_metrics_source_level_check;

ALTER TABLE public.meta_normalized_metrics
  ADD CONSTRAINT meta_normalized_metrics_source_level_check
  CHECK (source_level IS NULL OR source_level IN ('account', 'campaign', 'adset', 'ad'));

ALTER TABLE public.meta_sync_runs
  DROP CONSTRAINT IF EXISTS meta_sync_runs_this_month_exact_range_check;

ALTER TABLE public.meta_sync_runs
  ADD CONSTRAINT meta_sync_runs_this_month_exact_range_check
  CHECK (
    requested_period <> 'this_month'
    OR date_start IS NULL
    OR (
      date_start = date_trunc('month', date_start)::date
      AND date_stop >= date_start
      AND date_stop < (date_start + interval '1 month')::date
    )
  );

DO $monthly_dashboard$
DECLARE
  v_definition TEXT;
BEGIN
  v_definition := pg_get_functiondef(
    'public.get_global_performance_dashboard(text,text[],uuid[])'::regprocedure
  );

  IF strpos(v_definition, 'IF p_period NOT IN (''today'', ''last_7d'', ''last_30d'') THEN') = 0 THEN
    RAISE EXCEPTION 'Unexpected get_global_performance_dashboard period contract';
  END IF;
  v_definition := replace(
    v_definition,
    'IF p_period NOT IN (''today'', ''last_7d'', ''last_30d'') THEN',
    'IF p_period NOT IN (''this_month'', ''today'', ''last_7d'', ''last_30d'') THEN'
  );
  v_definition := replace(v_definition, 'p_period text DEFAULT ''last_7d''::text', 'p_period text DEFAULT ''this_month''::text');

  IF strpos(v_definition, '(m.source_level = ''campaign'' OR (m.source_level IS NULL AND m.adset_id IS NULL AND m.ad_id IS NULL))') = 0 THEN
    RAISE EXCEPTION 'Unexpected account metric source contract';
  END IF;
  v_definition := regexp_replace(
    v_definition,
    '\(m\.source_level = ''campaign'' OR \(m\.source_level IS NULL AND m\.adset_id IS NULL AND m\.ad_id IS NULL\)\)',
    'm.source_level = ''account'''
  );

  v_definition := replace(
    v_definition,
    E'''spend'',\n      ''impressions'',\n      ''link_clicks'',' ,
    E'''spend'',\n      ''impressions'',\n      ''reach'',\n      ''frequency'',\n      ''cpm'',\n      ''link_clicks'',\n      ''landing_page_views'','
  );
  EXECUTE v_definition;

  v_definition := pg_get_functiondef(
    'public.get_global_performance_dashboard_v2(text,text[],uuid[])'::regprocedure
  );
  IF strpos(v_definition, 'IF p_period NOT IN (''today'', ''last_7d'', ''last_30d'') THEN') = 0 THEN
    RAISE EXCEPTION 'Unexpected get_global_performance_dashboard_v2 period contract';
  END IF;
  v_definition := replace(
    v_definition,
    'IF p_period NOT IN (''today'', ''last_7d'', ''last_30d'') THEN',
    'IF p_period NOT IN (''this_month'', ''today'', ''last_7d'', ''last_30d'') THEN'
  );
  v_definition := replace(v_definition, 'p_period text DEFAULT ''last_7d''::text', 'p_period text DEFAULT ''this_month''::text');
  v_definition := regexp_replace(
    v_definition,
    '''sourceLevel'', ''aggregated''',
    '''sourceLevel'', ''account'''
  );
  v_definition := replace(
    v_definition,
    E'''spend'',\n    ''impressions'',\n    ''cpm'',' ,
    E'''spend'',\n    ''impressions'',\n    ''reach'',\n    ''frequency'',\n    ''cpm'','
  );
  EXECUTE v_definition;
END;
$monthly_dashboard$;

CREATE OR REPLACE FUNCTION public.get_analytics_capabilities()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'contractVersion', 3,
    'dashboardAvailable', true,
    'dashboardRpc', 'get_global_performance_dashboard_v2',
    'supportedPeriods', jsonb_build_array('this_month', 'today', 'last_7d', 'last_30d'),
    'supportedLevels', jsonb_build_array('campaign', 'adset', 'ad'),
    'targetsAvailable', true,
    'reconciliationAvailable', true,
    'traceableMetrics', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_analytics_capabilities() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_analytics_capabilities() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_capabilities() TO authenticated;

COMMIT;
