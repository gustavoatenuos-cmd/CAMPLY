# Analytics por Cliente: Card Board
Refatoração visual da aba Analytics por Cliente, passando do modelo lateral para um dashboard em grid.

## O que foi feito:
- Refatoração do componente `ClientAnalyticsView` para comportar um layout em Grid através do novo `ClientAnalyticsBoard`.
- Implementação dos Cards de clientes (`ClientAnalyticsCard`), mostrando informações de métricas reais da Meta, status, budget e ritmo (pacing).
- Implementação de um Drawer lazy-loaded (`ClientCampaignDrawer`) que exibe a hierarquia de campanhas de forma detalhada apenas quando o card de um cliente é clicado.
- Os scripts temporários com sufixo `.cjs` relatados no feedback foram ignorados da branch (já que esta é uma feature branch limpa e visual apenas).
- Remoção do consumo errôneo de `data.campaigns` na view. Tudo agora utiliza a `EnrichedGlobalClientPerformance` já exposta pelo estado.
- Tipagens e erros de compilação corrigidos:
  - `MetaHierarchyItem`
  - `PerformanceStatusBadge`
  - `deriveCostMetric` (parametros adicionais e mapeamentos).

## Validação e Qualidade:
- **Build (`npm run build`)**: `PASS` (Concluído sem erros de TypeScript)
- **Lint (`npm run lint`)**: `PASS`
- **Git**: Push automático feito para `origin fix/client-analytics-card-board`.

## Próximos Passos recomendados:
- Validar se o comportamento interativo do modal de Campanhas (Drawer) supre a visão de micro-estratégia esperada.
- Adição da persistência do `logoUrl` (pendente no `ClientFormModal` e schema para armazenar visual).
- Efetuar a revisão do Pull Request de `fix/client-analytics-card-board` para a branch principal.
