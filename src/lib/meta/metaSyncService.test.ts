import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeFunctionMock = vi.fn();

vi.mock('../invokeFunction', () => ({
  invokeFunction: (...args: unknown[]) => invokeFunctionMock(...args),
  InvokeError: class InvokeError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import {
  syncMetaAsset,
  type OperationalMetaSyncInput,
} from './metaSyncService';

describe('syncMetaAsset operational contract', () => {
  beforeEach(() => invokeFunctionMock.mockReset());

  it('requires clientMetaAssetId and refuses to call the backend without it', async () => {
    const input = { clientMetaAssetId: '', period: 'last_90d' } as OperationalMetaSyncInput;

    await expect(syncMetaAsset(input)).rejects.toThrow(
      'A sincronização operacional exige uma conta Meta vinculada a um cliente.'
    );
    expect(invokeFunctionMock).not.toHaveBeenCalled();
  });

  it('does not accept metaAssetId as a substitute for clientMetaAssetId (compile-time contract)', () => {
    // @ts-expect-error metaAssetId is no longer a valid operational sync key
    const invalidInput: OperationalMetaSyncInput = { metaAssetId: 'asset-1', period: 'last_90d' };
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
      period: 'last_90d',
      requestedLevel: 'campaign',
    });

    expect(result).toMatchObject({ success: true, status: 'success', runId: 'run-1' });
    expect(invokeFunctionMock).toHaveBeenCalledWith('meta-sync-performance', expect.objectContaining({
      clientMetaAssetId: 'link-abc',
      periods: ['last_90d'],
      requestedLevel: 'campaign',
    }), expect.any(Number));
  });
});
