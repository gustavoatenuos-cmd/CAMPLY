# Plano de Migração Arquitetural

Este documento detalha o processo de estrangulamento (Strangler Pattern) da estrutura legada monolítica para a nova arquitetura modularizada e relacional do CAMPLY. A ideia central é não fazer um *Big Bang*. 

## Estratégia de Migração de Dados (JSONB -> Relacional)

1. **Criação de Estruturas Relacionais:** Criar `CREATE TABLE` correspondentes com RLS para todos os domínios (Tasks, Receivables, Campaigns, Projects).
2. **Dual-Write / Adaptador Local:** A aplicação passará a salvar tanto no JSONB (via RPC `try_save_camply_workspace...`) quanto nas novas tabelas, para garantir rollback seguro.
3. **Leitura Híbrida:** Módulos que estão sendo migrados (ex: `TaskEngine`) passarão a consultar a nova tabela. Caso esteja vazia ou inconsistente, consultam a "versão de segurança" no JSONB.
4. **Desligamento e Limpeza:** Após um período sem anomalias, as chaves antigas dentro do JSONB (ex: `.tasks`, `.receivables`) deixam de ser alimentadas e são podadas pela aplicação.

## Ordem Recomendada de Migração
O JSONB deve ser fatiado progressivamente na seguinte prioridade, movendo os módulos de maior mutabilidade e concorrência primeiro:

1. **Tasks (Tarefas)** 
   - *Por quê?* Cresce muito e é a base de ações corretivas dos alertas. 
2. **Receivables (Financeiro)** 
   - *Por quê?* Precisam virar a fonte da verdade oficial para fluxo de caixa (billing agreements), sem depender de heurísticas.
3. **Operational Signals (Alertas)** 
   - *Por quê?* Substituir o histórico do agente por logs determinísticos (resolução de problemas).
4. **Operational Campaigns (Campanhas)** 
   - *Por quê?* Necessitam do desacoplamento do `MetaCampaignSnapshot`.
5. **Projects (Projetos)** 
   - *Por quê?* Escopo definido. Menor concorrência.
6. **Clients (Clientes)** 
   - *Por quê?* Estabilidade. Já possuem ID oficial mapeado em `client_identity`.
7. **Activity Events (Histórico de Atividade)** 
   - *Por quê?* Remover teto de 500 registros, pois tabela append-only escala indefinidamente no Supabase.
