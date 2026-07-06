-- scripts/diagnose-analytics-chain.sql

-- Diagnóstico objetivo da cadeia SQL de Analytics
-- Objetivo: Identificar exatamente em qual etapa um cliente está sendo perdido no dashboard.

WITH active_clients AS (
  SELECT 
    ci.client_id, 
    ci.user_id as identity_user_id,
    ci.display_name
  FROM public.client_identity ci
  WHERE ci.archived_at IS NULL
),
client_profiles AS (
  SELECT 
    cp.client_id, 
    true as has_profile 
  FROM public.client_analysis_profiles cp
),
meta_links AS (
  SELECT 
    cma.client_id, 
    cma.user_id as cma_user_id,
    cma.meta_asset_id,
    cma.unlinked_at,
    ma.integration_id,
    mi.user_id as integration_user_id
  FROM public.client_meta_assets cma
  LEFT JOIN public.meta_assets ma ON cma.meta_asset_id = ma.id
  LEFT JOIN public.meta_integrations mi ON ma.integration_id = mi.id
),
sync_history AS (
  SELECT 
    msr.ad_account_id,
    msr.id as latest_run_id,
    msr.requested_period,
    msr.run_scope,
    msr.requested_level,
    msr.status as latest_status
  FROM public.meta_sync_runs msr
  -- Assumindo que queremos o mais recente por ad_account_id (simplificado para o último id)
  WHERE msr.id IN (
    SELECT MAX(id) FROM public.meta_sync_runs GROUP BY ad_account_id
  )
),
metrics_summary AS (
  SELECT 
    mnm.sync_run_id,
    bool_or(mnm.source_level = 'account') as has_account_metric,
    bool_or(mnm.source_level = 'campaign') as has_campaign_metric,
    bool_or(mnm.source_level = 'adset') as has_adset_metric,
    bool_or(mnm.source_level = 'ad') as has_ad_metric
  FROM public.meta_normalized_metrics mnm
  GROUP BY mnm.sync_run_id
)
SELECT 
  ac.client_id,
  ac.display_name,
  true as exists_in_client_identity,
  COALESCE(cp.has_profile, false) as has_client_analysis_profile,
  ml.meta_asset_id IS NOT NULL as has_client_meta_asset,
  ml.unlinked_at IS NULL as is_cma_active,
  (ml.cma_user_id = ac.identity_user_id) as cma_user_id_matches,
  ml.integration_id IS NOT NULL as meta_asset_exists,
  (ml.integration_user_id = ac.identity_user_id) as integration_user_id_matches,
  sh.latest_run_id IS NOT NULL as has_meta_sync_run,
  sh.latest_run_id,
  sh.requested_period,
  sh.run_scope,
  sh.requested_level,
  sh.latest_status as run_status,
  COALESCE(ms.has_account_metric, false) as has_account_metric,
  COALESCE(ms.has_campaign_metric, false) as has_campaign_metric,
  CASE
    WHEN ml.meta_asset_id IS NULL THEN 'Sem client_meta_assets (nunca vinculado)'
    WHEN ml.unlinked_at IS NOT NULL THEN 'client_meta_assets pausado (unlinked_at != null)'
    WHEN NOT (ml.cma_user_id = ac.identity_user_id) THEN 'Divergência de user_id no client_meta_assets'
    WHEN ml.integration_id IS NULL THEN 'meta_asset inexistente (órfão)'
    WHEN NOT (ml.integration_user_id = ac.identity_user_id) THEN 'Integração pertence a outro user_id'
    WHEN sh.latest_run_id IS NULL THEN 'Nunca sincronizado (sem meta_sync_runs)'
    WHEN ms.sync_run_id IS NULL THEN 'Sync concluído mas sem métricas normalizadas (meta_normalized_metrics)'
    WHEN NOT COALESCE(ms.has_account_metric, false) THEN 'Tem métricas de nível inferior mas não de account (Pode ser bloqueado pelo Dashboard V2 antigo)'
    ELSE 'Pronto. Deveria ler no Dashboard.'
  END as missing_reason
FROM active_clients ac
LEFT JOIN client_profiles cp ON ac.client_id = cp.client_id
LEFT JOIN meta_links ml ON ac.client_id = ml.client_id
LEFT JOIN sync_history sh ON ml.meta_asset_id = sh.ad_account_id
LEFT JOIN metrics_summary ms ON sh.latest_run_id = ms.sync_run_id;
