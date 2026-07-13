import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ClientCampaignDrawer } from './ClientCampaignDrawer';
import { fetchMetaPerformanceHierarchy, type HierarchyResponse } from '../../lib/performance/metaPerformanceHierarchy';
import type { EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { unavailableTraceableMetric } from '../../lib/performance/traceableMetrics';

vi.mock('../../lib/performance/metaPerformanceHierarchy', () => ({
  fetchMetaPerformanceHierarchy: vi.fn(),
}));

const fetchHierarchyMock = vi.mocked(fetchMetaPerformanceHierarchy);

function makeAccount(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clientMetaAssetId: 'asset-1',
    metaAssetId: 'meta-asset-1',
    integrationId: 'integration-1',
    adAccountId: 'act_123456',
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
    ...overrides,
  };
}

function makePerformance(accounts: ReturnType<typeof makeAccount>[]): EnrichedGlobalClientPerformance {
  return {
    clientId: 'client-1',
    clientName: 'Cliente Teste',
    clientStatus: 'active',
    accounts: accounts as any,
    metrics: {},
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: { value: null, status: 'unavailable' } as any,
    dataQuality: { status: 'complete', reason: null } as any,
    lastSuccessfulRun: null,
    lastAttempt: null,
    hasNewerPartial: false,
    hasNewerFailure: false,
  } as any;
}

function metric(value: number) {
  return {
    ...unavailableTraceableMetric('x'),
    value,
    available: true,
    currency: 'BRL',
    completenessStatus: 'complete' as const,
    clientMetaAssetId: 'asset-1',
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

function makeCampaign(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'camp-1',
    name: 'Campanha de Leads',
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    objective: 'OUTCOME_LEADS',
    classifiedObjective: 'LEADS',
    destinationType: 'WHATSAPP',
    attributionSetting: '7d_click_1d_view',
    creativeId: null,
    verdict: 'ANALYZABLE',
    scopeStatus: 'included',
    hasActiveAdset: true,
    adLevelCollected: false,
    hasActiveAd: false,
    metrics: {
      spend: metric(100),
      purchases: metric(2),
      purchase_roas: metric(3.5),
    },
    ...overrides,
  };
}

describe('ClientCampaignDrawer', () => {
  beforeEach(() => {
    fetchHierarchyMock.mockReset();
  });

  it('não chama a hierarquia quando o cliente não tem conta Meta vinculada', async () => {
    const performance = makePerformance([]);
    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Conta Meta não vinculada.')).toBeInTheDocument();
    expect(fetchHierarchyMock).not.toHaveBeenCalled();
  });

  it('pula contas sem clientMetaAssetId e usa a próxima conta válida', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse());
    const invalidAccount = makeAccount({ clientMetaAssetId: '', accountName: 'Conta sem vínculo' });
    const validAccount = makeAccount({ clientMetaAssetId: 'asset-valid', accountName: 'Conta válida' });
    const performance = makePerformance([invalidAccount, validAccount]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    await waitFor(() => expect(fetchHierarchyMock).toHaveBeenCalledTimes(1));
    expect(fetchHierarchyMock).toHaveBeenCalledWith('asset-valid', 'last_30d', 'campaign', null, 1, 100);
  });

  it('renderiza estado vazio quando a RPC retorna empty', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse());
    const performance = makePerformance([makeAccount()]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Nenhuma campanha encontrada no período.')).toBeInTheDocument();
  });

  it('renderiza aviso de período não sincronizado', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse({ state: 'period_not_synced' }));
    const performance = makePerformance([makeAccount()]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Esse período ainda não foi sincronizado.')).toBeInTheDocument();
  });

  it('renderiza as campanhas quando a RPC retorna ready', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse({
      state: 'ready',
      total: 1,
      items: [makeCampaign() as any],
    }));
    const account = makeAccount({ adAccountId: 'act_999' });
    const performance = makePerformance([account]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Campanha de Leads')).toBeInTheDocument();
    expect(screen.getByText('Ativa no último sync')).toBeInTheDocument();
    const link = screen.getByTitle('Abrir no Gerenciador de Anúncios') as HTMLAnchorElement;
    expect(link.href).toContain('act=act_999');
    expect(link.href).not.toContain('client-1');
  });

  it('mostra mensagem amigável quando a RPC falha, sem usar o texto genérico antigo', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchHierarchyMock.mockRejectedValue(new Error('RPC boom'));
    const performance = makePerformance([makeAccount()]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Falha no carregamento')).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar a hierarquia salva.')).not.toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('exibe aviso discreto quando há mais de uma conta Meta vinculada', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse());
    const accountA = makeAccount({ clientMetaAssetId: 'asset-a', accountName: 'Conta A' });
    const accountB = makeAccount({ clientMetaAssetId: 'asset-b', accountName: 'Conta B' });
    const performance = makePerformance([accountA, accountB]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText(/Exibindo a primeira conta Meta vinculada: Conta A/)).toBeInTheDocument();
  });

  it('mostra campanhas pausadas com gasto num grupo separado, com o rótulo correto', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse({
      state: 'ready',
      total: 1,
      items: [makeCampaign() as any],
      pausedWithSpendItems: [makeCampaign({
        id: 'camp-paused',
        name: 'Campanha pausada com gasto',
        effectiveStatus: 'PAUSED',
        status: 'PAUSED',
        verdict: 'PAUSED_WITH_SPEND',
      }) as any],
      pausedWithSpendTotal: 1,
    }));
    const performance = makePerformance([makeAccount()]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Pausadas com gasto (1)')).toBeInTheDocument();
    expect(screen.getByText('Campanha pausada com gasto')).toBeInTheDocument();
    expect(screen.getByText('Pausada com gasto')).toBeInTheDocument();
  });

  it('mostra o veredito ACTIVE_NO_DELIVERY para campanhas sem entrega', async () => {
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse({
      state: 'ready',
      total: 0,
      items: [],
      activeNoDeliveryItems: [makeCampaign({
        id: 'camp-no-delivery',
        name: 'Campanha sem entrega',
        verdict: 'ACTIVE_NO_DELIVERY',
        metrics: { spend: metric(0) },
      }) as any],
      activeNoDeliveryTotal: 1,
    }));
    const performance = makePerformance([makeAccount()]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Ativas sem entrega (1)')).toBeInTheDocument();
    expect(screen.getByText('Ativa sem entrega')).toBeInTheDocument();
  });

  it('exibe aviso de sincronização antiga quando o run confiável tem mais de 24h', async () => {
    const oldFinishedAt = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    fetchHierarchyMock.mockResolvedValue(hierarchyResponse({
      state: 'ready',
      total: 1,
      items: [makeCampaign() as any],
      run: { id: 'run-1', status: 'success', startedAt: oldFinishedAt, finishedAt: oldFinishedAt },
    }));
    const performance = makePerformance([makeAccount()]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText(/Sincronização antiga/)).toBeInTheDocument();
  });
});
