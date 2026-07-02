// @ts-nocheck
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
  errorResponse: vi.fn((err) => new Response(JSON.stringify({ error: err.message }), { status: err.status || 500 }))
}));

vi.mock('https://deno.land/std@0.177.0/http/server.ts', () => ({
  serve: vi.fn()
}));

vi.mock('../../../supabase/functions/_shared/crypto.ts', () => ({
  decryptToken: vi.fn().mockResolvedValue('mocked_decrypted_token')
}));

vi.mock('../../../supabase/functions/_shared/cors.ts', () => ({
  corsHeaders: {}
}));

vi.mock('../../../supabase/functions/_shared/direct-postgres.ts', () => ({
  withDirectPostgres: vi.fn().mockResolvedValue({
    id: 'act_123',
    asset_id: 'act_mock_account',
    integration_id: 'int_123',
    integration_user_id: 'user_123',
    integration_status: 'active',
    access_token_encrypted: 'abc',
  }),
}));

vi.mock('../../../supabase/functions/_shared/meta-api.ts', () => ({
  fetchMetaGraph: vi.fn(),
  fetchMetaGraphPaginated: vi.fn(),
  META_GRAPH_VERSION: 'v25.0',
}));

let handleRequest: any;
let PersistenceError: any;
let requireAuthenticatedUser: any;
let fetchMetaGraph: any;
let fetchMetaGraphPaginated: any;

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => k === 'META_APP_SECRET' ? 'secret' : '' } });
  
  const indexStr = '../../../supabase/functions/meta-sync-ads/index.ts';
  const module = await import(indexStr);
  handleRequest = module.handleRequest;
  
  const syncStr = '../../../supabase/functions/_shared/meta/syncPersistence.ts';
  const persistenceModule = await import(syncStr);
  PersistenceError = persistenceModule.PersistenceError;
  
  const authStr = '../../../supabase/functions/_shared/auth.ts';
  const authModule = await import(authStr);
  requireAuthenticatedUser = authModule.requireAuthenticatedUser;
  
  const apiStr = '../../../supabase/functions/_shared/meta-api.ts';
  const apiModule = await import(apiStr);
  fetchMetaGraph = apiModule.fetchMetaGraph;
  fetchMetaGraphPaginated = apiModule.fetchMetaGraphPaginated;
});

const createMockRequest = (body: any) => {
  return {
    method: 'POST',
    json: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue('Bearer test') }
  } as unknown as Request;
};

describe('Persistence Failure Handling through Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMetaGraphPaginated.mockResolvedValue({
      data: [
        {
          id: 'camp_1',
          campaign_id: 'camp_1',
          date_start: '2026-06-27',
          date_stop: '2026-06-27',
          impressions: '1000',
          spend: '10.00',
          reach: '500'
        }
      ],
      paging: { cursors: { after: null } },
      recordsFetched: 1,
      isPartial: false,
      completionStatus: 'complete'
    });

    fetchMetaGraph.mockImplementation(async (opts: any) => {
      if (opts.endpoint.includes('fields=id,name,objective,status,effective_status')) {
        return { data: [{ id: 'camp_1', name: 'Camp 1', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }] };
      }
      if (opts.endpoint.includes('fields=id,name,campaign_id,optimization_goal')) {
        return { data: [{ id: 'adset_1', campaign_id: 'camp_1', name: 'Adset 1', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [] }] };
      }
      return { data: [] };
    });
  });

  const createMockSupabase = (failConfig?: { target: string }) => {
    return {
      from: vi.fn((table) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          if (table === 'meta_assets') {
            return Promise.resolve({
              data: {
                id: 'act_123',
                asset_id: 'act_mock_account',
                meta_integrations: {
                  id: 'int_123',
                  user_id: 'user_123',
                  status: 'active',
                  access_token_encrypted: 'abc'
                }
              },
              error: null
            });
          }
          if (table === 'meta_integrations') {
            return Promise.resolve({ data: { access_token_encrypted: 'abc' }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        insert: vi.fn().mockImplementation(() => {
          if (failConfig?.target === 'insert_run') {
            return Promise.resolve({ error: { message: `DB Failure on Insert meta_sync_runs` } });
          }
          return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'mock_run_id' }, error: null }) }) };
        }),
        update: vi.fn().mockImplementation(() => {
          return {
            match: vi.fn().mockImplementation(() => {
              if (failConfig?.target === 'update_run') {
                return Promise.resolve({ error: { message: `DB Failure on Update meta_sync_runs` } });
              }
              return Promise.resolve({ error: null });
            })
          };
        })
      })),
      rpc: vi.fn().mockImplementation((rpcName) => {
        if (rpcName === 'persist_meta_sync_run' && failConfig?.target === 'rpc_persist') {
           return Promise.resolve({ error: { message: `DB Failure on RPC persist` } });
        }
        return Promise.resolve({ error: null });
      })
    };
  };

  const runScenario = async (failConfig?: { target: string }, body = { metaAssetId: 'act_123', periods: ['today'] }) => {
    const supabaseClient = createMockSupabase(failConfig);
    requireAuthenticatedUser.mockResolvedValue({
      user: { id: 'user_123' },
      adminClient: supabaseClient
    });

    const req = createMockRequest(body);
    const response = await handleRequest(req);
    return { response, json: await response.json(), supabaseClient };
  };

  it('handles database insert failures for meta_sync_runs safely', async () => {
    const { response, json } = await runScenario({ target: 'insert_run' });
    expect(response.status).toBe(500);
    expect(json.error).toContain('DB Failure on Insert meta_sync_runs');
  });

  it('handles RPC persistence failures safely (atomicity)', async () => {
    const { response, json, supabaseClient } = await runScenario({ target: 'rpc_persist' });
    expect(response.status).toBe(500);
    expect(json.error).toContain('Database persistence failed: DB Failure on RPC persist');
    // Ensure that it tries to mark the run as failed in the catch block!
    expect(supabaseClient.from).toHaveBeenCalledWith('meta_sync_runs');
  });

  it('supports legacy adAccountId only through the owned meta asset lookup', async () => {
    const { response, supabaseClient } = await runScenario(undefined, { adAccountId: 'act_mock_account', periods: ['today'] });

    expect(response.status).toBe(206);
    expect(supabaseClient.rpc).toHaveBeenCalledWith('persist_meta_sync_run', expect.objectContaining({
      p_ad_account_id: 'act_mock_account',
      p_user_id: 'user_123',
    }));
  });

  it('rejects unsafe adAccountId values before building Graph API endpoints', async () => {
    const { response, json } = await runScenario(undefined, {
      adAccountId: 'act_mock_account/insights?fields=access_token',
      periods: ['today'],
    });

    expect(response.status).toBe(400);
    expect(json.error).toContain('Invalid adAccountId');
  });

  it('rejects unsafe selected entity ids before filtering Graph API data', async () => {
    const { response, json } = await runScenario(undefined, {
      metaAssetId: 'act_123',
      periods: ['today'],
      selectedCampaigns: ['camp_1', '../metadata'],
    });

    expect(response.status).toBe(400);
    expect(json.error).toContain('Invalid selected Meta entity id');
  });
});
