import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ExecutiveSummary } from './ExecutiveSummary';
import type { GlobalClientPerformance, GlobalPerformanceAccount } from '../../lib/performance/globalPerformanceDashboard';

function account(overrides: Partial<GlobalPerformanceAccount> = {}): GlobalPerformanceAccount {
  return {
    clientMetaAssetId: 'a1',
    metaAssetId: 'a1',
    integrationId: 'i1',
    adAccountId: 'act_1',
    accountName: 'Conta 1',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    dateStart: null,
    dateStop: null,
    metrics: {},
    budgetPacing: null,
    dataQuality: { status: 'complete', reason: null },
    lastSuccessfulRun: { id: '1', status: 'success', startedAt: '', finishedAt: '2026-01-01', terminationReason: null },
    lastAttempt: { id: '1', status: 'success', startedAt: '', finishedAt: '2026-01-01', terminationReason: null },
    ...overrides,
  };
}

function client(overrides: Partial<GlobalClientPerformance> = {}): GlobalClientPerformance {
  return {
    clientId: 'c1',
    clientName: 'Cliente 1',
    clientStatus: 'available',
    accounts: [account()],
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

describe('ExecutiveSummary', () => {
  afterEach(() => cleanup());

  it('counts accounts with a reliable sync separately from accounts with a problem', () => {
    const reliableClient = client({ clientId: 'c1', accounts: [account({ clientMetaAssetId: 'a1' })] });
    const problemClient = client({
      clientId: 'c2',
      // Precisa de uma tentativa real (lastAttempt não nulo) para contar como
      // "problema" — sem tentativa alguma é not_synced, não problem (regra de
      // contrato período<->sync: ausência de sync não é falha do cliente).
      accounts: [account({
        clientMetaAssetId: 'a2',
        dataQuality: { status: 'unavailable', reason: 'account_not_connected' },
        lastSuccessfulRun: null,
        lastAttempt: { id: '2', status: 'failed', startedAt: '', finishedAt: '2026-01-02', terminationReason: 'meta_api_error' },
      })],
    });

    render(<ExecutiveSummary clients={[reliableClient, problemClient]} statusFilter="all" onStatusFilterChange={() => {}} />);

    expect(screen.getByText('Contas com sync confiável')).toBeInTheDocument();
    expect(screen.getByText('Contas com problema')).toBeInTheDocument();
    // Uma conta confiável e uma com problema, entre os 2 clientes do recorte.
    const values = screen.getAllByText('1');
    expect(values.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the health filter chips with counts', () => {
    render(<ExecutiveSummary clients={[client()]} statusFilter="all" onStatusFilterChange={() => {}} />);
    expect(screen.getByText(/Saudáveis/)).toBeInTheDocument();
    expect(screen.getByText(/Atenção/)).toBeInTheDocument();
    expect(screen.getByText(/Críticos/)).toBeInTheDocument();
  });

  it('shows only macro volume metrics — never an aggregated average cost across clients/objectives', () => {
    const withSpend = client({
      clientId: 'c1',
      accounts: [account({ clientMetaAssetId: 'a1', metrics: { spend: { value: 500, available: true, currency: 'BRL', completenessStatus: 'complete' } as any, reach: { value: 12000, available: true, currency: null, completenessStatus: 'complete' } as any } })],
      metrics: { purchases: { value: 10, available: true, currency: null, completenessStatus: 'complete' } as any },
    });

    render(<ExecutiveSummary clients={[withSpend]} statusFilter="all" onStatusFilterChange={() => {}} />);

    expect(screen.getByText('Investimento total')).toBeInTheDocument();
    expect(screen.getByText('Conversas totais')).toBeInTheDocument();
    expect(screen.getByText('Compras totais')).toBeInTheDocument();
    expect(screen.getByText('Leads totais')).toBeInTheDocument();
    expect(screen.getByText('Alcance total')).toBeInTheDocument();
    expect(screen.getByText('12.000')).toBeInTheDocument();

    expect(screen.queryByText(/custo por conversa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/custo por compra/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^cpa$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^cpl$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/roas médio/i)).not.toBeInTheDocument();
  });
});
