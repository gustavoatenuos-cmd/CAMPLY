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

O app usa Supabase Auth com e-mail e senha, RLS por usuário e persistência híbrida. O `localStorage` mantém uma cópia local para abertura rápida; o Supabase sincroniza o workspace com controle de versão para impedir sobrescritas silenciosas entre dispositivos.

## Supabase

Crie um arquivo `.env.local` com:

```bash
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-publishable
```

Crie o usuário administrador em **Supabase → Authentication → Users**. Login anônimo não é usado e deve permanecer desativado.

Para um projeto novo, rode [supabase/schema.sql](supabase/schema.sql). Para atualizar o projeto existente, aplique as migrations na ordem:

```bash
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

### Edge Functions e secrets

Credenciais da Anthropic e da Meta pertencem ao Supabase, nunca a variáveis `VITE_*` ou à Vercel. Copie [supabase/secrets.example](supabase/secrets.example) para `supabase/secrets.local`, preencha os valores e execute:

```bash
npx supabase secrets set --env-file supabase/secrets.local
npx supabase functions deploy
```

O redirect cadastrado no aplicativo Meta deve ser exatamente:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/meta-oauth-callback
```

Depois de migrar de uma versão antiga, reconecte a conta Meta. Integrações gravadas com o antigo usuário UUID fixo não são reutilizadas.

Se `VITE_CLAUDE_API_KEY` já foi usada em produção, revogue a chave no Console da Anthropic e gere uma nova antes de configurar `ANTHROPIC_API_KEY` no Supabase.

## Rodar

```bash
npm install
npm run dev
```

## Validar

```bash
npm run lint
npm test
npm run build
```

## Ordem segura de publicação

1. Revogar a chave Anthropic antiga.
2. Criar ou confirmar o usuário permanente no Supabase Auth.
3. Aplicar as migrations.
4. Configurar os secrets do Supabase.
5. Publicar as Edge Functions.
6. Publicar o frontend na Vercel.
