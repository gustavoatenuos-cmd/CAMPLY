import { getSupabaseSessionUserId, supabaseData } from '../supabase';
import { invokeFunction } from '../invokeFunction';
import { withTimeout } from '../withTimeout';
import {
  E2E_ASSET_ID,
  E2E_CLIENT_ID,
  E2E_LINK_ID,
  isMetaE2EMode,
  metaE2EState,
  persistMetaE2EState,
} from './metaE2ERuntime';

export interface MetaRunSummary {
  id: string;
  status?: 'running' | 'success' | 'partial' | 'failed';
  period: string;
  level: string;
  scope: string;
  startedAt: string;
  finishedAt: string | null;
  terminationReason?: string | null;
  pagesFetched?: number;
  recordsFetched?: number;
}

export interface ClientMetaAccount {
  clientMetaAssetId: string;
  metaAssetId: string;
  integrationId: string;
  adAccountId: string;
  accountName: string;
  currency: string | null;
  timezone: string | null;
  assetStatus: string | null;
  linkedAt: string;
  availablePeriods: string[];
  lastAttempt: MetaRunSummary | null;
  lastSuccess: MetaRunSummary | null;
}

export interface ClientMetaAssetCatalog {
  clients: Array<{ clientId: string; clientName: string; accounts: ClientMetaAccount[] }>;
  availableAssets: Array<{
    metaAssetId: string;
    integrationId: string;
    adAccountId: string;
    accountName: string;
    currency: string | null;
    timezone: string | null;
    assetStatus: string | null;
    linkedClientId: string | null;
    clientMetaAssetId: string | null;
  }>;
  source?: 'rpc' | 'edge' | 'direct' | 'cache';
  cachedAt?: string;
}

const CACHE_PREFIX = 'camply.meta.assetCatalog.v1';

function cacheKey(clientId?: string): string | null {
  const userId = getSupabaseSessionUserId();
  if (!userId) return null;
  return `${CACHE_PREFIX}:${userId}:${clientId || 'all'}`;
}

function readCachedCatalog(clientId?: string): ClientMetaAssetCatalog | null {
  if (typeof window === 'undefined') return null;
  const key = cacheKey(clientId);
  if (!key) return null;
  try {
    let raw = window.localStorage.getItem(key);
    if (!raw && !clientId) {
      const userId = getSupabaseSessionUserId();
      const userPrefix = userId ? `${CACHE_PREFIX}:${userId}:` : null;
      if (userPrefix) {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const storageKey = window.localStorage.key(index);
          if (storageKey?.startsWith(userPrefix)) {
            raw = window.localStorage.getItem(storageKey);
            if (raw) break;
          }
        }
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientMetaAssetCatalog;
    if (!Array.isArray(parsed.clients) || !Array.isArray(parsed.availableAssets)) return null;
    return { ...parsed, source: 'cache' };
  } catch {
    return null;
  }
}

function writeCachedCatalog(clientId: string | undefined, catalog: ClientMetaAssetCatalog): void {
  if (typeof window === 'undefined') return;
  const key = cacheKey(clientId);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({
      ...catalog,
      source: catalog.source || 'rpc',
      cachedAt: new Date().toISOString(),
    }));
  } catch {
    // Cache is a resilience layer only; storage failures must not block the dashboard.
  }
}

export function loadCachedClientMetaAssetCatalog(clientId?: string): ClientMetaAssetCatalog | null {
  return readCachedCatalog(clientId);
}

const mockAccount = (): ClientMetaAccount => ({
  clientMetaAssetId: E2E_LINK_ID,
  metaAssetId: E2E_ASSET_ID,
  integrationId: 'integration-e2e',
  adAccountId: 'act_e2e',
  accountName: 'Conta Meta Mock',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  assetStatus: 'ACTIVE',
  linkedAt: '2026-06-30T12:00:00.000Z',
  availablePeriods: Array.from(metaE2EState.syncedPeriods),
  lastAttempt: {
    id: 'run-e2e', status: 'success', period: 'this_month', level: 'creative',
    scope: 'full_account', startedAt: '2026-06-30T17:59:00.000Z',
    finishedAt: '2026-06-30T18:00:00.000Z', terminationReason: 'completed',
    pagesFetched: 4, recordsFetched: 12,
  },
  lastSuccess: {
    id: 'run-e2e', period: 'this_month', level: 'creative', scope: 'full_account',
    startedAt: '2026-06-30T17:59:00.000Z', finishedAt: '2026-06-30T18:00:00.000Z',
    pagesFetched: 4, recordsFetched: 12,
  },
});

export async function loadClientMetaAssetCatalog(clientId?: string): Promise<ClientMetaAssetCatalog> {
  if (isMetaE2EMode) {
    const account = mockAccount();
    return {
      clients: clientId && clientId !== E2E_CLIENT_ID ? [] : [{
        clientId: E2E_CLIENT_ID,
        clientName: 'Clínica Mock',
        accounts: metaE2EState.linked ? [account] : [],
      }],
      availableAssets: [{
        metaAssetId: E2E_ASSET_ID,
        integrationId: 'integration-e2e',
        adAccountId: 'act_e2e',
        accountName: 'Conta Meta Mock',
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
        assetStatus: 'ACTIVE',
        linkedClientId: metaE2EState.linked ? E2E_CLIENT_ID : null,
        clientMetaAssetId: metaE2EState.linked ? E2E_LINK_ID : null,
      }],
    };
  }
  if (!supabaseData) throw new Error('Backend analítico não configurado.');
  try {
    const catalog = await invokeFunction<ClientMetaAssetCatalog>('meta-client-catalog', {
      clientId: clientId || null,
    }, 20_000);
    const edgeCatalog = { ...catalog, source: 'edge' as const };
    writeCachedCatalog(clientId, edgeCatalog);
    return edgeCatalog;
  } catch {
    // The Edge catalog runs with the service role and is the preferred path.
    // Keep the RPC/direct paths as fallbacks when the function is cold or not
    // available in a specific Supabase environment.
  }

  try {
    const { data, error } = await withTimeout(
      supabaseData.rpc('get_client_meta_asset_catalog', {
        p_client_id: clientId || null,
      }),
      10_000,
      'A leitura dos vínculos salvos demorou mais que o esperado.'
    );
    if (error) throw new Error('Não foi possível carregar os vínculos Meta.');
    const catalog = { ...(data as ClientMetaAssetCatalog), source: 'rpc' as const };
    writeCachedCatalog(clientId, catalog);
    return catalog;
  } catch (rpcError) {
    try {
      const catalog = await loadClientMetaAssetCatalogDirect(clientId);
      writeCachedCatalog(clientId, catalog);
      return catalog;
    } catch {
      const cached = readCachedCatalog(clientId);
      if (cached) return cached;
      throw rpcError instanceof Error ? rpcError : new Error('Não foi possível carregar os vínculos Meta.');
    }
  }
}

type DirectClientRow = { client_id: string; display_name: string | null };
type DirectIntegrationRow = { id: string };
type DirectAssetRow = {
  id: string;
  integration_id: string;
  asset_id: string;
  asset_name: string | null;
  currency: string | null;
  timezone_name: string | null;
  asset_status: string | null;
};
type DirectClientAssetRow = {
  id: string;
  client_id: string;
  meta_asset_id: string;
  linked_at: string;
};
type DirectRunRow = {
  id: string;
  status?: 'running' | 'success' | 'partial' | 'failed';
  requested_period: string;
  requested_level: string;
  run_scope: string;
  started_at: string;
  finished_at: string | null;
  termination_reason?: string | null;
  pages_fetched?: number | null;
  records_fetched?: number | null;
  integration_id: string;
  ad_account_id: string;
};

function runSummary(run?: DirectRunRow): MetaRunSummary | null {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    period: run.requested_period,
    level: run.requested_level,
    scope: run.run_scope,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    terminationReason: run.termination_reason ?? null,
    pagesFetched: run.pages_fetched ?? undefined,
    recordsFetched: run.records_fetched ?? undefined,
  };
}

function newestRun(current: DirectRunRow | undefined, candidate: DirectRunRow): DirectRunRow {
  if (!current) return candidate;
  const currentTime = new Date(current.finished_at || current.started_at).getTime();
  const candidateTime = new Date(candidate.finished_at || candidate.started_at).getTime();
  return candidateTime > currentTime ? candidate : current;
}

async function loadClientMetaAssetCatalogDirect(clientId?: string): Promise<ClientMetaAssetCatalog> {
  if (!supabaseData) throw new Error('Backend analítico não configurado.');

  const clientsQuery = supabaseData
    .from('client_identity')
    .select('client_id,display_name')
    .is('archived_at', null)
    .order('display_name', { ascending: true });

  const { data: clientsData, error: clientsError } = await withTimeout(
    clientId ? clientsQuery.eq('client_id', clientId) : clientsQuery,
    12_000,
    'A leitura direta dos clientes Meta demorou mais que o esperado.'
  );
  if (clientsError) throw clientsError;

  const { data: integrationsData, error: integrationsError } = await withTimeout(
    supabaseData
      .from('meta_integrations')
      .select('id')
      .eq('status', 'active'),
    12_000,
    'A leitura direta da conexão Meta demorou mais que o esperado.'
  );
  if (integrationsError) throw integrationsError;

  const integrations = (integrationsData || []) as DirectIntegrationRow[];
  const integrationIds = integrations.map((item) => item.id);
  const clients = (clientsData || []) as DirectClientRow[];
  if (integrationIds.length === 0) {
    return {
      clients: clients.map((client) => ({
        clientId: client.client_id,
        clientName: client.display_name || client.client_id,
        accounts: [],
      })),
      availableAssets: [],
      source: 'direct',
    };
  }

  const { data: assetsData, error: assetsError } = await withTimeout(
    supabaseData
      .from('meta_assets')
      .select('id,integration_id,asset_id,asset_name,currency,timezone_name,asset_status')
      .in('integration_id', integrationIds)
      .eq('asset_type', 'adaccount')
      .order('asset_name', { ascending: true }),
    12_000,
    'A leitura direta das contas Meta demorou mais que o esperado.'
  );
  if (assetsError) throw assetsError;

  const assets = (assetsData || []) as DirectAssetRow[];
  const assetIds = assets.map((asset) => asset.id);
  const adAccountIds = assets.map((asset) => asset.asset_id);

  const { data: linksData, error: linksError } = assetIds.length === 0
    ? { data: [], error: null }
    : await withTimeout(
      supabaseData
        .from('client_meta_assets')
        .select('id,client_id,meta_asset_id,linked_at')
        .in('meta_asset_id', assetIds)
        .is('unlinked_at', null),
      12_000,
      'A leitura direta dos vínculos Meta demorou mais que o esperado.'
    );
  if (linksError) throw linksError;

  const { data: runsData, error: runsError } = adAccountIds.length === 0
    ? { data: [], error: null }
    : await withTimeout(
      supabaseData
        .from('meta_sync_runs')
        .select('id,status,requested_period,requested_level,run_scope,started_at,finished_at,termination_reason,pages_fetched,records_fetched,integration_id,ad_account_id')
        .in('integration_id', integrationIds)
        .in('ad_account_id', adAccountIds)
        .order('started_at', { ascending: false })
        .limit(500),
      12_000,
      'A leitura direta dos snapshots Meta demorou mais que o esperado.'
    );
  if (runsError) throw runsError;

  const links = (linksData || []) as DirectClientAssetRow[];
  const runs = (runsData || []) as DirectRunRow[];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const linkByAssetId = new Map(links.map((link) => [link.meta_asset_id, link]));
  const lastAttemptByAccount = new Map<string, DirectRunRow>();
  const lastSuccessByAccount = new Map<string, DirectRunRow>();
  const periodsByAccount = new Map<string, Set<string>>();

  for (const run of runs) {
    const key = `${run.integration_id}:${run.ad_account_id}`;
    lastAttemptByAccount.set(key, newestRun(lastAttemptByAccount.get(key), run));
    if (run.status === 'success') {
      lastSuccessByAccount.set(key, newestRun(lastSuccessByAccount.get(key), run));
      if (run.run_scope === 'full_account' && ['this_month', 'this_week', 'today', 'last_7d', 'last_30d'].includes(run.requested_period)) {
        const periods = periodsByAccount.get(key) || new Set<string>();
        periods.add(run.requested_period);
        periodsByAccount.set(key, periods);
      }
    }
  }

  return {
    clients: clients.map((client) => ({
      clientId: client.client_id,
      clientName: client.display_name || client.client_id,
      accounts: links
        .filter((link) => link.client_id === client.client_id)
        .map((link) => {
          const asset = assetById.get(link.meta_asset_id);
          if (!asset) return null;
          const key = `${asset.integration_id}:${asset.asset_id}`;
          return {
            clientMetaAssetId: link.id,
            metaAssetId: asset.id,
            integrationId: asset.integration_id,
            adAccountId: asset.asset_id,
            accountName: asset.asset_name || asset.asset_id,
            currency: asset.currency,
            timezone: asset.timezone_name,
            assetStatus: asset.asset_status,
            linkedAt: link.linked_at,
            availablePeriods: Array.from(periodsByAccount.get(key) || []).sort(),
            lastAttempt: runSummary(lastAttemptByAccount.get(key)),
            lastSuccess: runSummary(lastSuccessByAccount.get(key)),
          } satisfies ClientMetaAccount;
        })
        .filter((account): account is ClientMetaAccount => Boolean(account)),
    })),
    availableAssets: assets.map((asset) => {
      const link = linkByAssetId.get(asset.id) || null;
      return {
        metaAssetId: asset.id,
        integrationId: asset.integration_id,
        adAccountId: asset.asset_id,
        accountName: asset.asset_name || asset.asset_id,
        currency: asset.currency,
        timezone: asset.timezone_name,
        assetStatus: asset.asset_status,
        linkedClientId: link?.client_id || null,
        clientMetaAssetId: link?.id || null,
      };
    }),
    source: 'direct',
  };
}

export async function linkClientMetaAsset(clientId: string, metaAssetId: string): Promise<string> {
  if (isMetaE2EMode) {
    metaE2EState.linked = true;
    persistMetaE2EState();
    return E2E_LINK_ID;
  }
  if (!supabaseData) throw new Error('Backend analítico não configurado.');
  const { data, error } = await supabaseData.rpc('link_client_meta_asset', {
    p_client_id: clientId,
    p_meta_asset_id: metaAssetId,
  });
  if (error) throw new Error('Não foi possível vincular esta conta ao cliente.');
  return String(data);
}

export async function unlinkClientMetaAsset(clientMetaAssetId: string): Promise<void> {
  if (isMetaE2EMode) {
    metaE2EState.linked = false;
    persistMetaE2EState();
    return;
  }
  if (!supabaseData) throw new Error('Backend analítico não configurado.');
  const { error } = await supabaseData.rpc('unlink_client_meta_asset', {
    p_client_meta_asset_id: clientMetaAssetId,
  });
  if (error) throw new Error('Não foi possível desvincular esta conta.');
}
