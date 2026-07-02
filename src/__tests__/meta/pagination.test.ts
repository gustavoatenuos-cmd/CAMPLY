// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMetaGraphPaginated } from '../../../supabase/functions/_shared/meta-api';

describe('Pagination & Retry', () => {
  beforeEach(() => {
    vi.stubGlobal('Deno', {
      env: {
        get: vi.fn((key) => {
          if (key === 'META_BASE_URL') return 'https://graph.facebook.com';
          if (key === 'META_TEST_MODE') return 'false';
          if (key === 'TEST_MAX_RETRIES') return '2';
          if (key === 'TEST_TIMEOUT_MS') return '1500';
          return undefined;
        })
      }
    });
  });
  it('handles partial state when next page fetch fails', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
         return Promise.resolve({
           ok: true,
           json: () => Promise.resolve({ data: [{ id: 1 }], paging: { next: 'https://graph.facebook.com/page2?after=123', cursors: { after: '123' } } })
         });
      }
      return Promise.resolve({
         ok: false,
         status: 400,
         json: () => Promise.resolve({ error: { message: 'Server Error' } })
      });
    });

    const res = await fetchMetaGraphPaginated({ endpoint: '/test', accessToken: 'a', appSecret: 'b', params: {} });
    expect(res.data.length).toBe(1);
    expect(res.isPartial).toBe(true);
    expect(res.completionStatus).toBe('api_error');
  });

  it('reports partial_page when a configured page limit truncates pagination', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 1 }], paging: { next: 'https://graph.facebook.com/page2?after=123', cursors: { after: '123' } } })
    });

    const res = await fetchMetaGraphPaginated(
      { endpoint: '/test', accessToken: 'a', appSecret: 'b', params: {} },
      1
    );
    expect(res.completionStatus).toBe('partial_page');
    expect(res.isPartial).toBe(true);
  });
});
