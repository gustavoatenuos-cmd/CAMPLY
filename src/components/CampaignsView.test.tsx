/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CamplyData, Project } from '../types';
import { metaE2EWorkspace } from '../lib/meta/metaE2ERuntime';
import { CampaignsView } from './CampaignsView';

vi.mock('./campaigns/MetaCampaignsBoard', () => ({
  MetaCampaignsBoard: () => <div>Quadro Meta simulado</div>,
}));

afterEach(cleanup);

describe('CampaignsView operational clients', () => {
  it('excludes an archived project from the Kanban and new-campaign choices', () => {
    const active = { ...metaE2EWorkspace.clients[0], id: 'active', name: 'Cliente Ativo', company: 'Ativo', projectId: 'project-active' };
    const archived = { ...metaE2EWorkspace.clients[0], id: 'archived', name: 'Cliente Arquivado', company: 'Arquivado', projectId: 'project-archived' };
    const project = (id: string, status: Project['status']): Project => ({
      id, status, projectType: 'traffic', clientId: id, ownerName: '', company: '',
      billingType: 'recurring', name: id, role: '', progress: 0, dueDate: '',
      amountCharged: 0, amountReceived: 0, paymentStatus: 'pending',
      deliveredUrl: '', visibility: 'private', nextAction: '',
    });
    const data: CamplyData = {
      ...metaE2EWorkspace,
      clients: [active, archived],
      projects: [project('project-active', 'active'), project('project-archived', 'archived')],
      campaigns: [
        { id: 'campaign-active', clientId: active.id, name: 'Campanha ativa', platform: 'Meta Ads', status: 'live', objective: 'Tráfego', budget: 100, spent: 0, nextAction: '', priority: 'medium' },
        { id: 'campaign-archived', clientId: archived.id, name: 'Campanha arquivada', platform: 'Meta Ads', status: 'live', objective: 'Tráfego', budget: 100, spent: 0, nextAction: '', priority: 'medium' },
      ],
    };

    render(<CampaignsView data={data} updateData={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Kanban operacional' }));

    expect(screen.getByText('Campanha ativa')).toBeInTheDocument();
    expect(screen.queryByText('Campanha arquivada')).not.toBeInTheDocument();
    expect(document.querySelectorAll('option[value="active"]')).toHaveLength(1);
    expect(document.querySelectorAll('option[value="archived"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Nova Campanha' }));
    expect(document.querySelectorAll('option[value="active"]')).toHaveLength(2);
    expect(document.querySelectorAll('option[value="archived"]')).toHaveLength(0);
  });
});
