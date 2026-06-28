import { classifyAdSetObjective, classifyCampaignObjective } from './campaignObjectiveClassifier.ts';
import {
  analyzeCampaignMix,
  insightHasDelivery,
  type CampaignMixAnalysis,
  type MetaAdSetForMixAnalysis,
  type MetaAdSetInsightForDelivery,
} from './mixedAttributionDetector.ts';
import { normalizeMetaMetrics } from './metaNormalizer.ts';
import {
  aggregateCompatibleMetrics,
  type MetaObjective,
  type MetricValueMap,
} from './metricRegistry.ts';

export type PeriodCompletenessStatus =
  | 'zero_delivery'
  | 'missing_insight_row'
  | 'partial_page'
  | 'timeout'
  | 'api_error'
  | 'validation_error'
  | 'complete';

export interface MetaInsightRow extends MetaAdSetInsightForDelivery {
  campaign_id?: string;
  date_start?: string | null;
  date_stop?: string | null;
  reach?: string | number | null;
  inline_link_clicks?: string | number | null;
  action_values?: Array<{ action_type?: string; value?: string | number | null }> | null;
  [key: string]: unknown;
}

export interface MetaAdSetDefinition extends MetaAdSetForMixAnalysis {
  campaign_id?: string;
  name?: string;
}

export interface PeriodCompleteness {
  status: PeriodCompletenessStatus;
  reason?: string;
  sourceLevel: 'campaign' | 'adset';
  missingAdsetIds: string[];
  failedAdsetIds: string[];
  dateStart: string | null;
  dateStop: string | null;
  timezone: string;
  currency: string;
}

export interface AttributionGroup {
  attributionSetting: string;
  classifiedObjective: MetaObjective;
  adsetIds: string[];
  metrics: MetricValueMap;
  sourceLevel: 'campaign' | 'adset';
  dateStart: string | null;
  dateStop: string | null;
  timezone: string;
  currency: string;
  completeness: PeriodCompletenessStatus;
}

export interface GlobalMetrics {
  [key: string]: number | string | null | undefined;
  sourceLevel: 'campaign';
  dateStart: string | null;
  dateStop: string | null;
  timezone: string;
  currency: string;
}

export interface CampaignPeriodAnalytics {
  mix: CampaignMixAnalysis;
  classifiedObjective: MetaObjective;
  globalMetrics?: GlobalMetrics;
  attributionGroups: AttributionGroup[];
  completeness: PeriodCompleteness;
}

export interface PeriodAnalyticsContext {
  campaignCollectionStatus: PeriodCompletenessStatus;
  adsetCollectionStatus: PeriodCompletenessStatus;
  timezone: string;
  currency: string;
  failedAdsetIds?: string[];
}

export interface TrendPeriodSignature {
  period: string;
  attributionSettings: string[];
  sourceLevel: 'campaign' | 'adset';
  timezone: string;
  objectiveGroups: MetaObjective[];
  completenessStatus: PeriodCompletenessStatus;
  dateStart: string | null;
  dateStop: string | null;
  metricDefinitionVersion: string;
}

export interface TrendAvailability {
  available: boolean;
  reason: string | null;
  comparedWith?: string;
}

const statusPriority: Record<PeriodCompletenessStatus, number> = {
  complete: 0,
  zero_delivery: 1,
  missing_insight_row: 2,
  validation_error: 3,
  partial_page: 4,
  timeout: 5,
  api_error: 6,
};

export function mergeCompletenessStatuses(
  statuses: PeriodCompletenessStatus[]
): PeriodCompletenessStatus {
  if (statuses.length === 0) return 'complete';
  return statuses.reduce((worst, current) =>
    statusPriority[current] > statusPriority[worst] ? current : worst
  );
}

const flatMetrics = (normalized: ReturnType<typeof normalizeMetaMetrics>): MetricValueMap =>
  Object.fromEntries(Object.entries(normalized).map(([metricId, result]) => [metricId, result.value]));

function groupAdsetMetrics(
  adsets: MetaAdSetDefinition[],
  insights: MetaInsightRow[],
  campaignObjective: string,
  context: PeriodAnalyticsContext
): AttributionGroup[] {
  type Bucket = {
    adsetIds: string[];
    metrics: MetricValueMap[];
    statuses: PeriodCompletenessStatus[];
    dateStart: string | null;
    dateStop: string | null;
  };

  const nested = new Map<string, Map<MetaObjective, Bucket>>();

  for (const insight of insights) {
    const adset = adsets.find((candidate) => candidate.id === insight.adset_id);
    if (!adset) continue;

    const objective = adset.classified_objective || classifyAdSetObjective({
      campaignObjective,
      adsetOptimizationGoal: adset.optimization_goal || undefined,
      adsetDestinationType: adset.destination_type || undefined,
      adsetPromotedObject: adset.promoted_object,
    });
    const attribution = adset.attribution_setting || 'UNKNOWN';
    const metrics = flatMetrics(normalizeMetaMetrics([insight], objective, insight.campaign_id || '', adset.id));
    const rowStatus = context.adsetCollectionStatus === 'complete'
      ? (insightHasDelivery(insight) ? 'complete' : 'zero_delivery')
      : context.adsetCollectionStatus;

    let objectiveMap = nested.get(attribution);
    if (!objectiveMap) {
      objectiveMap = new Map<MetaObjective, Bucket>();
      nested.set(attribution, objectiveMap);
    }
    let bucket = objectiveMap.get(objective);
    if (!bucket) {
      bucket = {
        adsetIds: [],
        metrics: [],
        statuses: [],
        dateStart: insight.date_start || null,
        dateStop: insight.date_stop || null,
      };
      objectiveMap.set(objective, bucket);
    }
    bucket.adsetIds.push(adset.id);
    bucket.metrics.push(metrics);
    bucket.statuses.push(rowStatus);
  }

  const groups: AttributionGroup[] = [];
  for (const [attributionSetting, objectiveMap] of nested) {
    for (const [classifiedObjective, bucket] of objectiveMap) {
      groups.push({
        attributionSetting,
        classifiedObjective,
        adsetIds: Array.from(new Set(bucket.adsetIds)).sort(),
        metrics: aggregateCompatibleMetrics(bucket.metrics, { sourceLevel: 'adset' }),
        sourceLevel: 'adset',
        dateStart: bucket.dateStart,
        dateStop: bucket.dateStop,
        timezone: context.timezone,
        currency: context.currency,
        completeness: mergeCompletenessStatuses(bucket.statuses),
      });
    }
  }

  return groups.sort((left, right) =>
    left.attributionSetting.localeCompare(right.attributionSetting)
    || left.classifiedObjective.localeCompare(right.classifiedObjective)
  );
}

export function buildCampaignPeriodAnalytics(
  campaign: { id: string; objective: string },
  adsets: MetaAdSetDefinition[],
  campaignInsight: MetaInsightRow | undefined,
  adsetInsights: MetaInsightRow[],
  context: PeriodAnalyticsContext
): CampaignPeriodAnalytics {
  const classifiedAdsets = adsets.map((adset) => ({
    ...adset,
    classified_objective: adset.classified_objective || classifyAdSetObjective({
      campaignObjective: campaign.objective,
      adsetOptimizationGoal: adset.optimization_goal || undefined,
      adsetDestinationType: adset.destination_type || undefined,
      adsetPromotedObject: adset.promoted_object,
    }),
  }));
  const classifiedObjective = classifyCampaignObjective(classifiedAdsets.map((adset) => ({
    campaignObjective: campaign.objective,
    adsetOptimizationGoal: adset.optimization_goal || undefined,
    adsetDestinationType: adset.destination_type || undefined,
    adsetPromotedObject: adset.promoted_object,
  })));
  const mix = analyzeCampaignMix(classifiedAdsets, campaign.objective, adsetInsights);
  const requiresAdsetLevel = mix.structuralMixedAttribution || mix.mixedObjective || mix.mixedDestination;
  const expectedAdsetIds = new Set(classifiedAdsets.map((adset) => adset.id));
  const returnedAdsetIds = new Set(adsetInsights.map((insight) => insight.adset_id));
  const missingAdsetIds = requiresAdsetLevel
    ? Array.from(expectedAdsetIds).filter((id) => !returnedAdsetIds.has(id)).sort()
    : [];

  let globalMetrics: GlobalMetrics | undefined;
  if (campaignInsight) {
    const normalizedGlobal = flatMetrics(
      normalizeMetaMetrics([campaignInsight], classifiedObjective, campaign.id)
    );
    globalMetrics = {
      ...aggregateCompatibleMetrics([normalizedGlobal], {
        sourceLevel: 'campaign',
        deduplicatedReach: typeof normalizedGlobal.reach === 'number' ? normalizedGlobal.reach : undefined,
      }),
      sourceLevel: 'campaign',
      dateStart: campaignInsight.date_start || null,
      dateStop: campaignInsight.date_stop || null,
      timezone: context.timezone,
      currency: context.currency,
    };
  }

  let attributionGroups: AttributionGroup[] = [];
  if (requiresAdsetLevel) {
    attributionGroups = groupAdsetMetrics(
      classifiedAdsets,
      adsetInsights,
      campaign.objective,
      context
    );
  } else if (campaignInsight) {
    const normalized = flatMetrics(
      normalizeMetaMetrics([campaignInsight], classifiedObjective, campaign.id)
    );
    attributionGroups = [{
      attributionSetting: classifiedAdsets[0]?.attribution_setting || 'UNKNOWN',
      classifiedObjective,
      adsetIds: classifiedAdsets.map((adset) => adset.id).sort(),
      metrics: aggregateCompatibleMetrics([normalized], {
        sourceLevel: 'campaign',
        deduplicatedReach: typeof normalized.reach === 'number' ? normalized.reach : undefined,
      }),
      sourceLevel: 'campaign',
      dateStart: campaignInsight.date_start || null,
      dateStop: campaignInsight.date_stop || null,
      timezone: context.timezone,
      currency: context.currency,
      completeness: context.campaignCollectionStatus === 'complete'
        ? (insightHasDelivery({
          adset_id: campaign.id,
          spend: campaignInsight.spend,
          impressions: campaignInsight.impressions,
          actions: campaignInsight.actions,
        }) ? 'complete' : 'zero_delivery')
        : context.campaignCollectionStatus,
    }];
  }

  const deliveryStatuses = requiresAdsetLevel
    ? attributionGroups.map((group) => group.completeness)
    : attributionGroups.map((group) => group.completeness);
  const statuses: PeriodCompletenessStatus[] = [
    context.campaignCollectionStatus,
    ...(requiresAdsetLevel ? [context.adsetCollectionStatus] : []),
    ...deliveryStatuses,
  ];
  if (!campaignInsight) statuses.push('missing_insight_row');
  if (missingAdsetIds.length > 0) statuses.push('missing_insight_row');
  if (context.timezone === 'UNKNOWN' || context.currency === 'UNKNOWN') {
    statuses.push('validation_error');
  }

  const completenessStatus = mergeCompletenessStatuses(statuses);
  const dateStart = campaignInsight?.date_start || attributionGroups[0]?.dateStart || null;
  const dateStop = campaignInsight?.date_stop || attributionGroups[0]?.dateStop || null;

  return {
    mix,
    classifiedObjective,
    globalMetrics,
    attributionGroups,
    completeness: {
      status: completenessStatus,
      reason: completenessStatus === 'complete' || completenessStatus === 'zero_delivery'
        ? undefined
        : 'The period is not fully comparable because collection or validation was incomplete.',
      sourceLevel: requiresAdsetLevel ? 'adset' : 'campaign',
      missingAdsetIds,
      failedAdsetIds: Array.from(new Set(context.failedAdsetIds || [])).sort(),
      dateStart,
      dateStop,
      timezone: context.timezone,
      currency: context.currency,
    },
  };
}

const sortedKey = (values: string[]) => Array.from(new Set(values)).sort().join('|');

const dateSpanDays = (start: string | null, stop: string | null): number | null => {
  if (!start || !stop) return null;
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const stopTime = Date.parse(`${stop}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(stopTime)) return null;
  return Math.round((stopTime - startTime) / 86_400_000) + 1;
};

export function evaluateTrendAvailability(
  current: TrendPeriodSignature,
  previous?: TrendPeriodSignature
): TrendAvailability {
  if (!previous) return { available: false, reason: 'Previous equivalent period is unavailable' };
  if (current.completenessStatus !== 'complete' || previous.completenessStatus !== 'complete') {
    return { available: false, reason: 'One or both periods are incomplete', comparedWith: previous.period };
  }
  if (sortedKey(current.attributionSettings) !== sortedKey(previous.attributionSettings)) {
    return { available: false, reason: 'Attribution settings changed', comparedWith: previous.period };
  }
  if (current.sourceLevel !== previous.sourceLevel) {
    return { available: false, reason: 'Source level changed', comparedWith: previous.period };
  }
  if (
    current.timezone === 'UNKNOWN'
    || previous.timezone === 'UNKNOWN'
    || current.timezone !== previous.timezone
  ) {
    return { available: false, reason: 'Timezone is unavailable or changed', comparedWith: previous.period };
  }
  if (sortedKey(current.objectiveGroups) !== sortedKey(previous.objectiveGroups)) {
    return { available: false, reason: 'Objective groups changed', comparedWith: previous.period };
  }
  if (
    current.metricDefinitionVersion !== previous.metricDefinitionVersion
  ) {
    return { available: false, reason: 'Metric definition changed', comparedWith: previous.period };
  }
  const currentSpan = dateSpanDays(current.dateStart, current.dateStop);
  const previousSpan = dateSpanDays(previous.dateStart, previous.dateStop);
  if (currentSpan === null || previousSpan === null || currentSpan !== previousSpan) {
    return { available: false, reason: 'Date ranges are not equivalent', comparedWith: previous.period };
  }

  return { available: true, reason: null, comparedWith: previous.period };
}

export function buildTrendAvailabilityByPeriod(
  signatures: TrendPeriodSignature[]
): Record<string, TrendAvailability> {
  return Object.fromEntries(signatures.map((signature, index) => [
    signature.period,
    evaluateTrendAvailability(signature, index > 0 ? signatures[index - 1] : undefined),
  ]));
}
