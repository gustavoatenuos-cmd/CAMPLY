import { describe, expect, it } from 'vitest';
import { initialData } from '../../data/camplyStore';
import type { CamplyData } from '../../types';
import type { GlobalClientPerformance } from './globalPerformanceDashboard';
import { selectOperationalDashboardClients } from './usePerformanceDashboard';

const performance = (clientId: string) => ({
  clientId,
  clientName: `Meta ${clientId}`,
}) as GlobalClientPerformance;

describe('Analytics operational client selection', () => {
  it('hides archived projects and inactive clients without removing their saved Meta data', () => {
    const workspace = {
      ...initialData,
      clients: [
        { id: 'active', name: 'Ativo', status: 'active', projectId: 'project-active' },
        { id: 'archived', name: 'Arquivado', status: 'active', projectId: 'project-archived' },
        { id: 'paused', name: 'Pausado', status: 'paused', projectId: 'project-active' },
      ],
      projects: [
        { id: 'project-active', status: 'active' },
        { id: 'project-archived', status: 'archived' },
      ],
    } as CamplyData;
    const remote = [performance('active'), performance('archived'), performance('paused')];

    expect(selectOperationalDashboardClients(remote, workspace).map(client => client.clientId)).toEqual(['active']);
    expect(remote).toHaveLength(3);
  });
});
