# Entrega 1 — Auditoria do contrato analítico

Data da auditoria: 2026-06-30  
Branch: `refactor/meta-analytics-engine`  
SHA inicial: `8687d0ae52b222c86b22b11ad0a8952d6176831e`

## Fluxo atual da Visão geral

| Responsabilidade | Arquivo | Função/componente |
| --- | --- | --- |
| Roteamento da categoria `today` | `src/App.tsx` | `App` renderiza `OverviewView` |
| Tela analítica principal | `src/components/OverviewView.tsx` | `OverviewView` |
| Carregamento do dashboard | `src/lib/performance/globalPerformanceDashboard.ts` | `loadGlobalPerformanceDashboard` |
| RPC consumida | `src/lib/performance/globalPerformanceDashboard.ts` | `get_global_performance_dashboard` |
| RPC vigente | `supabase/migrations/20260630000018_global_dashboard_contract.sql` | `public.get_global_performance_dashboard` |
| Primeira versão da RPC | `supabase/migrations/20260627000015_multiclient_performance_foundation.sql` | `public.get_global_performance_dashboard` |
| Fallback operacional | `src/components/OverviewView.tsx` | `TodayView` quando a RPC falha |

Antes desta entrega, o frontend não possuía um contrato explícito de capacidade. A disponibilidade da nova central era inferida por uma tentativa de chamada à RPC e por comparação textual da mensagem de erro. O contrato do dashboard também não identificava sua versão e os objetos de métrica carregavam somente valor, disponibilidade e completude.

## Dependências do legado

### Vínculo direto à conta Meta no workspace

- `src/types.ts`: `Client.metaAdAccountId` e `Client.metaAdAccountName`.
- `src/lib/meta/metaSyncService.ts`: usa `client.metaAdAccountId` para iniciar sync.
- `src/components/TodayView.tsx`: decide se oferece sync usando `client.metaAdAccountId`.
- `src/components/ClientsView.tsx`: persiste a seleção no workspace.

O identificador continua necessário temporariamente para compatibilidade operacional, mas não deve ser fonte de autorização nem vínculo analítico. O vínculo oficial é `public.client_meta_assets`.

### Persistência de campanhas e métricas no workspace

- `src/lib/meta/applyMetaSyncToWorkspace.ts`: copia campanhas, Ad Sets, anúncios e métricas do payload da Edge Function para `CamplyData`.
- `src/lib/meta/metaSyncMapper.ts`: converte o contrato analítico em `Campaign` operacional.
- `src/lib/meta/clientAnalytics.ts`: lê `globalMetricsByPeriod`, `attributionGroupsByPeriod` e métricas de anúncio do workspace.
- `src/components/ClientsView.tsx`: usa `buildClientMetaAnalytics`.
- `src/components/TodayView.tsx`: usa `buildClientMetaAnalytics`, `buildSnapshot` e métricas legadas.
- `src/components/CampaignsView.tsx`: lê `globalMetricsByPeriod`, `normalizedMetricsByPeriod` e `metricsByPeriod`.
- `src/components/MetaIntegrationView.tsx`: importa o payload sincronizado para o workspace.
- `src/data/camplyStore.ts`: salva todo o workspace no `localStorage`.

### Componentes analíticos ainda acoplados ao workspace

- `src/components/meta/CampaignObjectiveBlocks.tsx` é usado por `TodayView` e `CampaignsView` e recebe `Campaign` do workspace.
- `src/components/meta/ReconciliationModal.tsx` consulta tabelas analíticas, mas é aberto a partir da campanha local e depende do `syncRunId` copiado para o workspace.

## Telas que ainda dependem da estrutura antiga

1. `TodayView`: fallback completo, sync manual e blocos de performance locais.
2. `ClientsView`: totais, melhor campanha e melhor grupo calculados do workspace.
3. `CampaignsView`: métricas e grupos armazenados em `Campaign`.
4. `MetaIntegrationView`: lista e importa campanhas sincronizadas para o CRM.
5. `CreativeCriticView`: usa um fluxo paralelo de leitura de criativos e métricas.

`OverviewView` já usa a RPC normalizada como fonte principal, mas seu fallback ainda não era identificado como modo legado e não havia negociação de versão.

## Períodos e níveis

### Frontend

- Visão geral: `today`, `last_7d`, `last_30d`.
- Sync padrão disparado pelo frontend: somente `last_7d`, pois `periods` não é enviado.
- `TodayView` legado mantém períodos adicionais vindos do workspace.

### Backend

- Períodos aceitos pela Edge Function: `today`, `yesterday`, `this_month`, `last_month`, `this_quarter`, `maximum`, `last_3d`, `last_7d`, `last_14d`, `last_28d`, `last_30d`, `last_90d`, `this_year`, `last_year`.
- Períodos suportados pela RPC do dashboard: `today`, `last_7d`, `last_30d`.
- Níveis aceitos pelo sync: `campaign`, `adset`, `ad`, `creative`.
- Níveis expostos inicialmente pelo contrato de dashboard: `campaign`, `adset`, `ad`.

## Gaps entre banco e interface

1. Não existia negociação de capacidade ou versão antes de abrir a nova central.
2. Métricas não carregavam metadados suficientes para explicar origem, período, run, timezone e atribuição.
3. O frontend ainda possui duas fontes analíticas: RPC normalizada e workspace.
4. `client_meta_assets` e metas de performance existem no banco, mas o vínculo/configuração ainda não está completamente exposto pela interface.
5. O dashboard oferece períodos que o fluxo padrão de sync não coleta.
6. Ad Sets, anúncios e criativos persistidos ainda não são lidos progressivamente pela nova central.
7. O fallback anterior podia parecer uma continuação da nova central, sem rótulo explícito de compatibilidade.

## Riscos

- Decisões tomadas com números de runs diferentes entre telas.
- Ausência interpretada como zero por consumidores legados.
- Dificuldade de conciliação por falta de proveniência por métrica.
- Ativação prematura da interface quando a migration ainda não existe.
- Regressão de navegação se o legado for removido de uma vez.

## Remoção gradual do legado

1. **Entrega 1:** negociar capacidades, introduzir dashboard v2 rastreável e rotular o fallback como `Modo de compatibilidade`.
2. **Entrega 2:** mover conciliação para contratos normalizados independentes do workspace.
3. **Entrega 3:** substituir os blocos analíticos de `TodayView`/`ClientsView` pela central baseada em RPC.
4. **Entrega 4:** expor vínculos e metas versionadas sem escrita direta em tabelas.
5. **Entrega 5:** carregar campanha, Ad Set, anúncio e criativo sob demanda a partir do banco.
6. Depois de equivalência funcional comprovada, remover de `Campaign` os campos analíticos deprecated, interromper `applyMetaSyncToWorkspace` para entidades Meta e migrar/limpar apenas o cache local, sem excluir o histórico normalizado.

O workspace permanece fonte oficial somente para clientes operacionais, tarefas, projetos, recebíveis, alertas e informações internas.
