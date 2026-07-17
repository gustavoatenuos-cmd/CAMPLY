import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ClientAnalyticsBoard } from './ClientAnalyticsBoard';
import { fetchMetaPerformanceHierarchy } from '../../lib/performance/metaPerformanceHierarchy';
import { syncMetaAsset } from '../../lib/meta/metaSyncService';
import type { EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { defaultAnalysisProfile } from '../../lib/analysis/clientAnalysisProfile';

vi.mock('../../lib/performance/metaPerformanceHierarchy', () => ({
  fetchMetaPerformanceHierarchy: vi.fn(),
}));
vi.mock('../../lib/meta/metaSyncService', () => ({
  syncMetaAsset: vi.fn(),
}));

const fetchHierarchyMock = vi.mocked(fetchMetaPerformanceHierarchy);
const syncMetaAssetMock = vi.mocked(syncMetaAsset);

function makePerformance(overrides: Partial<EnrichedGlobalClientPerformance> = {}): EnrichedGlobalClientPerformance {
  return {
    clientId: 'client-1',
    clientName: 'Cliente Teste',
    clientStatus: 'available',
    accounts: [],
    metrics: { spend: { value: 500, available: true, metricId: 'spend' } as any },
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: { value: 80, status: 'healthy' } as any,
    dataQuality: { status: 'complete', reason: null } as any,
    lastSuccessfulRun: { id: 'run-1', status: 'success', startedAt: '2026-07-10T00:00:00Z', finishedAt: '2026-07-10T00:00:00Z', terminationReason: 'completed' },
    lastAttempt: null,
    hasNewerPartial: false,
    hasNewerFailure: false,
    analysisProfile: defaultAnalysisProfile('client-1', { primaryConversionMetric: 'purchases', plannedBudget: 1000 }),
    client: { id: 'client-1', name: 'Cliente Teste' },
    ...overrides,
  } as EnrichedGlobalClientPerformance;
}

describe('ClientAnalyticsBoard', () => {
  beforeEach(() => {
    fetchHierarchyMock.mockReset();
    syncMetaAssetMock.mockReset();
    fetchHierarchyMock.mockResolvedValue({ state: 'empty', items: [], total: 0 });
  });
  afterEach(() => cleanup());

  it('"Ver detalhes" opens the analytics detail drawer, not the campaign drawer', () => {
    const performance = makePerformance();
    render(<ClientAnalyticsBoard clients={[performance]} period="last_30d" loading={false} />);

    fireEvent.click(screen.getByText('Ver detalhes'));

    // O drawer de detalhe mostra o cabeçalho "Contrato do cliente"; o drawer
    // de campanhas nunca renderiza esse texto.
    expect(screen.getByText('Contrato do cliente')).toBeInTheDocument();
    expect(screen.queryByText('Desempenho detalhado das campanhas sincronizadas')).not.toBeInTheDocument();
    expect(fetchHierarchyMock).not.toHaveBeenCalled();
  });

  it('"Ver campanhas" opens the campaign drawer, not the analytics detail drawer', async () => {
    const performance = makePerformance();
    render(<ClientAnalyticsBoard clients={[performance]} period="last_30d" loading={false} />);

    fireEvent.click(screen.getByText('Ver campanhas'));

    expect(await screen.findByText('Desempenho detalhado das campanhas sincronizadas')).toBeInTheDocument();
    expect(screen.queryByText('Contrato do cliente')).not.toBeInTheDocument();
  });

  it('the detail drawer\'s "Ver campanhas" button switches to the campaign drawer for the same client', async () => {
    const performance = makePerformance();
    render(<ClientAnalyticsBoard clients={[performance]} period="last_30d" loading={false} />);

    fireEvent.click(screen.getByText('Ver detalhes'));
    expect(screen.getByText('Contrato do cliente')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('detail-drawer-open-campaigns'));
    expect(await screen.findByText('Desempenho detalhado das campanhas sincronizadas')).toBeInTheDocument();
  });
});
