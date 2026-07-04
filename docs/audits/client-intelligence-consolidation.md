# Auditoria de consolidação da inteligência de clientes

Data: 2026-07-04  
Base auditada: `origin/main` em `edc4a976db7d8ba97dff94dbc5fb3e5ea84290ad`

## Estado e divergência

O `main` adicionou `ClientAnalyticsView`, `AlertCenterView`, `ClientCategory`, `ClientBenchmarks`, `metricsSelector`, `budget_alerts`, `cost_thresholds` e `cost-alert-engine`. Essa linha calcula métricas, score e alertas no navegador a partir de `CamplyData.campaigns` e mantém categorias no JSON de `camply_workspace`.

A branch `codex/profile-budget-control`, em `03d3612b19de1ffc70db26bf4d3eb6a9dbd83174`, adicionou objetivos, metas configuráveis, orçamento por período, templates e `client_analysis_profiles`. Ela partiu de `08bdc4e` e remove arquivos analíticos que foram adicionados posteriormente ao `main`; por isso o commit não é isolado e não pode ser aplicado integralmente sem regressão.

## Fluxos encontrados

| Área | Fonte atual | Problema | Fonte consolidada |
|---|---|---|---|
| CRM/projetos | `camply_workspace.data` e cache do navegador | JSON e autosave concorrem com gravações explícitas | RPC transacional + tabelas normalizadas; workspace apenas compatibilidade |
| Perfil | `client_analysis_profiles` e campos paralelos em `Client` | categoria/benchmark e perfil competem | `client_analysis_profiles` |
| Metas | `ClientBenchmarks`, `cost_thresholds` e metas de perfil | IDs e semânticas incompatíveis | `client_performance_targets` versionada |
| Métricas Meta | `data.campaigns`, snapshots e métricas normalizadas | telas novas usam o legado | último `meta_sync_runs` qualificado + `meta_normalized_metrics` |
| Analytics | cálculo no React | score, tendência e totais não rastreáveis | `get_client_intelligence_dashboard_v1` via serviço tipado |
| Alertas | derivados no React + `budget_alerts` | duplicação e resolução incorreta | alertas persistidos e reavaliados no backend |
| IA | `CamplyData` legado | contexto incompleto e score inventado | `ClientIntelligenceAIContextDTO` |

## Tabelas e contratos relevantes

- `client_identity`: registro canônico do cliente por usuário; já é alimentado pela gravação versionada do workspace.
- `client_meta_assets`: vínculo do cliente à conta Meta.
- `client_analysis_profiles`: perfil estratégico, orçamento e período.
- `client_performance_targets`: alvos versionados; antes da consolidação exige um asset e não cobre meta no nível do cliente.
- `meta_sync_runs`: tentativas de sincronização; contém status, escopo, nível pedido, intervalo e término.
- `meta_normalized_metrics`: valores normalizados por run, nível, entidade, intervalo, timezone e atribuição.
- `meta_campaign_snapshots`: identidade e estado das campanhas por run.
- `budget_alerts`/`cost_thresholds`: modelo adicionado no `main`, incompleto para ciclo de vida e com unicidade inadequada quando `campaign_id IS NULL`.
- `camply_workspace`: permanece como compatibilidade e origem de backfill, não como fonte analítica nova.

## Campos e nomes duplicados

- `Client.category`/`ClientBenchmarks` versus `vertical`, `subsegment`, `primary_objective` e metas.
- `monthlyBudgetLimit` e `adInvestmentMeta` versus `planned_budget`, `budget_period`, `budget_platform`.
- `spent`, `ctr`, `cpc`, `roas`, `pageViews` versus `spend`, `link_ctr`, `link_cpc`, `purchase_roas`, `landing_page_views`.
- `cpa`, `cpr` e `results` são ambíguos e não podem ser convertidos sem objetivo/evidência.
- `Project.clientId` e `Client.projectId` não representam corretamente um projeto com vários clientes.

## Riscos confirmados

1. O autosave global pode competir com o salvamento explícito do modal e criar conflito de versão.
2. O cache local contém CRM completo; limpar ou alternar navegador produz comportamento divergente.
3. `ClientAnalyticsView` calcula sobre campanhas do workspace e pode exibir campanhas históricas como atuais.
4. O motor atual aceita métricas calculadas pelo chamador, registra erros sem falhar e resolve alertas que continuaram violados porque compara apenas linhas novas.
5. A restrição única de `cost_thresholds` não deduplica corretamente registros com `campaign_id NULL`.
6. Score e estado saudável podem ser exibidos sem run confiável.
7. Moedas podem ser agregadas sem separação.

## Decisões adotadas

1. Supabase normalizado é a fonte oficial; estado React é transitório e armazenamento do navegador fica limitado a preferências/E2E.
2. Um catálogo canônico compartilhado define ID, unidade, direção, objetivos e disponibilidade. Aliases ambíguos retornam contexto insuficiente.
3. Perfil e metas são gravados numa única transação; metas reais são normalizadas e o JSON legado é preservado apenas para leitura/backfill.
4. Runs confiáveis exigem `success`, `full_account`, `campaign`, intervalo válido, término e dados persistidos. A última tentativa é retornada separadamente.
5. Pacing, avaliação e score ficam em funções de domínio/RPC; sem evidência, score é `null`.
6. Alertas usam chaves estáveis, índices parciais por escopo e estados `active`, `acknowledged`, `resolved`; somente regras reavaliadas com dados válidos podem resolver.
7. `project_clients` representa o vínculo oficial; campos do workspace continuam temporariamente como compatibilidade.
8. Nenhuma migration histórica será editada e nenhuma alteração será aplicada ao Supabase de produção nesta entrega.
