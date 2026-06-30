// @ts-nocheck
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('https://deno.land/std@0.168.0/http/server.ts', () => ({
  serve: vi.fn(),
}));

vi.mock('../../../supabase/functions/_shared/auth.ts', () => ({
  requireAuthenticatedUser: vi.fn(),
  HttpError: class HttpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
  errorResponse: vi.fn((error) => new Response(
    JSON.stringify({ error: error.message }),
    { status: error.status || 500 },
  )),
}));

vi.mock('../../../supabase/functions/_shared/crypto.ts', () => ({
  decryptToken: vi.fn().mockResolvedValue('decrypted-token'),
}));

vi.mock('../../../supabase/functions/_shared/cors.ts', () => ({
  corsHeaders: {},
}));

vi.mock('../../../supabase/functions/_shared/meta-api.ts', () => ({
  fetchMetaGraph: vi.fn().mockResolvedValue({ data: [] }),
}));

let handleRequest: (req: Request) => Promise<Response>;
let requireAuthenticatedUser: any;
let fetchMetaGraph: any;

const createRequest = (body: unknown) => ({
  method: 'POST',
  json: vi.fn().mockResolvedValue(body),
}) as unknown as Request;

function createQuery(table: string, allowAsset: boolean, allowCampaign: boolean) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => {
      if (table === 'meta_integrations') {
        return Promise.resolve({
          data: {
            id: 'integration_1',
            user_id: 'user_1',
            status: 'active',
            access_token_encrypted: 'encrypted-token',
          },
          error: null,
        });
      }
      if (table === 'meta_assets' && allowAsset) {
        return Promise.resolve({
          data: {
            id: 'asset_uuid_1',
            asset_id: 'act_123',
          },
          error: null,
        });
      }
      if (table === 'meta_campaign_entities' && allowCampaign) {
        return Promise.resolve({
          data: {
            campaign_id: 'campaign_123',
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: 'not found' } });
    }),
  };
  return query;
}

function createSupabaseMock(options: { allowAsset?: boolean; allowCampaign?: boolean } = {}) {
  return {
    from: vi.fn((table: string) => createQuery(
      table,
      Boolean(options.allowAsset),
      Boolean(options.allowCampaign),
    )),
  };
}

describe('meta-fetch-creatives authorization', () => {
  beforeAll(async () => {
    const creativeFunctionPath = '../../../supabase/functions/meta-fetch-creatives/index.ts';
    const module = await import(creativeFunctionPath);
    handleRequest = module.handleRequest;

    const authPath = '../../../supabase/functions/_shared/auth.ts';
    const authModule = await import(authPath);
    requireAuthenticatedUser = authModule.requireAuthenticatedUser;

    const metaApiPath = '../../../supabase/functions/_shared/meta-api.ts';
    const metaApiModule = await import(metaApiPath);
    fetchMetaGraph = metaApiModule.fetchMetaGraph;

    vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'META_APP_SECRET' ? 'secret' : '' } });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves an authorized ad account through meta_assets before calling Meta', async () => {
    const supabaseClient = createSupabaseMock({ allowAsset: true });
    requireAuthenticatedUser.mockResolvedValue({
      user: { id: 'user_1' },
      adminClient: supabaseClient,
    });

    const response = await handleRequest(createRequest({ targetId: 'asset_uuid_1', type: 'adaccount' }));

    expect(response.status).toBe(200);
    expect(fetchMetaGraph).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: '/act_123/ads',
    }));
  });

  it('rejects a creative target that is not owned by the authenticated user', async () => {
    const supabaseClient = createSupabaseMock({ allowAsset: false });
    requireAuthenticatedUser.mockResolvedValue({
      user: { id: 'user_1' },
      adminClient: supabaseClient,
    });

    const response = await handleRequest(createRequest({ targetId: 'act_foreign', type: 'adaccount' }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('não autorizada');
    expect(fetchMetaGraph).not.toHaveBeenCalled();
  });
});
