import { describe, expect, it } from 'vitest';
import { calculatePerformanceScore } from './performanceScore';
import type { PerformanceEvaluation } from './types';

function evaluation(status: PerformanceEvaluation['status'], confidence = 100): PerformanceEvaluation {
  return {
    clientMetaAssetId: 'asset-1',
    campaignId: null,
    classifiedObjective: 'LEADS',
    destinationType: 'WEBSITE',
    attributionSetting: '7d_click',
    metricId: 'leads',
    targetKind: 'cost_per_result',
    actualValue: status === 'on_track' ? 20 : 40,
    targetValue: 25,
    differenceValue: status === 'on_track' ? -5 : 15,
    differencePercent: status === 'on_track' ? -20 : 60,
    status,
    reason: `status_${status}`,
    confidence,
  };
}

describe('calculatePerformanceScore', () => {
  it('does not invent a score without targets or pacing', () => {
    const result = calculatePerformanceScore({
      clientStatus: 'available',
      dataQuality: { status: 'complete', reason: null },
      evaluations: [],
      budgetPacing: null,
    });

    expect(result.value).toBeNull();
    expect(result.status).toBe('unavailable');
    expect(result.summary).toContain('Configure metas');
  });

  it('returns an excellent score when performance, pacing and data quality are healthy', () => {
    const result = calculatePerformanceScore({
      clientStatus: 'available',
      dataQuality: { status: 'complete', reason: null },
      evaluations: [evaluation('on_track')],
      budgetPacing: {
        actualSpend: 100,
        targetDailyBudget: 20,
        expectedSpendUntilNow: 100,
        actualDailyAverage: 20,
        projectedMonthlySpend: 600,
        differenceValue: 0,
        differencePercent: 0,
        status: 'on_track',
        currency: 'BRL',
        elapsedDays: 5,
        totalDays: 30,
      },
    });

    expect(result.value).toBe(100);
    expect(result.status).toBe('excellent');
    expect(result.confidence).toBe(100);
  });

  it('penalizes critical performance and produces an actionable signal', () => {
    const result = calculatePerformanceScore({
      clientStatus: 'available',
      dataQuality: { status: 'complete', reason: null },
      evaluations: [evaluation('critical', 90)],
      budgetPacing: null,
    });

    expect(result.value).not.toBeNull();
    expect(result.status).toBe('critical');
    expect(result.signals[0]).toMatchObject({
      kind: 'performance',
      severity: 'critical',
      metricId: 'leads',
    });
  });

  it('ignores unrelated metrics when a client profile defines the decision scope', () => {
    const unrelated = { ...evaluation('critical'), metricId: 'purchases' };
    const result = calculatePerformanceScore({
      clientStatus: 'available',
      dataQuality: { status: 'complete', reason: null },
      evaluations: [evaluation('on_track'), unrelated],
      budgetPacing: null,
      profile: { primaryConversionMetric: 'leads', secondaryMetrics: ['cost_per_lead'] },
    });

    expect(result.status).toBe('excellent');
    expect(result.signals.some((signal) => signal.metricId === 'purchases')).toBe(false);
  });

  it('surfaces synchronization and data-quality failures before optimization advice', () => {
    const result = calculatePerformanceScore({
      clientStatus: 'failed',
      dataQuality: { status: 'unavailable', reason: 'sync_failed' },
      evaluations: [evaluation('partial_data', 30)],
      budgetPacing: null,
    });

    expect(result.value).toBeNull();
    expect(result.signals.some((signal) => signal.kind === 'sync')).toBe(true);
    expect(result.signals.some((signal) => signal.kind === 'data_quality')).toBe(true);
  });

  it('creates a pacing decision when investment is materially below plan', () => {
    const result = calculatePerformanceScore({
      clientStatus: 'available',
      dataQuality: { status: 'complete', reason: null },
      evaluations: [evaluation('on_track')],
      budgetPacing: {
        actualSpend: 40,
        targetDailyBudget: 20,
        expectedSpendUntilNow: 100,
        actualDailyAverage: 8,
        projectedMonthlySpend: 240,
        differenceValue: -60,
        differencePercent: -60,
        status: 'critical',
        currency: 'BRL',
        elapsedDays: 5,
        totalDays: 30,
      },
    });

    expect(result.signals.some((signal) => signal.kind === 'pacing')).toBe(true);
    expect(result.signals.find((signal) => signal.kind === 'pacing')?.nextAction).toContain('subinvestimento');
  });
});
