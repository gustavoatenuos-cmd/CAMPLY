import { Client, Project } from '../types';

export function clientDisplayName(client?: Pick<Client, 'name' | 'company' | 'segment'>): string {
  if (!client) return 'Cliente não encontrado';
  return client.company || client.name || client.segment || 'Cliente sem nome';
}

export function clientOptionLabel(client: Pick<Client, 'name' | 'company' | 'segment'>, _projects: Project[]): string {
  const displayName = clientDisplayName(client);
  return client.name && client.name !== displayName ? `${displayName} · ${client.name}` : displayName;
}
