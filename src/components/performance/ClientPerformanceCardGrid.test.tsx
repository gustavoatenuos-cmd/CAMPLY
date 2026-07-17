import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClientPerformanceCardGrid } from './ClientPerformanceCardGrid';
import { buildClientPriorityEntries } from '../../lib/performance/clientPriorityGrouping';
import type { GlobalClientPerformance } from '../../lib/performance/globalPerformanceDashboard';
import type { Client } from '../../types';

function baseGlobalClient(overrides: Partial<GlobalClientPerformance> = {}): GlobalClientPerformance {
  return {
    clientId: 'c1',
    clientName: 'Test Global Client',
    clientStatus: 'available',
    accounts: [{ clientMetaAssetId: 'asset-1', accountName: 'Conta 1', dateStart: '2026-06-18', dateStop: '2026-07-17' } as any],
    metrics: {},
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: { value: 80, status: 'healthy' } as any,
    dataQuality: { status: 'complete', reason: null },
    lastSuccessfulRun: { id: 'run-success', status: 'success', startedAt: '2026-07-17T10:00:00.000Z', finishedAt: '2026-07-17T10:05:00.000Z', terminationReason: null },
    lastAttempt: { id: 'run-success', status: 'success', startedAt: '2026-07-17T10:00:00.000Z', finishedAt: '2026-07-17T10:05:00.000Z', terminationReason: null },
    hasNewerPartial: false,
    hasNewerFailure: false,
    analysisProfile: null,
    ...overrides,
  };
}

const workspaceClient: Client = {
  id: 'c1',
  name: 'Workspace Client Name',
  company: 'Test Company',
  status: 'active',
  monthlyFee: 100,
  managementFeeType: 'recurring',
  dueDay: 10,
  adInvestmentPeriod: 'monthly',
  adInvestmentMeta: 1000,
  adInvestmentGoogle: 0,
  adInvestmentYoutube: 0,
  adInvestmentTikTok: 0,
  hasProject: false,
  segment: 'Retail',
  structure: 'B2C',
  contact: 'test@example.com',
  projectId: '',
};

describe('ClientPerformanceCardGrid', () => {
  afterEach(() => cleanup());

  it('renders empty state when no entries', () => {
    render(<ClientPerformanceCardGrid entries={[]} period="last_30d" onViewAnalytics={() => {}} onEditClient={() => {}} />);
    expect(screen.getByText('Nenhum cliente atende aos filtros aplicados.')).toBeInTheDocument();
  });

  it('renders a card per client using the same priority-entry data as the priority board', () => {
    const entries = buildClientPriorityEntries([baseGlobalClient()], [workspaceClient], 'last_30d');
    render(<ClientPerformanceCardGrid entries={entries} period="last_30d" onViewAnalytics={() => {}} onEditClient={() => {}} />);
    // resolveClientPrimaryName trusts the backend-resolved client.clientName
    // over anything derived from the local workspace record — no duplicate/
    // parallel naming logic at the component level.
    expect(screen.getByText('Test Global Client')).toBeInTheDocument();
  });

  it('never shows the project contractor/responsible name from the workspace record as the title', () => {
    // Reproduces the reported bug: an entire project's clients had `name`
    // holding the contractor's name ("Joao") while `company` (and the
    // backend-resolved clientName) had the real client name.
    const contractorNamedWorkspaceClient: Client = { ...workspaceClient, id: 'c2', name: 'Joao', company: 'Donatellus' };
    const entries = buildClientPriorityEntries(
      [baseGlobalClient({ clientId: 'c2', clientName: 'Donatellus' })],
      [contractorNamedWorkspaceClient],
      'last_30d',
    );
    render(<ClientPerformanceCardGrid entries={entries} period="last_30d" onViewAnalytics={() => {}} onEditClient={() => {}} />);
    expect(screen.getByText('Donatellus')).toBeInTheDocument();
    expect(screen.queryByText('Joao')).not.toBeInTheDocument();
  });

  it('shows the operational health badge and the diagnosis summary for a client missing data and a profile', () => {
    const client = baseGlobalClient({ analysisProfile: null, score: { value: null, status: 'unavailable' } as any });
    const entries = buildClientPriorityEntries([client], [workspaceClient], 'last_30d');
    render(<ClientPerformanceCardGrid entries={entries} period="last_30d" onViewAnalytics={() => {}} onEditClient={() => {}} />);
    // Sem perfil e sem métricas confiáveis: "Poucos dados" tem prioridade de exibição sobre o
    // rótulo genérico "Crítico" (ver operationalHealthTagFor), mas o diagnóstico completo lista os dois motivos.
    expect(screen.getByText('Poucos dados')).toBeInTheDocument();
    expect(screen.getByText(/Meta principal não configurada/)).toBeInTheDocument();
  });

  it('calls onViewAnalytics and onEditClient with the client id', () => {
    const onViewAnalytics = vi.fn();
    const onEditClient = vi.fn();
    const entries = buildClientPriorityEntries([baseGlobalClient()], [workspaceClient], 'last_30d');
    render(
      <ClientPerformanceCardGrid
        entries={entries}
        period="last_30d"
        onViewAnalytics={onViewAnalytics}
        onEditClient={onEditClient}
      />
    );

    fireEvent.click(screen.getByText('Ver análise'));
    expect(onViewAnalytics).toHaveBeenCalledWith('c1');

    fireEvent.click(screen.getByTitle('Editar cliente/metas'));
    expect(onEditClient).toHaveBeenCalledWith('c1');
  });

  it('expands campaigns for the account when the campaigns action is clicked', () => {
    const client = baseGlobalClient({
      accounts: [{
        clientMetaAssetId: 'a1',
        metaAssetId: 'a1',
        integrationId: 'i1',
        adAccountId: 'act_1',
        accountName: 'Conta Principal',
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
        dateStart: null,
        dateStop: null,
        metrics: {},
        budgetPacing: null,
        dataQuality: { status: 'complete', reason: null },
        lastSuccessfulRun: { id: 'run-success', status: 'success', startedAt: '2026-07-17T10:00:00.000Z', finishedAt: '2026-07-17T10:05:00.000Z', terminationReason: null },
        lastAttempt: { id: 'run-success', status: 'success', startedAt: '2026-07-17T10:00:00.000Z', finishedAt: '2026-07-17T10:05:00.000Z', terminationReason: null },
      }],
    });
    const entries = buildClientPriorityEntries([client], [workspaceClient], 'last_30d');
    render(<ClientPerformanceCardGrid entries={entries} period="last_30d" onViewAnalytics={() => {}} onEditClient={() => {}} />);

    expect(screen.queryByText('Conta Principal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('client-performance-card-toggle-campaigns'));
    expect(screen.getByText('Conta Principal')).toBeInTheDocument();
  });

  it('does not render a deactivate/reactivate button when the prop is omitted', () => {
    const entries = buildClientPriorityEntries([baseGlobalClient()], [workspaceClient], 'last_30d');
    render(<ClientPerformanceCardGrid entries={entries} period="last_30d" onViewAnalytics={() => {}} onEditClient={() => {}} />);
    expect(screen.queryByTestId('client-card-deactivate-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('client-card-reactivate-button')).not.toBeInTheDocument();
  });

  it('shows "Desativar" for an operationally active client and calls onDeactivateClient with its id', () => {
    const onDeactivateClient = vi.fn();
    const entries = buildClientPriorityEntries([baseGlobalClient()], [workspaceClient], 'last_30d');
    render(
      <ClientPerformanceCardGrid
        entries={entries}
        period="last_30d"
        onViewAnalytics={() => {}}
        onEditClient={() => {}}
        onDeactivateClient={onDeactivateClient}
        isClientOperationallyActive={() => true}
      />
    );
    expect(screen.queryByTestId('client-card-reactivate-button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('client-card-deactivate-button'));
    expect(onDeactivateClient).toHaveBeenCalledWith('c1');
  });

  it('shows "Reativar" for an operationally inactive client and calls onReactivateClient with its id', () => {
    const onReactivateClient = vi.fn();
    const entries = buildClientPriorityEntries([baseGlobalClient()], [workspaceClient], 'last_30d');
    render(
      <ClientPerformanceCardGrid
        entries={entries}
        period="last_30d"
        onViewAnalytics={() => {}}
        onEditClient={() => {}}
        onReactivateClient={onReactivateClient}
        isClientOperationallyActive={() => false}
      />
    );
    expect(screen.queryByTestId('client-card-deactivate-button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('client-card-reactivate-button'));
    expect(onReactivateClient).toHaveBeenCalledWith('c1');
  });
});
