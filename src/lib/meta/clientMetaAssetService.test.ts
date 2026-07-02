import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeFunctionMock } = vi.hoisted(() => ({
  invokeFunctionMock: vi.fn(),
}));

vi.mock('../invokeFunction', () => ({
  invokeFunction: invokeFunctionMock,
}));

vi.mock('../supabase', () => ({
  getSupabaseSessionUserId: () => '412e0bce-e32f-423c-8864-96e127233b98',
  supabaseData: {},
}));

vi.mock('./metaE2ERuntime', () => ({
  E2E_ASSET_ID: 'asset-e2e',
  E2E_CLIENT_ID: 'client-e2e',
  E2E_LINK_ID: 'link-e2e',
  isMetaE2EMode: false,
  metaE2EState: { linked: false, syncedPeriods: new Set() },
  persistMetaE2EState: vi.fn(),
}));

import { linkClientMetaAsset, unlinkClientMetaAsset } from './clientMetaAssetService';

describe('clientMetaAssetService mutations', () => {
  beforeEach(() => invokeFunctionMock.mockReset());

  it('links an account through the protected Edge mutation', async () => {
    invokeFunctionMock.mockResolvedValue({ success: true, clientMetaAssetId: 'link-123' });

    await expect(linkClientMetaAsset('client-123', '11111111-1111-4111-8111-111111111111'))
      .resolves.toBe('link-123');
    expect(invokeFunctionMock).toHaveBeenCalledWith('meta-client-assets', {
      action: 'link',
      clientId: 'client-123',
      metaAssetId: '11111111-1111-4111-8111-111111111111',
    }, 15_000);
  });

  it('unlinks an account through the protected Edge mutation', async () => {
    invokeFunctionMock.mockResolvedValue({ success: true });

    await expect(unlinkClientMetaAsset('22222222-2222-4222-8222-222222222222'))
      .resolves.toBeUndefined();
    expect(invokeFunctionMock).toHaveBeenCalledWith('meta-client-assets', {
      action: 'unlink',
      clientMetaAssetId: '22222222-2222-4222-8222-222222222222',
    }, 15_000);
  });
});
