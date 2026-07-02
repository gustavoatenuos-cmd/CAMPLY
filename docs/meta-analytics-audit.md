# Auditoria independente — Meta Analytics Engine

**PR:** #1

**Branch:** `refactor/meta-analytics-engine`

**SHA inicial revisado:** `3e02e6e18b2ef33b50acd910ac0ed6c3f09947ff`

**Data:** 2026-06-27

## Correções verificadas no código

- atribuição, objetivo e destino mistos são sinais independentes;
- entrega exige gasto, impressões ou ação com valor positivo;
- completude diferencia zero delivery, linha ausente, página parcial, timeout, erro de API e validação;
- grupos preservam o `attribution_setting` original e usam o objetivo de cada Ad Set;
- somente métricas aditivas do registry são somadas; taxas e custos são recalculados;
- reach/frequency de grupos de Ad Sets não são agregados;
- métricas, grupos, completude e tendência são específicos por período;
- tendências exigem snapshots completos e compatíveis;
- todas as mutações de persistência do sync têm o resultado verificado;
- timezone, moeda e datas vêm da conta/payload Meta ou permanecem indisponíveis;
- sync parcial preserva o último snapshot completo exibido;
- conciliação relaciona entidades, snapshots e métricas normalizadas e calcula diferenças reais;
- mapper não inventa otimização nem próxima ação;
- migration preserva nulls e deduplica antes do índice idempotente;
- CI executa instalação limpa, typecheck, testes e build.

## Estratégia de staging

1. Criar um projeto Supabase de staging separado e restaurar uma cópia anonimizada do schema.
2. Executar as migrations em duas condições: banco vazio e banco com duplicações/nulls legados.
3. Publicar `meta-sync-ads` somente em staging e cadastrar credenciais Meta exclusivas de teste.
4. Sincronizar contas com campanhas simples, objetivos mistos, atribuições mistas e zero delivery.
5. Conferir `meta_sync_runs`, snapshots, entidades, métricas e o modal de conciliação.
6. Simular paginação interrompida, timeout e falha de upsert para validar `partial`/`failed`.
7. Comparar manualmente uma amostra com o Ads Manager antes de qualquer promoção.

Esta revisão não autoriza nem executa merge, migration ou deploy de produção.
