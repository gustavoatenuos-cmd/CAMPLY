-- Migration 000027: objective-led analysis profiles, profile goals and reusable templates.
-- Additive compatibility migration. business_model and legacy technical gates remain
-- available for rollback/read fallback and can be removed only in a future migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_allowed_performance_metric(p_metric_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_metric_id = ANY (ARRAY[
    'spend', 'impressions', 'reach', 'frequency', 'cpm', 'clicks',
    'link_clicks', 'link_ctr', 'link_cpc', 'cpa',
    'whatsapp_conversations_started', 'messenger_conversations_started',
    'instagram_direct_conversations_started', 'messaging_conversations_started_generic',
    'messaging_conversations_started_total', 'cost_per_messaging_conversation',
    'purchases', 'cost_per_purchase', 'purchase_value', 'purchase_roas',
    'leads', 'cost_per_lead', 'registrations', 'cost_per_registration',
    'landing_page_views', 'cost_per_landing_page_view', 'page_load_rate',
    'profile_visits', 'video_views', 'thru_plays'
  ]);
$$;

REVOKE ALL ON FUNCTION public.is_allowed_performance_metric(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_allowed_performance_metric(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_allowed_performance_metric(TEXT) TO authenticated;

ALTER TABLE public.client_analysis_profiles
  ADD COLUMN IF NOT EXISTS primary_objective TEXT,
  ADD COLUMN IF NOT EXISTS performance_goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS budget_platform TEXT NOT NULL DEFAULT 'meta';

ALTER TABLE public.client_analysis_profiles
  DROP CONSTRAINT IF EXISTS client_analysis_profiles_primary_objective_check,
  DROP CONSTRAINT IF EXISTS client_analysis_profiles_performance_goals_check,
  DROP CONSTRAINT IF EXISTS client_analysis_profiles_budget_platform_check;

ALTER TABLE public.client_analysis_profiles
  ADD CONSTRAINT client_analysis_profiles_primary_objective_check CHECK (
    primary_objective IS NULL OR primary_objective IN (
      'whatsapp_messages', 'leads', 'registrations', 'sales', 'website_sales'
    )
  ),
  ADD CONSTRAINT client_analysis_profiles_performance_goals_check CHECK (
    jsonb_typeof(performance_goals) = 'array'
  ),
  ADD CONSTRAINT client_analysis_profiles_budget_platform_check CHECK (
    budget_platform IN ('meta', 'google', 'youtube', 'tiktok')
  );

-- Only deterministic legacy values are migrated. Ambiguous values remain NULL and
-- appear as "Configuração pendente" until the user confirms the objective.
UPDATE public.client_analysis_profiles
SET primary_objective = CASE lower(btrim(business_model))
  WHEN 'geração de leads' THEN 'leads'
  WHEN 'venda pelo whatsapp' THEN 'whatsapp_messages'
  WHEN 'venda pelo site' THEN 'website_sales'
  WHEN 'e-commerce' THEN 'website_sales'
  ELSE primary_objective
END
WHERE primary_objective IS NULL;

CREATE TABLE IF NOT EXISTS public.analysis_profile_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vertical TEXT NOT NULL,
  subsegment TEXT NOT NULL,
  primary_objective TEXT NOT NULL,
  selected_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_defaults JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget_period_default TEXT NOT NULL DEFAULT 'monthly',
  budget_platform_default TEXT NOT NULL DEFAULT 'meta',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT analysis_profile_templates_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT analysis_profile_templates_vertical_not_blank CHECK (btrim(vertical) <> ''),
  CONSTRAINT analysis_profile_templates_subsegment_not_blank CHECK (btrim(subsegment) <> ''),
  CONSTRAINT analysis_profile_templates_objective_check CHECK (
    primary_objective IN ('whatsapp_messages', 'leads', 'registrations', 'sales', 'website_sales')
  ),
  CONSTRAINT analysis_profile_templates_metrics_array_check CHECK (jsonb_typeof(selected_metrics) = 'array'),
  CONSTRAINT analysis_profile_templates_targets_array_check CHECK (jsonb_typeof(target_defaults) = 'array'),
  CONSTRAINT analysis_profile_templates_budget_period_check CHECK (budget_period_default IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT analysis_profile_templates_platform_check CHECK (budget_platform_default IN ('meta', 'google', 'youtube', 'tiktok'))
);

ALTER TABLE public.analysis_profile_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own analysis profile templates" ON public.analysis_profile_templates;
CREATE POLICY "Users can view their own analysis profile templates"
ON public.analysis_profile_templates FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own analysis profile templates" ON public.analysis_profile_templates;
CREATE POLICY "Users can insert their own analysis profile templates"
ON public.analysis_profile_templates FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own analysis profile templates" ON public.analysis_profile_templates;
CREATE POLICY "Users can update their own analysis profile templates"
ON public.analysis_profile_templates FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own analysis profile templates" ON public.analysis_profile_templates;
CREATE POLICY "Users can delete their own analysis profile templates"
ON public.analysis_profile_templates FOR DELETE TO authenticated
USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_analysis_profile_templates_updated_at ON public.analysis_profile_templates;
CREATE TRIGGER trg_analysis_profile_templates_updated_at
BEFORE UPDATE ON public.analysis_profile_templates
FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

REVOKE ALL ON public.analysis_profile_templates FROM PUBLIC;
REVOKE ALL ON public.analysis_profile_templates FROM anon;
REVOKE ALL ON public.analysis_profile_templates FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_profile_templates TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_client_analysis_profile_v2(
  p_client_id TEXT,
  p_vertical TEXT,
  p_subsegment TEXT,
  p_primary_objective TEXT,
  p_primary_conversion_metric TEXT,
  p_secondary_metrics JSONB,
  p_performance_goals JSONB,
  p_primary_channel TEXT,
  p_budget_period TEXT,
  p_planned_budget NUMERIC,
  p_budget_platform TEXT DEFAULT 'meta',
  p_analysis_enabled BOOLEAN DEFAULT true,
  p_custom_vertical TEXT DEFAULT NULL,
  p_custom_subsegment TEXT DEFAULT NULL,
  p_legacy_business_model TEXT DEFAULT NULL
)
RETURNS public.client_analysis_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_metrics JSONB := '[]'::jsonb;
  v_goals JSONB := COALESCE(p_performance_goals, '[]'::jsonb);
  v_profile public.client_analysis_profiles;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.client_identity ci
    WHERE ci.user_id = v_user_id AND ci.client_id = p_client_id AND ci.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Client not found or archived' USING ERRCODE = '42501';
  END IF;
  IF p_primary_objective IS NOT NULL
    AND p_primary_objective NOT IN ('whatsapp_messages', 'leads', 'registrations', 'sales', 'website_sales') THEN
    RAISE EXCEPTION 'primary_objective is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_budget_period NOT IN ('daily', 'weekly', 'monthly') OR p_budget_platform NOT IN ('meta', 'google', 'youtube', 'tiktok') THEN
    RAISE EXCEPTION 'budget configuration is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_planned_budget IS NOT NULL AND p_planned_budget < 0 THEN
    RAISE EXCEPTION 'planned_budget must be greater than or equal to zero' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_secondary_metrics, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(v_goals) <> 'array' THEN
    RAISE EXCEPTION 'metrics and goals must be arrays' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_allowed_performance_metric(p_primary_conversion_metric) THEN
    RAISE EXCEPTION 'primary metric is invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_goals) goal
    WHERE NOT public.is_allowed_performance_metric(goal ->> 'metricId')
      OR COALESCE(goal ->> 'expectationType', '') NOT IN ('maximum', 'minimum', 'range', 'quantity_minimum')
  ) THEN
    RAISE EXCEPTION 'performance goal is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(metric_id ORDER BY metric_id), '[]'::jsonb)
  INTO v_metrics
  FROM (
    SELECT DISTINCT metric_id
    FROM jsonb_array_elements_text(COALESCE(p_secondary_metrics, '[]'::jsonb)) metrics(metric_id)
    WHERE public.is_allowed_performance_metric(metric_id)
  ) allowed_metrics;

  INSERT INTO public.client_analysis_profiles (
    user_id, client_id, vertical, subsegment, custom_vertical, custom_subsegment,
    business_model, primary_objective, primary_conversion_metric, secondary_metrics,
    performance_goals, primary_channel, budget_period, planned_budget, budget_platform,
    analysis_enabled
  ) VALUES (
    v_user_id, btrim(p_client_id), COALESCE(NULLIF(btrim(p_vertical), ''), 'Outros'),
    COALESCE(NULLIF(btrim(p_subsegment), ''), 'Outros'),
    NULLIF(btrim(COALESCE(p_custom_vertical, '')), ''),
    NULLIF(btrim(COALESCE(p_custom_subsegment, '')), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_legacy_business_model, '')), ''), p_primary_objective, 'configuração pendente'),
    p_primary_objective, p_primary_conversion_metric, v_metrics, v_goals,
    COALESCE(NULLIF(btrim(p_primary_channel), ''), 'Misto'), p_budget_period,
    p_planned_budget, p_budget_platform, COALESCE(p_analysis_enabled, true)
  )
  ON CONFLICT (user_id, client_id) DO UPDATE SET
    vertical = EXCLUDED.vertical,
    subsegment = EXCLUDED.subsegment,
    custom_vertical = EXCLUDED.custom_vertical,
    custom_subsegment = EXCLUDED.custom_subsegment,
    primary_objective = EXCLUDED.primary_objective,
    primary_conversion_metric = EXCLUDED.primary_conversion_metric,
    secondary_metrics = EXCLUDED.secondary_metrics,
    performance_goals = EXCLUDED.performance_goals,
    primary_channel = EXCLUDED.primary_channel,
    budget_period = EXCLUDED.budget_period,
    planned_budget = EXCLUDED.planned_budget,
    budget_platform = EXCLUDED.budget_platform,
    analysis_enabled = EXCLUDED.analysis_enabled,
    updated_at = now()
  RETURNING * INTO v_profile;
  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_client_analysis_profile_v2(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_client_analysis_profile_v2(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_client_analysis_profile_v2(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_analysis_profile_template(
  p_template_id UUID,
  p_name TEXT,
  p_vertical TEXT,
  p_subsegment TEXT,
  p_primary_objective TEXT,
  p_selected_metrics JSONB,
  p_target_defaults JSONB,
  p_budget_period_default TEXT DEFAULT 'monthly',
  p_budget_platform_default TEXT DEFAULT 'meta'
)
RETURNS public.analysis_profile_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_template public.analysis_profile_templates;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Template name is required' USING ERRCODE = '22023';
  END IF;
  IF p_primary_objective NOT IN ('whatsapp_messages', 'leads', 'registrations', 'sales', 'website_sales')
    OR p_budget_period_default NOT IN ('daily', 'weekly', 'monthly')
    OR p_budget_platform_default NOT IN ('meta', 'google', 'youtube', 'tiktok')
    OR jsonb_typeof(COALESCE(p_selected_metrics, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_target_defaults, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Template configuration is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.analysis_profile_templates (
    id, user_id, name, vertical, subsegment, primary_objective, selected_metrics,
    target_defaults, budget_period_default, budget_platform_default
  ) VALUES (
    COALESCE(p_template_id, gen_random_uuid()), v_user_id, btrim(p_name),
    COALESCE(NULLIF(btrim(p_vertical), ''), 'Outros'),
    COALESCE(NULLIF(btrim(p_subsegment), ''), 'Outros'), p_primary_objective,
    COALESCE(p_selected_metrics, '[]'::jsonb), COALESCE(p_target_defaults, '[]'::jsonb),
    p_budget_period_default, p_budget_platform_default
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    vertical = EXCLUDED.vertical,
    subsegment = EXCLUDED.subsegment,
    primary_objective = EXCLUDED.primary_objective,
    selected_metrics = EXCLUDED.selected_metrics,
    target_defaults = EXCLUDED.target_defaults,
    budget_period_default = EXCLUDED.budget_period_default,
    budget_platform_default = EXCLUDED.budget_platform_default,
    archived_at = NULL,
    updated_at = now()
  WHERE analysis_profile_templates.user_id = v_user_id
  RETURNING * INTO v_template;
  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'Template not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_template;
END;
$$;

REVOKE ALL ON FUNCTION public.save_analysis_profile_template(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_analysis_profile_template(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_analysis_profile_template(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.duplicate_analysis_profile_template(p_template_id UUID, p_name TEXT DEFAULT NULL)
RETURNS public.analysis_profile_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_copy public.analysis_profile_templates;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.analysis_profile_templates (
    user_id, name, vertical, subsegment, primary_objective, selected_metrics,
    target_defaults, budget_period_default, budget_platform_default
  )
  SELECT user_id, COALESCE(NULLIF(btrim(p_name), ''), name || ' — cópia'), vertical,
    subsegment, primary_objective, selected_metrics, target_defaults,
    budget_period_default, budget_platform_default
  FROM public.analysis_profile_templates
  WHERE id = p_template_id AND user_id = v_user_id AND archived_at IS NULL
  RETURNING * INTO v_copy;
  IF v_copy.id IS NULL THEN RAISE EXCEPTION 'Template not found' USING ERRCODE = '42501'; END IF;
  RETURN v_copy;
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_analysis_profile_template(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.duplicate_analysis_profile_template(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.duplicate_analysis_profile_template(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_analysis_profile_template(p_template_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  UPDATE public.analysis_profile_templates SET archived_at = now(), updated_at = now()
  WHERE id = p_template_id AND user_id = v_user_id AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found' USING ERRCODE = '42501'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_analysis_profile_template(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_analysis_profile_template(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_analysis_profile_template(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_analysis_profile_template(p_template_id UUID, p_client_id TEXT)
RETURNS public.client_analysis_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_template public.analysis_profile_templates;
  v_profile public.client_analysis_profiles;
  v_primary_metric TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_template FROM public.analysis_profile_templates
  WHERE id = p_template_id AND user_id = v_user_id AND archived_at IS NULL;
  IF v_template.id IS NULL THEN RAISE EXCEPTION 'Template not found' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_identity WHERE user_id = v_user_id AND client_id = p_client_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = '42501';
  END IF;
  v_primary_metric := CASE v_template.primary_objective
    WHEN 'whatsapp_messages' THEN 'messaging_conversations_started_total'
    WHEN 'leads' THEN 'leads'
    WHEN 'registrations' THEN 'registrations'
    ELSE 'purchases'
  END;
  INSERT INTO public.client_analysis_profiles (
    user_id, client_id, vertical, subsegment, business_model, primary_objective,
    primary_conversion_metric, secondary_metrics, performance_goals, primary_channel,
    budget_period, budget_platform, analysis_enabled
  ) VALUES (
    v_user_id, p_client_id, v_template.vertical, v_template.subsegment,
    v_template.primary_objective, v_template.primary_objective, v_primary_metric,
    v_template.selected_metrics, v_template.target_defaults, 'Misto',
    v_template.budget_period_default, v_template.budget_platform_default, true
  )
  ON CONFLICT (user_id, client_id) DO UPDATE SET
    vertical = EXCLUDED.vertical,
    subsegment = EXCLUDED.subsegment,
    primary_objective = EXCLUDED.primary_objective,
    primary_conversion_metric = EXCLUDED.primary_conversion_metric,
    secondary_metrics = EXCLUDED.secondary_metrics,
    performance_goals = EXCLUDED.performance_goals,
    budget_period = EXCLUDED.budget_period,
    budget_platform = EXCLUDED.budget_platform,
    updated_at = now()
  RETURNING * INTO v_profile;
  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_analysis_profile_template(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_analysis_profile_template(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_analysis_profile_template(UUID, TEXT) TO authenticated;

COMMIT;
