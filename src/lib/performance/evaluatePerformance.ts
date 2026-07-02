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
  const referenceValue = target.targetKind === 'target_range'
    ? actualValue !== null && target.targetMin != null && actualValue < target.targetMin
      ? target.targetMin
      : target.targetMax ?? target.targetValue
    : target.targetValue;
  const differenceValue = actualValue === null ? null : actualValue - referenceValue;
  const differencePercent = actualValue === null || referenceValue <= 0 ? null : (differenceValue! / referenceValue) * 100;

  return {
    clientMetaAssetId: target.clientMetaAssetId,
    campaignId: target.campaignId ?? null,
    metricId: target.metricId,
    targetKind: target.targetKind,
    actualValue,
    targetValue: target.targetValue,
    targetMin: target.targetMin ?? null,
    targetMax: target.targetMax ?? null,
    priorityWeight: target.priorityWeight ?? null,
    differenceValue,
    differencePercent,
    status,
    reason,
    confidence,
  };
}

function warningTolerance(target: PerformanceTarget): number {
  return typeof target.warningTolerancePercent === 'number' && Number.isFinite(target.warningTolerancePercent)
    ? target.warningTolerancePercent
    : 10;
}

function criticalTolerance(target: PerformanceTarget): number {
  return typeof target.criticalTolerancePercent === 'number' && Number.isFinite(target.criticalTolerancePercent)
    ? target.criticalTolerancePercent
    : 25;
}

function thresholdStatus(overTargetPercent: number, target: PerformanceTarget): PerformanceStatus {
  if (overTargetPercent <= 0) return 'on_track';
  if (overTargetPercent <= warningTolerance(target)) return 'attention';
  return overTargetPercent <= criticalTolerance(target) ? 'attention' : 'critical';
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
    const status = thresholdStatus(overspendPercent, target);
    return buildEvaluation(target, actualCost, status, status === 'attention' ? 'cost_above_warning_tolerance' : 'cost_above_critical_tolerance', 0.85);
  }

  if (target.targetKind === 'minimum_results' || target.targetKind === 'minimum_metric') {
    if (metricValue >= target.targetValue) {
      return buildEvaluation(target, metricValue, 'on_track', 'minimum_reached', 0.9);
    }

    const shortfallPercent = ((target.targetValue - metricValue) / target.targetValue) * 100;
    const status = shortfallPercent <= warningTolerance(target) ? 'attention' : shortfallPercent <= criticalTolerance(target) ? 'attention' : 'critical';
    return buildEvaluation(
      target,
      metricValue,
      status,
      status === 'attention' ? 'metric_below_warning_tolerance' : 'metric_below_critical_tolerance',
      0.8
    );
  }

  if (target.targetKind === 'maximum_metric') {
    if (metricValue <= target.targetValue) {
      return buildEvaluation(target, metricValue, 'on_track', 'metric_at_or_below_maximum', 0.9);
    }
    const excessPercent = ((metricValue - target.targetValue) / target.targetValue) * 100;
    const status = thresholdStatus(excessPercent, target);
    return buildEvaluation(target, metricValue, status, status === 'attention' ? 'metric_above_warning_tolerance' : 'metric_above_critical_tolerance', 0.85);
  }

  if (target.targetKind === 'target_range') {
    const min = finiteOrNull(target.targetMin);
    const max = finiteOrNull(target.targetMax);
    if (min === null || max === null || min <= 0 || max <= min) {
      return buildEvaluation(target, metricValue, 'unavailable', 'invalid_target_range', 0);
    }
    if (metricValue >= min && metricValue <= max) {
      return buildEvaluation(target, metricValue, 'on_track', 'metric_inside_target_range', 0.9);
    }
    const reference = metricValue < min ? min : max;
    const deviationPercent = Math.abs(((metricValue - reference) / reference) * 100);
    const status = deviationPercent <= warningTolerance(target) ? 'attention' : deviationPercent <= criticalTolerance(target) ? 'attention' : 'critical';
    return buildEvaluation(target, metricValue, status, status === 'attention' ? 'range_deviation_warning_tolerance' : 'range_deviation_critical_tolerance', 0.8);
  }

  if (target.targetKind === 'daily_budget' || target.targetKind === 'weekly_budget' || target.targetKind === 'monthly_budget') {
    return buildEvaluation(target, metricValue, 'unavailable', 'budget_targets_require_pacing_evaluation', 0);
  }

  return buildEvaluation(target, metricValue, 'unavailable', 'unsupported_target_kind', 0);
}
