export type TraceableMetricCompleteness =
  | 'complete'
  | 'zero_delivery'
  | 'partial_page'
  | 'missing_insight_row'
  | 'timeout'
  | 'api_error'
  | 'rate_limit_exhausted'
  | 'validation_error'
  | 'mixed_currency'
  | 'unavailable';

export type TraceableMetricSourceLevel = 'account' | 'campaign' | 'adset' | 'ad' | 'aggregated';

export interface TraceableMetric {
  metricId: string;
  value: number | null;
  available: boolean;
  currency: string | null;
  dateStart: string | null;
  dateStop: string | null;
  timezone: string | null;
  sourceLevel: TraceableMetricSourceLevel;
  attributionSetting: string | null;
  classifiedObjective: string | null;
  destinationType: string | null;
  syncRunId: string | null;
  completenessStatus: TraceableMetricCompleteness;
  collectedAt: string | null;
  clientMetaAssetId: string | null;
  accountId: string | null;
  accountName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  unavailableReason?: string | null;
}

const completenessStatuses = new Set<TraceableMetricCompleteness>([
  'complete',
  'zero_delivery',
  'partial_page',
  'missing_insight_row',
  'timeout',
  'api_error',
  'rate_limit_exhausted',
  'validation_error',
  'mixed_currency',
  'unavailable',
]);

const sourceLevels = new Set<TraceableMetricSourceLevel>(['account', 'campaign', 'adset', 'ad', 'aggregated']);

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function unavailableTraceableMetric(metricId: string): TraceableMetric {
  return {
    metricId,
    value: null,
    available: false,
    currency: null,
    dateStart: null,
    dateStop: null,
    timezone: null,
    sourceLevel: 'aggregated',
    attributionSetting: null,
    classifiedObjective: null,
    destinationType: null,
    syncRunId: null,
    completenessStatus: 'unavailable',
    collectedAt: null,
    clientMetaAssetId: null,
    accountId: null,
    accountName: null,
    campaignId: null,
    adsetId: null,
    adId: null,
    unavailableReason: 'metric_unavailable',
  };
}

export function normalizeTraceableMetric(metricId: string, value: unknown): TraceableMetric {
  const fallback = unavailableTraceableMetric(metricId);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;

  const metric = value as Record<string, unknown>;
  const normalizedValue = finiteNumber(metric.value);
  const completenessStatus = completenessStatuses.has(metric.completenessStatus as TraceableMetricCompleteness)
    ? metric.completenessStatus as TraceableMetricCompleteness
    : 'unavailable';
  const sourceLevel = sourceLevels.has(metric.sourceLevel as TraceableMetricSourceLevel)
    ? metric.sourceLevel as TraceableMetricSourceLevel
    : 'aggregated';
  const available = metric.available === true && normalizedValue !== null;

  return {
    metricId,
    value: available ? normalizedValue : null,
    available,
    currency: nullableString(metric.currency),
    dateStart: nullableString(metric.dateStart),
    dateStop: nullableString(metric.dateStop),
    timezone: nullableString(metric.timezone),
    sourceLevel,
    attributionSetting: nullableString(metric.attributionSetting),
    classifiedObjective: nullableString(metric.classifiedObjective),
    destinationType: nullableString(metric.destinationType),
    syncRunId: nullableString(metric.syncRunId),
    completenessStatus: !available && ['complete', 'zero_delivery'].includes(completenessStatus)
      ? 'unavailable'
      : completenessStatus,
    collectedAt: nullableString(metric.collectedAt),
    clientMetaAssetId: nullableString(metric.clientMetaAssetId),
    accountId: nullableString(metric.accountId),
    accountName: nullableString(metric.accountName),
    campaignId: nullableString(metric.campaignId),
    adsetId: nullableString(metric.adsetId),
    adId: nullableString(metric.adId),
    unavailableReason: nullableString(metric.unavailableReason),
  };
}

function scopeSignature(metric: TraceableMetric): string {
  return [
    metric.clientMetaAssetId,
    metric.accountId,
    metric.campaignId,
    metric.adsetId,
    metric.adId,
    metric.sourceLevel,
    metric.attributionSetting,
    metric.classifiedObjective,
    metric.destinationType,
    metric.dateStart,
    metric.dateStop,
    metric.timezone,
    metric.currency,
    metric.syncRunId,
    metric.collectedAt,
  ].join('|');
}

export function deriveCostMetric(
  metricId: string,
  spend: TraceableMetric | undefined,
  result: TraceableMetric | undefined
): TraceableMetric {
  const source = result || spend || unavailableTraceableMetric(metricId);
  const derived: TraceableMetric = {
    ...source,
    metricId,
    value: null,
    available: false,
    unavailableReason: 'missing_compatible_inputs',
  };

  if (!spend?.available || !result?.available || spend.value === null || result.value === null) {
    return derived;
  }
  if (scopeSignature(spend) !== scopeSignature(result)) {
    return { ...derived, completenessStatus: 'unavailable', unavailableReason: 'incompatible_metric_scope' };
  }
  if (result.value <= 0) return { ...derived, unavailableReason: 'denominator_not_positive' };

  return {
    ...derived,
    value: spend.value / result.value,
    available: true,
    unavailableReason: null,
    completenessStatus: spend.completenessStatus === 'complete'
      ? result.completenessStatus
      : spend.completenessStatus,
  };
}

export function deriveScopedMetric(
  metricId: string,
  numerator: TraceableMetric | undefined,
  denominator: TraceableMetric | undefined,
  multiplier = 1
): TraceableMetric {
  const source = numerator || denominator || unavailableTraceableMetric(metricId);
  const unavailable: TraceableMetric = {
    ...source,
    metricId,
    value: null,
    available: false,
    completenessStatus: 'unavailable',
    unavailableReason: 'missing_compatible_inputs',
  };

  if (!numerator?.available || !denominator?.available
    || numerator.value === null || denominator.value === null) return unavailable;
  if (scopeSignature(numerator) !== scopeSignature(denominator)) {
    return { ...unavailable, unavailableReason: 'incompatible_metric_scope' };
  }
  if (denominator.value <= 0) {
    return { ...unavailable, unavailableReason: 'denominator_not_positive' };
  }

  return {
    ...source,
    metricId,
    value: (numerator.value / denominator.value) * multiplier,
    available: true,
    completenessStatus: numerator.completenessStatus === 'complete'
      ? denominator.completenessStatus
      : numerator.completenessStatus,
    unavailableReason: null,
  };
}

export function metricTraceLabel(metric: TraceableMetric): string {
  const lines = [
    `Métrica: ${metric.metricId}`,
    `Conta: ${metric.accountName || 'não informada'}${metric.accountId ? ` (${metric.accountId})` : ''}`,
    `Período: ${metric.dateStart || '—'} a ${metric.dateStop || '—'}`,
    `Timezone: ${metric.timezone || '—'}`,
    `Nível: ${metric.sourceLevel}`,
    `Atribuição: ${metric.attributionSetting || 'não informada'}`,
    `Objetivo: ${metric.classifiedObjective || 'não informado'}`,
    `Destino: ${metric.destinationType || 'não informado'}`,
    `Run: ${metric.syncRunId || '—'}`,
    `Qualidade: ${metric.completenessStatus}`,
    `Indisponibilidade: ${metric.unavailableReason || '—'}`,
    `Coletado em: ${metric.collectedAt || '—'}`,
  ];
  return lines.join('\n');
}
