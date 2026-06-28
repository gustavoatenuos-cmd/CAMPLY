// @ts-nocheck
import { describe, it, expect, vi } from 'vitest';
import { fetchMetaGraphPaginated } from '../../../supabase/functions/_shared/meta-api';

describe('Pagination & Retry', () => {
  it('handles partial state when next page fetch fails', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
         return Promise.resolve({
           ok: true,
           json: () => Promise.resolve({ data: [{ id: 1 }], paging: { next: 'page2' } })
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
      json: () => Promise.resolve({ data: [{ id: 1 }], paging: { next: 'page2' } })
    });

    const res = await fetchMetaGraphPaginated(
      { endpoint: '/test', accessToken: 'a', appSecret: 'b', params: {} },
      1
    );
    expect(res.completionStatus).toBe('partial_page');
    expect(res.isPartial).toBe(true);
  });
});
