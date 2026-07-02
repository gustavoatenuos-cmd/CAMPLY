# Rollback — migration 20260702000026

Esta migration deve ser revertida somente em staging, após backup e confirmação de que nenhum perfil ou meta avançada precisa ser preservado.

Ordem segura:

1. Reimplantar as definições anteriores de `get_analytics_capabilities`, `get_global_performance_dashboard_v2`, `get_meta_performance_hierarchy` e `get_client_meta_asset_catalog` a partir das migrations `000020`, `000022` e `000025`.
2. Interromper o uso de `set_client_performance_target_v2` no frontend.
3. Exportar `client_analysis_profiles` e os campos avançados de `client_performance_targets`.
4. Remover grants e funções `upsert_client_analysis_profile` e `set_client_performance_target_v2`.
5. Remover as políticas e a tabela `client_analysis_profiles` somente após confirmar o backup.
6. Remover as colunas avançadas de metas somente se nenhuma versão criada após esta migration precisar ser mantida.

O rollback não é automatizado porque as etapas 5 e 6 descartam dados. Produção não deve receber esse procedimento sem ensaio completo em staging.
