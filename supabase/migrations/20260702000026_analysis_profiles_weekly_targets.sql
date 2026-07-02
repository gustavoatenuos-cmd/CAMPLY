-- Migration 000026: client analysis profiles, weekly period and advanced targets.
-- Adds the product-context layer without changing the legacy workspace source or prior migrations.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_allowed_performance_metric(p_metric_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_metric_id = ANY (ARRAY[
    'spend',
    'impressions',
    'reach',
    'frequency',
    'cpm',
    'clicks',
    'link_clicks',
    'link_ctr',
    'link_cpc',
    'cpa',
    'whatsapp_conversations_started',
    'messenger_conversations_started',
    'instagram_direct_conversations_started',
    'messaging_conversations_started_generic',
    'messaging_conversations_started_total',
    'cost_per_messaging_conversation',
    'purchases',
    'cost_per_purchase',
    'purchase_value',
    'purchase_roas',
    'leads',
    'cost_per_lead',
    'landing_page_views',
    'page_load_rate',
    'profile_visits',
    'video_views',
    'thru_plays'
  ]);
$$;

REVOKE ALL ON FUNCTION public.is_allowed_performance_metric(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_allowed_performance_metric(TEXT) TO authenticated;

CREATE TABLE IF NOT EXISTS public.client_analysis_profiles (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  vertical TEXT NOT NULL,
  subsegment TEXT NOT NULL,
  custom_vertical TEXT,
  custom_subsegment TEXT,
  business_model TEXT NOT NULL,
  primary_conversion_metric TEXT NOT NULL,
  secondary_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_channel TEXT NOT NULL,
  budget_period TEXT NOT NULL DEFAULT 'monthly',
  planned_budget NUMERIC,
  minimum_evaluation_spend NUMERIC NOT NULL DEFAULT 0,
  minimum_impressions BIGINT NOT NULL DEFAULT 0,
  minimum_results BIGINT NOT NULL DEFAULT 0,
  attribution_delay_hours INTEGER NOT NULL DEFAULT 24,
  analysis_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id),
  CONSTRAINT client_analysis_profiles_client_fk
    FOREIGN KEY (user_id, client_id)
    REFERENCES public.client_identity(user_id, client_id)
    ON DELETE CASCADE,
  CONSTRAINT client_analysis_profiles_vertical_not_blank CHECK (btrim(vertical) <> ''),
  CONSTRAINT client_analysis_profiles_subsegment_not_blank CHECK (btrim(subsegment) <> ''),
  CONSTRAINT client_analysis_profiles_business_model_not_blank CHECK (btrim(business_model) <> ''),
  CONSTRAINT client_analysis_profiles_primary_channel_not_blank CHECK (btrim(primary_channel) <> ''),
  CONSTRAINT client_analysis_profiles_budget_period_check CHECK (budget_period IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT client_analysis_profiles_primary_metric_check CHECK (public.is_allowed_performance_metric(primary_conversion_metric)),
  CONSTRAINT client_analysis_profiles_secondary_metrics_array_check CHECK (jsonb_typeof(secondary_metrics) = 'array'),
  CONSTRAINT client_analysis_profiles_planned_budget_check CHECK (planned_budget IS NULL OR planned_budget >= 0),
  CONSTRAINT client_analysis_profiles_evaluation_gate_check CHECK (
    minimum_evaluation_spend >= 0
    AND minimum_impressions >= 0
    AND minimum_results >= 0
    AND attribution_delay_hours >= 0
  )
);

ALTER TABLE public.client_analysis_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own client analysis profiles" ON public.client_analysis_profiles;
CREATE POLICY "Users can view their own client analysis profiles"
ON public.client_analysis_profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own client analysis profiles" ON public.client_analysis_profiles;
CREATE POLICY "Users can insert their own client analysis profiles"
ON public.client_analysis_profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own client analysis profiles" ON public.client_analysis_profiles;
CREATE POLICY "Users can update their own client analysis profiles"
ON public.client_analysis_profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_client_analysis_profiles_updated_at ON public.client_analysis_profiles;
CREATE TRIGGER trg_client_analysis_profiles_updated_at
BEFORE UPDATE ON public.client_analysis_profiles
FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

REVOKE ALL ON public.client_analysis_profiles FROM PUBLIC;
REVOKE ALL ON public.client_analysis_profiles FROM anon;
REVOKE ALL ON public.client_analysis_profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.client_analysis_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_client_analysis_profile(
  p_client_id TEXT,
  p_vertical TEXT DEFAULT 'Outros',
  p_subsegment TEXT DEFAULT 'Outros',
  p_business_model TEXT DEFAULT 'modelo misto',
  p_primary_conversion_metric TEXT DEFAULT 'messaging_conversations_started_total',
  p_secondary_metrics JSONB DEFAULT '[]'::jsonb,
  p_primary_channel TEXT DEFAULT 'Misto',
  p_budget_period TEXT DEFAULT 'monthly',
  p_planned_budget NUMERIC DEFAULT NULL,
  p_analysis_enabled BOOLEAN DEFAULT true,
  p_custom_vertical TEXT DEFAULT NULL,
  p_custom_subsegment TEXT DEFAULT NULL,
  p_minimum_evaluation_spend NUMERIC DEFAULT 0,
  p_minimum_impressions BIGINT DEFAULT 0,
  p_minimum_results BIGINT DEFAULT 0,
  p_attribution_delay_hours INTEGER DEFAULT 24
)
RETURNS public.client_analysis_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_secondary_metrics JSONB := '[]'::jsonb;
  v_profile public.client_analysis_profiles;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(COALESCE(p_client_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'client_id is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.client_identity ci
    WHERE ci.user_id = v_user_id
      AND ci.client_id = p_client_id
      AND ci.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Client not found or archived' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_allowed_performance_metric(COALESCE(NULLIF(btrim(p_primary_conversion_metric), ''), 'messaging_conversations_started_total')) THEN
    RAISE EXCEPTION 'primary_conversion_metric is not allowed' USING ERRCODE = '22023';
  END IF;

  IF p_budget_period NOT IN ('daily', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'budget_period must be daily, weekly or monthly' USING ERRCODE = '22023';
  END IF;

  IF p_planned_budget IS NOT NULL AND p_planned_budget < 0 THEN
    RAISE EXCEPTION 'planned_budget must be greater than or equal to zero' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_minimum_evaluation_spend, 0) < 0
    OR COALESCE(p_minimum_impressions, 0) < 0
    OR COALESCE(p_minimum_results, 0) < 0
    OR COALESCE(p_attribution_delay_hours, 0) < 0 THEN
    RAISE EXCEPTION 'analysis thresholds must be greater than or equal to zero' USING ERRCODE = '22023';
  END IF;

  IF p_secondary_metrics IS NOT NULL AND jsonb_typeof(p_secondary_metrics) <> 'array' THEN
    RAISE EXCEPTION 'secondary_metrics must be an array' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(metric_id ORDER BY metric_id), '[]'::jsonb)
  INTO v_secondary_metrics
  FROM (
    SELECT DISTINCT metric_id
    FROM jsonb_array_elements_text(COALESCE(p_secondary_metrics, '[]'::jsonb)) AS metrics(metric_id)
    WHERE public.is_allowed_performance_metric(metric_id)
  ) filtered_metrics;

  INSERT INTO public.client_analysis_profiles (
    user_id,
    client_id,
    vertical,
    subsegment,
    custom_vertical,
    custom_subsegment,
    business_model,
    primary_conversion_metric,
    secondary_metrics,
    primary_channel,
    budget_period,
    planned_budget,
    minimum_evaluation_spend,
    minimum_impressions,
    minimum_results,
    attribution_delay_hours,
    analysis_enabled
  )
  VALUES (
    v_user_id,
    btrim(p_client_id),
    COALESCE(NULLIF(btrim(p_vertical), ''), 'Outros'),
    COALESCE(NULLIF(btrim(p_subsegment), ''), 'Outros'),
    NULLIF(btrim(COALESCE(p_custom_vertical, '')), ''),
    NULLIF(btrim(COALESCE(p_custom_subsegment, '')), ''),
    COALESCE(NULLIF(btrim(p_business_model), ''), 'modelo misto'),
    COALESCE(NULLIF(btrim(p_primary_conversion_metric), ''), 'messaging_conversations_started_total'),
    v_secondary_metrics,
    COALESCE(NULLIF(btrim(p_primary_channel), ''), 'Misto'),
    p_budget_period,
    p_planned_budget,
    COALESCE(p_minimum_evaluation_spend, 0),
    COALESCE(p_minimum_impressions, 0),
    COALESCE(p_minimum_results, 0),
    COALESCE(p_attribution_delay_hours, 24),
    COALESCE(p_analysis_enabled, true)
  )
  ON CONFLICT (user_id, client_id) DO UPDATE SET
    vertical = EXCLUDED.vertical,
    subsegment = EXCLUDED.subsegment,
    custom_vertical = EXCLUDED.custom_vertical,
    custom_subsegment = EXCLUDED.custom_subsegment,
    business_model = EXCLUDED.business_model,
    primary_conversion_metric = EXCLUDED.primary_conversion_metric,
    secondary_metrics = EXCLUDED.secondary_metrics,
    primary_channel = EXCLUDED.primary_channel,
    budget_period = EXCLUDED.budget_period,
    planned_budget = EXCLUDED.planned_budget,
    minimum_evaluation_spend = EXCLUDED.minimum_evaluation_spend,
    minimum_impressions = EXCLUDED.minimum_impressions,
    minimum_results = EXCLUDED.minimum_results,
    attribution_delay_hours = EXCLUDED.attribution_delay_hours,
    analysis_enabled = EXCLUDED.analysis_enabled,
    updated_at = now()
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_client_analysis_profile(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, TEXT, NUMERIC, BIGINT, BIGINT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_client_analysis_profile(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, TEXT, NUMERIC, BIGINT, BIGINT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_client_analysis_profile(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, TEXT, NUMERIC, BIGINT, BIGINT, INTEGER) TO authenticated;

ALTER TABLE public.client_performance_targets
  ADD COLUMN IF NOT EXISTS target_min NUMERIC,
  ADD COLUMN IF NOT EXISTS target_max NUMERIC,
  ADD COLUMN IF NOT EXISTS warning_tolerance_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS critical_tolerance_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS priority_weight NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS evaluation_period TEXT;

ALTER TABLE public.client_performance_targets
  DROP CONSTRAINT IF EXISTS client_performance_targets_kind_check,
  DROP CONSTRAINT IF EXISTS client_performance_targets_metric_kind_check,
  DROP CONSTRAINT IF EXISTS client_performance_targets_range_check,
  DROP CONSTRAINT IF EXISTS client_performance_targets_tolerance_check,
  DROP CONSTRAINT IF EXISTS client_performance_targets_priority_check;

ALTER TABLE public.client_performance_targets
  ADD CONSTRAINT client_performance_targets_kind_check
    CHECK (target_kind IN (
      'cost_per_result',
      'daily_budget',
      'weekly_budget',
      'monthly_budget',
      'minimum_results',
      'maximum_metric',
      'minimum_metric',
      'target_range'
    )),
  ADD CONSTRAINT client_performance_targets_metric_kind_check CHECK (
    (
      target_kind IN ('daily_budget', 'weekly_budget', 'monthly_budget')
      AND metric_id = 'spend'
    )
    OR (
      target_kind IN ('cost_per_result', 'minimum_results', 'maximum_metric', 'minimum_metric', 'target_range')
      AND metric_id <> 'spend'
    )
  ),
  ADD CONSTRAINT client_performance_targets_range_check CHECK (
    target_kind <> 'target_range'
    OR (target_min IS NOT NULL AND target_max IS NOT NULL AND target_min > 0 AND target_max > target_min)
  ),
  ADD CONSTRAINT client_performance_targets_tolerance_check CHECK (
    (warning_tolerance_percent IS NULL OR warning_tolerance_percent >= 0)
    AND (critical_tolerance_percent IS NULL OR critical_tolerance_percent >= 0)
    AND (
      warning_tolerance_percent IS NULL
      OR critical_tolerance_percent IS NULL
      OR critical_tolerance_percent >= warning_tolerance_percent
    )
  ),
  ADD CONSTRAINT client_performance_targets_priority_check CHECK (priority_weight > 0);

CREATE OR REPLACE FUNCTION public.set_client_performance_target_v2(
  p_client_meta_asset_id UUID,
  p_metric_id TEXT,
  p_target_kind TEXT,
  p_target_value NUMERIC DEFAULT NULL,
  p_target_min NUMERIC DEFAULT NULL,
  p_target_max NUMERIC DEFAULT NULL,
  p_warning_tolerance_percent NUMERIC DEFAULT NULL,
  p_critical_tolerance_percent NUMERIC DEFAULT NULL,
  p_priority_weight NUMERIC DEFAULT 1,
  p_evaluation_period TEXT DEFAULT NULL,
  p_campaign_id TEXT DEFAULT NULL,
  p_effective_from TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_effective_from TIMESTAMPTZ := COALESCE(p_effective_from, now());
  v_target_id UUID;
  v_metric_id TEXT := NULLIF(btrim(COALESCE(p_metric_id, '')), '');
  v_target_kind TEXT := NULLIF(btrim(COALESCE(p_target_kind, '')), '');
  v_target_value NUMERIC := p_target_value;
  v_priority_weight NUMERIC := COALESCE(p_priority_weight, 1);
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_metric_id IS NULL OR NOT public.is_allowed_performance_metric(v_metric_id) THEN
    RAISE EXCEPTION 'Metric id is not allowed for performance targets: %', v_metric_id USING ERRCODE = '22023';
  END IF;

  IF v_target_kind NOT IN (
    'cost_per_result',
    'daily_budget',
    'weekly_budget',
    'monthly_budget',
    'minimum_results',
    'maximum_metric',
    'minimum_metric',
    'target_range'
  ) THEN
    RAISE EXCEPTION 'Invalid target kind: %', v_target_kind USING ERRCODE = '22023';
  END IF;

  IF (
    (v_target_kind IN ('daily_budget', 'weekly_budget', 'monthly_budget') AND v_metric_id <> 'spend')
    OR (v_target_kind IN ('cost_per_result', 'minimum_results', 'maximum_metric', 'minimum_metric', 'target_range') AND v_metric_id = 'spend')
  ) THEN
    RAISE EXCEPTION 'Metric and target kind are incompatible' USING ERRCODE = '22023';
  END IF;

  IF v_target_kind = 'target_range' THEN
    IF p_target_min IS NULL OR p_target_max IS NULL OR p_target_min <= 0 OR p_target_max <= p_target_min THEN
      RAISE EXCEPTION 'target_range requires target_min greater than zero and target_max greater than target_min' USING ERRCODE = '22023';
    END IF;
    v_target_value := COALESCE(p_target_value, p_target_max);
  END IF;

  IF v_target_value IS NULL OR v_target_value <= 0 THEN
    RAISE EXCEPTION 'Target value must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF p_warning_tolerance_percent IS NOT NULL AND p_warning_tolerance_percent < 0 THEN
    RAISE EXCEPTION 'warning_tolerance_percent must be greater than or equal to zero' USING ERRCODE = '22023';
  END IF;
  IF p_critical_tolerance_percent IS NOT NULL AND p_critical_tolerance_percent < 0 THEN
    RAISE EXCEPTION 'critical_tolerance_percent must be greater than or equal to zero' USING ERRCODE = '22023';
  END IF;
  IF p_warning_tolerance_percent IS NOT NULL
    AND p_critical_tolerance_percent IS NOT NULL
    AND p_critical_tolerance_percent < p_warning_tolerance_percent THEN
    RAISE EXCEPTION 'critical_tolerance_percent must be greater than or equal to warning_tolerance_percent' USING ERRCODE = '22023';
  END IF;
  IF v_priority_weight <= 0 THEN
    RAISE EXCEPTION 'priority_weight must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.client_meta_assets cma
    JOIN public.client_identity ci
      ON ci.user_id = cma.user_id
     AND ci.client_id = cma.client_id
    JOIN public.meta_assets ma
      ON ma.id = cma.meta_asset_id
    JOIN public.meta_integrations mi
      ON mi.id = ma.integration_id
    WHERE cma.id = p_client_meta_asset_id
      AND cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL
      AND ci.archived_at IS NULL
      AND mi.user_id::text = v_user_id::text
  ) THEN
    RAISE EXCEPTION 'Client Meta asset link not found for authenticated user' USING ERRCODE = '42501';
  END IF;

  UPDATE public.client_performance_targets
  SET effective_to = v_effective_from
  WHERE user_id = v_user_id
    AND client_meta_asset_id = p_client_meta_asset_id
    AND COALESCE(campaign_id, '') = COALESCE(NULLIF(btrim(COALESCE(p_campaign_id, '')), ''), '')
    AND metric_id = v_metric_id
    AND target_kind = v_target_kind
    AND effective_to IS NULL
    AND effective_from < v_effective_from;

  IF EXISTS (
    SELECT 1
    FROM public.client_performance_targets t
    WHERE t.user_id = v_user_id
      AND t.client_meta_asset_id = p_client_meta_asset_id
      AND COALESCE(t.campaign_id, '') = COALESCE(NULLIF(btrim(COALESCE(p_campaign_id, '')), ''), '')
      AND t.metric_id = v_metric_id
      AND t.target_kind = v_target_kind
      AND tstzrange(t.effective_from, COALESCE(t.effective_to, 'infinity'::timestamptz), '[)')
          && tstzrange(v_effective_from, 'infinity'::timestamptz, '[)')
  ) THEN
    RAISE EXCEPTION 'Performance target temporal overlap detected' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.client_performance_targets (
    user_id,
    client_meta_asset_id,
    campaign_id,
    metric_id,
    target_kind,
    target_value,
    target_min,
    target_max,
    warning_tolerance_percent,
    critical_tolerance_percent,
    priority_weight,
    evaluation_period,
    effective_from
  )
  VALUES (
    v_user_id,
    p_client_meta_asset_id,
    NULLIF(btrim(COALESCE(p_campaign_id, '')), ''),
    v_metric_id,
    v_target_kind,
    v_target_value,
    p_target_min,
    p_target_max,
    p_warning_tolerance_percent,
    p_critical_tolerance_percent,
    v_priority_weight,
    NULLIF(btrim(COALESCE(p_evaluation_period, '')), ''),
    v_effective_from
  )
  RETURNING id INTO v_target_id;

  RETURN v_target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_client_performance_target_v2(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_client_performance_target_v2(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_client_performance_target_v2(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_client_performance_target_history(
  p_client_meta_asset_id UUID,
  p_campaign_id TEXT DEFAULT NULL
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
  IF NOT EXISTS (
    SELECT 1 FROM public.client_meta_assets cma
    WHERE cma.id = p_client_meta_asset_id AND cma.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Client Meta asset link not found' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
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
    'evaluationPeriod', t.evaluation_period,
    'effectiveFrom', t.effective_from,
    'effectiveTo', t.effective_to,
    'active', t.effective_to IS NULL
  ) ORDER BY t.effective_from DESC), '[]'::jsonb)
  INTO v_result
  FROM public.client_performance_targets t
  WHERE t.user_id = v_user_id
    AND t.client_meta_asset_id = p_client_meta_asset_id
    AND (
      (p_campaign_id IS NULL AND t.campaign_id IS NULL)
      OR t.campaign_id = p_campaign_id
    );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_client_performance_target_history(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_client_performance_target_history(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_client_performance_target_history(UUID, TEXT) TO authenticated;

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
    'contractVersion', 5,
    'dashboardAvailable', true,
    'dashboardRpc', 'get_global_performance_dashboard_v2',
    'supportedPeriods', jsonb_build_array('this_month', 'this_week', 'today', 'last_7d', 'last_30d'),
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

-- Explicit RPC definitions keep the migration deterministic and reviewable.
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

  IF p_period NOT IN ('this_month', 'this_week', 'today', 'last_7d', 'last_30d') THEN
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
     AND r.requested_period = p_period
     AND r.run_scope = 'full_account'
     AND r.requested_level = 'campaign'
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
     AND r.run_scope = 'full_account'
     AND r.requested_level = 'campaign'
     AND r.status = 'success'
    WHERE EXISTS (
      SELECT 1
      FROM public.meta_normalized_metrics m
      WHERE m.user_id = v_user_id
        AND m.sync_run_id = r.id
        AND m.integration_id = a.integration_id
        AND m.ad_account_id = a.ad_account_id
        AND m.source_level = 'account'
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
            WHEN NOT EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id) THEN 'never_synced'
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id)
             AND EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'failed') THEN 'failed'
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id)
             AND EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'partial') THEN 'partial'
            WHEN EXISTS (
              SELECT 1
              FROM latest_attempt la
              JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
              WHERE la.client_id = ac.client_id
                AND la.status = 'failed'
                AND la.started_at > ls.started_at
            ) THEN 'failed'
            WHEN EXISTS (
              SELECT 1
              FROM latest_attempt la
              JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
              WHERE la.client_id = ac.client_id
                AND la.status = 'partial'
                AND la.started_at > ls.started_at
            ) THEN 'partial'
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
                'terminationReason', ls.termination_reason
              ) END,
              'lastAttempt', CASE WHEN la.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', la.id,
                'status', la.status,
                'startedAt', la.started_at,
                'finishedAt', la.finished_at,
                'terminationReason', la.termination_reason
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
            'terminationReason', ls.termination_reason
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
            'terminationReason', la.termination_reason
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
        'analyticsContractVersion', 4
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

CREATE OR REPLACE FUNCTION public.get_meta_performance_hierarchy(
  p_client_meta_asset_id UUID,
  p_period TEXT,
  p_level TEXT,
  p_parent_id TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_period NOT IN ('this_month', 'this_week', 'today', 'last_7d', 'last_30d') THEN
    RAISE EXCEPTION 'Invalid hierarchy period' USING ERRCODE = '22023';
  END IF;
  IF p_level NOT IN ('campaign', 'adset', 'ad', 'creative') THEN
    RAISE EXCEPTION 'Invalid hierarchy level' USING ERRCODE = '22023';
  END IF;
  IF p_page < 1 OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'Invalid hierarchy pagination' USING ERRCODE = '22023';
  END IF;
  IF p_level <> 'campaign' AND NULLIF(btrim(COALESCE(p_parent_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'parent_id is required for this level' USING ERRCODE = '22023';
  END IF;

  SELECT cma.id, cma.client_id, ma.id AS meta_asset_id, ma.integration_id,
         ma.asset_id AS ad_account_id, ma.asset_name AS account_name,
         ma.currency, ma.timezone_name
  INTO v_link
  FROM public.client_meta_assets cma
  JOIN public.meta_assets ma ON ma.id = cma.meta_asset_id
  JOIN public.meta_integrations mi ON mi.id = ma.integration_id
  WHERE cma.id = p_client_meta_asset_id
    AND cma.user_id = v_user_id
    AND cma.unlinked_at IS NULL
    AND mi.user_id::text = v_user_id::text;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client Meta asset link not found' USING ERRCODE = '42501';
  END IF;

  SELECT r.* INTO v_run
  FROM public.meta_sync_runs r
  WHERE r.user_id = v_user_id
    AND r.integration_id = v_link.integration_id
    AND r.ad_account_id = v_link.ad_account_id
    AND r.requested_period = p_period
    AND r.status = 'success'
    AND (
      (p_level = 'campaign' AND r.run_scope = 'full_account')
      OR (p_level = 'adset' AND r.requested_level IN ('adset', 'ad', 'creative')
          AND (r.run_scope = 'full_account' OR r.selected_entity_ids->'campaign_ids' ? p_parent_id))
      OR (p_level = 'ad' AND r.requested_level IN ('ad', 'creative')
          AND (r.run_scope = 'full_account' OR r.selected_entity_ids->'adset_ids' ? p_parent_id))
      OR (p_level = 'creative' AND r.requested_level IN ('ad', 'creative')
          AND (r.run_scope = 'full_account' OR r.selected_entity_ids->'ad_ids' ? p_parent_id))
    )
  ORDER BY (r.status = 'success') DESC, r.finished_at DESC NULLS LAST, r.started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'period_not_synced', 'level', p_level, 'period', p_period,
      'page', p_page, 'pageSize', p_page_size, 'total', 0, 'items', '[]'::jsonb,
      'clientId', v_link.client_id, 'clientMetaAssetId', v_link.id,
      'metaAssetId', v_link.meta_asset_id, 'integrationId', v_link.integration_id,
      'adAccountId', v_link.ad_account_id, 'currency', v_link.currency,
      'timezone', v_link.timezone_name
    );
  END IF;

  v_offset := (p_page - 1) * p_page_size;

  IF p_level = 'campaign' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_campaign_snapshots s
    WHERE s.sync_run_id = v_run.id
      AND s.user_id = v_user_id
      AND COALESCE(NULLIF(upper(s.effective_status), ''), NULLIF(upper(s.meta_status), ''), '') = 'ACTIVE'
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.meta_adset_snapshots any_adset
          WHERE any_adset.sync_run_id = s.sync_run_id
            AND any_adset.user_id = s.user_id
            AND any_adset.campaign_id = s.campaign_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.meta_adset_snapshots active_adset
          WHERE active_adset.sync_run_id = s.sync_run_id
            AND active_adset.user_id = s.user_id
            AND active_adset.campaign_id = s.campaign_id
            AND COALESCE(NULLIF(upper(active_adset.effective_status), ''), NULLIF(upper(active_adset.meta_status), ''), '') = 'ACTIVE'
        )
      );

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
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.meta_adset_snapshots any_adset
            WHERE any_adset.sync_run_id = meta_campaign_snapshots.sync_run_id
              AND any_adset.user_id = meta_campaign_snapshots.user_id
              AND any_adset.campaign_id = meta_campaign_snapshots.campaign_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.meta_adset_snapshots active_adset
            WHERE active_adset.sync_run_id = meta_campaign_snapshots.sync_run_id
              AND active_adset.user_id = meta_campaign_snapshots.user_id
              AND active_adset.campaign_id = meta_campaign_snapshots.campaign_id
              AND COALESCE(NULLIF(upper(active_adset.effective_status), ''), NULLIF(upper(active_adset.meta_status), ''), '') = 'ACTIVE'
          )
        )
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
      'dailyBudget', CASE
        WHEN s.promoted_object->>'_camply_daily_budget' ~ '^[0-9]+([.][0-9]+)?$'
          THEN (s.promoted_object->>'_camply_daily_budget')::numeric / 100
        ELSE NULL
      END,
      'lifetimeBudget', CASE
        WHEN s.promoted_object->>'_camply_lifetime_budget' ~ '^[0-9]+([.][0-9]+)?$'
          THEN (s.promoted_object->>'_camply_lifetime_budget')::numeric / 100
        ELSE NULL
      END,
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
    'dateStart', v_run.date_start, 'dateStop', v_run.date_stop,
    'run', jsonb_build_object(
      'id', v_run.id, 'status', v_run.status, 'scope', v_run.run_scope,
      'requestedLevel', v_run.requested_level, 'startedAt', v_run.started_at,
      'finishedAt', v_run.finished_at, 'terminationReason', v_run.termination_reason,
      'pagesFetched', v_run.pages_fetched, 'recordsFetched', v_run.records_fetched
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_client_meta_asset_catalog(
  p_client_id TEXT DEFAULT NULL
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

  SELECT jsonb_build_object(
    'clients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'clientId', ci.client_id,
        'clientName', ci.display_name,
        'accounts', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'clientMetaAssetId', cma.id,
            'metaAssetId', ma.id,
            'integrationId', ma.integration_id,
            'adAccountId', ma.asset_id,
            'accountName', ma.asset_name,
            'currency', ma.currency,
            'timezone', ma.timezone_name,
            'assetStatus', ma.asset_status,
            'linkedAt', cma.linked_at,
            'availablePeriods', COALESCE((
              SELECT jsonb_agg(period_value ORDER BY period_value)
              FROM (
                SELECT DISTINCT r.requested_period AS period_value
                FROM public.meta_sync_runs r
                WHERE r.user_id = v_user_id
                  AND r.integration_id = ma.integration_id
                  AND r.ad_account_id = ma.asset_id
                  AND r.run_scope = 'full_account'
                  AND r.status = 'success'
                  AND r.requested_period IN ('this_month', 'this_week', 'today', 'last_7d', 'last_30d')
              ) periods
            ), '[]'::jsonb),
            'lastAttempt', (
              SELECT jsonb_build_object(
                'id', r.id,
                'status', r.status,
                'period', r.requested_period,
                'level', r.requested_level,
                'scope', r.run_scope,
                'startedAt', r.started_at,
                'finishedAt', r.finished_at,
                'terminationReason', r.termination_reason,
                'pagesFetched', r.pages_fetched,
                'recordsFetched', r.records_fetched
              )
              FROM public.meta_sync_runs r
              WHERE r.user_id = v_user_id
                AND r.integration_id = ma.integration_id
                AND r.ad_account_id = ma.asset_id
              ORDER BY r.started_at DESC
              LIMIT 1
            ),
            'lastSuccess', (
              SELECT jsonb_build_object(
                'id', r.id,
                'period', r.requested_period,
                'level', r.requested_level,
                'scope', r.run_scope,
                'startedAt', r.started_at,
                'finishedAt', r.finished_at,
                'pagesFetched', r.pages_fetched,
                'recordsFetched', r.records_fetched
              )
              FROM public.meta_sync_runs r
              WHERE r.user_id = v_user_id
                AND r.integration_id = ma.integration_id
                AND r.ad_account_id = ma.asset_id
                AND r.status = 'success'
              ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
              LIMIT 1
            )
          ) ORDER BY ma.asset_name)
          FROM public.client_meta_assets cma
          JOIN public.meta_assets ma ON ma.id = cma.meta_asset_id
          JOIN public.meta_integrations mi ON mi.id = ma.integration_id
          WHERE cma.user_id = v_user_id
            AND cma.client_id = ci.client_id
            AND cma.unlinked_at IS NULL
            AND mi.user_id::text = v_user_id::text
        ), '[]'::jsonb)
      ) ORDER BY ci.display_name)
      FROM public.client_identity ci
      WHERE ci.user_id = v_user_id
        AND ci.archived_at IS NULL
        AND (p_client_id IS NULL OR ci.client_id = p_client_id)
    ), '[]'::jsonb),
    'availableAssets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'metaAssetId', ma.id,
        'integrationId', ma.integration_id,
        'adAccountId', ma.asset_id,
        'accountName', ma.asset_name,
        'currency', ma.currency,
        'timezone', ma.timezone_name,
        'assetStatus', ma.asset_status,
        'linkedClientId', cma.client_id,
        'clientMetaAssetId', cma.id
      ) ORDER BY ma.asset_name)
      FROM public.meta_assets ma
      JOIN public.meta_integrations mi ON mi.id = ma.integration_id
      LEFT JOIN public.client_meta_assets cma
        ON cma.meta_asset_id = ma.id
       AND cma.user_id = v_user_id
       AND cma.unlinked_at IS NULL
      WHERE mi.user_id::text = v_user_id::text
        AND mi.status = 'active'
        AND ma.asset_type = 'adaccount'
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) TO authenticated;

REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.get_client_meta_asset_catalog(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_client_meta_asset_catalog(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_client_meta_asset_catalog(TEXT) TO authenticated;

COMMIT;
