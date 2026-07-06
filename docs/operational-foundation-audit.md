# Auditoria operacional CAMPLY — base funcional

Branch: `fix/camply-operational-foundation`
Data: 2026-07-06

## 1. Telas que ainda usam workspace local para performance

- `src/components/TodayView.tsx`: legado; usa `data.campaigns`, `syncClientMeta`, `buildClientMetaAnalytics` e dashboards locais. Mantido apenas mapeado/arquivado, não como fonte oficial.
- `src/components/CampaignsView.tsx`: usa `data.campaigns` apenas para quadro operacional interno; a performance oficial aparece via `MetaOperationalWorkspace`.
- `src/components/CreativeCriticView.tsx`: ainda seleciona campanhas locais para crítica criativa, não deve ser tratado como performance oficial.
- `src/components/IntelligenceView.tsx` e `ActivityView.tsx`: usam workspace para operação/atividade, não para métrica oficial.

Correção desta rodada: `ClientAnalyticsView` deixou de usar `data.campaigns` e score local para performance.

## 2. Telas/camadas que usam RPCs ou Edge Functions analíticas

- `OverviewView` usa `loadAnalyticsCapabilities` + `loadGlobalPerformanceDashboard`.
- `ClientAnalyticsView` agora usa `loadAnalyticsCapabilities` + `loadGlobalPerformanceDashboard`.
- `MetaOperationalWorkspace` usa `meta-client-catalog`, `meta-client-assets`, `meta-sync-ads`, `meta-hierarchy` via serviços.
- `ReconciliationModal` consulta `meta_normalized_metrics`, `meta_raw_snapshots` e `meta_campaign_entities` por `sync_run_id`.
- Serviços principais:
  - `src/lib/performance/globalPerformanceDashboard.ts`
  - `src/lib/meta/clientMetaAssetService.ts`
  - `src/lib/meta/performanceHierarchyService.ts`
  - `src/lib/meta/metaSyncService.ts`

## 3. Onde cliente é relacionado com conta Meta

- Banco/RPC: `public.client_meta_assets` e `public.link_client_meta_asset` em `supabase/migrations/20260627000015_multiclient_performance_foundation.sql`.
- Front/Edge: `src/lib/meta/clientMetaAssetService.ts` chama `meta-client-catalog` e `meta-client-assets`.
- UI: `MetaOperationalWorkspace` vincula/desvincula contas sem misturar com `CamplyData.campaigns`.

## 4. Onde segmento/subsegmento é calculado

- Perfil oficial: `client_analysis_profiles`, lido por `src/lib/analysis/clientAnalysisProfile.ts`.
- Resolver criado nesta rodada: `src/lib/analysis/clientProfileResolver.ts`.
- Ordem do resolver: perfil oficial, segmento manual do cliente, nome da conta Meta, nome de campanha, classificador por palavra-chave, pendência.
- Central de segmento: `src/components/performance/SegmentDecisionOverview.tsx`.

## 5. Onde score de saúde é calculado

- Fonte oficial: `src/lib/performance/performanceScore.ts`, aplicado em `enrichGlobalPerformanceDashboard`.
- UI oficial: `PerformanceScoreBadge`.
- Correção desta rodada: `ClientAnalyticsView` não usa mais `HealthScoreGauge` com score local/falso.

## 6. Onde o save remoto falha

- `src/data/supabaseStore.ts`, função `saveRemoteDataNow`.
- RPC usada: `save_camply_workspace_with_client_registry`.
- Erro exposto ao usuário em `src/App.tsx` pelo estado `syncError`.

## 7. Onde `remoteVersion` é definido

- `src/data/supabaseStore.ts`:
  - inicial/reset: `resetRemoteWorkspaceState`.
  - leitura: `loadRemoteData`.
  - gravação: `saveRemoteDataNow`.
- Corrigido para resetar em falha e validar `Number.isFinite`.

## 8. Onde `OverviewView` ignora props

- Antes: contrato tinha `insights`/`updateData`, mas o componente não usava.
- Corrigido: `OverviewView` agora recebe e usa `insights` para alertas calculados e `updateData` para concluir tarefa/resolver alerta.

## 9. Funcionalidades úteis ainda em `TodayView`

Mapeadas em `docs/archive/today-view-feature-map.md`:

- criação rápida de tarefas;
- toggle de conclusão;
- ações de alertas;
- cards operacionais;
- sync Meta legado;
- dashboard por cliente/período legado.

`TodayView` não foi removido.

## 10. Edge Functions existentes

- analytics-dashboard
- claude-proxy
- cost-alert-engine
- meta-client-assets
- meta-client-catalog
- meta-creative-critic
- meta-disconnect
- meta-fetch-creatives
- meta-hierarchy
- meta-list-assets
- meta-oauth-callback
- meta-oauth-start
- meta-sync-ads
- meta-sync-campaigns
- meta-validate-token

## 11. Edge Functions configuradas em `supabase/config.toml`

Todas as funções acima estão configuradas. `meta-oauth-callback` permanece `verify_jwt = false` por ser callback OAuth público. As demais estão com `verify_jwt = true`.

## 12. Constraints em `meta_sync_runs`

Migrations relevantes:

- criação inicial: `20260627000002_meta_analytics_storage.sql`.
- `run_scope_check` legado inicial aceitava poucos valores.
- `20260627000017_meta_ad_creative_storage.sql` já ampliou escopos.
- nova migration defensiva desta rodada: `20260704000001_fix_meta_sync_run_scope_check.sql`, aceitando `full_account`, `selected_campaigns`, `selected_adsets`, `selected_ads`, `selected_creatives`, `selected_entities`.

## 13. RPCs para dashboard, hierarchy, client assets e analytics

- Dashboard/capabilities:
  - `get_analytics_capabilities`
  - `get_global_performance_dashboard`
  - `get_global_performance_dashboard_v2`
- Hierarquia:
  - `get_meta_performance_hierarchy`
  - `get_traceable_entity_metrics`
- Client assets:
  - `get_client_meta_asset_catalog`
  - `link_client_meta_asset`
  - `unlink_client_meta_asset`
- Metas/performance:
  - `set_client_performance_target`
  - `set_client_performance_target_v2`
  - `close_client_performance_target`
  - `get_client_performance_target_history`
  - `upsert_client_analysis_profile`
- Sync:
  - `persist_meta_sync_run`
  - `consume_meta_oauth_state`

## 14. `vercel.json`

Existe `vercel.json` com rewrite SPA para `/index.html`.

## 15. `.env` versionado ou referências sensíveis

- `git log --all -- .env.production .env.vercel .env .env.local` encontra um `.env` antigo de 1 byte, removido depois.
- `git grep` não encontrou `VERCEL_OIDC_TOKEN`.
- Scan local encontrou apenas exemplos/fakes em `supabase/secrets.example` e `scripts/validate-meta-e2e-once.sh`.
- Nenhum `.env` novo foi criado nesta rodada.

## Decisão arquitetural aplicada

Performance Meta oficial deve fluir por:

Cliente → client_meta_assets → meta_sync_runs → meta_raw_snapshots/meta_normalized_metrics → client_analysis_profiles/metas → dashboard/hierarchy/analytics.

Workspace local fica para operação interna do CRM, não para performance oficial Meta.
