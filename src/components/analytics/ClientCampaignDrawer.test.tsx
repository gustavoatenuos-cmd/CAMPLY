import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ClientCampaignDrawer } from './ClientCampaignDrawer';
import { fetchMetaPerformanceHierarchy } from '../../lib/performance/metaPerformanceHierarchy';
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
    fetchHierarchyMock.mockResolvedValue({ state: 'empty', items: [], total: 0 });
    const invalidAccount = makeAccount({ clientMetaAssetId: '', accountName: 'Conta sem vínculo' });
    const validAccount = makeAccount({ clientMetaAssetId: 'asset-valid', accountName: 'Conta válida' });
    const performance = makePerformance([invalidAccount, validAccount]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    await waitFor(() => expect(fetchHierarchyMock).toHaveBeenCalledTimes(1));
    expect(fetchHierarchyMock).toHaveBeenCalledWith('asset-valid', 'last_30d', 'campaign', null, 1, 100);
  });

  it('renderiza estado vazio quando a RPC retorna empty', async () => {
    fetchHierarchyMock.mockResolvedValue({ state: 'empty', items: [], total: 0 });
    const performance = makePerformance([makeAccount()]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Nenhuma campanha encontrada no período.')).toBeInTheDocument();
  });

  it('renderiza aviso de período não sincronizado', async () => {
    fetchHierarchyMock.mockResolvedValue({ state: 'period_not_synced', items: [], total: 0 });
    const performance = makePerformance([makeAccount()]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Esse período ainda não foi sincronizado.')).toBeInTheDocument();
  });

  it('renderiza as campanhas quando a RPC retorna ready', async () => {
    fetchHierarchyMock.mockResolvedValue({
      state: 'ready',
      total: 1,
      items: [
        {
          id: 'camp-1',
          name: 'Campanha de Leads',
          status: 'ACTIVE',
          effectiveStatus: 'ACTIVE',
          objective: 'OUTCOME_LEADS',
          classifiedObjective: 'LEADS',
          destinationType: 'WHATSAPP',
          attributionSetting: '7d_click_1d_view',
          creativeId: null,
          metrics: {
            spend: metric(100),
            purchases: metric(2),
            purchase_roas: metric(3.5),
          },
        },
      ],
    });
    const account = makeAccount({ adAccountId: 'act_999' });
    const performance = makePerformance([account]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText('Campanha de Leads')).toBeInTheDocument();
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
    fetchHierarchyMock.mockResolvedValue({ state: 'empty', items: [], total: 0 });
    const accountA = makeAccount({ clientMetaAssetId: 'asset-a', accountName: 'Conta A' });
    const accountB = makeAccount({ clientMetaAssetId: 'asset-b', accountName: 'Conta B' });
    const performance = makePerformance([accountA, accountB]);

    render(<ClientCampaignDrawer isOpen onClose={() => {}} performance={performance} period="last_30d" />);

    expect(await screen.findByText(/Exibindo a primeira conta Meta vinculada: Conta A/)).toBeInTheDocument();
  });
});
