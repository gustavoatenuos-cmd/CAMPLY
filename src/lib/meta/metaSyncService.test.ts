import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeFunctionMock } = vi.hoisted(() => ({
  invokeFunctionMock: vi.fn(),
}));

vi.mock('../invokeFunction', () => ({
  invokeFunction: invokeFunctionMock,
  InvokeError: class InvokeError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('./metaE2ERuntime', () => ({
  isMetaE2EMode: false,
  metaE2EState: { linked: false, syncedPeriods: new Set() },
  persistMetaE2EState: vi.fn(),
}));

import { syncMetaAsset, type OperationalMetaSyncInput } from './metaSyncService';

describe('syncMetaAsset operational contract', () => {
  beforeEach(() => invokeFunctionMock.mockReset());

  it('requires clientMetaAssetId and refuses to call the backend without it', async () => {
    const input = { clientMetaAssetId: '', period: 'this_month' } as OperationalMetaSyncInput;

    await expect(syncMetaAsset(input)).rejects.toThrow(
      'A sincronização operacional exige uma conta Meta vinculada a um cliente.'
    );
    expect(invokeFunctionMock).not.toHaveBeenCalled();
  });

  it('does not accept metaAssetId as a substitute for clientMetaAssetId (compile-time contract)', () => {
    // @ts-expect-error metaAssetId is no longer a valid operational sync key
    const invalidInput: OperationalMetaSyncInput = { metaAssetId: 'asset-1', period: 'this_month' };
    expect(invalidInput).toBeDefined();
  });

  it('calls meta-sync-performance with clientMetaAssetId as the sync key', async () => {
    invokeFunctionMock.mockResolvedValue({
      success: true,
      status: 'success',
      runId: 'run-1',
    });

    const result = await syncMetaAsset({
      clientMetaAssetId: 'link-abc',
      period: 'this_month',
      requestedLevel: 'campaign',
    });

    expect(result).toMatchObject({ success: true, status: 'success', runId: 'run-1' });
    expect(invokeFunctionMock).toHaveBeenCalledWith('meta-sync-performance', expect.objectContaining({
      clientMetaAssetId: 'link-abc',
      periods: ['this_month'],
      requestedLevel: 'campaign',
    }), expect.any(Number));
    const [, payload] = invokeFunctionMock.mock.calls[0];
    expect(payload).not.toHaveProperty('metaAssetId');
    expect(payload).not.toHaveProperty('adAccountId');
  });
});
