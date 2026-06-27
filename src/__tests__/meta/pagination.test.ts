import { describe, it, expect, vi } from 'vitest';
import { fetchMetaGraphPaginated } from '../../../supabase/functions/_shared/meta-api';

describe('Pagination & Retry', () => {
  it('fetches until next is null and handles partial state', async () => {
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
         ok: true,
         json: () => Promise.resolve({ data: [{ id: 2 }] })
      });
    });

    const res = await fetchMetaGraphPaginated({ endpoint: '/test', accessToken: 'a', appSecret: 'b', params: {} });
    expect(res.data.length).toBe(2);
    expect(res.isPartial).toBe(false);
    expect(callCount).toBe(2);
  });
});
