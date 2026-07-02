import type { TraceableMetric } from '../performance/traceableMetrics';

export type ReconciliationStatus = 'reconciled' | 'within_tolerance' | 'divergent' | 'unavailable' | 'partial' | 'incompatible_parameters';

export interface ReconciliationResult {
  metricId: string;
  referenceValue: number | null;
  camplyValue: number | null;
  absoluteDifference: number | null;
  percentageDifference: number | null;
  status: ReconciliationStatus;
  probableCause: string;
}

export function reconcileTraceableMetric(
  metric: TraceableMetric | undefined,
  referenceValue: number | null,
  tolerancePercent = 1
): ReconciliationResult {
  if (!metric?.available || metric.value === null || referenceValue === null) {
    return {
      metricId: metric?.metricId || 'unknown', referenceValue, camplyValue: metric?.value ?? null,
      absoluteDifference: null, percentageDifference: null, status: 'unavailable',
      probableCause: 'Métrica ou referência indisponível.',
    };
  }
  if (!['complete', 'zero_delivery'].includes(metric.completenessStatus)) {
    return {
      metricId: metric.metricId, referenceValue, camplyValue: metric.value,
      absoluteDifference: metric.value - referenceValue, percentageDifference: null,
      status: 'partial', probableCause: `Run com qualidade ${metric.completenessStatus}.`,
    };
  }
  const absoluteDifference = metric.value - referenceValue;
  const percentageDifference = referenceValue === 0
    ? (metric.value === 0 ? 0 : null)
    : (absoluteDifference / Math.abs(referenceValue)) * 100;
  const absolutePercent = Math.abs(percentageDifference ?? Number.POSITIVE_INFINITY);
  return {
    metricId: metric.metricId, referenceValue, camplyValue: metric.value,
    absoluteDifference, percentageDifference,
    status: absoluteDifference === 0 ? 'reconciled' : absolutePercent <= tolerancePercent ? 'within_tolerance' : 'divergent',
    probableCause: absolutePercent <= tolerancePercent
      ? 'Diferença dentro da tolerância configurada.'
      : 'Verifique período, timezone, atribuição, nível e processamento tardio no Meta.',
  };
}
