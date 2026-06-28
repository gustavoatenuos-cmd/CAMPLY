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

const createMockSupabase = (failConfig?: { table: string, operation: string }) => {
  const isFail = (table: string, operation: string) => 
    failConfig?.table === table && failConfig?.operation === operation;

  return {
    from: vi.fn((table) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        if (table === 'meta_integrations') {
          return Promise.resolve({ data: { access_token_encrypted: 'abc' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      insert: vi.fn().mockImplementation(() => {
        if (isFail(table, 'insert')) {
          return Promise.resolve({ error: { message: `DB Failure on Insert ${table}` } });
        }
        return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'mock_run_id' }, error: null }) }) };
      }),
      upsert: vi.fn().mockImplementation(() => {
        if (isFail(table, 'upsert')) {
          return Promise.resolve({ error: { message: `DB Failure on Upsert ${table}` } });
        }
        return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'mock_id' }, error: null }) }) };
      }),
      update: vi.fn().mockImplementation(() => {
        return {
          eq: vi.fn().mockImplementation(() => {
            if (isFail(table, 'update')) {
              return Promise.resolve({ error: { message: `DB Failure on Update ${table}` } });
            }
            return Promise.resolve({ error: null });
          })
        };
      })
    }))
  };
};

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

  const runScenario = async (failConfig: { table: string, operation: string } | undefined) => {
    const supabaseClient = createMockSupabase(failConfig);
    requireAuthenticatedUser.mockResolvedValue({
      user: { id: 'user_123' },
      adminClient: supabaseClient
    });

    const req = createMockRequest({ adAccountId: 'act_123', periods: ['today'] });
    const response = await handleRequest(req);
    return { response, json: await response.json(), supabaseClient };
  };

  it('handles database insert failures for meta_sync_runs safely', async () => {
    const { response, json } = await runScenario({ table: 'meta_sync_runs', operation: 'insert' });
    expect(response.status).toBe(500);
    expect(json.error).toBe('insert meta_sync_runs: DB Failure on Insert meta_sync_runs');
  });

  it('handles database insert failures for meta_raw_snapshots safely', async () => {
    const { response, json } = await runScenario({ table: 'meta_raw_snapshots', operation: 'insert' });
    expect(response.status).toBe(200);
    expect(json.message).toContain('DB Failure');
  });

  it('handles database upsert failures for meta_campaign_entities safely', async () => {
    const { response, json } = await runScenario({ table: 'meta_campaign_entities', operation: 'upsert' });
    expect(response.status).toBe(200);
    expect(json.message).toContain('DB Failure');
  });

  it('handles database upsert failures for meta_adset_entities safely', async () => {
    const { response, json } = await runScenario({ table: 'meta_adset_entities', operation: 'upsert' });
    expect(response.status).toBe(200);
    expect(json.message).toContain('DB Failure');
  });

  it('handles database upsert failures for meta_normalized_metrics safely', async () => {
    const { response, json } = await runScenario({ table: 'meta_normalized_metrics', operation: 'upsert' });
    expect(response.status).toBe(200);
    expect(json.message).toContain('DB Failure');
  });

  it('handles database update failures for final sync run safely', async () => {
    const { response, json, supabaseClient } = await runScenario({ table: 'meta_sync_runs', operation: 'update' });
    expect(response.status).toBe(500);
    expect(json.error).toContain('DB Failure on Update meta_sync_runs');
    // Ensure that it tries to mark the run as failed in the catch block!
    expect(supabaseClient.from).toHaveBeenCalledWith('meta_sync_runs');
    // We can't trivially assert the second update call arguments in this simplified mock, but we assert it doesn't return success silently.
  });
});
