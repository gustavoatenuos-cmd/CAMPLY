import { isMetaE2EMode } from './metaE2ERuntime';
import { syncMetaAsset, type MetaSyncLevel } from './metaSyncService';
import { supabase } from '../supabase';

export const META_FRESHNESS_UPDATED_EVENT = 'camply:meta-freshness-updated';

export interface MetaFreshnessAccount {
  clientMetaAssetId: string;
  clientId: string;
  accountId: string;
  accountName: string;
  timezone: string | null;
  localToday: string | null;
  campaignFreshThrough: string | null;
  campaignRefreshedAt: string | null;
  creativeFreshThrough: string | null;
  creativeRefreshedAt: string | null;
  needsCampaignRefresh: boolean;
  needsCreativeRefresh: boolean;
}

interface MetaFreshnessRpcResponse {
  state: 'ready' | 'unauthorized';
  staleAfterMinutes?: number;
  items?: MetaFreshnessAccount[];
}

export interface RefreshStaleMetaResult {
  checked: number;
  stale: number;
  refreshed: number;
  running: number;
  failed: number;
  accounts: MetaFreshnessAccount[];
}

export async function loadMetaFreshnessStatus(
  staleAfterMinutes = 30
): Promise<MetaFreshnessAccount[]> {
  if (isMetaE2EMode) return [];
  if (!supabase) return [];

  const { data, error } = await supabase.rpc('get_meta_freshness_status', {
    p_stale_after_minutes: staleAfterMinutes,
  });

  if (error) {
    console.error('[MetaFreshness] Falha ao consultar freshness.', error);
    throw new Error(error.message || 'Não foi possível consultar a atualização das contas Meta.');
  }

  const response = data as unknown as MetaFreshnessRpcResponse;
  return response?.state === 'ready' && Array.isArray(response.items)
    ? response.items
    : [];
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    }
  );
  await Promise.all(workers);
}

export async function refreshStaleMetaAccounts(options: {
  level?: Extract<MetaSyncLevel, 'campaign' | 'creative'>;
  staleAfterMinutes?: number;
  concurrency?: number;
  clientMetaAssetIds?: string[];
} = {}): Promise<RefreshStaleMetaResult> {
  const level = options.level || 'campaign';
  const accounts = await loadMetaFreshnessStatus(options.staleAfterMinutes ?? 30);
  const selectedIds = options.clientMetaAssetIds?.length
    ? new Set(options.clientMetaAssetIds)
    : null;
  const eligibleAccounts = selectedIds
    ? accounts.filter((account) => selectedIds.has(account.clientMetaAssetId))
    : accounts;
  const staleAccounts = eligibleAccounts.filter((account) => (
    level === 'creative'
      ? account.needsCreativeRefresh
      : account.needsCampaignRefresh
  ));

  let refreshed = 0;
  let running = 0;
  let failed = 0;

  await runWithConcurrency(staleAccounts, options.concurrency ?? 2, async (account) => {
    try {
      const result = await syncMetaAsset({
        clientMetaAssetId: account.clientMetaAssetId,
        period: 'today',
        requestedLevel: level,
        refreshMode: 'fresh',
      });

      if (result.status === 'running') {
        running += 1;
      } else if (result.status === 'success' || result.status === 'partial') {
        refreshed += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      console.warn('[MetaFreshness] Atualização de conta falhou.', {
        clientMetaAssetId: account.clientMetaAssetId,
        error,
      });
    }
  });

  if (refreshed > 0 || running > 0) {
    window.dispatchEvent(new CustomEvent(META_FRESHNESS_UPDATED_EVENT, {
      detail: { level, refreshed, running },
    }));
  }

  return {
    checked: eligibleAccounts.length,
    stale: staleAccounts.length,
    refreshed,
    running,
    failed,
    accounts: eligibleAccounts,
  };
}
