import type { GlobalClientPerformance, GlobalPerformanceAccount, GlobalMetricGroup, ClientDataFreshness, ClientAccountDataRun } from './globalPerformanceDashboard';

export function parseGlobalPerformanceDashboard(data: unknown): GlobalClientPerformance[] {
  if (!Array.isArray(data)) return [];
  return data.map(parseClient).filter((c): c is GlobalClientPerformance => c !== null);
}

function parseClient(item: unknown): GlobalClientPerformance | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;

  if (typeof obj.clientId !== 'string') return null;

  const accounts = Array.isArray(obj.accounts) 
    ? obj.accounts.map(parseAccount).filter((a): a is GlobalPerformanceAccount => a !== null)
    : [];

  const metrics = obj.metrics && typeof obj.metrics === 'object' ? obj.metrics : {};
  const dataQuality = obj.dataQuality && typeof obj.dataQuality === 'object' ? obj.dataQuality : { status: 'unavailable', reason: 'unknown' };
  
  // Calculate aggregate data quality based on accounts that have been collected.
  // Prioridade: unavailable > partial > zero_delivery > complete
  let aggregateQuality: 'complete' | 'partial' | 'zero_delivery' | 'unavailable' = 'complete';
  for (const acc of accounts) {
    if (!acc.dataRun) continue;
    const accStatus = acc.dataQuality.status;
    if (accStatus === 'unavailable') {
      aggregateQuality = 'unavailable';
      break;
    }
    if (accStatus === 'partial') {
      aggregateQuality = 'partial';
    }
    if (accStatus === 'zero_delivery' && aggregateQuality !== 'partial') {
      aggregateQuality = 'zero_delivery';
    }
  }

  const updatedDataQuality = {
    ...dataQuality,
    status: aggregateQuality
  };

  return {
    clientId: obj.clientId,
    clientName: typeof obj.clientName === 'string' ? obj.clientName : 'Desconhecido',
    clientStatus: typeof obj.clientStatus === 'string' ? obj.clientStatus as any : 'not_connected',
    accounts,
    metrics: metrics as any,
    metricGroups: Array.isArray(obj.metricGroups) ? obj.metricGroups as GlobalMetricGroup[] : [],
    resolvedTargets: Array.isArray(obj.resolvedTargets) ? obj.resolvedTargets : [],
    evaluations: Array.isArray(obj.evaluations) ? obj.evaluations : [],
    budgetPacing: obj.budgetPacing as any || null,
    score: obj.score as any || null,
    dataQuality: updatedDataQuality as any,
    dataFreshness: calculateClientDataFreshness(accounts),
    lastSuccessfulRun: obj.lastSuccessfulRun as any || null,
    lastAttempt: obj.lastAttempt as any || null,
    hasNewerPartial: Boolean(obj.hasNewerPartial),
    hasNewerFailure: Boolean(obj.hasNewerFailure),
    analysisProfile: obj.analysisProfile as any || null
  };
}

function calculateClientDataFreshness(accounts: GlobalPerformanceAccount[]): ClientDataFreshness {
  const sources: ClientAccountDataRun[] = [];
  let oldestAnchor: string | null = null;
  let anchorAccountId: string | null = null;
  let anchorAccountName: string | null = null;

  for (const acc of accounts) {
    if (acc.dataRun && acc.dataRun.finishedAt) {
      sources.push({
        accountId: acc.adAccountId,
        accountName: acc.accountName,
        runId: acc.dataRun.id,
        finishedAt: acc.dataRun.finishedAt,
      });
      if (!oldestAnchor || acc.dataRun.finishedAt < oldestAnchor) {
        oldestAnchor = acc.dataRun.finishedAt;
        anchorAccountId = acc.adAccountId;
        anchorAccountName = acc.accountName;
      }
    }
  }

  let reason: ClientDataFreshness['reason'] = 'none';
  if (sources.length === 1) {
    reason = 'single_account';
  } else if (sources.length > 1) {
    reason = 'oldest_of_multiple';
  }

  return {
    runCount: sources.length,
    oldestAnchor,
    anchorAccountId,
    anchorAccountName,
    reason,
    sources
  };
}

function parseAccount(item: unknown): GlobalPerformanceAccount | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  if (typeof obj.adAccountId !== 'string') return null;

  return {
    clientMetaAssetId: String(obj.clientMetaAssetId || ''),
    metaAssetId: String(obj.metaAssetId || ''),
    integrationId: String(obj.integrationId || ''),
    adAccountId: obj.adAccountId,
    accountName: typeof obj.accountName === 'string' ? obj.accountName : 'Desconhecido',
    currency: typeof obj.currency === 'string' ? obj.currency : null,
    timezone: typeof obj.timezone === 'string' ? obj.timezone : null,
    dateStart: typeof obj.dateStart === 'string' ? obj.dateStart : null,
    dateStop: typeof obj.dateStop === 'string' ? obj.dateStop : null,
    metrics: obj.metrics as any || {},
    budgetPacing: obj.budgetPacing as any || null,
    score: obj.score as any || undefined,
    dataQuality: obj.dataQuality as any || { status: 'unavailable', reason: 'unknown' },
    dataQualityByScope: obj.dataQualityByScope as any || { account: { status: 'unavailable', reason: 'unknown', coverage: [] }, campaigns: { status: 'unavailable', reason: 'unknown', coverage: [] } },
    dataRun: obj.dataRun as any || null,
    lastSuccessfulRun: obj.lastSuccessfulRun as any || null,
    lastAttempt: obj.lastAttempt as any || null
  };
}
