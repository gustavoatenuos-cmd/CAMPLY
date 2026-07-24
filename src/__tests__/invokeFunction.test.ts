import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  getSupabaseAccessToken: () => 'session-token',
  getSupabaseFunctionUrl: (name: string) => `https://example.supabase.co/functions/v1/${name}`,
  getSupabasePublishableKey: () => 'publishable-key',
  isSupabaseConfigured: true,
}));

import { invokeFunction, InvokeError } from '../lib/invokeFunction';

describe('invokeFunction', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows structured Edge Function errors instead of the generic non-2xx message', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      runId: 'run-123',
      error: {
        code: 'META_PERSISTENCE_FAILED',
        message: 'Database persistence verification failed',
      },
    }), { status: 503 }));

    await invokeFunction('meta-sync-performance', { metaAssetId: 'asset_1' }).catch((error) => {
      expect(error).toBeInstanceOf(InvokeError);
      expect(error).toHaveProperty('message', 'Database persistence verification failed');
      expect(error).toMatchObject({
        code: 'META_PERSISTENCE_FAILED',
        runId: 'run-123',
        status: 503,
      });
    });
  });
});
