-- Daily freshness read model for incremental Meta refreshes.
--
-- public.meta_normalized_metrics + snapshots remain the source of truth.
-- private.meta_daily_metric_facts is a reconstructable read model that keeps
-- the newest complete value for each entity/metric/day across sync runs.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.meta_daily_metric_facts (
  user_id UUID NOT NULL,
  integration_id UUID NOT NULL,
  ad_account_id TEXT NOT NULL,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  creative_id TEXT,
  metric_id TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  action_type TEXT,
  source_field TEXT,
  fact_date DATE NOT NULL,
  timezone TEXT,
  attribution_setting TEXT,
  source_level TEXT NOT NULL,
  completeness_status TEXT,
  calculation_metadata JSONB,
  source_run_id UUID NOT NULL,
  source_finished_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_daily_metric_facts_identity_key
  ON private.meta_daily_metric_facts (
    user_id,
    integration_id,
    ad_account_id,
    campaign_id,
    adset_id,
    ad_id,
    creative_id,
    metric_id,
    fact_date,
    attribution_setting,
    source_level
  ) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS meta_daily_metric_facts_lookup_idx
  ON private.meta_daily_metric_facts (
    user_id,
    integration_id,
    ad_account_id,
    source_level,
    fact_date,
    campaign_id,
    adset_id,
    ad_id,
    creative_id,
    metric_id
  );

REVOKE ALL ON private.meta_daily_metric_facts FROM PUBLIC;
REVOKE ALL ON private.meta_daily_metric_facts FROM anon;
REVOKE ALL ON private.meta_daily_metric_facts FROM authenticated;

CREATE OR REPLACE FUNCTION private.refresh_meta_daily_metric_facts_for_run(p_run_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_finished_at TIMESTAMPTZ;
BEGIN
  SELECT r.status::text, COALESCE(r.finished_at, r.started_at, r.created_at)
  INTO v_status, v_finished_at
  FROM public.meta_sync_runs r
  WHERE r.id = p_run_id;

  IF NOT FOUND OR v_status NOT IN ('success', 'partial') OR v_finished_at IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO private.meta_daily_metric_facts (
    user_id, integration_id, ad_account_id,
    campaign_id, adset_id, ad_id, creative_id,
    metric_id, metric_value, action_type, source_field,
    fact_date, timezone, attribution_setting, source_level,
    completeness_status, calculation_metadata,
    source_run_id, source_finished_at, updated_at
  )
  SELECT
    m.user_id, m.integration_id, m.ad_account_id,
    m.campaign_id, m.adset_id, m.ad_id, m.creative_id,
    m.metric_id, m.metric_value, m.action_type, m.source_field,
    m.date_start, m.timezone, m.attribution_setting, m.source_level,
    COALESCE(m.completeness_status, 'complete'), m.calculation_metadata,
    m.sync_run_id, v_finished_at, now()
  FROM public.meta_normalized_metrics m
  WHERE m.sync_run_id = p_run_id
    AND m.date_start IS NOT NULL
    AND m.date_stop IS NOT NULL
    AND m.date_start = m.date_stop
    AND m.source_level IN ('account', 'campaign', 'adset', 'ad')
    AND COALESCE(m.completeness_status, 'complete') IN ('complete', 'zero_delivery')
  ON CONFLICT (
    user_id, integration_id, ad_account_id,
    campaign_id, adset_id, ad_id, creative_id,
    metric_id, fact_date, attribution_setting, source_level
  ) DO UPDATE SET
    metric_value = EXCLUDED.metric_value,
    action_type = EXCLUDED.action_type,
    source_field = EXCLUDED.source_field,
    timezone = EXCLUDED.timezone,
    completeness_status = EXCLUDED.completeness_status,
    calculation_metadata = EXCLUDED.calculation_metadata,
    source_run_id = EXCLUDED.source_run_id,
    source_finished_at = EXCLUDED.source_finished_at,
    updated_at = now()
  WHERE EXCLUDED.source_finished_at >= private.meta_daily_metric_facts.source_finished_at;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_meta_daily_metric_facts_for_run(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.refresh_meta_daily_metric_facts_for_run(UUID) FROM anon;
REVOKE ALL ON FUNCTION private.refresh_meta_daily_metric_facts_for_run(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION private.capture_daily_metric_facts_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO private.meta_daily_metric_facts (
    user_id, integration_id, ad_account_id,
    campaign_id, adset_id, ad_id, creative_id,
    metric_id, metric_value, action_type, source_field,
    fact_date, timezone, attribution_setting, source_level,
    completeness_status, calculation_metadata,
    source_run_id, source_finished_at, updated_at
  )
  SELECT
    m.user_id, m.integration_id, m.ad_account_id,
    m.campaign_id, m.adset_id, m.ad_id, m.creative_id,
    m.metric_id, m.metric_value, m.action_type, m.source_field,
    m.date_start, m.timezone, m.attribution_setting, m.source_level,
    COALESCE(m.completeness_status, 'complete'), m.calculation_metadata,
    m.sync_run_id, COALESCE(r.finished_at, r.started_at, r.created_at), now()
  FROM new_metrics m
  JOIN public.meta_sync_runs r ON r.id = m.sync_run_id
  WHERE r.status IN ('success', 'partial')
    AND m.date_start IS NOT NULL
    AND m.date_stop IS NOT NULL
    AND m.date_start = m.date_stop
    AND m.source_level IN ('account', 'campaign', 'adset', 'ad')
    AND COALESCE(m.completeness_status, 'complete') IN ('complete', 'zero_delivery')
  ON CONFLICT (
    user_id, integration_id, ad_account_id,
    campaign_id, adset_id, ad_id, creative_id,
    metric_id, fact_date, attribution_setting, source_level
  ) DO UPDATE SET
    metric_value = EXCLUDED.metric_value,
    action_type = EXCLUDED.action_type,
    source_field = EXCLUDED.source_field,
    timezone = EXCLUDED.timezone,
    completeness_status = EXCLUDED.completeness_status,
    calculation_metadata = EXCLUDED.calculation_metadata,
    source_run_id = EXCLUDED.source_run_id,
    source_finished_at = EXCLUDED.source_finished_at,
    updated_at = now()
  WHERE EXCLUDED.source_finished_at >= private.meta_daily_metric_facts.source_finished_at;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.refresh_daily_metric_facts_after_run_finish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('success', 'partial')
     AND NEW.finished_at IS NOT NULL
     AND (
       OLD.status IS DISTINCT FROM NEW.status
       OR OLD.finished_at IS DISTINCT FROM NEW.finished_at
     )
  THEN
    PERFORM private.refresh_meta_daily_metric_facts_for_run(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_daily_metric_facts_after_insert
  ON public.meta_normalized_metrics;

CREATE TRIGGER trg_capture_daily_metric_facts_after_insert
AFTER INSERT ON public.meta_normalized_metrics
REFERENCING NEW TABLE AS new_metrics
FOR EACH STATEMENT
EXECUTE FUNCTION private.capture_daily_metric_facts_after_insert();

DROP TRIGGER IF EXISTS trg_refresh_daily_metric_facts_after_run_finish
  ON public.meta_sync_runs;

CREATE TRIGGER trg_refresh_daily_metric_facts_after_run_finish
AFTER UPDATE OF status, finished_at ON public.meta_sync_runs
FOR EACH ROW
EXECUTE FUNCTION private.refresh_daily_metric_facts_after_run_finish();

-- One-time reconstruction from persisted official metrics. For each identity/day,
-- keep the newest complete or verified-zero observation.
WITH ranked AS (
  SELECT
    m.user_id, m.integration_id, m.ad_account_id,
    m.campaign_id, m.adset_id, m.ad_id, m.creative_id,
    m.metric_id, m.metric_value, m.action_type, m.source_field,
    m.date_start AS fact_date, m.timezone, m.attribution_setting, m.source_level,
    COALESCE(m.completeness_status, 'complete') AS completeness_status,
    m.calculation_metadata,
    m.sync_run_id,
    COALESCE(r.finished_at, r.started_at, r.created_at) AS source_finished_at,
    row_number() OVER (
      PARTITION BY
        m.user_id, m.integration_id, m.ad_account_id,
        m.campaign_id, m.adset_id, m.ad_id, m.creative_id,
        m.metric_id, m.date_start, m.attribution_setting, m.source_level
      ORDER BY
        COALESCE(r.finished_at, r.started_at, r.created_at) DESC,
        m.created_at DESC,
        m.id DESC
    ) AS rn
  FROM public.meta_normalized_metrics m
  JOIN public.meta_sync_runs r ON r.id = m.sync_run_id
  WHERE r.status IN ('success', 'partial')
    AND m.date_start IS NOT NULL
    AND m.date_stop IS NOT NULL
    AND m.date_start = m.date_stop
    AND m.source_level IN ('account', 'campaign', 'adset', 'ad')
    AND COALESCE(m.completeness_status, 'complete') IN ('complete', 'zero_delivery')
)
INSERT INTO private.meta_daily_metric_facts (
  user_id, integration_id, ad_account_id,
  campaign_id, adset_id, ad_id, creative_id,
  metric_id, metric_value, action_type, source_field,
  fact_date, timezone, attribution_setting, source_level,
  completeness_status, calculation_metadata,
  source_run_id, source_finished_at, updated_at
)
SELECT
  user_id, integration_id, ad_account_id,
  campaign_id, adset_id, ad_id, creative_id,
  metric_id, metric_value, action_type, source_field,
  fact_date, timezone, attribution_setting, source_level,
  completeness_status, calculation_metadata,
  sync_run_id, source_finished_at, now()
FROM ranked
WHERE rn = 1
ON CONFLICT (
  user_id, integration_id, ad_account_id,
  campaign_id, adset_id, ad_id, creative_id,
  metric_id, fact_date, attribution_setting, source_level
) DO UPDATE SET
  metric_value = EXCLUDED.metric_value,
  action_type = EXCLUDED.action_type,
  source_field = EXCLUDED.source_field,
  timezone = EXCLUDED.timezone,
  completeness_status = EXCLUDED.completeness_status,
  calculation_metadata = EXCLUDED.calculation_metadata,
  source_run_id = EXCLUDED.source_run_id,
  source_finished_at = EXCLUDED.source_finished_at,
  updated_at = now()
WHERE EXCLUDED.source_finished_at >= private.meta_daily_metric_facts.source_finished_at;

-- Internal period rollup now reads the newest daily facts across sync runs.
CREATE OR REPLACE FUNCTION public.get_period_entity_metrics(
  p_sync_run_id UUID,
  p_client_meta_asset_id UUID,
  p_account_id TEXT,
  p_account_name TEXT,
  p_currency TEXT,
  p_timezone TEXT,
  p_source_level TEXT,
  p_campaign_id TEXT,
  p_adset_id TEXT,
  p_ad_id TEXT,
  p_creative_id TEXT,
  p_classified_objective TEXT,
  p_destination_type TEXT,
  p_attribution_setting TEXT,
  p_date_start DATE,
  p_date_stop DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_integration_id UUID;
  v_sums JSONB;
  v_result JSONB := '{}'::jsonb;
  v_context JSONB;
  v_metric JSONB;
  v_metric_id TEXT;
  v_value NUMERIC;
  v_status TEXT;
  v_has_rows BOOLEAN;
  v_collected_at TIMESTAMPTZ;
  v_single_day BOOLEAN := p_date_start = p_date_stop;
  v_metric_ids CONSTANT TEXT[] := ARRAY[
    'spend', 'impressions', 'reach', 'frequency', 'clicks', 'link_clicks', 'link_ctr',
    'link_cpc', 'cpm', 'landing_page_views', 'page_load_rate',
    'whatsapp_conversations_started', 'messenger_conversations_started',
    'instagram_direct_conversations_started', 'messaging_conversations_started_generic',
    'messaging_conversations_started_total', 'cost_per_messaging_conversation',
    'leads', 'cpa', 'purchases', 'purchase_value', 'purchase_roas'
  ];
  v_additive CONSTANT TEXT[] := ARRAY[
    'spend', 'impressions', 'clicks', 'link_clicks', 'landing_page_views',
    'whatsapp_conversations_started', 'messenger_conversations_started',
    'instagram_direct_conversations_started', 'messaging_conversations_started_generic',
    'messaging_conversations_started_total', 'leads', 'purchases', 'purchase_value'
  ];
BEGIN
  IF v_user_id IS NULL OR p_source_level NOT IN ('campaign', 'adset', 'ad') THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT r.integration_id
  INTO v_integration_id
  FROM public.meta_sync_runs r
  WHERE r.id = p_sync_run_id
    AND r.user_id = v_user_id;

  SELECT
    COALESCE(
      jsonb_object_agg(s.metric_id, jsonb_build_object('sum', s.total, 'status', s.status)),
      '{}'::jsonb
    ),
    max(s.collected_at)
  INTO v_sums, v_collected_at
  FROM (
    SELECT
      f.metric_id,
      SUM(f.metric_value) AS total,
      CASE
        WHEN bool_or(COALESCE(f.completeness_status, 'complete') NOT IN ('complete', 'zero_delivery'))
          THEN max(f.completeness_status) FILTER (
            WHERE f.completeness_status IS NOT NULL
              AND f.completeness_status NOT IN ('complete', 'zero_delivery')
          )
        WHEN bool_and(COALESCE(f.completeness_status, 'complete') = 'zero_delivery')
          THEN 'zero_delivery'
        ELSE 'complete'
      END AS status,
      max(f.source_finished_at) AS collected_at
    FROM private.meta_daily_metric_facts f
    WHERE f.user_id = v_user_id
      AND f.integration_id = v_integration_id
      AND f.ad_account_id = p_account_id
      AND f.source_level = p_source_level
      AND f.fact_date BETWEEN p_date_start AND p_date_stop
      AND (p_campaign_id IS NULL OR f.campaign_id = p_campaign_id)
      AND (p_adset_id IS NULL OR f.adset_id = p_adset_id)
      AND (p_ad_id IS NULL OR f.ad_id = p_ad_id)
      AND (p_creative_id IS NULL OR f.creative_id = p_creative_id)
      AND (p_source_level <> 'campaign' OR (f.adset_id IS NULL AND f.ad_id IS NULL))
    GROUP BY f.metric_id
  ) s;

  -- Compatibility fallback for environments that have not backfilled facts yet.
  IF v_sums = '{}'::jsonb THEN
    SELECT COALESCE(jsonb_object_agg(s.metric_id, jsonb_build_object('sum', s.total, 'status', s.status)), '{}'::jsonb)
    INTO v_sums
    FROM (
      SELECT
        m.metric_id,
        SUM(m.metric_value) AS total,
        CASE
          WHEN bool_or(COALESCE(m.completeness_status, 'complete') NOT IN ('complete', 'zero_delivery'))
            THEN max(m.completeness_status) FILTER (
              WHERE m.completeness_status IS NOT NULL
                AND m.completeness_status NOT IN ('complete', 'zero_delivery')
            )
          WHEN bool_and(COALESCE(m.completeness_status, 'complete') = 'zero_delivery')
            THEN 'zero_delivery'
          ELSE 'complete'
        END AS status
      FROM public.meta_normalized_metrics m
      WHERE m.user_id = v_user_id
        AND m.sync_run_id = p_sync_run_id
        AND m.source_level = p_source_level
        AND m.date_start >= p_date_start
        AND m.date_stop <= p_date_stop
        AND (p_campaign_id IS NULL OR m.campaign_id = p_campaign_id)
        AND (p_adset_id IS NULL OR m.adset_id = p_adset_id)
        AND (p_ad_id IS NULL OR m.ad_id = p_ad_id)
        AND (p_creative_id IS NULL OR m.creative_id = p_creative_id)
        AND (p_source_level <> 'campaign' OR (m.adset_id IS NULL AND m.ad_id IS NULL))
      GROUP BY m.metric_id
    ) s;

    SELECT r.finished_at
    INTO v_collected_at
    FROM public.meta_sync_runs r
    WHERE r.id = p_sync_run_id;
  END IF;

  v_has_rows := v_sums <> '{}'::jsonb;

  v_context := jsonb_build_object(
    'currency', p_currency,
    'timezone', p_timezone,
    'sourceLevel', p_source_level,
    'attributionSetting', p_attribution_setting,
    'classifiedObjective', p_classified_objective,
    'destinationType', p_destination_type,
    'syncRunId', p_sync_run_id,
    'collectedAt', v_collected_at,
    'clientMetaAssetId', p_client_meta_asset_id,
    'accountId', p_account_id,
    'accountName', p_account_name,
    'campaignId', p_campaign_id,
    'adsetId', p_adset_id,
    'adId', p_ad_id,
    'dateStart', p_date_start,
    'dateStop', p_date_stop
  );

  FOREACH v_metric_id IN ARRAY v_metric_ids LOOP
    v_metric := NULL;
    IF NOT v_has_rows THEN
      IF v_metric_id = ANY(v_additive) THEN
        v_metric := jsonb_build_object('value', 0, 'available', true, 'completenessStatus', 'zero_delivery');
      END IF;
    ELSE
      v_value := public.rollup_analytics_metric(
        v_metric_id,
        (v_sums->v_metric_id->>'sum')::numeric,
        COALESCE((v_sums->'spend'->>'sum')::numeric, 0),
        COALESCE((v_sums->'impressions'->>'sum')::numeric, 0),
        (v_sums->'reach'->>'sum')::numeric,
        COALESCE((v_sums->'link_clicks'->>'sum')::numeric, 0),
        COALESCE((v_sums->'messaging_conversations_started_total'->>'sum')::numeric, 0),
        COALESCE((v_sums->'purchases'->>'sum')::numeric, 0),
        COALESCE((v_sums->'purchase_value'->>'sum')::numeric, 0),
        COALESCE((v_sums->'leads'->>'sum')::numeric, 0),
        COALESCE((v_sums->'landing_page_views'->>'sum')::numeric, 0),
        v_single_day,
        p_classified_objective
      );
      IF v_value IS NULL AND v_metric_id = ANY(v_additive) THEN
        v_value := 0;
      END IF;
      IF v_value IS NOT NULL THEN
        v_status := COALESCE(v_sums->v_metric_id->>'status', v_sums->'spend'->>'status', 'complete');
        v_metric := jsonb_build_object('value', v_value, 'available', true, 'completenessStatus', v_status);
      END IF;
    END IF;

    v_result := v_result || jsonb_build_object(
      v_metric_id,
      public.decorate_analytics_metric(v_metric_id, v_metric, v_context)
    );
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_period_entity_metrics(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_period_entity_metrics(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE
) FROM anon;
REVOKE ALL ON FUNCTION public.get_period_entity_metrics(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE
) FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_meta_freshness_status(
  p_stale_after_minutes INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_items JSONB;
  v_stale_after INTERVAL;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb);
  END IF;

  v_stale_after := make_interval(mins => GREATEST(5, LEAST(COALESCE(p_stale_after_minutes, 30), 240)));

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'clientMetaAssetId', q.client_meta_asset_id,
      'clientId', q.client_id,
      'accountId', q.ad_account_id,
      'accountName', q.account_name,
      'timezone', q.timezone_name,
      'localToday', q.local_today,
      'campaignFreshThrough', q.campaign_fresh_through,
      'campaignRefreshedAt', q.campaign_refreshed_at,
      'creativeFreshThrough', q.creative_fresh_through,
      'creativeRefreshedAt', q.creative_refreshed_at,
      'needsCampaignRefresh',
        q.campaign_fresh_through IS NULL
        OR q.campaign_fresh_through < q.local_today
        OR q.campaign_refreshed_at IS NULL
        OR q.campaign_refreshed_at < now() - v_stale_after,
      'needsCreativeRefresh',
        q.creative_fresh_through IS NULL
        OR q.creative_fresh_through < q.local_today
        OR q.creative_refreshed_at IS NULL
        OR q.creative_refreshed_at < now() - v_stale_after
    )
    ORDER BY q.client_name, q.account_name
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      cma.id AS client_meta_asset_id,
      cma.client_id,
      ci.display_name AS client_name,
      ma.integration_id,
      ma.asset_id AS ad_account_id,
      ma.asset_name AS account_name,
      COALESCE(ma.timezone_name, 'America/Sao_Paulo') AS timezone_name,
      (timezone(COALESCE(ma.timezone_name, 'America/Sao_Paulo'), now()))::date AS local_today,
      max(f.fact_date) FILTER (WHERE f.source_level = 'campaign') AS campaign_fresh_through,
      max(f.source_finished_at) FILTER (WHERE f.source_level = 'campaign') AS campaign_refreshed_at,
      max(f.fact_date) FILTER (WHERE f.source_level = 'ad') AS creative_fresh_through,
      max(f.source_finished_at) FILTER (WHERE f.source_level = 'ad') AS creative_refreshed_at
    FROM public.client_meta_assets cma
    JOIN public.client_identity ci
      ON ci.user_id = cma.user_id
     AND ci.client_id = cma.client_id
     AND ci.archived_at IS NULL
    JOIN public.meta_assets ma ON ma.id = cma.meta_asset_id
    JOIN public.meta_integrations mi
      ON mi.id = ma.integration_id
     AND mi.user_id = cma.user_id
     AND mi.status = 'active'
    LEFT JOIN private.meta_daily_metric_facts f
      ON f.user_id = cma.user_id
     AND f.integration_id = ma.integration_id
     AND f.ad_account_id = ma.asset_id
    WHERE cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL
    GROUP BY
      cma.id, cma.client_id, ci.display_name,
      ma.integration_id, ma.asset_id, ma.asset_name, ma.timezone_name
  ) q;

  RETURN jsonb_build_object(
    'state', 'ready',
    'staleAfterMinutes', EXTRACT(EPOCH FROM v_stale_after)::integer / 60,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_freshness_status(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_freshness_status(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_freshness_status(INTEGER) TO authenticated;
