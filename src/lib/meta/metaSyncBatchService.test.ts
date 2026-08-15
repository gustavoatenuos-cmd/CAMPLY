import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('../supabase', () => ({
  supabaseData: { rpc: rpcMock },
}));

import {
  finishMetaSyncBatchItem,
  loadLatestMetaSyncBatch,
  persistedBatchToProgress,
  startMetaSyncBatch,
} from './metaSyncBatchService';

const batchPayload = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'running',
  period: 'last_90d',
  total: 2,
  completed: 1,
  success: 1,
  partial: 0,
  failed: 0,
  startedAt: '2026-08-03T12:00:00.000Z',
  finishedAt: null,
  items: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      clientId: 'client-1',
      clientName: 'Cliente 1',
      clientMetaAssetId: '33333333-3333-4333-8333-333333333333',
      accountName: 'Conta 1',
      adAccountId: 'act_1',
      status: 'success',
      runId: '44444444-4444-4444-8444-444444444444',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      clientId: 'client-2',
      clientName: 'Cliente 2',
      clientMetaAssetId: '66666666-6666-4666-8666-666666666666',
      accountName: 'Conta 2',
      adAccountId: 'act_2',
      status: 'pending',
    },
  ],
};

describe('metaSyncBatchService', () => {
  beforeEach(() => rpcMock.mockReset());

  it('loads and maps the latest persisted batch into UI progress', async () => {
    rpcMock.mockResolvedValue({ data: batchPayload, error: null });

    const batch = await loadLatestMetaSyncBatch();
    expect(batch?.items).toHaveLength(2);
    expect(batch && persistedBatchToProgress(batch)).toMatchObject({
      total: 2,
      completed: 1,
      success: 1,
      running: false,
    });
    expect(rpcMock).toHaveBeenCalledWith('get_latest_meta_sync_batch', undefined);
  });

  it('starts only the official last_90d batch for the requested account links', async () => {
    rpcMock.mockResolvedValue({ data: batchPayload, error: null });
    await startMetaSyncBatch([
      '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666',
    ]);

    expect(rpcMock).toHaveBeenCalledWith('start_meta_sync_batch', {
      p_client_meta_asset_ids: [
        '33333333-3333-4333-8333-333333333333',
        '66666666-6666-4666-8666-666666666666',
      ],
      p_period: 'last_90d',
    });
  });

  it('does not send synthetic non-UUID run identifiers to Postgres', async () => {
    rpcMock.mockResolvedValue({ data: { ...batchPayload, status: 'partial' }, error: null });

    await finishMetaSyncBatchItem(
      batchPayload.id,
      batchPayload.items[1].id,
      { status: 'partial', runId: 'run-e2e', message: 'Parcial' }
    );

    expect(rpcMock).toHaveBeenCalledWith('finish_meta_sync_batch_item', expect.objectContaining({
      p_status: 'partial',
      p_run_id: null,
      p_message: 'Parcial',
    }));
  });

  it('falls back cleanly before the additive RPC contract is installed remotely', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.get_latest_meta_sync_batch' },
    });

    await expect(loadLatestMetaSyncBatch()).resolves.toBeNull();
  });

  it('surfaces real persistence failures instead of hiding them', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Unauthorized' },
    });

    await expect(loadLatestMetaSyncBatch()).rejects.toThrow('Unauthorized');
  });
});
