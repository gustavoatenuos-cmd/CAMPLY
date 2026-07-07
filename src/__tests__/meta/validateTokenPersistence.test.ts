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

// direct-postgres importa o driver via URL https (estilo Deno), que o loader
// do Node/vitest não resolve — precisa ficar mockado como os demais _shared.
vi.mock('../../../supabase/functions/_shared/direct-postgres.ts', () => ({
  withDirectPostgres: vi.fn(),
}));

let handleRequest: (req: Request) => Promise<Response>;
let requireAuthenticatedUser: any;
let decryptToken: any;
let withDirectPostgres: any;

const createRequest = (body: unknown) => ({
  method: 'POST',
  json: vi.fn().mockResolvedValue(body),
}) as unknown as Request;

const integrationRow = {
  id: 'integration-1',
  user_id: 'user-1',
  status: 'active',
  meta_user_name: 'Conta salva',
  access_token_encrypted: 'encrypted',
  last_validated_at: '2026-07-01T10:00:00Z',
};

const assetRows = [
  { id: 'asset-1', integration_id: 'integration-1', asset_type: 'adaccount', asset_id: 'act_1', asset_name: 'Conta persistida' },
];

/**
 * A função usa `sql` como tagged template duas vezes dentro do mesmo
 * withDirectPostgres: primeiro para a integração, depois para os assets.
 */
function mockSavedConnection() {
  withDirectPostgres.mockImplementation(async (callback: (sql: unknown) => Promise<unknown>) => {
    let call = 0;
    const sql = async () => {
      call += 1;
      return call === 1 ? [integrationRow] : assetRows;
    };
    return callback(sql);
  });
}

describe('meta-validate-token persisted status', () => {
  beforeAll(async () => {
    const functionPath = '../../../supabase/functions/meta-validate-token/index.ts';
    const module = await import(functionPath);
    handleRequest = module.handleRequest;
    ({ requireAuthenticatedUser } = await import('../../../supabase/functions/_shared/auth.ts'));
    ({ decryptToken } = await import('../../../supabase/functions/_shared/crypto.ts'));
    ({ withDirectPostgres } = await import('../../../supabase/functions/_shared/direct-postgres.ts'));
    vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'META_APP_ID' ? 'app-id' : key === 'META_APP_SECRET' ? 'app-secret' : '' } });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the saved connection without contacting Facebook', async () => {
    mockSavedConnection();
    requireAuthenticatedUser.mockResolvedValue({ user: { id: 'user-1' } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleRequest(createRequest({ verifyRemote: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'active', source: 'database', remoteValidated: false });
    expect(body.assets).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decryptToken).not.toHaveBeenCalled();
    // Apenas a leitura inicial — nenhum update de status no banco.
    expect(withDirectPostgres).toHaveBeenCalledTimes(1);
  });

  it('preserves the saved connection when an explicit Facebook validation is unavailable', async () => {
    mockSavedConnection();
    requireAuthenticatedUser.mockResolvedValue({ user: { id: 'user-1' } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

    const response = await handleRequest(createRequest({ verifyRemote: true }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.message).toContain('conexão salva foi preservada');
    // A falha remota não pode disparar update: só a leitura inicial acontece.
    expect(withDirectPostgres).toHaveBeenCalledTimes(1);
  });
});
