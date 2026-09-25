import { supabase } from '../supabase';
import { isMetaE2EMode } from './metaE2ERuntime';
import { syncMetaAsset } from './metaSyncService';

export interface MetaFreshnessItem {
  clientId: string;
  clientMetaAssetId: string;
  accountId: string;
  accountName: string;
  timezone: string | null;
  localToday: string | null;
  structureLastSyncedAt: string | null;
  structureDateStop: string | null;
  creativeLastSyncedAt: string | null;
  creativeDateStop: string | null;
  structureFresh: boolean;
  creativeFresh: boolean;
  needsStructureRefresh: boolean;
  needsCreativeRefresh: boolean;
}

export interface MetaFreshnessSnapshot {
  state: 'ready' | 'unauthorized' | 'unavailable';
  checkedAt: string | null;
  items: MetaFreshnessItem[];
}

const EMPTY: MetaFreshnessSnapshot = {
  state: 'unavailable',
  checkedAt: null,
  items: [],
};

export async function loadMetaFreshnessStatus(): Promise<MetaFreshnessSnapshot> {
  if (isMetaE2EMode) {
    return { state: 'ready', checkedAt: new Date().toISOString(), items: [] };
  }
  if (!supabase) return EMPTY;

  const { data, error } = await supabase.rpc('get_meta_freshness_status', {
    p_structure_max_age_minutes: 60,
    p_creative_max_age_minutes: 360,
  });

  if (error) {
    console.warn('[MetaFreshness] status unavailable', error);
    return EMPTY;
  }

  const payload = data as unknown as {
    state?: MetaFreshnessSnapshot['state'];
    checkedAt?: string | null;
    items?: MetaFreshnessItem[];
  };

  return {
    state: payload?.state || 'unavailable',
    checkedAt: payload?.checkedAt || null,
    items: Array.isArray(payload?.items) ? payload.items : [],
  };
}

async function runWithConcurrency<T>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await worker(values[index]);
    }
  });
  await Promise.all(runners);
}

export async function refreshStaleMetaStructure(
  snapshot: MetaFreshnessSnapshot,
  onProgress?: (completed: number, total: number) => void
): Promise<{ attempted: number; failed: number }> {
  const stale = snapshot.items.filter((item) => item.needsStructureRefresh);
  if (stale.length === 0 || isMetaE2EMode) return { attempted: 0, failed: 0 };

  let completed = 0;
  let failed = 0;

  // Two concurrent accounts keeps login refresh responsive without producing a
  // burst of Graph API traffic. The current sync engine still writes the
  // official last_90d base; this orchestrator makes that work automatic and
  // invisible to the user.
  await runWithConcurrency(stale, 2, async (item) => {
    try {
      const result = await syncMetaAsset({
        clientMetaAssetId: item.clientMetaAssetId,
        period: 'today',
        requestedLevel: 'campaign',
      });
      if (!result.success && result.status !== 'running') failed += 1;
    } catch (error) {
      failed += 1;
      console.warn('[MetaFreshness] background refresh failed', {
        clientMetaAssetId: item.clientMetaAssetId,
        error,
      });
    } finally {
      completed += 1;
      onProgress?.(completed, stale.length);
    }
  });

  return { attempted: stale.length, failed };
}
