BEGIN;

-- A sincronização completa da conta coleta a mesma fonte mensal oficial em
-- source_level='account', mas persiste requested_level='creative' para manter
-- o drill-down de anúncios/criativos disponível. O dashboard mensal não pode
-- ignorar esses runs completos; caso contrário a UI parece "não salvar" após
-- uma sincronização completa.
DO $$
DECLARE
  v_function_sql TEXT;
BEGIN
  SELECT pg_get_functiondef('public.get_global_performance_dashboard_v2(text,text[],uuid[])'::regprocedure)
  INTO v_function_sql;

  IF v_function_sql IS NULL THEN
    RAISE EXCEPTION 'get_global_performance_dashboard_v2(text,text[],uuid[]) not found';
  END IF;

  v_function_sql := replace(
    v_function_sql,
    'AND r.requested_level = ''campaign''',
    'AND r.requested_level IN (''campaign'', ''adset'', ''ad'', ''creative'')'
  );

  EXECUTE v_function_sql;
END;
$$;

REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_global_performance_dashboard_v2(TEXT, TEXT[], UUID[]) TO authenticated;

COMMIT;
