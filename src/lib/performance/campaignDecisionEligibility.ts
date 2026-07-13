export type CampaignEligibilityVerdict =
  | 'NOT_OPERATIONAL'
  | 'STALE_SNAPSHOT'
  | 'ACTIVE_WITHOUT_ACTIVE_STRUCTURE'
  | 'ACTIVE_NO_DELIVERY'
  | 'PAUSED_WITH_SPEND'
  | 'UNCLASSIFIED_DESTINATION'
  | 'ANALYZABLE';

export type CampaignScopeStatus = 'included' | 'excluded' | 'archived';

export interface CampaignEligibilityRun {
  finishedAt: string | null;
  status: string | null;
}

export interface CampaignEligibilityMetricFact {
  value: number | null;
  available: boolean;
}

export interface CampaignEligibilityInput {
  effectiveStatus: string | null;
  metaStatus: string | null;
  hasActiveAdset: boolean;
  adLevelCollected: boolean;
  hasActiveAd: boolean;
  metrics: Record<string, CampaignEligibilityMetricFact>;
  classifiedObjective: string | null;
  scopeStatus: CampaignScopeStatus;
  run: CampaignEligibilityRun | null;
}

export interface CampaignEligibilityResult {
  verdict: CampaignEligibilityVerdict;
  reason: string;
  isStale: boolean;
}

export const REAL_METRIC_IDS = [
  'spend',
  'impressions',
  'reach',
  'clicks',
  'link_clicks',
  'messaging_conversations_started_total',
  'leads',
  'purchases',
  'purchase_value',
] as const;

export const STALE_SNAPSHOT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function isActiveStatus(effectiveStatus: string | null, metaStatus: string | null): boolean {
  return (effectiveStatus || metaStatus || '').toUpperCase() === 'ACTIVE';
}

function hasPositiveMetric(
  metrics: Record<string, CampaignEligibilityMetricFact>,
  metricIds: readonly string[]
): boolean {
  return metricIds.some((metricId) => {
    const metric = metrics[metricId];
    return Boolean(metric?.available) && typeof metric?.value === 'number' && metric.value > 0;
  });
}

export function isRunStale(run: CampaignEligibilityRun | null): boolean {
  if (!run || !run.finishedAt) return false;
  return Date.now() - new Date(run.finishedAt).getTime() > STALE_SNAPSHOT_THRESHOLD_MS;
}

export function evaluateCampaignEligibility(
  input: CampaignEligibilityInput
): CampaignEligibilityResult | null {
  const isStale = isRunStale(input.run);

  if (input.scopeStatus === 'excluded' || input.scopeStatus === 'archived') {
    return { verdict: 'NOT_OPERATIONAL', reason: 'excluded_by_scope', isStale };
  }

  if (input.run === null) {
    return { verdict: 'STALE_SNAPSHOT', reason: 'no_usable_sync_run', isStale };
  }

  const isActive = isActiveStatus(input.effectiveStatus, input.metaStatus);

  if (isActive) {
    const structureFailed =
      !input.hasActiveAdset || (input.adLevelCollected && !input.hasActiveAd);
    if (structureFailed) {
      return {
        verdict: 'ACTIVE_WITHOUT_ACTIVE_STRUCTURE',
        reason: !input.hasActiveAdset ? 'no_active_adset' : 'ad_level_collected_no_active_ad',
        isStale,
      };
    }

    if (!hasPositiveMetric(input.metrics, REAL_METRIC_IDS)) {
      return { verdict: 'ACTIVE_NO_DELIVERY', reason: 'no_positive_metric', isStale };
    }

    if (!input.classifiedObjective || input.classifiedObjective === 'UNCLASSIFIED') {
      return { verdict: 'UNCLASSIFIED_DESTINATION', reason: 'unclassified_objective', isStale };
    }

    return { verdict: 'ANALYZABLE', reason: 'passes_all_checks', isStale };
  }

  if (hasPositiveMetric(input.metrics, ['spend'])) {
    return { verdict: 'PAUSED_WITH_SPEND', reason: 'paused_with_positive_spend', isStale };
  }

  return null;
}
