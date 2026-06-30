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

  const actualValue = finiteOrNull(metric.value);
  if (actualValue === null) {
    return buildEvaluation(target, null, 'unavailable', 'metric_missing', 0);
  }

  if (metric.completenessStatus && PARTIAL_COMPLETENESS.has(metric.completenessStatus)) {
    return buildEvaluation(target, actualValue, 'partial_data', metric.completenessStatus, 0.55);
  }

  if (target.targetKind === 'cost_per_result') {
    if (actualValue <= target.targetValue) {
      return buildEvaluation(target, actualValue, 'on_track', 'cost_at_or_below_target', 0.9);
    }

    const overspendPercent = ((actualValue - target.targetValue) / target.targetValue) * 100;
    return buildEvaluation(
      target,
      actualValue,
      overspendPercent <= 10 ? 'attention' : 'critical',
      overspendPercent <= 10 ? 'cost_up_to_10_percent_above_target' : 'cost_more_than_10_percent_above_target',
      0.85
    );
  }

  if (target.targetKind === 'minimum_results') {
    if (actualValue >= target.targetValue) {
      return buildEvaluation(target, actualValue, 'on_track', 'minimum_results_reached', 0.9);
    }

    const spend = finiteOrNull(context.spend) ?? 0;
    if (actualValue === 0) {
      if (spend < target.targetValue * 0.5) {
        return buildEvaluation(target, actualValue, 'insufficient_data', 'zero_results_with_low_spend', 0.35);
      }
      if (spend <= target.targetValue) {
        return buildEvaluation(target, actualValue, 'attention', 'zero_results_with_moderate_spend', 0.65);
      }
      return buildEvaluation(target, actualValue, 'critical', 'zero_results_above_target_cost_limit', 0.8);
    }

    const shortfallPercent = ((target.targetValue - actualValue) / target.targetValue) * 100;
    return buildEvaluation(
      target,
      actualValue,
      shortfallPercent <= 10 ? 'attention' : 'critical',
      shortfallPercent <= 10 ? 'results_up_to_10_percent_below_target' : 'results_more_than_10_percent_below_target',
      0.8
    );
  }

  if (target.targetKind === 'daily_budget' || target.targetKind === 'monthly_budget') {
    return buildEvaluation(target, actualValue, 'unavailable', 'budget_targets_require_pacing_evaluation', 0);
  }

  return buildEvaluation(target, actualValue, 'unavailable', 'unsupported_target_kind', 0);
}
