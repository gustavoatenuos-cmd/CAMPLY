import { describe, expect, it } from 'vitest';
import { buildClientMetricComparisons } from './clientMetricComparison';
import type { GlobalClientPerformance } from './globalPerformanceDashboard';

function performanceFixture(): GlobalClientPerformance {
  return {
    clientId: 'client-1',
    clientName: 'Cliente 1',
    clientStatus: 'available',
    accounts: [{
      clientMetaAssetId: 'asset-link-1',
      metaAssetId: 'asset-1',
      integrationId: 'integration-1',
      adAccountId: 'act_1',
      accountName: 'Conta oficial',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      dateStart: '2026-07-01',
      dateStop: '2026-07-30',
      metrics: {},
      budgetPacing: null,
      dataQuality: { status: 'complete', reason: null },
      lastSuccessfulRun: null,
      lastAttempt: null,
    }],
    metrics: {
      spend: { value: 200, available: true },
      messaging_conversations_started_total: { value: 10, available: true },
      cpm: { value: 30, available: true },
    } as unknown as GlobalClientPerformance['metrics'],
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [{
      clientMetaAssetId: 'asset-link-1',
      campaignId: null,
      metricId: 'messaging_conversations_started_total',
      targetKind: 'cost_per_result',
      actualValue: 20,
      targetValue: 15,
      differenceValue: 5,
      differencePercent: 33.33,
      status: 'critical',
      reason: 'cost_above_critical_tolerance',
      confidence: 90,
    }, {
      clientMetaAssetId: 'asset-link-1',
      campaignId: null,
      metricId: 'cpm',
      targetKind: 'maximum_metric',
      actualValue: 30,
      targetValue: 25,
      differenceValue: 5,
      differencePercent: 20,
      status: 'attention',
      reason: 'metric_above_warning_tolerance',
      confidence: 85,
    }],
    budgetPacing: {
      actualSpend: 200,
      targetDailyBudget: 5,
      expectedSpendUntilNow: 150,
      actualDailyAverage: 6.67,
      projectedMonthlySpend: 200,
      differenceValue: 50,
      differencePercent: 33.33,
      status: 'critical',
      currency: 'BRL',
      elapsedDays: 30,
      totalDays: 30,
    },
    score: { value: 40, status: 'critical', confidence: 85, coveragePercent: 100, summary: '', signals: [] },
    dataQuality: { status: 'complete', reason: null },
    lastSuccessfulRun: null,
    lastAttempt: null,
    hasNewerPartial: false,
    hasNewerFailure: false,
    analysisProfile: {
      clientId: 'client-1',
      vertical: 'servicos_locais',
      subsegment: 'outros',
      customVertical: null,
      customSubsegment: null,
      operationType: null,
      salesModels: [],
      secondaryChannel: null,
      secondaryConversionMetric: null,
      businessModel: '',
      primaryConversionMetric: 'messaging_conversations_started_total',
      secondaryMetrics: ['cpm'],
      primaryChannel: 'whatsapp',
      budgetPeriod: 'monthly',
      plannedBudget: 150,
      minimumEvaluationSpend: 0,
      minimumImpressions: 0,
      minimumResults: 0,
      attributionDelayHours: 0,
      analysisEnabled: true,
    },
  };
}

describe('buildClientMetricComparisons', () => {
  it('combines monitored profile metrics, official target evaluations and budget pacing', () => {
    const comparisons = buildClientMetricComparisons(performanceFixture());

    expect(comparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricId: 'messaging_conversations_started_total',
        actualValue: 10,
        targetKind: 'none',
        status: 'observed',
      }),
      expect.objectContaining({
        metricId: 'cost_per_messaging_conversation',
        actualValue: 20,
        targetValue: 15,
        status: 'critical',
      }),
      expect.objectContaining({ metricId: 'cpm', actualValue: 30, targetValue: 25, status: 'attention' }),
      expect.objectContaining({ metricId: 'spend', actualValue: 200, targetValue: 150, source: 'budget' }),
    ]));
    expect(comparisons.filter((item) => item.metricId === 'cpm')).toHaveLength(1);
  });

  it('keeps a configured metric visible without inventing zero when Meta did not return it', () => {
    const client = performanceFixture();
    client.analysisProfile = { ...client.analysisProfile!, secondaryMetrics: ['purchase_roas'] };
    client.evaluations = [];
    client.budgetPacing = null;

    const comparison = buildClientMetricComparisons(client).find((item) => item.metricId === 'purchase_roas');
    expect(comparison).toMatchObject({ actualValue: null, targetValue: null, status: 'unavailable' });
  });
});
