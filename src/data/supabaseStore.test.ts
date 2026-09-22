import { beforeEach, describe, expect, it, vi } from 'vitest';

type SelectResponse = { data: unknown; error: { message: string; code?: string } | null };
type RpcResponse = { data: unknown; error: { message: string; code?: string } | null };

const mockState = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  selectQueue: [] as SelectResponse[],
  rpcQueue: [] as RpcResponse[],
  rpcCalls: [] as Array<Record<string, unknown>>,
  upsertCalls: [] as Array<Record<string, unknown>>,
  rpcHandler: null as null | (() => Promise<RpcResponse>),
}));

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseSessionUserId: () => mockState.userId,
  supabaseData: {
    from: () => ({
      select: () => {
        const query = {
          eq: () => query,
          is: () => query,
          maybeSingle: async () => mockState.selectQueue.shift() ?? { data: null, error: null },
        };
        return query;
      },
      upsert: (value: Record<string, unknown>) => {
        mockState.upsertCalls.push(value);
        return Promise.resolve({ error: null });
      },
    }),
    rpc: (_name: string, args: Record<string, unknown>) => {
      mockState.rpcCalls.push(args);
      if (mockState.rpcHandler) return mockState.rpcHandler();
      return Promise.resolve(
        mockState.rpcQueue.shift() ?? { data: null, error: { message: 'rpc queue empty' } }
      );
    },
  },
}));

import { initialData } from './camplyStore';
import { CamplyData } from '../types';
import {
  hasNewerRemoteVersion,
  loadRemoteData,
  resetRemoteWorkspaceState,
  saveRemoteData,
  saveRemoteDataAndConfirmClient,
} from './supabaseStore';

const workspaceFixture = { ...initialData, notes: [] };

beforeEach(() => {
  resetRemoteWorkspaceState();
  mockState.userId = 'user-1';
  mockState.selectQueue = [];
  mockState.rpcQueue = [];
  mockState.rpcCalls = [];
  mockState.upsertCalls = [];
  mockState.rpcHandler = null;
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

    mockState.rpcQueue.push({ data: { status: 'saved', version: 8 }, error: null });
    const saved = await saveRemoteData({ ...workspaceFixture, fakeData: 1 } as unknown as CamplyData);
    expect(saved.status).toBe('saved');
    expect(mockState.rpcCalls[0].p_expected_version).toBe(7);
  });
});

describe('saveRemoteData', () => {
  it('chains versions across consecutive saves', async () => {
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 3 }, error: null });
    await loadRemoteData();

    mockState.rpcQueue.push({ data: { status: 'saved', version: 4 }, error: null });
    mockState.rpcQueue.push({ data: { status: 'saved', version: 5 }, error: null });
    await saveRemoteData({ ...workspaceFixture, fakeData: 1 } as unknown as CamplyData);
    await saveRemoteData({ ...workspaceFixture, fakeData: 2 } as unknown as CamplyData);

    expect(mockState.rpcCalls.map(c => c.p_expected_version)).toEqual([3, 4]);
  });

  it('returns conflict with the remote workspace so the app can reload instead of overwriting', async () => {
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 3 }, error: null });
    await loadRemoteData();

    mockState.rpcQueue.push({ data: { status: 'conflict', current_version: 12 }, error: null });
    // Row fetched after the conflict: another device already wrote version 12.
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 12 }, error: null });

    const result = await saveRemoteData({ ...workspaceFixture, fakeData: 1 } as unknown as CamplyData);
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.remoteData).not.toBeNull();
    }

    // The next save must build on the fetched version, not the stale one.
    mockState.rpcQueue.push({ data: { status: 'saved', version: 13 }, error: null });
    await saveRemoteData({ ...workspaceFixture, fakeData: 2 } as unknown as CamplyData);
    expect(mockState.rpcCalls[1].p_expected_version).toBe(12);
  });

  it('returns error on non-conflict failures', async () => {
    mockState.rpcQueue.push({ data: null, error: { message: 'permission denied' } });
    const result = await saveRemoteData({ ...workspaceFixture, fakeData: 1 } as unknown as CamplyData);
    expect(result).toEqual({ status: 'error', message: 'permission denied' });
    expect(mockState.upsertCalls).toHaveLength(0);
  });

  it('returns the same pending result instead of reporting an unconfirmed save as skipped', async () => {
    let completeRpc!: (response: RpcResponse) => void;
    mockState.rpcHandler = () => new Promise<RpcResponse>((resolve) => { completeRpc = resolve; });
    const payload = { ...workspaceFixture, fakeData: 1 } as unknown as CamplyData;
    const first = saveRemoteData(payload);
    const second = saveRemoteData(payload);
    await vi.waitFor(() => expect(mockState.rpcCalls).toHaveLength(1));
    completeRpc({ data: null, error: { message: 'database unavailable' } });
    expect(await first).toEqual({ status: 'error', message: 'database unavailable' });
    expect(await second).toEqual({ status: 'error', message: 'database unavailable' });
    expect(mockState.upsertCalls).toHaveLength(0);
  });

  it('does not confirm a client when its transactional save failed', async () => {
    mockState.rpcQueue.push({ data: null, error: { message: 'database unavailable' } });
    await expect(saveRemoteDataAndConfirmClient(workspaceFixture, 'client-1'))
      .rejects.toThrow('Não foi possível confirmar a gravação do cliente no banco');
    expect(mockState.upsertCalls).toHaveLength(0);
  });

  it('does not fabricate client identity if the saved registry row cannot be confirmed', async () => {
    mockState.rpcQueue.push({ data: { status: 'saved', version: 1 }, error: null });
    mockState.selectQueue.push({ data: null, error: null });
    await expect(saveRemoteDataAndConfirmClient(workspaceFixture, 'client-1'))
      .rejects.toThrow('vínculo no banco não pôde ser confirmado');
    expect(mockState.upsertCalls).toHaveLength(0);
  });

  it('skips saving if payload is identical to last successfully saved payload', async () => {
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 3 }, error: null });
    await loadRemoteData(); // This populates lastSavedPayloadStr with workspaceFixture

    const result = await saveRemoteData(workspaceFixture); // Should be identical
    expect(result.status).toBe('skipped');
    // RPC queue will not be consumed
    expect(mockState.rpcCalls.length).toBe(0);
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
