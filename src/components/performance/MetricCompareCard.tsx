/**
 * performance/MetricCompareCard.tsx
 * Shows a metric value with comparison to a previous period and trend arrow.
 */
import React from 'react';
import { MetricDefinition, formatMetricValue, calcTrend } from '../../lib/meta/metricsSelector';
import { TrendArrow } from '../ui/TrendArrow';

interface MetricCompareCardProps {
  metric: MetricDefinition;
  currentValue: number | undefined | null;
  previousValue?: number | undefined | null;
  benchmarkValue?: number | undefined | null;
  isLoading?: boolean;
  compact?: boolean;
}

export function MetricCompareCard({
  metric,
  currentValue,
  previousValue,
  benchmarkValue,
  isLoading = false,
  compact = false,
}: MetricCompareCardProps) {
  const trend = calcTrend(
    currentValue ?? undefined,
    previousValue ?? undefined,
    metric.higherIsBetter
  );

  const deltaPercent = (currentValue !== undefined && currentValue !== null &&
    previousValue !== undefined && previousValue !== null && previousValue !== 0)
    ? ((currentValue - previousValue) / previousValue) * 100
    : undefined;

  // Benchmark comparison
  const aboveBenchmark = benchmarkValue !== undefined && benchmarkValue !== null &&
    currentValue !== undefined && currentValue !== null
    ? metric.higherIsBetter
      ? currentValue >= benchmarkValue
      : currentValue <= benchmarkValue
    : null;

  if (isLoading) {
    return (
      <div className={`animate-pulse rounded-xl bg-white/5 ${compact ? 'p-3' : 'p-4'}`}>
        <div className="mb-2 h-3 w-16 rounded bg-white/10" />
        <div className="h-6 w-24 rounded bg-white/10" />
      </div>
    );
  }

  return (
    <div
      className={`group rounded-xl border border-white/8 bg-white/5 transition-colors hover:bg-white/8 ${compact ? 'p-3' : 'p-4'}`}
      title={metric.description}
    >
      {/* Label */}
      <p className="mb-1.5 text-xs font-medium text-zinc-400">{metric.label}</p>

      {/* Value + Trend */}
      <div className="flex items-end gap-2">
        <span className={`font-bold tabular-nums text-white ${compact ? 'text-lg' : 'text-2xl'}`}>
          {formatMetricValue(metric.key, currentValue)}
        </span>
        {trend !== 'neutral' && (
          <TrendArrow trend={trend} deltaPercent={deltaPercent} showDelta size="sm" />
        )}
      </div>

      {/* Previous period */}
      {previousValue !== undefined && previousValue !== null && (
        <p className="mt-1 text-xs text-zinc-500">
          Anterior: {formatMetricValue(metric.key, previousValue)}
        </p>
      )}

      {/* Benchmark indicator */}
      {aboveBenchmark !== null && (
        <div
          className={`mt-2 flex items-center gap-1 text-xs ${
            aboveBenchmark ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          <span>{aboveBenchmark ? '✓' : '✗'}</span>
          <span>{aboveBenchmark ? 'Dentro do benchmark' : 'Abaixo do benchmark'}</span>
        </div>
      )}
    </div>
  );
}
