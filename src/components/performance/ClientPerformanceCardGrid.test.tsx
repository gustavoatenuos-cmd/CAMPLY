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
    accounts: [],
    metrics: {},
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: { value: 80, status: 'healthy' } as any,
    dataQuality: { status: 'complete', reason: null },
    lastSuccessfulRun: null,
    lastAttempt: null,
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
    const entries = buildClientPriorityEntries([baseGlobalClient()], [workspaceClient]);
    render(<ClientPerformanceCardGrid entries={entries} period="last_30d" onViewAnalytics={() => {}} onEditClient={() => {}} />);
    expect(screen.getByText('Workspace Client Name')).toBeInTheDocument();
  });

  it('shows the operational health badge and the diagnosis summary for a client missing data and a profile', () => {
    const client = baseGlobalClient({ analysisProfile: null, score: { value: null, status: 'unavailable' } as any });
    const entries = buildClientPriorityEntries([client], [workspaceClient]);
    render(<ClientPerformanceCardGrid entries={entries} period="last_30d" onViewAnalytics={() => {}} onEditClient={() => {}} />);
    // Sem perfil e sem métricas confiáveis: "Poucos dados" tem prioridade de exibição sobre o
    // rótulo genérico "Crítico" (ver operationalHealthTagFor), mas o diagnóstico completo lista os dois motivos.
    expect(screen.getByText('Poucos dados')).toBeInTheDocument();
    expect(screen.getByText(/Meta principal não configurada/)).toBeInTheDocument();
  });

  it('calls onViewAnalytics and onEditClient with the client id', () => {
    const onViewAnalytics = vi.fn();
    const onEditClient = vi.fn();
    const entries = buildClientPriorityEntries([baseGlobalClient()], [workspaceClient]);
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
        lastSuccessfulRun: null,
        lastAttempt: null,
      }],
    });
    const entries = buildClientPriorityEntries([client], [workspaceClient]);
    render(<ClientPerformanceCardGrid entries={entries} period="last_30d" onViewAnalytics={() => {}} onEditClient={() => {}} />);

    expect(screen.queryByText('Conta Principal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('client-performance-card-toggle-campaigns'));
    expect(screen.getByText('Conta Principal')).toBeInTheDocument();
  });
});
