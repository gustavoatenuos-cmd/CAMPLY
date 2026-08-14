/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  session: null as Session | null,
  authListener: null as ((event: string, session: Session | null) => void) | null,
  unsubscribe: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  setSupabaseSession: vi.fn(),
  loadData: vi.fn(),
  saveData: vi.fn(),
  clearUserData: vi.fn(),
  setActivityActor: vi.fn(),
  resetRemoteWorkspaceState: vi.fn(),
  loadRemoteData: vi.fn(),
  hasNewerRemoteVersion: vi.fn(async () => false),
  saveRemoteData: vi.fn(),
  saveRemoteDataAndConfirmClient: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  setSupabaseSession: mockState.setSupabaseSession,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: mockState.session } })),
      onAuthStateChange: vi.fn((listener) => {
        mockState.authListener = listener;
        return { data: { subscription: { unsubscribe: mockState.unsubscribe } } };
      }),
      signOut: mockState.signOut,
    },
  },
}));

vi.mock('../data/camplyStore', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/camplyStore')>();
  return {
    ...original,
    loadData: mockState.loadData,
    saveData: mockState.saveData,
    clearUserData: mockState.clearUserData,
    setActivityActor: mockState.setActivityActor,
  };
});

vi.mock('../data/supabaseStore', () => ({
  resetRemoteWorkspaceState: mockState.resetRemoteWorkspaceState,
  loadRemoteData: mockState.loadRemoteData,
  hasNewerRemoteVersion: mockState.hasNewerRemoteVersion,
  saveRemoteData: mockState.saveRemoteData,
  saveRemoteDataAndConfirmClient: mockState.saveRemoteDataAndConfirmClient,
}));

vi.mock('../lib/meta/metaE2ERuntime', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/meta/metaE2ERuntime')>();
  return { ...original, isMetaE2EMode: false };
});

import { initialData } from '../data/camplyStore';
import { useCamplyWorkspace } from './useCamplyWorkspace';

const sessionFor = (id: string, email = `${id}@example.com`) => ({
  access_token: `token-${id}`,
  user: { id, email, user_metadata: {} },
}) as Session;

const localWorkspace = { ...initialData, notes: [{ id: 'local-note' }] } as typeof initialData;
const remoteWorkspace = { ...initialData, notes: [{ id: 'remote-note' }] } as typeof initialData;
const conflictWorkspace = { ...initialData, notes: [{ id: 'conflict-note' }] } as typeof initialData;

beforeEach(() => {
  vi.clearAllMocks();
  mockState.session = sessionFor('user-1');
  mockState.authListener = null;
  mockState.loadData.mockReturnValue(localWorkspace);
  mockState.loadRemoteData.mockResolvedValue({ status: 'ok', data: remoteWorkspace });
  mockState.saveRemoteData.mockResolvedValue({ status: 'saved' });
  mockState.saveRemoteDataAndConfirmClient.mockResolvedValue(undefined);
  mockState.hasNewerRemoteVersion.mockResolvedValue(false);
});

describe('useCamplyWorkspace', () => {
  it('hydrates the authenticated user locally and then adopts the remote workspace', async () => {
    const { result } = renderHook(() => useCamplyWorkspace());

    await waitFor(() => expect(result.current.authReady).toBe(true));
    await waitFor(() => expect(result.current.remoteLoaded).toBe(true));

    expect(mockState.loadData).toHaveBeenCalledWith('user-1');
    expect(mockState.setSupabaseSession).toHaveBeenCalledWith(mockState.session);
    expect(mockState.resetRemoteWorkspaceState).toHaveBeenCalled();
    expect(result.current.authenticated).toBe(true);
    expect(result.current.data).toBe(remoteWorkspace);
  });

  it('keeps remote saving locked and exposes a retryable error when hydration fails', async () => {
    mockState.loadRemoteData.mockResolvedValueOnce({ status: 'error', message: 'network down' });

    const { result } = renderHook(() => useCamplyWorkspace());

    await waitFor(() => expect(result.current.remoteLoadError).not.toBeNull());
    expect(result.current.remoteLoaded).toBe(false);
    expect(mockState.saveRemoteData).not.toHaveBeenCalled();

    mockState.loadRemoteData.mockResolvedValueOnce({ status: 'empty' });
    act(() => result.current.retryRemoteLoad());
    await waitFor(() => expect(result.current.remoteLoaded).toBe(true));
    expect(result.current.remoteLoadError).toBeNull();
  });

  it('resets the remote contract and local workspace when the authenticated user changes', async () => {
    const { result } = renderHook(() => useCamplyWorkspace());
    await waitFor(() => expect(result.current.remoteLoaded).toBe(true));

    const nextSession = sessionFor('user-2');
    const nextLocalWorkspace = { ...initialData, notes: [{ id: 'user-2-note' }] } as typeof initialData;
    mockState.loadData.mockReturnValueOnce(nextLocalWorkspace);
    mockState.loadRemoteData.mockResolvedValueOnce({ status: 'empty' });

    act(() => mockState.authListener?.('SIGNED_IN', nextSession));

    await waitFor(() => expect(result.current.session?.user.id).toBe('user-2'));
    await waitFor(() => expect(result.current.remoteLoaded).toBe(true));
    expect(mockState.resetRemoteWorkspaceState).toHaveBeenCalledTimes(2);
    expect(mockState.loadData).toHaveBeenCalledWith('user-2');
    expect(result.current.data).toBe(nextLocalWorkspace);
  });

  it('adopts the remote workspace instead of overwriting after a save conflict', async () => {
    const { result } = renderHook(() => useCamplyWorkspace());
    await waitFor(() => expect(result.current.remoteLoaded).toBe(true));

    mockState.saveRemoteData.mockResolvedValueOnce({
      status: 'conflict',
      remoteData: conflictWorkspace,
    });

    act(() => result.current.updateData((current) => ({ ...current, notes: [{ id: 'local-change' }] })));

    await waitFor(() => expect(result.current.data).toBe(conflictWorkspace));
    expect(result.current.syncError).toContain('versão mais recente');
  });

  it('persists a client explicitly before exposing the new workspace', async () => {
    const { result } = renderHook(() => useCamplyWorkspace());
    await waitFor(() => expect(result.current.remoteLoaded).toBe(true));

    const nextWorkspace = { ...remoteWorkspace, notes: [{ id: 'client-change' }] } as typeof initialData;
    await act(() => result.current.persistClientData(nextWorkspace, 'client-1'));

    expect(mockState.saveRemoteDataAndConfirmClient).toHaveBeenCalledWith(nextWorkspace, 'client-1');
    expect(result.current.data).toBe(nextWorkspace);
    expect(result.current.syncError).toBeNull();
  });

  it('clears local and in-memory state before signing out', async () => {
    const { result } = renderHook(() => useCamplyWorkspace());
    await waitFor(() => expect(result.current.remoteLoaded).toBe(true));

    act(() => result.current.signOut());

    expect(mockState.setSupabaseSession).toHaveBeenLastCalledWith(null);
    expect(mockState.clearUserData).toHaveBeenCalledWith('user-1');
    expect(mockState.resetRemoteWorkspaceState).toHaveBeenCalledTimes(2);
    expect(mockState.signOut).toHaveBeenCalled();
    expect(result.current.data).toBe(initialData);
  });
});
