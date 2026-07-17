# CAMPLY — instruções para Claude Code

## Git workflow

**Commit e push são automáticos.** Depois de terminar uma mudança e validá-la
(`npx tsc --noEmit`, `npx vitest run`, `npm run build` — todos passando), faça
o commit e dê `git push` para a branch atual sem perguntar "posso subir?".
Não é necessário esperar confirmação explícita a cada mudança.

Isso substitui, para este repositório, a orientação genérica de "nunca
commitar sem pedido explícito do usuário" — aqui a autorização já foi dada
de forma permanente.

Ainda assim, continue seguindo as regras de segurança padrão:
- Nunca `git push --force` (avisar e pedir confirmação se for genuinamente necessário).
- Nunca `git reset --hard`, `git checkout --` ou similar sem checar `git status` antes.
- Nunca pular hooks (`--no-verify`) nem usar `--amend` em commit já publicado.
- Mensagens de commit em inglês, formato `tipo: descrição` (feat/fix/refactor/docs/test/chore/perf/ci), sem linha de atribuição (Co-Authored-By já é omitida por configuração do usuário).
- Se `tsc`/testes/build quebrarem, corrija antes de commitar — não commite estado quebrado.
