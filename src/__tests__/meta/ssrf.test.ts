import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMetaGraphPaginated } from '../../../supabase/functions/_shared/meta-api';

describe('SSRF Protection in fetchMetaGraphPaginated', () => {
  const mockFetch = vi.fn();
  
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('Deno', {
      env: {
        get: vi.fn((key) => {
          if (key === 'META_BASE_URL') return 'https://graph.facebook.com';
          if (key === 'META_TEST_MODE') return 'false'; // simulate production environment
          return undefined;
        })
      }
    });
    mockFetch.mockReset();
  });

  it('rejects an SSRF paging URL before calling fetch a second time', async () => {
    // The first call returns a valid payload but a malicious paging.next URL
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: [{ id: '1' }],
        paging: {
          cursors: { after: 'cursor1' },
          next: 'http://169.254.169.254/latest/meta-data/' // Malicious IP literal
        }
      })
    });

    const result = await fetchMetaGraphPaginated({
      endpoint: '/test',
      accessToken: 'token',
      appSecret: 'secret',
      params: {}
    });

    // We expect the first page to have been fetched successfully
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Because the second page URL was SSRF, it was caught by validateMetaPagingUrl,
    // which threw an error inside the paginated loop, causing it to return a partial result!
    expect(result.isPartial).toBe(true);
    expect(result.completionStatus).toBe('api_error');
    expect(result.data.length).toBe(1);

    // Prove that fetch was NEVER called for the malicious URL
    expect(mockFetch).not.toHaveBeenCalledTimes(2);
  });
  
  it('rejects non-https URLs in production', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: [{ id: '1' }],
        paging: {
          cursors: { after: 'cursor1' },
          next: 'http://graph.facebook.com/v15.0/test?after=cursor1' 
        }
      })
    });

    const result = await fetchMetaGraphPaginated({
      endpoint: '/test',
      accessToken: 'token',
      appSecret: 'secret',
      params: {}
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.isPartial).toBe(true);
  });
});
