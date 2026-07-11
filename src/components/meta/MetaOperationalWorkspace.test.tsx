import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { loadClientMetaAssetCatalogMock, syncMetaAssetMock } = vi.hoisted(() => ({
  loadClientMetaAssetCatalogMock: vi.fn(),
  syncMetaAssetMock: vi.fn(),
}));

vi.mock('../../lib/meta/clientMetaAssetService', () => ({
  loadClientMetaAssetCatalog: loadClientMetaAssetCatalogMock,
  linkClientMetaAsset: vi.fn(),
  unlinkClientMetaAsset: vi.fn(),
}));

vi.mock('../../lib/meta/metaSyncService', () => ({
  syncMetaAsset: syncMetaAssetMock,
}));

vi.mock('./MetaHierarchyExplorer', () => ({
  MetaHierarchyExplorer: () => <div data-testid="mock-hierarchy-explorer" />,
}));

vi.mock('./TargetSettingsDrawer', () => ({
  TargetSettingsDrawer: () => null,
}));

import { MetaOperationalWorkspace } from './MetaOperationalWorkspace';
import type { CamplyData } from '../../types';

const account = {
  clientMetaAssetId: 'link-123',
  metaAssetId: 'asset-456',
  integrationId: 'integration-1',
  adAccountId: 'act_789',
  accountName: 'Conta Operacional',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  assetStatus: 'ACTIVE',
  linkedAt: '2026-07-01T00:00:00.000Z',
  availablePeriods: ['this_month'],
  lastAttempt: null,
  lastSuccess: null,
};

const baseData = {
  clients: [{ id: 'client-1', company: 'Cliente Teste', name: 'Cliente Teste' }],
} as unknown as CamplyData;

describe('MetaOperationalWorkspace sync contract', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    loadClientMetaAssetCatalogMock.mockReset();
    syncMetaAssetMock.mockReset();
    loadClientMetaAssetCatalogMock.mockResolvedValue({
      clients: [{ clientId: 'client-1', clientName: 'Cliente Teste', accounts: [account] }],
      availableAssets: [],
    });
    syncMetaAssetMock.mockResolvedValue({ success: true, status: 'success', runId: 'run-1' });
  });

  it('syncs using clientMetaAssetId, never metaAssetId, when the operator clicks sync', async () => {
    render(<MetaOperationalWorkspace data={baseData} initialClientId="client-1" />);

    await waitFor(() => expect(screen.getByTestId('meta-sync-period')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('meta-sync-period'));

    await waitFor(() => expect(syncMetaAssetMock).toHaveBeenCalled());
    const [input] = syncMetaAssetMock.mock.calls[0];
    expect(input).toMatchObject({ clientMetaAssetId: 'link-123', requestedLevel: 'campaign' });
    expect(input).not.toHaveProperty('metaAssetId');
  });
});
