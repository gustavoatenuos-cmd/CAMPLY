// @ts-nocheck
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('https://deno.land/std@0.177.0/http/server.ts', () => ({
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
  errorResponse: vi.fn(() => new Response(JSON.stringify({ error: 'masked' }), { status: 500 })),
}));

vi.mock('../../../supabase/functions/_shared/crypto.ts', () => ({
  decryptToken: vi.fn().mockResolvedValue('decrypted-token'),
}));

vi.mock('../../../supabase/functions/_shared/cors.ts', () => ({
  corsHeaders: {},
}));

vi.mock('../../../supabase/functions/_shared/meta-api.ts', () => ({
  META_BASE_URL: 'https://graph.facebook.test',
}));

vi.mock('../../../supabase/functions/_shared/direct-postgres.ts', () => ({
  withDirectPostgres: vi.fn(async (callback) => {
    const mockSql = vi.fn().mockImplementation((strings) => {
      const queryStr = strings[0];
      if (queryStr.includes('meta_integrations')) {
        return [{
          id: 'integration-1',
          user_id: 'user-1',
          status: 'active',
          meta_user_name: 'Conta salva',
          access_token_encrypted: 'encrypted',
          last_validated_at: '2026-07-01T10:00:00Z',
        }];
      }
      if (queryStr.includes('meta_assets')) {
        return [{
          id: 'asset-1',
          integration_id: 'integration-1',
          asset_type: 'adaccount',
          asset_id: 'act_1',
          asset_name: 'Conta persistida',
          asset_status: 'ACTIVE',
        }];
      }
      return [];
    });
    return callback(mockSql);
  }),
}));

let handleRequest: (req: Request) => Promise<Response>;
let requireAuthenticatedUser: any;
let decryptToken: any;

const createRequest = (body: unknown) => ({
  method: 'POST',
  json: vi.fn().mockResolvedValue(body),
}) as unknown as Request;

function createSupabaseMock() {
  const integrationQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'integration-1',
        user_id: 'user-1',
        status: 'active',
        meta_user_name: 'Conta salva',
        access_token_encrypted: 'encrypted',
        last_validated_at: '2026-07-01T10:00:00Z',
      },
      error: null,
    }),
    update: vi.fn().mockReturnThis(),
  };
  const assetsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn(),
  };
  assetsQuery.order
    .mockReturnValueOnce(assetsQuery)
    .mockResolvedValueOnce({
      data: [{ id: 'asset-1', asset_id: 'act_1', asset_name: 'Conta persistida', asset_type: 'adaccount' }],
      error: null,
    });
  const client = {
    from: vi.fn((table: string) => table === 'meta_integrations' ? integrationQuery : assetsQuery),
  };
  return { client, integrationQuery };
}

describe('meta-validate-token persisted status', () => {
  beforeAll(async () => {
    const functionPath = '../../../supabase/functions/meta-validate-token/index.ts';
    const module = await import(functionPath);
    handleRequest = module.handleRequest;
    const authPath = '../../../supabase/functions/_shared/auth.ts';
    const cryptoPath = '../../../supabase/functions/_shared/crypto.ts';
    ({ requireAuthenticatedUser } = await import(authPath));
    ({ decryptToken } = await import(cryptoPath));
    vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'META_APP_ID' ? 'app-id' : key === 'META_APP_SECRET' ? 'app-secret' : '' } });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the saved connection without contacting Facebook', async () => {
    const { client, integrationQuery } = createSupabaseMock();
    requireAuthenticatedUser.mockResolvedValue({ user: { id: 'user-1' }, adminClient: client });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleRequest(createRequest({ verifyRemote: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'active', source: 'database', remoteValidated: false });
    expect(body.assets).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decryptToken).not.toHaveBeenCalled();
    expect(integrationQuery.update).not.toHaveBeenCalled();
  });

  it('preserves the saved connection when an explicit Facebook validation is unavailable', async () => {
    const { client, integrationQuery } = createSupabaseMock();
    requireAuthenticatedUser.mockResolvedValue({ user: { id: 'user-1' }, adminClient: client });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

    const response = await handleRequest(createRequest({ verifyRemote: true }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.message).toContain('conexão salva foi preservada');
    expect(integrationQuery.update).not.toHaveBeenCalled();
  });
});
