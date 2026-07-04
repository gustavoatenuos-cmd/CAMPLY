# Contrato frontend da inteligência de clientes

O frontend acessa o domínio exclusivamente por `src/services/clientIntelligenceService.ts`. Componentes não consultam tabelas nem recalculam score, metas, pacing ou alertas.

## Estados

- `loading`: RPC/readback em andamento.
- `saving`: transação de cliente em andamento; o modal permanece aberto.
- `saved`: RPC e identidade confirmadas; somente então o estado React é atualizado.
- `unavailable`: não existe run completo qualificado ou métrica oficial.
- `insufficient_data`: existe configuração, mas a evidência não permite avaliar.
- `conflict`: versão do workspace mudou; recarregar antes de reenviar.
- `error`: resposta não 2xx ou falha de readback; dados anteriores permanecem.

## Fonte e rastreabilidade

`getClientIntelligenceDashboard(clientId, period)` chama `get_client_intelligence_dashboard_v1`. A RPC deriva do último run `success/full_account/campaign`, preserva a tentativa mais recente separadamente e retorna metas normalizadas, campanhas do mesmo run e alertas persistidos.

Unidades são `currency`, `percentage`, `number` ou `ratio`. Valores indisponíveis são `null`, nunca zero artificial. Moedas diferentes não podem ser somadas.

## Serviços públicos

- `getClientIntelligenceDashboard`
- `listClientIntelligenceOverview`
- `acknowledgeClientAlert`
- `resolveClientAlert`
- `buildClientIntelligenceAIContext`

Metas usam apenas IDs de `src/lib/metrics/metricCatalog.ts`. `cpa`, `cpr` e `results` são aliases ambíguos e exigem contexto antes de migração.

