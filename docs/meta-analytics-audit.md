# Auditoria de Métricas Meta Ads

**Commit Base:** 245cfab4ae04c6ea182ecbf9c08e45f22d652385
**Data:** 2026-06-27

## 1. Fluxo Atual

O fluxo atual é inicializado no frontend por interações em botões nos componentes `TodayView.tsx`, `ClientsView.tsx`, `CampaignsView.tsx` e `MetaIntegrationView.tsx`, que disparam a edge function `meta-sync-ads`.
- A Edge function faz fetch via Graph API (`v25.0`) pedindo dados no nível de Campaign e Insights.
- Os insights são mastigados no frontend, principalmente varrendo o array `actions` das requisições e fazendo `.filter(a => isConversion(a.action_type))` para calcular "Resultados".

## 2. Problemas Encontrados

- **Soma Genérica**: Componentes (ex: `TodayView`) possuem lógicas repetidas que avaliam `action_type.includes('conversion') || action_type.includes('messaging')`.
- **Conversas Infladas**: Não há filtro por `destination_type`, assumindo ingenuamente que qualquer `messaging` é WhatsApp.
- **Duplicidade de Normalização**: Os mesmos `reduce` das actions estão espalhados por 3 a 4 componentes.
- **LastOptimizedAt**: É atualizado com `new Date()` simplesmente por bater no botão Sincronizar, confundindo sync de dados com ação de otimização de campanha.
- **Paginação Incompleta**: O código atual na função `meta-sync-ads` ignora o nó `paging.next`, pegando apenas os primeiros 50 (limite) ou 500 registros, o que causa buracos na coleta.
- **Alcance Falso**: O sistema exibe o rótulo "Alcance" mas apenas popula com a variável de impressões (`impressions`).
- **Nenhum Registro Histórico**: Os payloads da Meta e as métricas não são armazenados em tabelas; são salvos no `camplyStore` (localStorage/Zustand) que tem volatilidade e falta de escalabilidade para relatórios.

## 3. Estrutura Proposta e Arquivos Afetados

- **Banco de Dados (Supabase)**: Migrations para `meta_sync_runs`, `meta_raw_snapshots`, `meta_campaign_entities`, `meta_adset_entities`, `meta_normalized_metrics`, `meta_analysis_alerts`.
- **Cliente API (`supabase/functions/_shared/meta-api.ts`)**: Implementação de Client Paginated com exponential backoff e rate limiting.
- **Serviços Centrais (`src/lib/meta/`)**: `metricRegistry.ts`, `campaignObjectiveClassifier.ts`, `metaNormalizer.ts`, `performanceAnalysisEngine.ts`.
- **UI (`src/components/TodayView.tsx` e outros)**: Remoção das regras de parse. Passam a exibir apenas os dados retornados do `camplyStore` normalizado, seguindo os blocos de Objetivos.

## 4. Estratégia de Migração (Sem zerar a UI)

1. Os campos `results`, `cpr`, `conversations` e `metricsByPeriod` em `Campaign` serão tipados como `legacy`.
2. A UI verificará se a campanha possui `classifiedObjective`. Se não, exibirá um aviso: "Dados anteriores aguardando nova sincronização" mantendo o valor bruto antigo impresso.
3. Após o sync, o fluxo preencherá os novos campos isolados, liberando o bloco de renderização limpo.

## 5. Estratégia de Rollback

1. O deploy da edge function manterá o nome de funções isoladas se necessário, ou utilizará `supabase functions deploy` com versão local pinada no Git. Como não apagaremos os campos antigos das tabelas de estado local (`Campaign` em `types.ts`), um `git revert` imediato seria suficiente para voltar ao estado exato prévio à refatoração, sem quebra de tela.
