// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import {
  capturePersistenceFailure,
  markSyncRunFailed,
  type PersistenceFailure,
} from '../../../supabase/functions/_shared/meta/syncPersistence.ts';

describe('Meta sync persistence safeguards', () => {
  it('surfaces an upsert error and associates it with the failed Ad Set', async () => {
    const failures: PersistenceFailure[] = [];
    const ok = await capturePersistenceFailure(
      Promise.resolve({ error: { message: 'unique violation' } }),
      'upsert normalized metrics',
      failures,
      'adset-42'
    );

    expect(ok).toBe(false);
    expect(failures).toEqual([expect.objectContaining({
      operation: 'upsert normalized metrics',
      adsetId: 'adset-42',
    })]);
  });

  it('updates the real usedRunId and the error_message column in the catch path', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    await markSyncRunFailed({ from }, 'caller-provided-run-id', 'Meta API failed');

    expect(from).toHaveBeenCalledWith('meta_sync_runs');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error_message: 'Meta API failed',
    }));
    expect(eq).toHaveBeenCalledWith('id', 'caller-provided-run-id');
  });
});
