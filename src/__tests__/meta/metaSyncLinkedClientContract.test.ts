// @ts-nocheck
// Verifies the linked-client sync contract at the meta-sync-performance edge
// function: operational sync must resolve exclusively through an active
// client_meta_assets link (client_meta_assets -> client_identity ->
// meta_assets -> meta_integrations), never through a bare, unlinked, or
// cross-user Meta asset.
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

vi.mock('../../../supabase/functions/_shared/auth.ts', () => ({
  requireAuthenticatedUser: vi.fn(),
  HttpError: class HttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  errorResponse: vi.fn((err) => new Response(JSON.stringify({ error: err.message }), { status: err.status || 500 })),
}));

vi.mock('https://deno.land/std@0.177.0/http/server.ts', () => ({
  serve: vi.fn(),
}));

vi.mock('../../../supabase/functions/_shared/crypto.ts', () => ({
  decryptToken: vi.fn().mockResolvedValue('mocked_decrypted_token'),
}));

vi.mock('../../../supabase/functions/_shared/cors.ts', () => ({
  corsHeaders: {},
}));

const { withDirectPostgresMock } = vi.hoisted(() => ({
  withDirectPostgresMock: vi.fn(),
}));

vi.mock('../../../supabase/functions/_shared/direct-postgres.ts', () => ({
  withDirectPostgres: withDirectPostgresMock,
}));

vi.mock('../../../supabase/functions/_shared/meta-api.ts', () => ({
  fetchMetaGraph: vi.fn(),
  fetchMetaGraphPaginated: vi.fn(),
  META_GRAPH_VERSION: 'v25.0',
  MetaRateLimitError: class MetaRateLimitError extends Error {},
}));

let handleRequest: any;
let requireAuthenticatedUser: any;

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'META_APP_SECRET' ? 'secret' : '') } });

  // Import via a variable, not a string literal, so tsc's static module graph
  // (which does type-check literal dynamic import() targets) does not try to
  // type-check this Deno-only edge function against the Node/Vite tsconfig.
  const indexStr = '../../../supabase/functions/meta-sync-performance/index.ts';
  const module = await import(indexStr);
  handleRequest = module.handleRequest;

  const authStr = '../../../supabase/functions/_shared/auth.ts';
  const authModule = await import(authStr);
  requireAuthenticatedUser = authModule.requireAuthenticatedUser;
});

const createMockRequest = (body: any) => ({
  method: 'POST',
  json: vi.fn().mockResolvedValue(body),
  headers: { get: vi.fn().mockReturnValue('Bearer test') },
} as unknown as Request);

const createMockSupabase = () => ({
  from: vi.fn(() => ({
    insert: vi.fn().mockImplementation(() => Promise.resolve({ error: { message: 'not reached' } })),
    update: vi.fn().mockImplementation(() => ({ match: vi.fn().mockResolvedValue({ error: null }) })),
  })),
  rpc: vi.fn().mockResolvedValue({ error: null }),
});

const runRequest = async (userId: string, body: any) => {
  const supabaseClient = createMockSupabase();
  requireAuthenticatedUser.mockResolvedValue({ user: { id: userId }, adminClient: supabaseClient });
  const req = createMockRequest(body);
  const response = await handleRequest(req);
  return { response, json: await response.json() };
};

describe('meta-sync-performance linked-client resolution', () => {
  beforeEach(() => {
    withDirectPostgresMock.mockReset();
  });

  it('rejects a clientMetaAssetId that does not resolve to any active client link', async () => {
    withDirectPostgresMock.mockResolvedValue(null);

    const { response, json } = await runRequest('user_123', {
      clientMetaAssetId: 'cma-does-not-exist',
      periods: ['today'],
    });

    expect(response.status).toBe(403);
    expect(json.error).toContain('Conta Meta não vinculada a um cliente ativo');
  });

  it('rejects an unlinked account the same way (query already filters unlinked_at IS NULL)', async () => {
    // client_meta_assets.unlinked_at IS NULL is enforced in the SQL WHERE clause,
    // so an unlinked link resolves to no row, identical to a non-existent one.
    withDirectPostgresMock.mockResolvedValue(null);

    const { response, json } = await runRequest('user_123', {
      clientMetaAssetId: 'cma-unlinked',
      periods: ['today'],
    });

    expect(response.status).toBe(403);
    expect(json.error).toContain('Conta Meta não vinculada a um cliente ativo');
  });

  it('rejects a resolved link whose integration belongs to a different user', async () => {
    withDirectPostgresMock.mockResolvedValue({
      client_meta_asset_id: 'cma-1',
      client_id: 'client-1',
      id: 'asset-1',
      asset_id: 'act_1',
      integration_id: 'int-1',
      integration_user_id: 'someone_else',
      integration_status: 'active',
      access_token_encrypted: 'abc',
    });

    const { response, json } = await runRequest('user_123', {
      clientMetaAssetId: 'cma-1',
      periods: ['today'],
    });

    expect(response.status).toBe(403);
    expect(json.error).toContain('não pertence ao usuário');
  });

  it('rejects a resolved link whose integration is not active', async () => {
    withDirectPostgresMock.mockResolvedValue({
      client_meta_asset_id: 'cma-1',
      client_id: 'client-1',
      id: 'asset-1',
      asset_id: 'act_1',
      integration_id: 'int-1',
      integration_user_id: 'user_123',
      integration_status: 'revoked',
      access_token_encrypted: 'abc',
    });

    const { response, json } = await runRequest('user_123', {
      clientMetaAssetId: 'cma-1',
      periods: ['today'],
    });

    expect(response.status).toBe(403);
    expect(json.error).toContain('integração não está ativa');
  });
});
