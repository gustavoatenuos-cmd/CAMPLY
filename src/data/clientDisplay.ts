import { Client, Project } from '../types';
import type { ClientAnalysisProfile } from '../lib/analysis/clientAnalysisProfile';

export function clientDisplayName(client?: Pick<Client, 'name' | 'company' | 'segment'>): string {
  if (!client) return 'Cliente não encontrado';
  return client.company || client.name || client.segment || 'Cliente sem nome';
}

export function clientOptionLabel(client: Pick<Client, 'name' | 'company' | 'segment'>, _projects: Project[]): string {
  const displayName = clientDisplayName(client);
  return client.name && client.name !== displayName ? `${displayName} · ${client.name}` : displayName;
}

/**
 * Única fonte para o título principal de um cliente em qualquer tela
 * operacional (board de prioridade, cards, tabela, resumo). Nunca deve
 * resolver para nome de projeto, responsável/contratante ou qualquer outro
 * alias operacional — projeto/conta/categoria são sempre informação
 * secundária.
 *
 * Prioridade:
 * 1. `performance.clientName` — já resolvido no backend a partir de
 *    `client_identity.display_name` (computado como company || name || id,
 *    mantido em sincronia a cada save do workspace). É a fonte mais
 *    confiável quando disponível, porque nunca fica em branco (constraint
 *    `NOT NULL` / não-vazio no banco) e não depende do registro local do
 *    workspace estar carregado.
 * 2. `client.company` — nome comercial cadastrado no CRM local.
 * 3. `client.name` — cadastro local; em parte da base isso guarda o nome do
 *    responsável/contratante (ex.: "Joao", "ORLANDO") em vez do nome do
 *    cliente, então só é usado se as duas fontes acima estiverem vazias.
 * 4. `client.segment` — melhor que nada, mas ainda um rótulo genérico.
 * 5. "Cliente sem nome" — apenas quando realmente não há nenhuma fonte.
 *
 * `profile` é aceito para manter a mesma assinatura em todos os pontos de
 * chamada (board, cards, tabela já carregam os três juntos); não contribui
 * para o nome hoje porque `ClientAnalysisProfile` não tem campo de nome.
 */
export function resolveClientPrimaryName(
  client: Pick<Client, 'name' | 'company' | 'segment'> | null | undefined,
  _profile: ClientAnalysisProfile | null | undefined,
  performance: { clientName?: string | null } | null | undefined
): string {
  const resolved = performance?.clientName?.trim();
  if (resolved) return resolved;
  return clientDisplayName(client ?? undefined);
}
