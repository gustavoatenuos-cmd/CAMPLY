# Contratos de Domínio - CAMPLY

Mapeamento das Fontes de Verdade (Single Source of Truth) atuais vs. desejadas.

| Domínio | Fonte Atual | Fonte Desejada | Problemas/Conflitos Atuais |
| --- | --- | --- | --- |
| **Clientes** | `camplyStore` (JSONB) + `client_identity` | Tabela `clients` relacional | Dados duplicados entre `camply_workspace` e `client_identity`. Atualizações podem ficar dessincronizadas em caso de falha de rede. |
| **Projetos** | `camplyStore` (JSONB) | Tabela `projects` relacional | Vivem atrelados ao JSONB global. Atualizações em projetos conflitam com edições em campanhas no mesmo workspace. |
| **Tarefas** | `camplyStore` (JSONB) | Tabela `tasks` relacional | Vivem atrelados ao JSONB. Status de resolução não reflete nos Alertas de forma confiável. |
| **Campanhas Operacionais** | `camplyStore` (JSONB) | Tabela `operational_campaigns` | Misturadas com dados analíticos. A entidade hoje representa tanto o planejamento manual (nome, etapa, orçamento) quanto dados de mídia. |
| **Campanhas Meta** | Banco Analítico (`client_metric_values`) | Banco Analítico | Hoje a campanha operacional pode sobrescrever ou tentar emular as metas/métricas. Precisam ser estritamente separadas. |
| **Financeiro (Recebíveis)** | `camplyStore` (JSONB) + Configs de Cliente | Tabela `receivables` (fonte oficial) e `billing_agreements` | O recebível sintético gerado a partir de "mensalidade do cliente" entra em conflito com pagamentos efetivados. |
| **Perfil Analítico** | Configs na `Campaign` + `camplyStore` | RPC Atômica + Banco Analítico | Configurações de meta são salvas isoladamente e por vezes em JSONB em vez da estrutura relacional. Risco de client parcialmente salvo. |
| **Alertas/Sinais** | `buildInsights()` + `AgentEngine` + `PerformanceScore` | Motor Único (`OperationalSignal`) | Regras de negócio duplicadas nos componentes (e.g., cálculo de atraso espalhado no UI, heurísticas visuais). |
| **Histórico / Atividades** | `camplyStore` (`activityLogs` truncado em 500) | Tabela `activity_events` (Append Only) | Como está no JSONB, ele cresce infinitamente até o frontend cortar os registros antigos via splice, perdendo histórico real. |

## Definições Inegociáveis
1. **Separação Mídia vs. Operação:** `OperationalCampaign` controla o "o que" e "quem". `MetaCampaignSnapshot` provê as métricas de performance.
2. **Sinais e Evidências:** Alertas não são "textos coloridos". São instâncias de `OperationalSignal` baseadas em métricas, com um Lifecycle rígido (detectado -> resolvido).
3. **Atomicidade no Cadastro:** Clientes nunca devem existir "pela metade". A identidade local e remota formam uma única entidade transacional.
