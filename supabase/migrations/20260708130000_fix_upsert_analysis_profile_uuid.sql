-- Fix upsert_client_analysis_profile uuid comparison
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
  p_attribution_delay_hours INTEGER DEFAULT 24,
  p_operation_type TEXT DEFAULT NULL,
  p_sales_models TEXT[] DEFAULT '{}'::text[],
  p_secondary_channel TEXT DEFAULT NULL,
  p_secondary_conversion_metric TEXT DEFAULT NULL
)
RETURNS public.client_analysis_profiles
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile public.client_analysis_profiles;
BEGIN
  -- Validar acesso do usuário
  IF NOT EXISTS (
    SELECT 1 FROM public.camply_workspace 
    WHERE id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  -- Validar vínculo do cliente com o usuário logado
  IF NOT EXISTS (
    SELECT 1 FROM public.client_identity 
    WHERE id = p_client_id::uuid AND workspace_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado ou não pertence ao usuário logado';
  END IF;

  -- Tenta atualizar o registro existente
  UPDATE public.client_analysis_profiles SET
    vertical = p_vertical,
    subsegment = p_subsegment,
    custom_vertical = p_custom_vertical,
    custom_subsegment = p_custom_subsegment,
    business_model = p_business_model,
    primary_conversion_metric = p_primary_conversion_metric,
    secondary_metrics = p_secondary_metrics,
    primary_channel = p_primary_channel,
    budget_period = p_budget_period,
    planned_budget = p_planned_budget,
    minimum_evaluation_spend = p_minimum_evaluation_spend,
    minimum_impressions = p_minimum_impressions,
    minimum_results = p_minimum_results,
    attribution_delay_hours = p_attribution_delay_hours,
    analysis_enabled = p_analysis_enabled,
    operation_type = p_operation_type,
    sales_models = p_sales_models,
    secondary_channel = p_secondary_channel,
    secondary_conversion_metric = p_secondary_conversion_metric
  WHERE client_id = p_client_id::uuid
  RETURNING * INTO v_profile;

  -- Se não atualizou nada, significa que não existe, então insere
  IF NOT FOUND THEN
    INSERT INTO public.client_analysis_profiles (
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
      analysis_enabled,
      operation_type,
      sales_models,
      secondary_channel,
      secondary_conversion_metric
    ) VALUES (
      p_client_id::uuid,
      p_vertical,
      p_subsegment,
      p_custom_vertical,
      p_custom_subsegment,
      p_business_model,
      p_primary_conversion_metric,
      p_secondary_metrics,
      p_primary_channel,
      p_budget_period,
      p_planned_budget,
      p_minimum_evaluation_spend,
      p_minimum_impressions,
      p_minimum_results,
      p_attribution_delay_hours,
      p_analysis_enabled,
      p_operation_type,
      p_sales_models,
      p_secondary_channel,
      p_secondary_conversion_metric
    )
    RETURNING * INTO v_profile;
  END IF;

  RETURN v_profile;
END;
$$;
