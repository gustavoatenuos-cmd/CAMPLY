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
      select: () => {
        const builder = {
          eq: () => builder,
          is: () => builder,
          maybeSingle: async () =>
            mockState.selectQueue.shift() ?? { data: null, error: null },
        };
        return builder;
      },
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
import { CamplyData } from '../types';
import {
  WorkspacePersistenceError,
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
    expect(result).toMatchObject({ status: 'ok', version: 7 });

    mockState.rpcQueue.push({ data: { status: 'saved', version: 8 }, error: null });
    const saved = await saveRemoteData({ ...workspaceFixture, fakeData: 1 } as unknown as CamplyData);
    expect(saved).toEqual({ status: 'saved', version: 8 });
    expect(mockState.rpcCalls[0].p_expected_version).toBe(7);
  });
});

describe('saveRemoteData', () => {
  it('starts a fresh optimistic version when the authenticated user changes', async () => {
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 7 }, error: null });
    await loadRemoteData();

    mockState.userId = 'user-2';
    mockState.rpcQueue.push({ data: { status: 'saved', version: 1 }, error: null });
    const result = await saveRemoteData({ ...workspaceFixture, fakeData: 1 } as unknown as CamplyData);

    expect(result).toEqual({ status: 'saved', version: 1 });
    expect(mockState.rpcCalls[0].p_expected_version).toBeNull();
  });

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
      expect(result.remoteVersion).toBe(12);
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

describe('saveRemoteDataAndConfirmClient', () => {
  it('exposes a typed conflict instead of requiring callers to parse text', async () => {
    mockState.rpcQueue.push({ data: { status: 'conflict', current_version: 12 }, error: null });
    mockState.selectQueue.push({ data: { data: workspaceFixture, version: 12 }, error: null });

    await expect(
      saveRemoteDataAndConfirmClient(
        { ...workspaceFixture, fakeData: 1 } as unknown as CamplyData,
        'client-1'
      )
    ).rejects.toMatchObject<Partial<WorkspacePersistenceError>>({
      name: 'WorkspacePersistenceError',
      code: 'WORKSPACE_CONFLICT',
    });
  });

  it('distinguishes a missing client identity after the workspace was saved', async () => {
    mockState.rpcQueue.push({ data: { status: 'saved', version: 1 }, error: null });
    mockState.selectQueue.push({ data: null, error: null });

    await expect(
      saveRemoteDataAndConfirmClient(
        { ...workspaceFixture, fakeData: 1 } as unknown as CamplyData,
        'client-1'
      )
    ).rejects.toMatchObject<Partial<WorkspacePersistenceError>>({
      name: 'WorkspacePersistenceError',
      code: 'CLIENT_IDENTITY_NOT_CONFIRMED',
    });
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
