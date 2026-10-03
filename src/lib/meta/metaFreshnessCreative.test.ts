import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncMetaAssetMock } = vi.hoisted(() => ({
  syncMetaAssetMock: vi.fn(),
}));

vi.mock('./metaSyncService', () => ({
  syncMetaAsset: syncMetaAssetMock,
}));

vi.mock('../supabase', () => ({
  supabaseData: {},
}));

vi.mock('./metaE2ERuntime', () => ({
  isMetaE2EMode: false,
}));

import {
  refreshStaleMetaCreatives,
  type MetaFreshnessSnapshot,
} from './metaFreshnessService';

function snapshot(): MetaFreshnessSnapshot {
  return {
    state: 'ready',
    checkedAt: '2026-10-03T20:00:00.000Z',
    items: [
      {
        clientId: 'client-a',
        clientMetaAssetId: 'link-a',
        accountId: 'act_a',
        accountName: 'Conta A',
        timezone: 'America/Sao_Paulo',
        localToday: '2026-10-03',
        structureLastSyncedAt: '2026-10-03T19:50:00.000Z',
        structureDateStop: '2026-10-03',
        creativeLastSyncedAt: null,
        creativeDateStop: null,
        structureFresh: true,
        creativeFresh: false,
        needsStructureRefresh: false,
        needsCreativeRefresh: true,
      },
      {
        clientId: 'client-b',
        clientMetaAssetId: 'link-b',
        accountId: 'act_b',
        accountName: 'Conta B',
        timezone: 'America/Sao_Paulo',
        localToday: '2026-10-03',
        structureLastSyncedAt: '2026-10-03T19:50:00.000Z',
        structureDateStop: '2026-10-03',
        creativeLastSyncedAt: '2026-10-03T19:45:00.000Z',
        creativeDateStop: '2026-10-03',
        structureFresh: true,
        creativeFresh: true,
        needsStructureRefresh: false,
        needsCreativeRefresh: false,
      },
      {
        clientId: 'client-c',
        clientMetaAssetId: 'link-c',
        accountId: 'act_c',
        accountName: 'Conta C',
        timezone: 'America/Sao_Paulo',
        localToday: '2026-10-03',
        structureLastSyncedAt: '2026-10-03T19:50:00.000Z',
        structureDateStop: '2026-10-03',
        creativeLastSyncedAt: null,
        creativeDateStop: null,
        structureFresh: true,
        creativeFresh: false,
        needsStructureRefresh: false,
        needsCreativeRefresh: true,
      },
    ],
  };
}

describe('refreshStaleMetaCreatives', () => {
  beforeEach(() => {
    syncMetaAssetMock.mockReset();
    syncMetaAssetMock.mockResolvedValue({
      success: true,
      status: 'success',
      runId: 'run-1',
    });
  });

  it('refreshes only stale creative-depth accounts inside the selected client set', async () => {
    const progress: Array<[number, number]> = [];

    const result = await refreshStaleMetaCreatives(
      snapshot(),
      new Set(['client-a', 'client-b']),
      (completed, total) => progress.push([completed, total]),
    );

    expect(syncMetaAssetMock).toHaveBeenCalledTimes(1);
    expect(syncMetaAssetMock).toHaveBeenCalledWith({
      clientMetaAssetId: 'link-a',
      period: 'last_90d',
      requestedLevel: 'creative',
    });
    expect(result).toEqual({
      attempted: 1,
      failed: 0,
      completed: 1,
      failures: [],
    });
    expect(progress).toEqual([[1, 1]]);
  });

  it('keeps failures visible instead of pretending the Lab is ready', async () => {
    syncMetaAssetMock.mockResolvedValue({
      success: false,
      status: 'failed',
      message: 'Meta API rate limited',
    });

    const result = await refreshStaleMetaCreatives(
      snapshot(),
      new Set(['client-a']),
    );

    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({
        clientMetaAssetId: 'link-a',
        accountName: 'Conta A',
        message: 'Meta API rate limited',
      }),
    ]);
  });
});
