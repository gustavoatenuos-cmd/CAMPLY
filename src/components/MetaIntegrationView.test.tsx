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

vi.mock('../lib/invokeFunction', () => ({
  invokeFunction: invokeFunctionMock,
}));

vi.mock('../lib/meta/clientMetaAssetService', () => ({
  loadCachedClientMetaAssetCatalog: vi.fn(() => null),
  loadClientMetaAssetCatalog: loadClientMetaAssetCatalogMock,
}));

vi.mock('../lib/meta/metaSyncService', () => ({
  syncMetaAsset: syncMetaAssetMock,
}));

vi.mock('./meta/MetaOperationalWorkspace', () => ({
  MetaOperationalWorkspace: () => <div data-testid="mock-operational-workspace" />,
}));

import { MetaIntegrationView } from './MetaIntegrationView';
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

const baseData = { clients: [] } as unknown as CamplyData;

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
});
