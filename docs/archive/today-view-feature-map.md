# TodayView feature map

Data: 2026-07-04

`TodayView.tsx` não é renderizado diretamente pela rota principal neste momento; a rota `today` usa `OverviewView`. O componente, porém, ainda concentra funcionalidades úteis que não devem ser removidas sem migração explícita.

## Funcionalidades encontradas

| Funcionalidade | Local atual | Destino sugerido |
| --- | --- | --- |
| Criação rápida de tarefa | Modal interno de tarefa | `ProjectsView` ou um modal global de tarefas |
| Lançamento financeiro por tarefa | `addTask` cria `Receivable` quando `hasFinance` está ativo | `PersonalFinanceView` com ação rápida a partir de tarefas |
| Criação automática de campanha | `addTask` cria campanha quando tarefa é de tráfego | `CampaignsView`, mantendo confirmação explícita |
| Criação automática de projeto | `addTask` cria projeto quando tarefa é de site | `ProjectsView` |
| Toggle de tarefa | `toggleTask` marca/reabre tarefa com activity log | `ProjectsView` ou widget operacional no `OverviewView` |
| Ações de alerta | Blocos expansíveis resolvem alertas e concluem tarefas | `AlertCenterView` e seção operacional do `OverviewView` |
| Cards operacionais | Atrasados, urgentes, parados, atenção | `OverviewView` como resumo de operação |
| Sync Meta por cliente | `handleSyncClient` usa fluxo legado `syncClientMeta` | `MetaOperationalWorkspace`, pois o sync oficial já separa conta, período e hierarquia |
| Dashboard por cliente | `buildClientMetaAnalytics`/`buildSnapshot` | Contrato analítico oficial e `ClientAnalyticsView` |

## Decisão desta rodada

- Não remover `TodayView`.
- Não mover sync Meta legado para o dashboard.
- Migrar apenas o mínimo seguro para `OverviewView`: insights calculados, tarefas abertas e ações rápidas.
- Manter a remoção/arquivamento definitivo para uma etapa posterior, depois de validar que nenhuma função operacional ficou sem destino.
