# Camply: Arquitetura Operacional

O Camply deve ser tratado como um CRM operacional para prestação de serviços, unindo gestão de projetos, clientes, campanhas, tarefas, financeiro e histórico em uma visão única.

## Princípio Central

O sistema precisa entender a hierarquia real da operação:

1. Projeto principal ou conta contratante
2. Clientes, unidades ou empresas vinculadas ao projeto
3. Serviços prestados para cada cliente
4. Campanhas, tarefas, financeiro, recebimentos e histórico

Também deve permitir clientes diretos, sem projeto principal.

Exemplo:

```text
Projeto principal: SPX Assessoria
Contratante: João
Tipo: Tráfego recorrente

Clientes vinculados:
- Clínica A
- Clínica B
- Clínica C
- Pizzaria X
```

## Entidades Principais

### Projeto Principal

Representa a conta guarda-chuva, contratante ou projeto macro.

Campos:

- id
- nome do projeto
- tipo: tráfego ou site
- contratante/responsável
- empresa contratante
- status
- modelo financeiro: recorrente ou pontual
- data de início
- prazo, apenas para projeto pontual
- progresso, apenas para projeto pontual
- link finalizado, quando existir entrega
- observações internas
- criado em
- atualizado em

Regras:

- Projeto de tráfego tende a ser recorrente.
- Projeto de site tende a ser pontual.
- Projeto recorrente não precisa de prazo nem progresso.
- Projeto recorrente calcula valor pela soma dos clientes vinculados.
- Projeto pontual pode ter valor próprio, prazo, progresso e entrega final.

### Cliente Operacional

Representa a empresa, unidade ou cliente atendido dentro de um projeto, ou um cliente direto.

Campos:

- id
- project_id, opcional
- nome do responsável
- empresa/marca
- segmento
- contato principal
- status
- tipo de serviço: recorrente ou pontual
- estrutura trabalhada
- data de início
- responsável interno
- mensalidade ou valor de gestão
- dia de vencimento
- período do investimento de mídia: diário, semanal ou mensal
- investimento Meta
- investimento Google
- investimento YouTube
- investimento TikTok
- última otimização
- próxima otimização
- último contato
- próxima ação
- observações internas

Campos calculados:

- total de verba de anúncio
- verba mensal estimada
- dias sem otimização
- total em aberto
- quantidade de campanhas
- criticidade operacional

### Campanha

Representa campanhas de tráfego vinculadas a um cliente.

Campos:

- id
- client_id
- nome
- plataforma
- objetivo
- status
- data de início
- orçamento
- período do orçamento: diário ou mensal
- valor investido
- data da última otimização
- próxima otimização
- observações de performance
- próxima ação
- prioridade

Objetivos Meta iniciais:

- Reconhecimento
- Tráfego
- Engajamento
- Cadastros
- Promoção do app
- Vendas

Campos calculados:

- dias sem otimização
- percentual de verba consumida
- verba mensal estimada
- alerta de campanha parada

### Tarefa

Representa ações do dia a dia.

Campos:

- id
- project_id, opcional
- client_id, opcional
- campaign_id, opcional
- título
- área: campanhas, clientes, financeiro, projetos
- status
- prioridade
- data de vencimento
- responsável
- descrição
- concluída em

Regras:

- Tarefas vencidas devem gerar alerta.
- Tarefas ligadas a projeto/cliente devem aparecer na visão consolidada.

### Financeiro

Deve separar receita própria de verba de mídia.

#### Recebíveis do Serviço

Campos:

- id
- project_id, opcional
- client_id, opcional
- descrição
- valor total cobrado
- valor recebido
- valor pendente
- data de vencimento
- status: pendente, pago, atrasado
- forma de pagamento
- tipo: recorrente ou pontual
- observações financeiras

#### Verba de Mídia

Vem dos clientes/campanhas, não deve ser misturada com receita própria.

Campos relevantes:

- client_id
- platform
- valor
- período: diário, semanal ou mensal
- valor mensal estimado

Regras:

- Receita própria = mensalidades, setups, projetos e serviços.
- Verba de anúncio = dinheiro do cliente destinado às plataformas.
- Dashboard deve mostrar os dois separadamente.

### Histórico de Atividades

Registra rastreabilidade operacional.

Campos:

- id
- tipo da ação
- project_id, opcional
- client_id, opcional
- campaign_id, opcional
- financial_id, opcional
- descrição
- autor
- data e hora
- metadados

Eventos importantes:

- campanha otimizada
- contato realizado
- pagamento recebido
- serviço entregue
- status alterado
- tarefa concluída
- campanha pausada

## Relacionamentos

```text
projects 1:N clients
clients 1:N campaigns
projects 1:N tasks
clients 1:N tasks
campaigns 1:N tasks
projects 1:N receivables
clients 1:N receivables
projects 1:N activity_logs
clients 1:N activity_logs
campaigns 1:N activity_logs
```

## Dashboard Principal

Deve mostrar:

- total a receber no mês
- total recebido
- total em aberto
- total em atraso
- receita própria prevista
- verba de mídia total mensal estimada
- clientes ativos
- projetos ativos
- campanhas ativas
- clientes há mais dias sem otimização
- campanhas críticas
- próximos vencimentos
- próximas tarefas
- alertas críticos

## Regras de Inteligência

### Otimização

Gerar alerta quando:

- cliente sem otimização há mais de X dias
- campanha ativa sem otimização há mais de X dias
- campanha em etapa “No ar” sem próxima ação definida

Cálculo:

```text
dias_sem_otimizacao = hoje - ultima_otimizacao
```

### Financeiro

Gerar alerta quando:

- pagamento vence em até 3 dias
- pagamento está atrasado
- projeto pontual tem valor pendente
- cliente recorrente está sem recebível previsto

Cálculos:

```text
valor_pendente = valor_cobrado - valor_recebido
receita_propria = soma(serviços, mensalidades, projetos)
verba_midia = soma(investimentos de anúncio normalizados para mês)
```

### Projeto Guarda-Chuva

Para projeto recorrente:

```text
receita_recorrente = soma(mensalidades dos clientes vinculados)
receita_pontual = soma(serviços pontuais dos clientes vinculados)
verba_midia_mensal = soma(verbas normalizadas dos clientes vinculados)
quantidade_clientes = count(clientes vinculados)
```

Para projeto pontual:

```text
valor_projeto = valor cobrado no projeto
em_aberto = valor cobrado - valor recebido
progresso = informado manualmente
prazo = obrigatório
```

### Prioridade do Dia

Um item vira prioridade quando:

- pagamento está atrasado
- campanha está há muitos dias sem otimização
- tarefa venceu
- projeto pontual passou do prazo
- cliente ativo não tem próxima ação

## Filtros Necessários

- projeto principal
- cliente
- status
- tipo de serviço
- plataforma
- responsável
- período
- pagamento
- atraso
- pendência operacional

## Telas Principais

### Hoje

Visão de operação diária:

- alertas críticos
- tarefas do dia
- clientes que exigem atenção
- campanhas sem otimização
- recebimentos próximos

### Projetos

Visão por projeto pai:

- modelo: tráfego ou site
- recorrente ou pontual
- contratante
- clientes vinculados
- receita consolidada
- verba de mídia consolidada
- tarefas e pendências

### Clientes

Cadastro e operação:

- dados da empresa
- projeto vinculado
- serviço prestado
- investimento de mídia
- campanhas
- financeiro
- histórico

### Campanhas

Kanban operacional:

- setup
- subindo
- no ar
- otimizar
- aguardando cliente
- pausado

### Financeiro

Duas visões separadas:

- Meu financeiro: receita própria, recebimentos, atrasos, projetos a receber
- Verbas de mídia: dinheiro do cliente destinado às plataformas

### Histórico

Linha do tempo de tudo que aconteceu.

## MVP Recomendado

Prioridade para a versão atual:

- cadastro/edição de projetos
- cadastro/edição de clientes
- vínculo projeto-cliente
- campanhas por cliente
- financeiro separado entre receita própria e mídia
- dashboard “Hoje”
- alertas automáticos básicos
- histórico simples de ações

## Versão 2

Pode ficar para depois:

- login com backend real
- Supabase/Postgres
- multiusuário/equipe
- permissões por papel
- anexos
- integração com Meta Ads/Google Ads
- notificações por WhatsApp/email
- automações recorrentes
- exportação de relatórios
- IA lendo histórico e sugerindo ações

## Arquitetura Técnica Recomendada

Frontend:

- React + TypeScript
- componentes reutilizáveis de formulário
- estado local hoje, backend depois

Backend futuro:

- Supabase Auth
- Postgres
- Row Level Security
- API para integrações externas

Tabelas futuras:

- users
- projects
- clients
- services
- campaigns
- tasks
- receivables
- media_budgets
- activity_logs
- files

## Direção de Produto

O Camply não deve virar apenas um CRUD. Ele precisa operar como um painel de comando:

- mostra o que está atrasado
- mostra o que precisa ser feito hoje
- soma dinheiro corretamente
- separa verba de mídia de receita própria
- consolida projetos com múltiplos clientes
- registra histórico do trabalho feito
- reduz dependência de memória/manualidade
