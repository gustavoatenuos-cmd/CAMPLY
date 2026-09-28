import { supabaseData } from '../supabase';
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

export const META_STRUCTURE_MAX_AGE_MINUTES = 60;
export const META_CREATIVE_MAX_AGE_MINUTES = 360;
export const META_REPORTING_LAG_TOLERANCE_DAYS = 2;

function isoDayDiff(later: string | null, earlier: string | null): number | null {
  if (!later || !earlier) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(later) || !/^\d{4}-\d{2}-\d{2}$/.test(earlier)) return null;
  const laterMs = Date.parse(`${later}T12:00:00Z`);
  const earlierMs = Date.parse(`${earlier}T12:00:00Z`);
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs)) return null;
  return Math.round((laterMs - earlierMs) / 86_400_000);
}

function syncedRecently(iso: string | null, maxAgeMinutes: number, nowMs = Date.now()): boolean {
  if (!iso) return false;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return nowMs - timestamp <= maxAgeMinutes * 60_000;
}

export function normalizeMetaFreshnessItem(item: MetaFreshnessItem, nowMs = Date.now()): MetaFreshnessItem {
  const lagDays = isoDayDiff(item.localToday, item.structureDateStop);
  const lagAcceptable = lagDays !== null
    && lagDays >= 0
    && lagDays <= META_REPORTING_LAG_TOLERANCE_DAYS;
  const derivedStructureFresh = lagAcceptable
    && syncedRecently(item.structureLastSyncedAt, META_STRUCTURE_MAX_AGE_MINUTES, nowMs);
  const structureFresh = item.structureFresh || derivedStructureFresh;

  return {
    ...item,
    structureFresh,
    needsStructureRefresh: !structureFresh,
  };
}

export async function loadMetaFreshnessStatus(): Promise<MetaFreshnessSnapshot> {
  if (isMetaE2EMode) {
    return { state: 'ready', checkedAt: new Date().toISOString(), items: [] };
  }
  if (!supabaseData) return EMPTY;

  const { data, error } = await supabaseData.rpc('get_meta_freshness_status', {
    p_structure_max_age_minutes: META_STRUCTURE_MAX_AGE_MINUTES,
    p_creative_max_age_minutes: META_CREATIVE_MAX_AGE_MINUTES,
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
    items: Array.isArray(payload?.items)
      ? payload.items.map((item) => normalizeMetaFreshnessItem(item))
      : [],
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
