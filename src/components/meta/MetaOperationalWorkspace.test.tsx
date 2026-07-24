import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const { loadClientMetaAssetCatalogMock } = vi.hoisted(() => ({
  loadClientMetaAssetCatalogMock: vi.fn(),
}));

vi.mock('../../lib/meta/clientMetaAssetService', () => ({
  loadClientMetaAssetCatalog: loadClientMetaAssetCatalogMock,
  linkClientMetaAsset: vi.fn(),
  unlinkClientMetaAsset: vi.fn(),
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
  availablePeriods: ['last_90d'],
  lastAttempt: null,
  lastSuccess: null,
};

const baseData = {
  clients: [{ id: 'client-1', company: 'Cliente Teste', name: 'Cliente Teste' }],
} as unknown as CamplyData;

describe('MetaOperationalWorkspace read-only contract', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    loadClientMetaAssetCatalogMock.mockReset();
    loadClientMetaAssetCatalogMock.mockResolvedValue({
      clients: [{ clientId: 'client-1', clientName: 'Cliente Teste', accounts: [account] }],
      availableAssets: [],
    });
  });

  it('does not render any sync action outside Meta Integration', async () => {
    render(<MetaOperationalWorkspace data={baseData} initialClientId="client-1" />);

    await waitFor(() => expect(screen.getByTestId('meta-account-name')).toBeInTheDocument());

    expect(screen.getByTestId('meta-period-select')).toHaveValue('last_90d');
    expect(screen.queryByRole('option', { name: 'Mês atual' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Semana atual' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Últimos 30 dias' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('meta-sync-period')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meta-sync-account')).not.toBeInTheDocument();
    expect(screen.getByText(/sincronização oficial acontece somente/i)).toBeInTheDocument();
  });
});
