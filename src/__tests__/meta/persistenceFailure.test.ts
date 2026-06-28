import { describe, it, expect, vi } from 'vitest';
import { requirePersistence, PersistenceError } from '../../../supabase/functions/_shared/meta/syncPersistence';

// Mock Supabase client
const createMockSupabase = (shouldFail: boolean) => ({
  from: vi.fn((table) => {
    return {
      insert: vi.fn().mockResolvedValue(shouldFail ? { error: { message: 'DB Failure', code: '500' } } : { error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null })
    };
  })
});

describe('Persistence Failure Handling', () => {
  it('handles database insert failures safely', async () => {
    const supabase = createMockSupabase(true) as any;
    
    // Attempting to persist with a simulated failure
    const mutation = supabase.from('meta_sync_runs').insert({});
    const persistencePromise = requirePersistence(mutation, 'Insert meta_sync_runs');
    
    await expect(persistencePromise).rejects.toThrow(PersistenceError);
    await expect(persistencePromise).rejects.toThrow('DB Failure');
  });

  it('succeeds when DB operates normally', async () => {
    const supabase = createMockSupabase(false) as any;
    const mutation = supabase.from('meta_sync_runs').insert({});
    await requirePersistence(mutation, 'Insert meta_sync_runs');
    // If it doesn't throw, the test passes
    expect(true).toBe(true);
  });
});

