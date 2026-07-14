import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { CampaignHierarchicalTable } from './CampaignHierarchicalTable';
import { fetchMetaPerformanceHierarchy, type HierarchyResponse } from '../../lib/performance/metaPerformanceHierarchy';
import { unavailableTraceableMetric } from '../../lib/performance/traceableMetrics';

vi.mock('../../lib/performance/metaPerformanceHierarchy', () => ({
  fetchMetaPerformanceHierarchy: vi.fn(),
}));

const fetchHierarchyMock = vi.mocked(fetchMetaPerformanceHierarchy);

function metric(value: number) {
  return {
    ...unavailableTraceableMetric('x'),
    value,
    available: true,
    currency: 'BRL',
    completenessStatus: 'complete' as const,
  };
}

function hierarchyResponse(overrides: Partial<HierarchyResponse> = {}): HierarchyResponse {
  return {
    state: 'empty',
    level: 'campaign',
    page: 1,
    pageSize: 100,
    items: [],
    total: 0,
    activeNoDeliveryItems: [],
    activeNoDeliveryTotal: 0,
    activeWithoutActiveStructureItems: [],
    activeWithoutActiveStructureTotal: 0,
    pausedWithSpendItems: [],
    pausedWithSpendTotal: 0,
    unclassifiedDestinationItems: [],
    unclassifiedDestinationTotal: 0,
    ...overrides,
  };
}

const account: any = {
  clientMetaAssetId: 'asset-1',
  accountName: 'Conta Principal',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
};

describe('CampaignHierarchicalTable', () => {
  beforeEach(() => {
    fetchHierarchyMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Compras/CPA/ROAS for a SALES campaign', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse({
      state: 'ready',
      total: 1,
      items: [{
        id: 'camp-sales', name: 'Campanha de vendas', status: 'ACTIVE', effectiveStatus: 'ACTIVE',
        objective: 'OUTCOME_SALES', classifiedObjective: 'SALES', destinationType: null,
        attributionSetting: '7d_click_1d_view', creativeId: null, verdict: 'ANALYZABLE',
        metrics: { spend: metric(100), purchases: metric(4), purchase_value: metric(800) },
      } as any],
    }));

    render(<CampaignHierarchicalTable account={account} period="last_30d" />);

    expect(await screen.findByText('Campanha de vendas')).toBeInTheDocument();
    expect(screen.getByText('Compras')).toBeInTheDocument();
    expect(screen.getByText('CPA')).toBeInTheDocument();
    expect(screen.getByText('ROAS')).toBeInTheDocument();
    expect(screen.getByText('Ativa no último sync')).toBeInTheDocument();
  });

  it('renders Impressões/Alcance/CPM for an ENGAGEMENT campaign, never Compras/CPA/ROAS', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse({
      state: 'ready',
      total: 1,
      items: [{
        id: 'camp-engagement', name: 'Campanha de engajamento', status: 'ACTIVE', effectiveStatus: 'ACTIVE',
        objective: 'OUTCOME_ENGAGEMENT', classifiedObjective: 'ENGAGEMENT', destinationType: null,
        attributionSetting: null, creativeId: null, verdict: 'ANALYZABLE',
        metrics: { spend: metric(100), impressions: metric(5000), reach: metric(3000) },
      } as any],
    }));

    render(<CampaignHierarchicalTable account={account} period="last_30d" />);

    expect(await screen.findByText('Campanha de engajamento')).toBeInTheDocument();
    expect(screen.getByText('Impressões')).toBeInTheDocument();
    expect(screen.getByText('Alcance')).toBeInTheDocument();
    expect(screen.getByText('CPM')).toBeInTheDocument();
    expect(screen.queryByText('Compras')).not.toBeInTheDocument();
    expect(screen.queryByText('CPA')).not.toBeInTheDocument();
    expect(screen.queryByText('ROAS')).not.toBeInTheDocument();
  });

  it('renders a stale-sync warning when the confiável run is older than 24h', async () => {
    const oldFinishedAt = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse({
      state: 'ready',
      total: 1,
      items: [{
        id: 'camp-1', name: 'Campanha antiga', status: 'ACTIVE', effectiveStatus: 'ACTIVE',
        objective: 'OUTCOME_LEADS', classifiedObjective: 'LEADS', destinationType: 'WHATSAPP',
        attributionSetting: null, creativeId: null, verdict: 'ANALYZABLE',
        metrics: { spend: metric(100), leads: metric(3) },
      } as any],
      run: { id: 'run-1', status: 'success', startedAt: oldFinishedAt, finishedAt: oldFinishedAt },
    }));

    render(<CampaignHierarchicalTable account={account} period="last_30d" />);

    expect(await screen.findByText(/Sincronização antiga/)).toBeInTheDocument();
  });

  it('renders the empty state when there are no analyzable campaigns', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse());

    render(<CampaignHierarchicalTable account={account} period="last_30d" />);

    expect(await screen.findByText('Nenhuma campanha analisável encontrada para este período.')).toBeInTheDocument();
  });
});
