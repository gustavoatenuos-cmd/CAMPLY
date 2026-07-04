# Limites do handoff de frontend

O Claude pode alterar apresentação em `src/components/**`, `src/pages/**`, `src/styles/**`, `src/design-system/**` e `src/hooks/ui/**`.

Não pode alterar migrations, RLS, RPCs, Edge Functions, DTOs, serviços, catálogo canônico, regras de pacing/score/metas nem o motor de alertas.

Deve preservar estados `loading`, `saving`, `saved`, `unavailable`, `insufficient_data`, `conflict` e `error`; exibir `null` como indisponível; mostrar run confiável e última tentativa separadamente; manter a seleção de cliente acessível no mobile e impedir scroll horizontal obrigatório.
