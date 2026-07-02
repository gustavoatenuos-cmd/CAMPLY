import { supabase } from '../supabase';
import {
  E2E_ASSET_ID,
  E2E_CLIENT_ID,
  E2E_LINK_ID,
  isMetaE2EMode,
  metaE2EState,
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
  if (!supabase) throw new Error('Backend analítico não configurado.');
  const { data, error } = await supabase.rpc('get_client_meta_asset_catalog', {
    p_client_id: clientId || null,
  });
  if (error) throw new Error('Não foi possível carregar os vínculos Meta.');
  return data as ClientMetaAssetCatalog;
}

export async function linkClientMetaAsset(clientId: string, metaAssetId: string): Promise<string> {
  if (isMetaE2EMode) {
    metaE2EState.linked = true;
    return E2E_LINK_ID;
  }
  if (!supabase) throw new Error('Backend analítico não configurado.');
  const { data, error } = await supabase.rpc('link_client_meta_asset', {
    p_client_id: clientId,
    p_meta_asset_id: metaAssetId,
  });
  if (error) throw new Error('Não foi possível vincular esta conta ao cliente.');
  return String(data);
}

export async function unlinkClientMetaAsset(clientMetaAssetId: string): Promise<void> {
  if (isMetaE2EMode) {
    metaE2EState.linked = false;
    return;
  }
  if (!supabase) throw new Error('Backend analítico não configurado.');
  const { error } = await supabase.rpc('unlink_client_meta_asset', {
    p_client_meta_asset_id: clientMetaAssetId,
  });
  if (error) throw new Error('Não foi possível desvincular esta conta.');
}
