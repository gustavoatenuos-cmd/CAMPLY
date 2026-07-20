import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { invokeFunctionMock, loadClientMetaAssetCatalogMock, syncMetaAssetMock } = vi.hoisted(() => ({
  invokeFunctionMock: vi.fn(),
  loadClientMetaAssetCatalogMock: vi.fn(),
  syncMetaAssetMock: vi.fn(),
}));

vi.mock('../lib/invokeFunction', async (importOriginal) => {
  // Preserva a classe real InvokeError - bulkSyncDiagnostics.ts faz `instanceof InvokeError`,
  // que quebraria (undefined não é um construtor válido) se o módulo inteiro fosse mockado.
  const actual = await importOriginal<typeof import('../lib/invokeFunction')>();
  return { ...actual, invokeFunction: invokeFunctionMock };
});

vi.mock('../lib/meta/clientMetaAssetService', () => ({
  loadCachedClientMetaAssetCatalog: vi.fn(() => null),
  loadClientMetaAssetCatalog: loadClientMetaAssetCatalogMock,
}));

vi.mock('../lib/meta/metaSyncService', () => ({
  OFFICIAL_META_SYNC_PERIOD: 'last_90d',
  syncMetaAsset: syncMetaAssetMock,
}));

vi.mock('./meta/MetaOperationalWorkspace', () => ({
  MetaOperationalWorkspace: () => <div data-testid="mock-operational-workspace" />,
}));

import { MetaIntegrationView } from './MetaIntegrationView';
import { InvokeError } from '../lib/invokeFunction';
import type { CamplyData } from '../types';

const linkedAccount = {
  clientMetaAssetId: 'link-linked-1',
  metaAssetId: 'asset-linked-1',
  integrationId: 'integration-1',
  adAccountId: 'act_linked',
  accountName: 'Conta Vinculada',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  assetStatus: 'ACTIVE',
  linkedAt: '2026-07-01T00:00:00.000Z',
  availablePeriods: [],
  lastAttempt: null,
  lastSuccess: null,
};

const baseData = { clients: [], projects: [] } as unknown as CamplyData;

function catalogWithOneLinkedAndOneAvailable() {
  return {
    clients: [{ clientId: 'client-1', clientName: 'Cliente Vinculado', accounts: [linkedAccount] }],
    availableAssets: [{
      metaAssetId: 'asset-available-1',
      integrationId: 'integration-1',
      adAccountId: 'act_available',
      accountName: 'Conta Disponível',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      assetStatus: 'ACTIVE',
      linkedClientId: null,
      clientMetaAssetId: null,
    }],
  };
}

describe('MetaIntegrationView linked-vs-available accounts', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    invokeFunctionMock.mockReset();
    loadClientMetaAssetCatalogMock.mockReset();
    syncMetaAssetMock.mockReset();
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithOneLinkedAndOneAvailable());
    syncMetaAssetMock.mockResolvedValue({ success: true, status: 'success', runId: 'run-1' });
  });

  it('separates linked accounts from available-to-link accounts, and hides available ones behind a toggle', async () => {
    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Cliente Vinculado')).toBeInTheDocument());
    expect(screen.queryByText('Conta Disponível')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Ver contas disponíveis para vínculo/));
    expect(screen.getByText('Conta Disponível')).toBeInTheDocument();
  });

  it('bulk-syncs only linked accounts and never calls sync for available (unlinked) assets', async () => {
    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('meta-sync-linked-clients'));

    await waitFor(() => expect(syncMetaAssetMock).toHaveBeenCalledTimes(1));
    expect(syncMetaAssetMock).toHaveBeenCalledWith(expect.objectContaining({
      clientMetaAssetId: 'link-linked-1',
    }));

    await waitFor(() => expect(screen.getByTestId('meta-bulk-sync-progress')).toHaveTextContent('1/1'));
  });

  it('disables bulk sync when there are no linked accounts', async () => {
    loadClientMetaAssetCatalogMock.mockResolvedValue({ clients: [], availableAssets: [] });

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).toBeDisabled());
    expect(syncMetaAssetMock).not.toHaveBeenCalled();
  });

  it('shows account readiness without treating missing run evidence as sync success', async () => {
    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('meta-linked-account-row')).toBeInTheDocument());
    expect(screen.getByTestId('meta-linked-account-row')).toHaveTextContent('Conta pronta');
    expect(screen.getByTestId('meta-linked-account-row')).toHaveTextContent('sync: sem tentativa');
    expect(screen.getByTestId('meta-linked-account-row')).not.toHaveTextContent('Sucesso');
  });

  it('shows account readiness separately from the last sync evidence', async () => {
    const freshSuccess = {
      id: 'run-fresh',
      status: 'success' as const,
      period: 'this_month',
      level: 'campaign',
      scope: 'full_account',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    loadClientMetaAssetCatalogMock.mockResolvedValue({
      clients: [{ clientId: 'client-1', clientName: 'Cliente Vinculado', accounts: [{ ...linkedAccount, lastSuccess: freshSuccess }] }],
      availableAssets: [],
    });

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('meta-linked-account-row')).toBeInTheDocument());
    expect(screen.getByTestId('meta-linked-account-row')).toHaveTextContent('Conta pronta');
    expect(screen.getByTestId('meta-linked-account-row')).toHaveTextContent('sync: success');
    expect(screen.getByTestId('meta-linked-account-row')).toHaveTextContent('Run: run-fresh');
    expect(screen.getByTestId('meta-linked-account-row')).toHaveTextContent('Run: run-fresh');
    expect(screen.getByTestId('meta-linked-account-row')).not.toHaveTextContent('Sync pronto');
  });
});

describe('MetaIntegrationView excludes inactive clients from sync', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    invokeFunctionMock.mockReset();
    loadClientMetaAssetCatalogMock.mockReset();
    syncMetaAssetMock.mockReset();
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithOneLinkedAndOneAvailable());
    syncMetaAssetMock.mockResolvedValue({ success: true, status: 'success', runId: 'run-1' });
  });

  const pausedClientData = {
    clients: [{ id: 'client-1', status: 'paused', name: 'Cliente Pausado', company: '' }],
    projects: [],
  } as unknown as CamplyData;

  it('does not render the paused client\'s account as an active linked-account row, and disables bulk sync', async () => {
    render(<MetaIntegrationView data={pausedClientData} updateData={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('meta-inactive-accounts-toggle')).toBeInTheDocument());
    expect(screen.queryByTestId('meta-linked-account-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('meta-sync-linked-clients')).toBeDisabled();
  });

  it('shows the paused client under the collapsed "Contas fora da operação" section with the inactive badge', async () => {
    render(<MetaIntegrationView data={pausedClientData} updateData={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('meta-inactive-accounts-toggle')).toHaveTextContent('Contas fora da operação (1)'));
    expect(screen.queryByTestId('meta-inactive-account-row')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('meta-inactive-accounts-toggle'));
    expect(screen.getByTestId('meta-inactive-account-row')).toHaveTextContent('Cliente Vinculado');
    expect(screen.getByTestId('meta-inactive-account-badge')).toHaveTextContent('Cliente inativo — fora da sincronização');
  });

  it('never calls syncMetaAsset for a paused client even when bulk sync is somehow triggered', async () => {
    render(<MetaIntegrationView data={pausedClientData} updateData={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('meta-inactive-accounts-toggle')).toBeInTheDocument());

    // O botão está desabilitado no DOM, mas o teste garante a regra na
    // função em si (defesa em profundidade), não só no atributo disabled.
    fireEvent.click(screen.getByTestId('meta-sync-linked-clients'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncMetaAssetMock).not.toHaveBeenCalled();
  });

  it('a client that is active again after being reactivated returns to the normal linked-account list', async () => {
    const activeClientData = {
      clients: [{ id: 'client-1', status: 'active', name: 'Cliente Reativado', company: '' }],
      projects: [],
    } as unknown as CamplyData;
    render(<MetaIntegrationView data={activeClientData} updateData={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('meta-linked-account-row')).toBeInTheDocument());
    expect(screen.queryByTestId('meta-inactive-accounts-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled();
  });
});

function catalogWithAccounts(count: number) {
  return {
    clients: Array.from({ length: count }, (_, i) => ({
      clientId: `client-${i + 1}`,
      clientName: `Cliente ${i + 1}`,
      accounts: [{
        ...linkedAccount,
        clientMetaAssetId: `link-${i + 1}`,
        accountName: `Conta ${i + 1}`,
        adAccountId: `act_${i + 1}`,
      }],
    })),
    availableAssets: [],
  };
}

describe('MetaIntegrationView bulk sync diagnostics', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    invokeFunctionMock.mockReset();
    loadClientMetaAssetCatalogMock.mockReset();
    syncMetaAssetMock.mockReset();
  });

  it('reports success for every account when all syncs succeed', async () => {
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithAccounts(3));
    syncMetaAssetMock.mockResolvedValue({ success: true, status: 'success', runId: 'run-ok' });

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('meta-sync-linked-clients'));

    await waitFor(() => expect(screen.getByTestId('meta-bulk-sync-progress')).toHaveTextContent('3 sucesso'));
    expect(screen.getByRole('status')).toHaveTextContent('Sincronização concluída: 3 sucesso.');
  });

  it('counts a partial result as partial, never as failed', async () => {
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithAccounts(1));
    syncMetaAssetMock.mockResolvedValue({ success: true, status: 'partial', runId: 'run-partial', message: 'Alguns adsets falharam' });

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('meta-sync-linked-clients'));

    await waitFor(() => expect(screen.getByTestId('meta-bulk-sync-progress')).toHaveTextContent('1 parcial'));
    expect(screen.getByTestId('meta-bulk-sync-progress')).not.toHaveTextContent('falha');
    expect(screen.getByRole('status')).toHaveTextContent('1 parcial');
  });

  it('does not count a 409/already-running result as a fatal failure', async () => {
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithAccounts(1));
    syncMetaAssetMock.mockResolvedValue({ success: true, status: 'running', runId: null, message: 'Sincronização já em andamento' });

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('meta-sync-linked-clients'));

    await waitFor(() => expect(screen.getByTestId('meta-bulk-sync-progress')).toHaveTextContent('1/1'));
    expect(screen.getByTestId('meta-bulk-sync-progress')).not.toHaveTextContent('falha');
    expect(screen.getByRole('status')).toHaveTextContent('1 em andamento');
  });

  it('surfaces the real thrown error message in the per-account result instead of swallowing it', async () => {
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithAccounts(1));
    syncMetaAssetMock.mockRejectedValue(new InvokeError('Token Meta expirado', 401));

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('meta-sync-linked-clients'));

    await waitFor(() => expect(screen.getByTestId('meta-bulk-sync-results')).toBeInTheDocument());
    expect(screen.getByTestId('meta-bulk-sync-results')).toHaveTextContent('Token Meta expirado');
    expect(screen.getByTestId('meta-bulk-sync-retry')).toBeInTheDocument();
  });

  it('shows a per-account message for every account when all 11 fail', async () => {
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithAccounts(11));
    syncMetaAssetMock.mockImplementation(async ({ clientMetaAssetId }: { clientMetaAssetId: string }) => {
      throw new Error(`Falha na conta ${clientMetaAssetId}`);
    });

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('meta-sync-linked-clients'));

    // Todas as 11 linhas já aparecem como 'pending' assim que initializeBulkSyncProgress
    // roda - esperar só a contagem de linhas corre risco de checar o texto por conta antes
    // do loop sequencial terminar. Espera o alerta final (só aparece após todas concluírem).
    await waitFor(() => (
      expect(screen.getByRole('alert')).toHaveTextContent('Nenhuma conta foi sincronizada. Veja os erros abaixo.')
    ));
    expect(screen.getAllByTestId('meta-bulk-sync-result-row')).toHaveLength(11);
    for (let i = 1; i <= 11; i++) {
      expect(screen.getByText(`Falha na conta link-${i}`)).toBeInTheDocument();
    }
  });

  it('shows the aggregated message with correct counts across mixed outcomes', async () => {
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithAccounts(4));
    syncMetaAssetMock
      .mockResolvedValueOnce({ success: true, status: 'success', runId: 'r1' })
      .mockResolvedValueOnce({ success: true, status: 'partial', runId: 'r2', message: 'parcial' })
      .mockResolvedValueOnce({ success: true, status: 'running', runId: null, message: 'Sincronização já em andamento' })
      .mockRejectedValueOnce(new Error('Falha real'));

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('meta-sync-linked-clients'));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Sincronização concluída: 1 sucesso, 1 parcial, 1 em andamento, 1 falha.'
    ));
  });

  it('does not render the linked-account badge as a sync status indicator', async () => {
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithAccounts(1));

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('meta-linked-account-row')).toBeInTheDocument());

    // Antes de qualquer Sincronização, a linha mostra só o vínculo (ícone de
    // link), sem nenhum badge de status de sync (sucesso/falha/parcial/etc).
    expect(screen.getByTitle('Conta vinculada ao cliente')).toBeInTheDocument();
    expect(screen.queryByText('Sucesso')).not.toBeInTheDocument();
    expect(screen.queryByText('Falha')).not.toBeInTheDocument();
    expect(screen.queryByText('Pendente')).not.toBeInTheDocument();
  });

  it('disables the main bulk-sync button while a single-account retry is in flight', async () => {
    loadClientMetaAssetCatalogMock.mockResolvedValue(catalogWithAccounts(1));
    syncMetaAssetMock.mockRejectedValueOnce(new Error('Falha inicial'));

    render(<MetaIntegrationView data={baseData} updateData={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('meta-sync-linked-clients'));
    await waitFor(() => expect(screen.getByTestId('meta-bulk-sync-retry')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());

    // A retentativa fica pendurada (nunca resolve neste teste) para provar que,
    // enquanto ela está em voo, o botão de Sincronização em massa é desabilitado -
    // evitando a corrida entre um retry e um novo lote sobre os mesmos contadores.
    let releaseRetry: (() => void) | undefined;
    syncMetaAssetMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseRetry = () => resolve({ success: true, status: 'success', runId: 'run-retry' });
    }));

    fireEvent.click(screen.getByTestId('meta-bulk-sync-retry'));
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).toBeDisabled());

    releaseRetry?.();
    await waitFor(() => expect(screen.getByTestId('meta-sync-linked-clients')).not.toBeDisabled());
  });
});
