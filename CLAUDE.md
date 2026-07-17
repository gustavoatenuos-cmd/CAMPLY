# CAMPLY — instruções para Claude Code

## Git workflow

**Commit, push e deploy são automáticos, até produção.** O usuário quer que
toda atualização termine publicada em produção via GitHub → Vercel, sem ele
precisar pedir merge manualmente. Fluxo padrão depois de terminar e validar
uma mudança (`npx tsc --noEmit`, `npx vitest run`, `npm run build` — todos
passando):

1. Commit + `git push` para uma branch (feature branch, como já era feito neste repo).
2. Abrir/atualizar PR contra `main` (`gh pr create` / já existe, `gh pr ready` se estava em draft).
3. Esperar os checks de CI (`gh pr checks`) ficarem verdes — inclui `local-supabase-e2e` quando a mudança tocou sync/Supabase.
4. Mergear a PR em `main` (`gh pr merge --merge`) assim que os checks passarem — isso dispara o deploy de produção na Vercel automaticamente.

Não é necessário perguntar "posso subir?" nem "posso mergear?" a cada
mudança — só pausar e avisar se algum check de CI falhar (nesse caso,
corrija antes de mergear, não pule o check).

Isso substitui, para este repositório, a orientação genérica de "nunca
commitar/mergear sem pedido explícito do usuário" — aqui a autorização já foi
dada de forma permanente, para todo o pipeline até produção.

Ainda assim, continue seguindo as regras de segurança padrão:
- Nunca `git push --force` (avisar e pedir confirmação se for genuinamente necessário).
- Nunca `git reset --hard`, `git checkout --` ou similar sem checar `git status` antes.
- Nunca pular hooks (`--no-verify`) nem usar `--amend` em commit já publicado.
- Mensagens de commit em inglês, formato `tipo: descrição` (feat/fix/refactor/docs/test/chore/perf/ci), sem linha de atribuição (Co-Authored-By já é omitida por configuração do usuário).
- Se `tsc`/testes/build quebrarem, corrija antes de commitar — não commite estado quebrado.
