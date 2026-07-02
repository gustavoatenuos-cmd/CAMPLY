import { describe, expect, it, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

import { invokeFunction } from '../lib/invokeFunction';

describe('invokeFunction', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('shows structured Edge Function errors instead of the generic non-2xx message', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(JSON.stringify({
          error: {
            code: 'META_PERSISTENCE_FAILED',
            message: 'Database persistence verification failed',
          },
        })),
      },
    });

    await expect(invokeFunction('meta-sync-ads', { metaAssetId: 'asset_1' }))
      .rejects.toThrow('Database persistence verification failed');
  });
});
