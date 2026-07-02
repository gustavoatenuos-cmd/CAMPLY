# Auditoria Sênior Definitiva — Camply Meta Analytics Engine

## 1. Fluxo Completo dos Dados
1. O Frontend despacha uma requisição POST com `adAccountId` e `periods` para `meta-sync-ads`.
2. A Edge Function valida o JWT via Supabase Auth, verifica no DB se a integração pertence ao usuário, está ativa, e se o `asset` de `adaccount` está autorizado.
3. Se autorizado, o backend decripta o token OAuth versionado AES-GCM (tratando chaves e sentinelas nulas).
4. O Deno faz HTTP GET para `graph.facebook.com` coletando campanhas e ad sets paginados.
5. Em loop (com concurrecy limmit e hostname HTTPS verificado), ele consome as páginas respeitando `Retry-After`.
6. A resposta é consolidada: se houver mixed objectives ou attributions, dimensões são separadas (spend no Campaign; conversões no AdSet). O status de completude individual é calculado.
7. É construído um payload DTO validado e repassado para a RPC PL/pgSQL transacional.
8. A RPC insere Snapshots Históricos (Immutable Entities), Raw Snapshots puros, e Métricas Normalizadas em lote. Se falhar no banco, revoga toda inserção analítica do run e registra `failed`.
9. Retorna-se um envelope HTTP padronizado. O Frontend atualiza apenas o estado operacional, buscando do DB os dados analíticos via realtime ou re-fetch.

## 2. Fontes da Verdade
- **Analítico (DB Postgres)**: A única fonte de verdade para Runs, Métricas, Histórico, Snapshots e Entidades. Nunca o Workspace e nunca o LocalStorage.
- **Operacional (Supabase + Workspace Local)**: Guarda as configurações visuais, metadados do agente, clientes criados, prioridades e seleções temporárias. Limite de tamanho de cache.

## 3. Fronteiras de Confiança
- **Frontend** é inseguro: Não envia Run ID, não decide Autorização de Account e não envia query raw para o AI Proxy (apenas flags mapeadas).
- **Edge Functions** são seguras: Validam tudo contra o banco. Limitadas no tempo (timeouts).
- **Meta (Terceiro)**: A API do Meta é tratada como não-confiável e não-determinística. Suas URLs de paging sofrem validação estrita (SSRF check para IPs privados e hostname falso).
- **Banco de Dados**: Protegido por RLS e FKs severas (e.g. user_id corresponde a run_id obrigatoriamente).

## 4. Contratos HTTP
```json
{
  "success": false,
  "status": "failed",
  "runId": null,
  "error": {
    "code": "META_COLLECTION_FAILED",
    "message": "Não foi possível concluir a sincronização."
  }
}
```
**Regra**: Nunca vazar stack traces, queries SQL, schemas, respostas cruas da Meta ou Tokens em texto.

## 5. Tabelas
- **Existentes**: `meta_integrations`, `meta_assets`, `meta_sync_runs`, `meta_raw_snapshots`, `meta_normalized_metrics`, `meta_campaign_entities`, `meta_adset_entities`, `meta_oauth_states`.
- **Novas**: `meta_campaign_snapshots`, `meta_adset_snapshots` (Histórico Imutável).

## 6. Edge Functions Auditadas
- `meta-sync-ads`: Orchestration da sync, auth check e persistence atômica.
- `meta-oauth-start` / `meta-oauth-callback`: OAuth com State Hash SHA-256 no Banco.
- Outras serão uniformizadas para timeouts, erros e checks de usuário: `meta-list-assets`, `meta-disconnect`, `meta-validate-token`, `meta-fetch-creatives`, `meta-creative-critic`.
- O endpoint legado `meta-sync-campaigns` será removido/desativado.

## 7. Workspace e LocalStorage
- **Workspace**: Reduzido em peso. Não duplica o histórico da conta Meta. Limpo no logout, segregado por userID, schemas migrados em startup com salvamentos parando perante conflito, não os sobrescrevendo destrutivamente.
- **LocalStorage**: Sem snapshots, sem tokens.

## 8. Proxy de IA
O `claude-proxy` possuirá `operational_summary`, `chat_command` e `creative_analysis`. Quotas e Timeouts definidos, erro mascarado em caso de rate limit, e impossibilidade de prompt injection a nível de endpoint.

## 9. Riscos
- **[P0] SSRF em Paging Meta**: Seguir URLs cegas. Mitigado via HTTPS host parsing mandatory `graph.facebook.com` ou docker internal se mock.
- **[P0] Auth e RLS vazando Conta**: Um usuário passando `adAccountId` alheio. Mitigado no backend com select single verificado pelo ID do usuário logado e Integration join.
- **[P1] OAuth Replay / CSRF**: State não criptografado. Mitigado usando Hash SHA-256 consumido no primeiro uso.
- **[P2] Sync Partial Parando DB (Performance)**: Atualização unitária. Mitigado por RPC de lote.
- **[P3] Poluição do LocalStorage**. Mitigado por remoção de objetos analíticos.

## 10. Plano de Rollback
As migrations (4, 5 e 6) são independentes e aditivas. Se o comportamento de RPC PL/pgSQL, por exemplo, trouxer memory leak, reverteremos o código TypeScript para chamadas batch convencionais, sem destruição da tabela. Se o histórico falhar, poderemos remover as triggers/FKs sem ferir a extração.

## 11. Critérios de Aceite
- Os E2E test scripts devem cobrir `simple`, `zero_delivery`, `mixed_objective`, `mixed_attribution`, `mixed_destination`, `partial_page`, `timeout`, `rate_limit_recovered/exhausted`, `invalid_payload`, `unauthorized`, `foreign_ad_account`, `persistence_failure`, `historical_reconciliation`, e `selected_campaign_import`.
- Executar E2E completo 3 vezes seguidas com 0% flaky behavior.
- Verificação que o frontend consegue lidar com os novos DTOs através de uma passagem manual final da tela.
