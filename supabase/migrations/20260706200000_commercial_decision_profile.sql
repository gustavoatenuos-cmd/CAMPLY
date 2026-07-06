-- Adiciona novas colunas comerciais à tabela client_analysis_profiles
ALTER TABLE public.client_analysis_profiles
  ADD COLUMN IF NOT EXISTS operation_type text NULL,
  ADD COLUMN IF NOT EXISTS sales_models text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS secondary_channel text NULL,
  ADD COLUMN IF NOT EXISTS secondary_conversion_metric text NULL;

-- Atualiza a constraint de array (opcional, apenas garantindo tipo jsonb_typeof caso fosse jsonb, mas é text[])
-- sales_models já é text[] então não precisa de jsonb_typeof.

-- Atualiza a função upsert
CREATE OR REPLACE FUNCTION public.upsert_client_analysis_profile(
  p_client_id text,
  p_vertical text,
  p_subsegment text,
  p_custom_vertical text,
  p_custom_subsegment text,
  p_business_model text,
  p_primary_conversion_metric text,
  p_secondary_metrics text[],
  p_primary_channel text,
  p_budget_period text,
  p_planned_budget numeric,
  p_minimum_evaluation_spend numeric,
  p_minimum_impressions integer,
  p_minimum_results integer,
  p_attribution_delay_hours integer,
  p_analysis_enabled boolean,
  p_operation_type text DEFAULT NULL,
  p_sales_models text[] DEFAULT '{}'::text[],
  p_secondary_channel text DEFAULT NULL,
  p_secondary_conversion_metric text DEFAULT NULL
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
    WHERE id = p_client_id AND workspace_id = auth.uid()
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
  WHERE client_id = p_client_id
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
      p_client_id,
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
