# Camply: CRM Operacional, Campanhas e Financeiro

O Camply deve ser construido como uma central de operacao para prestacao de servicos. Ele precisa unir CRM, projetos, clientes, campanhas, tarefas, recebimentos e historico em um unico painel rapido de usar no dia a dia.

O ponto principal do produto e entender que nem todo cliente e isolado. Muitas vezes existe uma conta contratante, chamada aqui de Projeto Principal, e dentro dela varios clientes, unidades ou empresas operacionais.

```text
Projeto principal: SPX
Contratante: Joao

Clientes operacionais:
- Clinica A
- Clinica B
- Clinica C
- Pizzaria X
```

Tambem deve existir o caso simples: cliente direto, sem projeto pai.

## Objetivo Do Sistema

O sistema deve ajudar a responder rapidamente:

- O que eu preciso fazer hoje?
- Quais clientes estao sem otimizacao?
- Quais campanhas precisam de atencao?
- Quem esta perto de vencer ou atrasado?
- Quanto eu tenho a receber?
- Quanto e receita minha e quanto e verba de anuncio do cliente?
- Qual projeto guarda-chuva concentra quais clientes, campanhas, tarefas e valores?
- O que ja foi feito para cada cliente?

O Camply nao deve ser apenas um CRUD. Ele deve calcular, alertar, consolidar e priorizar.

## Hierarquia Central

```text
Projeto Principal / Conta Contratante
  -> Clientes / Empresas / Unidades
    -> Servicos prestados
    -> Campanhas
    -> Tarefas
    -> Recebimentos
    -> Historico
```

Regras:

- Um projeto principal pode ter varios clientes vinculados.
- Um cliente pode existir sem projeto principal.
- Um cliente pode ter varios servicos.
- Um cliente pode ter varias campanhas.
- Financeiro, tarefas e historico podem estar ligados ao projeto, ao cliente, a campanha ou ao servico.
- O projeto principal deve consolidar automaticamente os dados dos clientes filhos.

## Entidades E Tabelas

### projects

Representa a conta contratante, projeto guarda-chuva ou entrega principal.

Campos:

- id
- name
- type: traffic, site, mixed, other
- contractor_name
- contractor_company
- status: planning, active, waiting, done, paused
- billing_model: recurring, one_time, mixed
- start_date
- due_date, apenas quando pontual
- progress, apenas quando pontual
- delivered_url
- visibility: private, portfolio, public
- responsible_user_id
- next_action
- notes
- created_at
- updated_at

Regras:

- Projeto de trafego tende a ser recorrente.
- Projeto de site tende a ser pontual.
- Projeto recorrente nao precisa de prazo nem progresso obrigatorio.
- Projeto recorrente calcula valor pela soma dos clientes e servicos vinculados.
- Projeto pontual pode ter valor proprio, prazo, progresso e entrega final.
- O projeto deve exibir receita, verba de midia, pendencias e alertas consolidados.

### clients

Representa a empresa, unidade ou cliente operacional atendido.

Campos:

- id
- project_id, opcional
- owner_name
- company_name
- segment
- contact_name
- contact_phone
- contact_email
- status: active, lead, paused, finished
- service_profile: traffic, site, recurring_support, one_time, mixed
- structure_description
- start_date
- internal_owner_id
- management_fee
- management_fee_type: recurring, one_time
- due_day
- ad_investment_period: daily, weekly, monthly
- ad_investment_meta
- ad_investment_google
- ad_investment_youtube
- ad_investment_tiktok
- ad_investment_other
- last_optimization_at
- next_optimization_at
- last_contact_at
- next_action
- notes
- created_at
- updated_at

Campos calculados:

- total_media_budget
- estimated_monthly_media_budget
- days_without_optimization
- open_receivable_amount
- active_campaign_count
- pending_task_count
- operational_risk_score

Regras:

- Cliente com project_id entra na consolidacao do projeto principal.
- Cliente sem project_id e tratado como cliente direto.
- Verba de anuncio nunca deve ser somada como receita propria.
- Mensalidade de gestao entra como receita propria.
- Cliente ativo sem proxima acao deve gerar alerta leve.

### services

Representa o servico prestado para um cliente.

Campos:

- id
- project_id, opcional
- client_id
- type: traffic_management, site_creation, landing_page, design, consulting, other
- name
- billing_type: recurring, one_time
- service_amount
- media_budget_amount
- media_budget_period
- status: active, paused, delivered, canceled
- start_date
- due_date
- delivered_at
- delivered_url
- notes
- created_at
- updated_at

Regras:

- Trafego pago normalmente cria servico recorrente.
- Site normalmente cria servico pontual.
- Servicos recorrentes alimentam previsao mensal.
- Servicos pontuais alimentam projetos e recebiveis ate serem quitados.

### campaigns

Representa campanhas de midia vinculadas a um cliente.

Campos:

- id
- project_id, opcional, herdado do cliente quando existir
- client_id
- service_id, opcional
- name
- platform: Meta Ads, Google Ads, YouTube Ads, TikTok Ads, LinkedIn Ads, Outro
- objective
- status: setup, launching, live, optimize, waiting, paused, finished
- start_date
- daily_budget
- monthly_budget
- budget_period: daily, monthly
- amount_spent
- last_optimized_at
- next_optimization_at
- performance_notes
- next_action
- priority: low, medium, high, critical
- created_at
- updated_at

Objetivos iniciais de Meta Ads:

- Reconhecimento
- Trafego
- Engajamento
- Cadastros
- Promocao do app
- Vendas

Campos calculados:

- days_without_optimization
- consumed_budget_rate
- estimated_monthly_budget
- stopped_campaign_alert

Regras:

- Campanha ativa sem otimizacao por X dias gera alerta.
- Campanha com verba consumida acima de um limite gera alerta.
- Campanha parada ou aguardando cliente deve aparecer na rotina.

### tasks

Representa tarefas e lembretes operacionais.

Campos:

- id
- project_id, opcional
- client_id, opcional
- campaign_id, opcional
- service_id, opcional
- title
- description
- area: crm, campaigns, finance, projects, delivery
- status: pending, doing, done, canceled
- priority: low, medium, high, critical
- due_date
- completed_at
- responsible_user_id
- created_at
- updated_at

Regras:

- Tarefa vencida gera alerta.
- Tarefa critica deve aparecer no dashboard Hoje.
- Tarefa vinculada a cliente aparece tambem no detalhe do cliente.
- Tarefa vinculada a projeto aparece tambem no consolidado do projeto.

### receivables

Representa valores que voce tem a receber pelo seu servico.

Campos:

- id
- project_id, opcional
- client_id, opcional
- service_id, opcional
- description
- gross_amount
- service_revenue_amount
- media_budget_amount
- received_amount
- pending_amount
- due_date
- paid_at
- status: pending, paid, overdue, partial, canceled
- billing_type: recurring, one_time
- payment_method: pix, boleto, card, transfer, cash, other
- recurrence_month
- notes
- created_at
- updated_at

Regras:

- service_revenue_amount e receita sua.
- media_budget_amount e verba de anuncio e deve ficar separada.
- pending_amount = gross_amount - received_amount.
- Pagamento vencido e nao pago vira overdue.
- Recebivel recorrente deve poder gerar previsao mensal.
- Recebivel pontual deve aparecer ate ser quitado.

### media_budgets

Representa dinheiro destinado as plataformas de anuncio.

Campos:

- id
- project_id, opcional
- client_id
- campaign_id, opcional
- platform
- amount
- period: daily, weekly, monthly
- estimated_monthly_amount
- start_date
- end_date
- status: active, paused, finished
- notes

Regras:

- Verba diaria: amount * 30.
- Verba semanal: amount * 4.33.
- Verba mensal: amount.
- Deve entrar no painel de Verbas de Midia, nao no painel de receita propria.

### activity_logs

Registra rastreabilidade do que foi feito.

Campos:

- id
- project_id, opcional
- client_id, opcional
- campaign_id, opcional
- service_id, opcional
- receivable_id, opcional
- task_id, opcional
- action_type
- title
- description
- actor_user_id
- occurred_at
- metadata_json

Eventos importantes:

- Cliente criado ou editado
- Campanha criada, pausada, otimizada ou finalizada
- Contato feito com cliente
- Pagamento recebido
- Recebivel criado ou atrasado
- Servico entregue
- Link finalizado cadastrado
- Tarefa criada ou concluida
- Status alterado

### users e permissoes futuras

Campos de users:

- id
- name
- email
- role: owner, manager, traffic, finance, viewer
- status
- created_at

Permissoes futuras:

- owner: acesso total
- manager: operacao, clientes, campanhas, projetos e financeiro
- traffic: campanhas, tarefas e historico operacional
- finance: recebimentos e financeiro
- viewer: somente leitura

## Relacionamentos

```text
projects 1:N clients
projects 1:N services
projects 1:N receivables
projects 1:N tasks
projects 1:N activity_logs

clients 1:N services
clients 1:N campaigns
clients 1:N receivables
clients 1:N tasks
clients 1:N activity_logs

services 1:N campaigns
services 1:N receivables
services 1:N tasks

campaigns 1:N tasks
campaigns 1:N activity_logs

receivables 1:N activity_logs
tasks 1:N activity_logs
```

## Telas Principais

### Hoje

Tela inicial da rotina.

Deve mostrar:

- alertas criticos
- prioridades do dia
- clientes mais tempo sem otimizacao
- campanhas que precisam revisar
- pagamentos proximos
- pagamentos atrasados
- tarefas vencidas e de hoje
- proximas acoes registradas

Acoes rapidas:

- marcar tarefa como feita
- registrar otimizacao
- registrar contato
- marcar pagamento como recebido
- criar nova tarefa

### Projetos

Tela de projeto principal e consolidacao.

Deve mostrar:

- nome do projeto e contratante
- tipo: trafego, site ou misto
- status
- clientes vinculados
- servicos vinculados
- receita propria consolidada
- verba de midia consolidada
- recebimentos em aberto
- atrasos
- tarefas pendentes
- historico do projeto

Ao criar projeto:

- escolher modelo: Trafego ou Site
- Trafego cria estrutura recorrente
- Site cria estrutura pontual
- permitir projeto misto depois na V2

### Clientes

Tela de CRM operacional.

Deve mostrar:

- projeto pai, quando existir
- dados da empresa
- responsavel e contato
- servicos prestados
- mensalidade ou valor pontual
- investimento de anuncio por plataforma
- periodo do investimento
- campanhas
- ultima otimizacao
- proxima otimizacao
- ultimo contato
- proxima acao
- tarefas e pendencias
- historico

Acoes rapidas:

- editar dados
- adicionar campanha
- registrar otimizacao
- registrar contato
- criar recebivel
- criar tarefa

### Campanhas

Tela operacional em formato kanban/lista.

Colunas sugeridas:

- Setup
- Subindo
- No ar
- Otimizar
- Aguardando cliente
- Pausado

Filtros:

- projeto
- cliente
- plataforma
- objetivo
- status
- prioridade
- dias sem otimizacao

### Meu Financeiro

Tela da receita propria.

Deve mostrar:

- total a receber no mes
- total recebido
- total em aberto
- total em atraso
- previsao recorrente
- valores pontuais
- recebiveis por cliente
- recebiveis por projeto
- status de pagamento

Importante:

- esta tela nao deve tratar verba de anuncio como receita.

### Verbas De Midia

Tela separada para dinheiro de anuncio dos clientes.

Deve mostrar:

- verba total mensal estimada
- verba por projeto
- verba por cliente
- verba por plataforma
- periodo cadastrado: diario, semanal ou mensal
- equivalente mensal estimado

### Inteligencia

Tela de leitura automatica da operacao.

Deve mostrar:

- alertas criticos
- oportunidades de melhoria
- clientes em risco
- campanhas sem otimizacao
- financeiro atrasado
- projetos com pendencia
- recomendacao objetiva para cada alerta

### Historico

Linha do tempo pesquisavel.

Filtros:

- projeto
- cliente
- campanha
- financeiro
- tipo de acao
- periodo
- responsavel

## Dashboard Principal

Indicadores obrigatorios:

- Total a receber no mes
- Total recebido no mes
- Total em aberto
- Total em atraso
- Receita propria prevista
- Verba de midia mensal estimada
- Clientes ativos
- Projetos ativos
- Campanhas ativas
- Tarefas vencidas
- Clientes ha mais dias sem otimizacao
- Proximos vencimentos
- Proximas tarefas
- Alertas criticos

Blocos recomendados:

- Painel financeiro
- Painel operacional
- Painel de campanhas
- Painel de projetos
- Lista de prioridades do dia

## Calculos Principais

### Dias sem otimizacao

```text
dias_sem_otimizacao = hoje - ultima_otimizacao
```

Se nao existir ultima otimizacao:

```text
dias_sem_otimizacao = hoje - data_inicio
```

### Verba mensal estimada

```text
se periodo = diario:
  verba_mensal = valor * 30

se periodo = semanal:
  verba_mensal = valor * 4.33

se periodo = mensal:
  verba_mensal = valor
```

### Receita propria

```text
receita_propria = soma(service_revenue_amount dos recebiveis)
```

ou, no cadastro operacional:

```text
receita_prevista = soma(mensalidades de gestao + servicos pontuais)
```

### Valor pendente

```text
valor_pendente = valor_cobrado - valor_recebido
```

### Consolidado do projeto principal

```text
clientes_do_projeto = clientes onde project_id = projeto.id

receita_recorrente = soma(mensalidade dos clientes vinculados)
receita_pontual = soma(servicos pontuais vinculados)
verba_midia_mensal = soma(verba mensal estimada dos clientes vinculados)
campanhas_ativas = count(campanhas ativas dos clientes vinculados)
tarefas_pendentes = count(tarefas abertas vinculadas ao projeto ou aos clientes)
em_aberto = soma(recebiveis pendentes do projeto e dos clientes vinculados)
em_atraso = soma(recebiveis atrasados do projeto e dos clientes vinculados)
```

### Score de risco operacional

Sugestao inicial:

```text
risco = 0

se pagamento atrasado: +40
se cliente sem otimizacao >= 7 dias: +30
se campanha ativa sem otimizacao >= 5 dias: +25
se tarefa critica vencida: +20
se cliente ativo sem proxima acao: +10
se campanha pausada sem motivo/observacao: +10
```

Classificacao:

- 0 a 19: normal
- 20 a 39: atencao
- 40 a 69: alto
- 70+: critico

## Automacoes E Alertas

Alertas operacionais:

- Cliente sem otimizacao ha X dias.
- Campanha ativa sem otimizacao ha X dias.
- Campanha pausada sem proxima acao.
- Cliente ativo sem proxima acao.
- Projeto com tarefa vencida.
- Entrega pontual atrasada.
- Follow-up vencido.

Alertas financeiros:

- Pagamento vence em ate 3 dias.
- Pagamento atrasado.
- Cliente recorrente sem recebivel previsto no mes.
- Projeto pontual com valor pendente.
- Valor recebido menor que valor cobrado.

Automacoes recomendadas:

- Ao marcar campanha como otimizada, atualizar last_optimized_at e criar activity_log.
- Ao registrar pagamento recebido, atualizar receivable, status e criar activity_log.
- Ao criar cliente recorrente, sugerir recebivel mensal.
- Ao criar projeto de trafego, sugerir billing_model recorrente.
- Ao criar projeto de site, sugerir billing_model pontual, prazo e progresso.
- Ao cadastrar link entregue, registrar evento de entrega.

## Fluxos De Uso

### Novo projeto de trafego

1. Criar Projeto Principal.
2. Escolher modelo Trafego.
3. Informar contratante, empresa e papel da entrega.
4. Sistema define recorrente por padrao.
5. Cadastrar clientes operacionais dentro dele.
6. Para cada cliente, informar mensalidade de gestao e verba de anuncio.
7. Dashboard do projeto passa a somar clientes, campanhas, receita e verba.

### Novo projeto de site

1. Criar Projeto Principal.
2. Escolher modelo Site.
3. Informar cliente, prazo, valor cobrado e valor recebido.
4. Sistema define pontual por padrao.
5. Criar tarefas de entrega.
6. Ao finalizar, cadastrar link entregue.
7. Sistema registra historico e pendencia financeira se houver valor aberto.

### Cliente direto

1. Criar cliente sem projeto pai.
2. Informar tipo de servico, mensalidade ou valor pontual.
3. Cadastrar campanhas, tarefas e recebiveis.
4. Cliente aparece nos dashboards sem consolidacao por projeto.

### Rotina diaria

1. Abrir tela Hoje.
2. Ver alertas criticos.
3. Resolver pagamentos atrasados.
4. Otimizar campanhas mais antigas.
5. Registrar contato ou proxima acao.
6. Marcar tarefas como concluidas.
7. Historico registra as principais acoes.

## Filtros Necessarios

- Projeto principal
- Cliente
- Status
- Tipo de servico
- Plataforma
- Objetivo da campanha
- Responsavel
- Periodo
- Pagamento
- Atraso
- Pendencia operacional
- Risco operacional
- Recorrente ou pontual

## Experiencia De Uso

Principios:

- Poucos cliques para registrar acao.
- Formularios completos, sem prompt nativo do navegador.
- Cards com resumo claro e botao de editar.
- Dinheiro sempre com prefixo R$.
- Verba de anuncio e receita propria sempre separadas.
- Projeto pai sempre mostra consolidado dos filhos.
- Cliente sempre mostra o que esta pendente agora.
- Dashboard deve priorizar acao, nao apenas estatistica.

Padrao visual:

- Interface escura profissional.
- Verde Camply para acao positiva e destaque.
- Cards compactos.
- Tabelas/listas para operacao recorrente.
- Badges para status, risco e vencimento.
- Modais para cadastro e edicao.

## MVP Recomendado

Deve existir agora:

- Login simples por senha.
- Cadastro e edicao de Projetos Principais.
- Escolha de modelo do projeto: Trafego ou Site.
- Cadastro e edicao de Clientes.
- Cliente vinculado ou nao a Projeto Principal.
- Campos de mensalidade, vencimento e verba por plataforma.
- Investimento com periodo diario, semanal ou mensal.
- Cadastro de Campanhas por cliente.
- Kanban de campanhas.
- Financeiro separado em Meu Financeiro e Verbas de Midia.
- Dashboard Hoje com alertas basicos.
- Inteligencia calculando atrasos, otimizacoes e vencimentos.
- Dados sem exemplos ficticios.
- Persistencia local em localStorage enquanto nao houver banco.

## Versao 2

Pode ficar para uma etapa seguinte:

- Backend com Supabase/Postgres.
- Login real com usuario e senha.
- Multiusuario e permissoes.
- Activity log completo.
- Geracao automatica de recebiveis recorrentes.
- Notificacoes por WhatsApp, email ou push.
- Integracao com Meta Ads e Google Ads.
- Upload de anexos e contratos.
- Relatorios PDF.
- Exportacao CSV.
- Templates de checklist por tipo de projeto.
- IA lendo historico e sugerindo proximas acoes.
- Webhooks de pagamento.

## Arquitetura Tecnica Recomendada

Estado atual:

- React
- TypeScript
- Vite
- Tailwind
- localStorage

Evolucao recomendada:

- Supabase Auth para login.
- Postgres como banco.
- Row Level Security para permissao por usuario.
- Tabelas normalizadas para projetos, clientes, campanhas, tarefas, recebiveis e historico.
- Jobs agendados para gerar alertas e recebiveis recorrentes.
- API para integrar plataformas de anuncio no futuro.

## Prioridade De Implementacao

Ordem recomendada:

1. Fechar bem Projetos e Clientes.
2. Garantir edicao completa dos dados cadastrados.
3. Consolidar projeto pai com clientes filhos.
4. Melhorar campanhas e otimizacoes.
5. Melhorar financeiro e recorrencia.
6. Criar historico de atividades.
7. Evoluir dashboard e inteligencia.
8. Migrar para banco real.

## Definicao De Pronto

O Camply esta pronto para uso operacional quando:

- um projeto com varios clientes mostra somas corretas;
- um cliente direto funciona sem projeto pai;
- campanhas mostram dias sem otimizacao;
- financeiro separa receita propria de verba de anuncio;
- dashboard mostra prioridades reais do dia;
- cadastros podem ser editados;
- pagamentos atrasados e proximos geram alerta;
- tarefas vencidas aparecem como prioridade;
- historico registra as principais acoes;
- nao existem dados ficticios no sistema inicial.
