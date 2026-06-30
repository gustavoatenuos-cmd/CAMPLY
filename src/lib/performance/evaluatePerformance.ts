import type { MetricDatum, PerformanceEvaluation, PerformanceStatus, PerformanceTarget } from './types';

const PARTIAL_COMPLETENESS = new Set(['partial_page', 'timeout', 'api_error', 'rate_limit_exhausted']);

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildEvaluation(
  target: PerformanceTarget,
  actualValue: number | null,
  status: PerformanceStatus,
  reason: string,
  confidence: number
): PerformanceEvaluation {
  const differenceValue = actualValue === null ? null : actualValue - target.targetValue;
  const differencePercent = actualValue === null ? null : (differenceValue! / target.targetValue) * 100;

  return {
    clientMetaAssetId: target.clientMetaAssetId,
    campaignId: target.campaignId ?? null,
    metricId: target.metricId,
    targetKind: target.targetKind,
    actualValue,
    targetValue: target.targetValue,
    differenceValue,
    differencePercent,
    status,
    reason,
    confidence,
  };
}

export function evaluatePerformanceTarget(
  target: PerformanceTarget,
  metric: MetricDatum | undefined,
  context: { spend?: number | null } = {}
): PerformanceEvaluation {
  if (!target || target.targetValue <= 0 || !Number.isFinite(target.targetValue)) {
    return buildEvaluation(target, null, 'unavailable', 'invalid_target', 0);
  }

  if (!metric || !metric.available) {
    return buildEvaluation(target, null, 'unavailable', 'metric_unavailable', 0);
  }

  const metricValue = finiteOrNull(metric.value);
  if (metricValue === null) {
    return buildEvaluation(target, null, 'unavailable', 'metric_missing', 0);
  }

  if (metric.completenessStatus && PARTIAL_COMPLETENESS.has(metric.completenessStatus)) {
    return buildEvaluation(target, metricValue, 'partial_data', metric.completenessStatus, 0.55);
  }

  if (target.targetKind === 'cost_per_result') {
    const spend = finiteOrNull(context.spend);
    if (spend === null) {
      return buildEvaluation(target, null, 'unavailable', 'spend_unavailable', 0);
    }

    if (metricValue <= 0) {
      if (spend < target.targetValue * 0.5) {
        return buildEvaluation(target, null, 'insufficient_data', 'zero_results_before_half_target_spend', 0.35);
      }
      if (spend <= target.targetValue) {
        return buildEvaluation(target, null, 'attention', 'zero_results_before_target_spend', 0.65);
      }
      return buildEvaluation(target, null, 'critical', 'zero_results_after_target_spend', 0.85);
    }

    const actualCost = spend / metricValue;
    if (actualCost <= target.targetValue) {
      return buildEvaluation(target, actualCost, 'on_track', 'cost_at_or_below_target', 0.9);
    }

    const overspendPercent = ((actualCost - target.targetValue) / target.targetValue) * 100;
    return buildEvaluation(
      target,
      actualCost,
      overspendPercent <= 10 ? 'attention' : 'critical',
      overspendPercent <= 10 ? 'cost_up_to_10_percent_above_target' : 'cost_more_than_10_percent_above_target',
      0.85
    );
  }

  if (target.targetKind === 'minimum_results') {
    if (metricValue >= target.targetValue) {
      return buildEvaluation(target, metricValue, 'on_track', 'minimum_results_reached', 0.9);
    }

    const shortfallPercent = ((target.targetValue - metricValue) / target.targetValue) * 100;
    return buildEvaluation(
      target,
      metricValue,
      shortfallPercent <= 10 ? 'attention' : 'critical',
      shortfallPercent <= 10 ? 'results_up_to_10_percent_below_target' : 'results_more_than_10_percent_below_target',
      0.8
    );
  }

  if (target.targetKind === 'daily_budget' || target.targetKind === 'monthly_budget') {
    return buildEvaluation(target, metricValue, 'unavailable', 'budget_targets_require_pacing_evaluation', 0);
  }

  return buildEvaluation(target, metricValue, 'unavailable', 'unsupported_target_kind', 0);
}
