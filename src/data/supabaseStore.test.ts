import { beforeEach, describe, expect, it, vi } from 'vitest';

type SelectResponse = { data: unknown; error: { message: string; code?: string } | null };
type RpcResponse = { data: unknown; error: { message: string; code?: string } | null };

const mockState = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  selectQueue: [] as SelectResponse[],
  rpcQueue: [] as RpcResponse[],
  rpcCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseSessionUserId: () => mockState.userId,
  supabaseData: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            mockState.selectQueue.shift() ?? { data: null, error: null },
        }),
      }),
    }),
    rpc: (_name: string, args: Record<string, unknown>) => {
      mockState.rpcCalls.push(args);
      return Promise.resolve(
        mockState.rpcQueue.shift() ?? { data: null, error: { message: 'rpc queue empty' } }
      );
    },
  },
}));

import { initialData } from './camplyStore';
import {
  hasNewerRemoteVersion,
  loadRemoteData,
  resetRemoteWorkspaceState,
  saveRemoteData,
} from './supabaseStore';

const workspaceFixture = { ...initialData, notes: [] };

beforeEach(() => {
  resetRemoteWorkspaceState();
  mockState.userId = 'user-1';
  mockState.selectQueue = [];
  mockState.rpcQueue = [];
  mockState.rpcCalls = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadRemoteData', () => {
  it('returns unavailable when there is no authenticated user', async () => {
    mockState.userId = null;
    const result = await loadRemoteData();
    expect(result.status).toBe('unavailable');
  });

  it('returns error when the query fails, instead of pretending the workspace is empty', async () => {
    mockState.selectQueue.push({ data: null, error: { message: 'network down' } });
    const result = await loadRemoteData();
    expect(result).toEqual({ status: 'error', message: 'network down' });
  });

  it('returns empty when the user has no workspace row yet', async () => {
    mockState.selectQueue.push({ data: null, error: null });
    const result = await loadRemoteData();
    expect(result.status).toBe('empty');
  });

  it('returns the normalized workspace and tracks its version for later saves', async () => {
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 7 }, error: null });
    const result = await loadRemoteData();
    expect(result.status).toBe('ok');

    mockState.rpcQueue.push({ data: 8, error: null });
    const saved = await saveRemoteData(workspaceFixture);
    expect(saved.status).toBe('saved');
    expect(mockState.rpcCalls[0].p_expected_version).toBe(7);
  });
});

describe('saveRemoteData', () => {
  it('chains versions across consecutive saves', async () => {
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 3 }, error: null });
    await loadRemoteData();

    mockState.rpcQueue.push({ data: 4, error: null });
    mockState.rpcQueue.push({ data: 5, error: null });
    await saveRemoteData(workspaceFixture);
    await saveRemoteData(workspaceFixture);

    expect(mockState.rpcCalls.map(c => c.p_expected_version)).toEqual([3, 4]);
  });

  it('returns conflict with the remote workspace so the app can reload instead of overwriting', async () => {
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 3 }, error: null });
    await loadRemoteData();

    mockState.rpcQueue.push({ data: null, error: { message: 'stale', code: '40001' } });
    // Row fetched after the conflict: another device already wrote version 12.
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 12 }, error: null });

    const result = await saveRemoteData(workspaceFixture);
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.remoteData).not.toBeNull();
    }

    // The next save must build on the fetched version, not the stale one.
    mockState.rpcQueue.push({ data: 13, error: null });
    await saveRemoteData(workspaceFixture);
    expect(mockState.rpcCalls[1].p_expected_version).toBe(12);
  });

  it('returns error on non-conflict failures', async () => {
    mockState.rpcQueue.push({ data: null, error: { message: 'permission denied' } });
    const result = await saveRemoteData(workspaceFixture);
    expect(result).toEqual({ status: 'error', message: 'permission denied' });
  });
});

describe('hasNewerRemoteVersion', () => {
  it('detects when another device advanced the workspace version', async () => {
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 7 }, error: null });
    await loadRemoteData();

    mockState.selectQueue.push({ data: { version: 9 }, error: null });
    expect(await hasNewerRemoteVersion()).toBe(true);
  });

  it('stays quiet when the local version is current', async () => {
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 7 }, error: null });
    await loadRemoteData();

    mockState.selectQueue.push({ data: { version: 7 }, error: null });
    expect(await hasNewerRemoteVersion()).toBe(false);
  });

  it('treats a row created elsewhere as newer when this device loaded an empty workspace', async () => {
    mockState.selectQueue.push({ data: null, error: null });
    await loadRemoteData();

    mockState.selectQueue.push({ data: { version: 1 }, error: null });
    expect(await hasNewerRemoteVersion()).toBe(true);
  });
});
