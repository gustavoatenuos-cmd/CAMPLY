# Baseline de producao - 2026-08-14

Este documento registra a evidencia observada na branch `main` do CAMPLY no
commit `24117224b0566ec06f0198e7f33b40a0989380f9`. Ele e um retrato datado, nao
uma garantia permanente de que producao ou servicos externos continuam
saudaveis.

## Veredito

**67/100 - arriscado para uma nova publicacao sem gates adicionais.**

O frontend compila, a suite local passa e a CI do commit auditado esta verde.
A nota fica limitada porque o caminho critico Meta/Supabase nao foi validado de
ponta a ponta neste ambiente, nao existe evidencia de E2E Meta na `main` para o
commit auditado, ha dependencias com advisories altos e o procedimento de
rollback nao cobre a sequencia atual de migrations e Edge Functions.

Este resultado nao exige retirar do ar uma versao ja publicada. Ele significa
que uma nova publicacao deve passar pelos gates definidos abaixo.

## Superficie auditada

- SPA React 19 e Vite 6 publicada pela Vercel.
- Supabase Auth, Data API, RLS, RPCs e 15 Edge Functions.
- Persistencia hibrida do workspace em `localStorage` e `camply_workspace`.
- Integracao Meta: OAuth, catalogo, sincronizacao, snapshots e analytics.
- 59 migrations SQL e testes SQL de schema, RLS e contratos analiticos.
- Workflows de CI, E2E Meta e staging.

## Evidencia aprovada

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| Checkout | passou | `main` limpa e alinhada a `origin/main` no commit auditado |
| Instalacao | passou | `npm ci`, 301 pacotes instalados pelo lockfile |
| Typecheck | passou | `npm run lint` (`tsc --noEmit`) |
| Unitarios/contratos | passou | 61 arquivos e 445 testes |
| Build | passou com alerta | Vite transformou 2.211 modulos; chunk principal de 581,84 kB |
| CI remota | passou | workflow `CI`, [run `30147716757`](https://github.com/gustavoatenuos-cmd/CAMPLY/actions/runs/30147716757), no mesmo SHA |
| Segredos no cliente | passou na inspecao estatica | apenas URL e chave publishable usam prefixo `VITE_` |
| E2E Meta/Supabase | nao executado | Docker instalado, mas daemon indisponivel apos inicializacao limitada |
| Staging/producao | nao executado | nenhuma conexao remota, migration ou deploy foi autorizado nesta PR |

## Riscos priorizados

### P0 - ausencia de gate E2E na `main`

O workflow `.github/workflows/e2e-meta.yml` roda em pull requests e por disparo
manual, mas nao em `push` para `main`. O workflow `CI` verde cobre TypeScript,
Vitest e build; nao sobe Supabase, nao aplica a cadeia de migrations e nao testa
as Edge Functions. Portanto, CI verde nao comprova o fluxo Meta/Supabase.

Acao recomendada: tornar o E2E Meta um check obrigatorio antes do merge e
executa-lo tambem no commit resultante da `main` ou em um gate de release.

### P0 - rollback incompleto para o estado atual

`docs/camply-senior-audit.md` descreve uma arquitetura anterior, incluindo
nomes como `meta-sync-ads`, e um rollback limitado a migrations antigas. O
repositorio atual possui 59 migrations e 15 Edge Functions. Ha um rollback
especifico para `20260702000026`, mas nao um runbook da release atual.

Acao recomendada: criar um runbook testado em staging que separe rollback de
frontend, Edge Functions e migrations aditivas/destrutivas, sempre com backup e
criterios de abortar.

### P1 - tres dependencias vulneraveis

`npm audit --json` reportou tres vulnerabilidades altas, todas com correcao
disponivel. A verificacao com `--omit=dev` ainda reportou `postcss` e `nanoid`;
portanto, elas nao podem ser descartadas apenas como dependencias de teste:

- `postcss@8.5.15`, dependencia direta de desenvolvimento;
- `nanoid@3.3.15`, transitiva de `postcss`;
- `undici@7.28.0`, transitiva de `jsdom`.

`postcss` e `nanoid` entram pela cadeia de build CSS; `undici` entra por `jsdom`.
O risco observado esta concentrado principalmente na cadeia de build/teste, mas
continua sendo risco de supply chain. Atualizar separadamente e repetir install,
testes, build e audit; nao executar `npm audit fix --force` sem revisar o diff.

### P1 - runtime de CI fora do contrato atual do Supabase

Os workflows `ci.yml` e `e2e-meta.yml` usam Node 20. O
[changelog do Supabase](https://supabase.com/changelog?tags=javascript) informa
que suas bibliotecas cliente encerraram suporte ao Node 20 em 2026-06-30. O
ambiente local auditado usa Node 24.

Acao recomendada: declarar uma versao Node suportada e unica (minimo 22) no
repositorio, CI e E2E, evitando resultados diferentes entre ambientes.

### P1 - grants precisam de verificacao antes de outubro de 2026

O Supabase anunciou que
[novas tabelas deixam de ser expostas automaticamente a Data API](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
e que a mudanca sera aplicada a todos os projetos em 2026-10-30. RLS e grants
sao camadas distintas. As migrations do CAMPLY ja contem grants e revokes
explicitos em varios contratos, mas o schema efetivo do staging precisa ser
validado com os papeis `anon`, `authenticated` e `service_role`.

Acao recomendada: manter os testes RLS/API no E2E e adicionar `db advisors` e
uma verificacao de grants ao gate de staging.

### P2 - bundle principal grande

O build produziu um chunk principal de 581,84 kB minificado (173,30 kB gzip),
acima do limite de alerta do Vite. Isso nao bloqueia corretude, mas aumenta o
tempo de carregamento e o impacto de mudancas no shell principal.

Acao recomendada: medir no navegador antes de alterar; depois separar vendors e
retirar mais modulos pesados do caminho inicial.

### P2 - fila de PRs antigas e concorrentes

Na data da auditoria havia dez PRs abertas, incluindo PRs antigas e ramos que
tocam os mesmos contratos Meta/operacionais. Isso aumenta risco de aplicar uma
correcao sobre uma premissa obsoleta ou duplicar trabalho.

Acao recomendada: classificar as PRs em incorporar, substituir ou encerrar antes
de iniciar refatoracoes estruturais.

## Gates obrigatorios para a proxima release

1. `npm ci` em uma versao Node suportada e declarada.
2. `npm run lint`.
3. `npm test` sem testes ignorados inesperadamente.
4. `npm run build`, registrando tamanho dos chunks.
5. `npm audit --omit=dev` e `npm audit` completo sem vulnerabilidade aceita sem
   justificativa documentada.
6. `npm run validate:meta:local` tres vezes em ambiente isolado.
7. `supabase db push --dry-run` no staging.
8. Aplicar migrations e Edge Functions no staging, nunca diretamente como
   primeira execucao em producao.
9. Executar `supabase/tests/meta_analytics_smoke.sql`, testes de RLS/API e fluxo
   OAuth/sync/dashboard no staging.
10. Confirmar backup, rollback por camada e responsavel pela decisao de deploy.
11. Fazer smoke test autenticado em desktop e mobile apos publicar.

## Ordem de correcao sugerida

1. Atualizar Node da CI e dependencias vulneraveis em uma PR pequena.
2. Tornar o E2E Meta obrigatorio e reproduzivel.
3. Criar e ensaiar o runbook de staging/rollback.
4. Reconciliar e encerrar PRs antigas.
5. Somente depois iniciar a extracao da orquestracao de `App.tsx`.

## Comandos usados neste baseline

```text
git status --short --branch
git log --oneline --decorate -20
git diff --stat origin/main...HEAD
npm ci
npm run lint
npm test
npm run build
npm audit --json
npm explain postcss
npm explain nanoid
npm explain undici
docker info
```

As informacoes da CI e das PRs foram consultadas pela API publica do GitHub. O
E2E nao foi marcado como aprovado porque `docker info` nao conseguiu conectar ao
daemon. Nenhuma migration, Edge Function, variavel ou dado remoto foi alterado.
