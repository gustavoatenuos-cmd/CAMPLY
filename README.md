# Camply

Assistente operacional para gestor de tráfego.

O Camply centraliza a rotina de clientes, campanhas, recebimentos, projetos e tarefas. A tela principal mostra o que precisa de atenção no dia: campanhas para otimizar, mensalidades pendentes, projetos em andamento e recomendações automáticas.

## Arquitetura do produto

A especificação operacional completa está em [docs/arquitetura-operacional.md](docs/arquitetura-operacional.md).

Ela descreve:

- hierarquia entre projeto principal e clientes vinculados;
- CRM operacional;
- gestão de campanhas;
- financeiro separado entre receita própria e verba de mídia;
- dashboards;
- automações;
- histórico;
- MVP e versão 2.

## Módulos

- Hoje: central diária com prioridades, tarefas e alertas.
- Campanhas: Kanban para acompanhar setup, subida, campanhas no ar e otimizações.
- Clientes: base comercial com mensalidade, vencimento, contato e status.
- Financeiro: recebíveis, pendências, atrasos e pagamentos marcados como pagos.
- Projetos: projetos próprios, parcerias e próximas ações.
- Inteligência: recomendações simples geradas a partir dos dados cadastrados.

## Estado atual

MVP com persistência híbrida. O app abre rápido usando `localStorage` e, quando o Supabase está configurado, sincroniza o estado da operação na tabela `camply_workspace`.

## Supabase

Crie um arquivo `.env.local` com:

```bash
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-publishable
```

Depois rode o SQL de [supabase/schema.sql](supabase/schema.sql) no SQL Editor do Supabase.

Observação: a política atual é para MVP single-user com senha local. Quando o Camply tiver login real, troque por Supabase Auth e RLS por usuário/organização.

## Rodar

```bash
npm install
npm run dev
```

## Validar

```bash
npm run lint
npm run build
```
