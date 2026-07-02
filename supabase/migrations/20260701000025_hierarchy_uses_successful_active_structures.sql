BEGIN;

-- A hierarquia operacional não pode usar snapshots parciais como verdade de
-- campanha ativa. Um run parcial pode carregar entidades antigas sem métricas
-- completas e exibir "ACTIVE" para uma estrutura que já não está operando.
--
-- Quando a coleta também trouxe conjuntos, a campanha raiz só é considerada
-- operacionalmente ativa se houver pelo menos um conjunto ativo abaixo dela.
-- Runs campaign-only continuam aceitos como fallback porque não possuem
-- snapshots de conjuntos para validar a estrutura.
DO $$
DECLARE
  v_function_sql TEXT;
BEGIN
  SELECT pg_get_functiondef('public.get_meta_performance_hierarchy(uuid,text,text,text,integer,integer)'::regprocedure)
  INTO v_function_sql;

  IF v_function_sql IS NULL THEN
    RAISE EXCEPTION 'get_meta_performance_hierarchy(uuid,text,text,text,integer,integer) not found';
  END IF;

  v_function_sql := replace(
    v_function_sql,
    'AND r.status IN (''success'', ''partial'')',
    'AND r.status = ''success'''
  );

  v_function_sql := replace(
    v_function_sql,
    'AND COALESCE(NULLIF(upper(s.effective_status), ''''), NULLIF(upper(s.meta_status), ''''), '''') = ''ACTIVE'';',
    'AND COALESCE(NULLIF(upper(s.effective_status), ''''), NULLIF(upper(s.meta_status), ''''), '''') = ''ACTIVE''
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
            AND COALESCE(NULLIF(upper(active_adset.effective_status), ''''), NULLIF(upper(active_adset.meta_status), ''''), '''') = ''ACTIVE''
        )
      );'
  );

  v_function_sql := replace(
    v_function_sql,
    'AND COALESCE(NULLIF(upper(effective_status), ''''), NULLIF(upper(meta_status), ''''), '''') = ''ACTIVE''
      ORDER BY campaign_name OFFSET v_offset LIMIT p_page_size',
    'AND COALESCE(NULLIF(upper(effective_status), ''''), NULLIF(upper(meta_status), ''''), '''') = ''ACTIVE''
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
              AND COALESCE(NULLIF(upper(active_adset.effective_status), ''''), NULLIF(upper(active_adset.meta_status), ''''), '''') = ''ACTIVE''
          )
        )
      ORDER BY campaign_name OFFSET v_offset LIMIT p_page_size'
  );

  IF position('AND r.status IN (''success'', ''partial'')' IN v_function_sql) > 0 THEN
    RAISE EXCEPTION 'Hierarchy function still accepts partial runs';
  END IF;

  IF position('active_adset' IN v_function_sql) = 0 THEN
    RAISE EXCEPTION 'Hierarchy function was not patched with active adset validation';
  END IF;

  EXECUTE v_function_sql;
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

COMMIT;
