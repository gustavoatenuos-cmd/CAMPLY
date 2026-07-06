import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CamplyData } from '../types';

const { maybeSingle, rpc } = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseSessionUserId: () => 'user-1',
  supabaseData: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
    rpc,
  },
}));

import { initialData } from './camplyStore';
import { loadRemoteData, resetRemoteWorkspaceState, saveRemoteData } from './supabaseStore';

describe('supabaseStore remote version contract', () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    rpc.mockReset();
    resetRemoteWorkspaceState();
  });

  it('uses a finite loaded version as the next optimistic-lock value', async () => {
    maybeSingle.mockResolvedValue({ data: { data: initialData, version: '4' }, error: null });
    rpc.mockResolvedValue({ data: 5, error: null });

    await expect(loadRemoteData()).resolves.toEqual(expect.objectContaining({ clients: expect.any(Array) }));
    await expect(saveRemoteData(initialData as CamplyData)).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith('save_camply_workspace_with_client_registry', expect.objectContaining({
      p_expected_version: 4,
    }));
  });

  it('rejects an invalid loaded version instead of treating a failed load as an empty workspace', async () => {
    maybeSingle.mockResolvedValue({ data: { data: initialData, version: 'not-a-version' }, error: null });

    await expect(loadRemoteData()).rejects.toThrow('A versão do workspace remoto é inválida.');
  });

  it('clears the optimistic-lock version when the save RPC returns an invalid value', async () => {
    maybeSingle.mockResolvedValue({ data: { data: initialData, version: 7 }, error: null });
    rpc
      .mockResolvedValueOnce({ data: 'invalid', error: null })
      .mockResolvedValueOnce({ data: 1, error: null });

    await loadRemoteData();
    await expect(saveRemoteData(initialData as CamplyData)).resolves.toBe(false);
    await expect(saveRemoteData(initialData as CamplyData)).resolves.toBe(true);

    expect(rpc).toHaveBeenLastCalledWith('save_camply_workspace_with_client_registry', expect.objectContaining({
      p_expected_version: null,
    }));
  });
});
