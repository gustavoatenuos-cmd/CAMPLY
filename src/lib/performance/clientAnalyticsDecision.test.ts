import { describe, expect, it } from 'vitest';
import { buildClientAnalyticsDecision, deriveMonthPeriod, type ClientAnalyticsDecisionInput } from './clientAnalyticsDecision';
import { defaultAnalysisProfile } from '../analysis/clientAnalysisProfile';
import type { GlobalMetricGroup, MetricContract } from './globalPerformanceDashboard';
import type { PerformanceTarget, TargetKind } from './types';

const CURRENT_DATE = new Date('2026-07-10T12:00:00');
const PERIOD = { start: '2026-07-01', end: '2026-07-31' };

function metric(value: number | null, overrides: Partial<MetricContract> = {}): MetricContract {
  return {
    metricId: 'metric',
    value,
    available: value !== null,
    currency: 'BRL',
    dateStart: PERIOD.start,
    dateStop: PERIOD.end,
    timezone: 'America/Sao_Paulo',
    sourceLevel: 'campaign',
    attributionSetting: '7d_click_1d_view',
    classifiedObjective: null,
    destinationType: null,
    syncRunId: 'run-1',
    completenessStatus: 'complete',
    collectedAt: CURRENT_DATE.toISOString(),
    clientMetaAssetId: 'asset-1',
    accountId: 'account-1',
    accountName: 'Conta Teste',
    campaignId: 'campaign-1',
    adsetId: null,
    adId: null,
    unavailableReason: null,
    ...overrides,
  };
}

function group(metrics: Record<string, MetricContract>, overrides: Partial<GlobalMetricGroup> = {}): GlobalMetricGroup {
  return {
    clientMetaAssetId: 'asset-1',
    metaAssetId: 'asset-1',
    currency: 'BRL',
    campaignId: 'campaign-1',
    campaignName: 'Campanha Teste',
    classifiedObjective: null,
    destinationType: null,
    attributionSetting: '7d_click_1d_view',
    spend: metrics.spend?.value ?? null,
    completenessStatus: 'complete',
    metrics,
    ...overrides,
  };
}

function target(metricId: string, targetKind: TargetKind, targetValue: number, overrides: Partial<PerformanceTarget> = {}): PerformanceTarget {
  return { metricId, targetKind, targetValue, clientMetaAssetId: 'asset-1', ...overrides };
}

function baseInput(overrides: Partial<ClientAnalyticsDecisionInput> = {}): ClientAnalyticsDecisionInput {
  return {
    client: { id: 'client-1', name: 'Cliente Teste', company: '' },
    analysisProfile: defaultAnalysisProfile('client-1', {
      primaryConversionMetric: 'messaging_conversations_started_total',
      plannedBudget: null,
      budgetPeriod: 'monthly',
    }),
    globalPerformance: {
      clientStatus: 'available',
      dataQuality: { status: 'complete', reason: null },
      lastSuccessfulRun: { id: 'run-1', status: 'success', startedAt: CURRENT_DATE.toISOString(), finishedAt: CURRENT_DATE.toISOString(), terminationReason: 'completed' },
    },
    accountMetrics: {},
    metricGroups: [],
    resolvedTargets: [],
    period: PERIOD,
    currentDate: CURRENT_DATE,
    ...overrides,
  };
}

describe('buildClientAnalyticsDecision', () => {
  it('returns no_profile when the client has no analysis profile configured', () => {
    const decision = buildClientAnalyticsDecision(baseInput({ analysisProfile: null }));
    expect(decision.status).toBe('no_profile');
    expect(decision.mainProblem).toBe('no_profile');
    expect(decision.recommendation).toMatch(/perfil de análise não configurado/i);
  });

  it('returns no_data when the profile exists but there is no Meta data in the period', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      globalPerformance: {
        clientStatus: 'never_synced',
        dataQuality: { status: 'unavailable', reason: 'never_synced' },
        lastSuccessfulRun: null,
      },
      accountMetrics: {},
      metricGroups: [],
    }));
    expect(decision.status).toBe('no_data');
  });

  it('returns stale_data when the last successful sync is older than 24h', () => {
    const staleRun = new Date(CURRENT_DATE.getTime() - 30 * 3_600_000).toISOString();
    const decision = buildClientAnalyticsDecision(baseInput({
      globalPerformance: {
        clientStatus: 'available',
        dataQuality: { status: 'complete', reason: null },
        lastSuccessfulRun: { id: 'run-1', status: 'success', startedAt: staleRun, finishedAt: staleRun, terminationReason: 'completed' },
      },
      metricGroups: [group({ messaging_conversations_started_total: metric(20), spend: metric(300) })],
    }));
    expect(decision.status).toBe('stale_data');
  });

  it('returns healthy when the client is within its target and budget pacing is on track', () => {
    const healthyCurrentDate = new Date('2026-07-15T12:00:00');
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', {
        primaryConversionMetric: 'messaging_conversations_started_total',
        plannedBudget: 620,
        budgetPeriod: 'monthly',
      }),
      globalPerformance: {
        clientStatus: 'available',
        dataQuality: { status: 'complete', reason: null },
        lastSuccessfulRun: { id: 'run-1', status: 'success', startedAt: healthyCurrentDate.toISOString(), finishedAt: healthyCurrentDate.toISOString(), terminationReason: 'completed' },
      },
      metricGroups: [group({ messaging_conversations_started_total: metric(20), spend: metric(300) })],
      resolvedTargets: [target('messaging_conversations_started_total', 'cost_per_result', 20)],
      currentDate: healthyCurrentDate,
    }));
    expect(decision.status).toBe('healthy');
    expect(decision.mainProblem).toBeNull();
  });

  it('returns critical when CPA is above the configured target (sales family)', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', {
        primaryConversionMetric: 'purchases',
        plannedBudget: 2015,
        budgetPeriod: 'monthly',
      }),
      metricGroups: [group({ purchases: metric(10), spend: metric(650), purchase_value: metric(2600) })],
      resolvedTargets: [target('purchases', 'cost_per_result', 40)],
    }));
    expect(decision.status).toBe('critical');
    expect(decision.mainProblem).toBe('cost_above_target');
    expect(decision.actual.costPerResult).toBe(65);
    expect(decision.actual.objectiveScoped).toBe(true);
    // Exemplo do enunciado: alvo R$40, atual R$65 -> 62,5% acima da meta.
    expect(decision.gap.costDifferencePercent).toBeCloseTo(62.5, 5);
  });

  it('returns critical for CPL above target (leads family)', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', {
        primaryConversionMetric: 'leads',
        plannedBudget: 1240,
        budgetPeriod: 'monthly',
      }),
      metricGroups: [group({ leads: metric(8), spend: metric(400) })],
      resolvedTargets: [target('leads', 'cost_per_result', 25)],
    }));
    expect(decision.status).toBe('critical');
    expect(decision.mainProblem).toBe('cost_above_target');
    expect(decision.actual.costPerResult).toBe(50);
  });

  it('returns critical for cost-per-conversation above target (messaging family)', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      metricGroups: [group({ messaging_conversations_started_total: metric(10), spend: metric(410) })],
      resolvedTargets: [target('messaging_conversations_started_total', 'cost_per_result', 25)],
    }));
    expect(decision.status).toBe('critical');
    expect(decision.mainProblem).toBe('cost_above_target');
    expect(decision.actual.costPerResult).toBe(41);
  });

  it('returns attention when the monthly projection falls short of the configured minimum volume', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', {
        primaryConversionMetric: 'messaging_conversations_started_total',
        plannedBudget: 1000,
        budgetPeriod: 'monthly',
      }),
      metricGroups: [group({ messaging_conversations_started_total: metric(20), spend: metric(322.58) })],
      resolvedTargets: [target('messaging_conversations_started_total', 'minimum_results', 80)],
    }));
    expect(decision.status).toBe('attention');
    expect(decision.mainProblem).toBe('projection_below_target');
    expect(decision.projection.projectedResult).toBeCloseTo(62, 0);
    expect(decision.gap.volumeDeficit).toBeCloseTo(18, 0);
  });

  it('flags attention when spend is running above the expected pacing for the period', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', {
        primaryConversionMetric: 'purchases',
        plannedBudget: 1000,
        budgetPeriod: 'monthly',
      }),
      metricGroups: [group({ purchases: metric(5), spend: metric(500) })],
    }));
    expect(decision.status).toBe('attention');
    expect(decision.mainProblem).toBe('budget_pacing_off');
    expect(decision.budgetPacing.status).toBe('over_pacing');
  });

  it('flags critical when the budget is nearly consumed with zero conversions', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', {
        primaryConversionMetric: 'purchases',
        plannedBudget: 500,
        budgetPeriod: 'monthly',
      }),
      metricGroups: [group({ purchases: metric(0), spend: metric(480) })],
    }));
    expect(decision.status).toBe('critical');
    expect(decision.mainProblem).toBe('budget_consumed_without_conversion');
  });

  it('reports "no budget configured" when the profile has no planned budget', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', {
        primaryConversionMetric: 'messaging_conversations_started_total',
        plannedBudget: null,
      }),
      metricGroups: [group({ messaging_conversations_started_total: metric(20), spend: metric(300) })],
    }));
    expect(decision.budgetPacing.status).toBe('no_budget');
    expect(decision.budgetPacing.plannedMonthlyBudget).toBeNull();
  });

  it('resolves the sales family to purchases/CPA/ROAS', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', { primaryConversionMetric: 'purchases' }),
      metricGroups: [group({ purchases: metric(4), spend: metric(200), purchase_value: metric(800) })],
    }));
    expect(decision.primaryMetric.family).toBe('sales');
    expect(decision.primaryMetric.resultMetricId).toBe('purchases');
    expect(decision.primaryMetric.costMetricId).toBe('cost_per_purchase');
    expect(decision.actual.resultCount).toBe(4);
    expect(decision.actual.costPerResult).toBe(50);
    expect(decision.actual.roas).toBe(4);
  });

  it('resolves the messaging family to conversations/cost-per-conversation', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      metricGroups: [group({ messaging_conversations_started_total: metric(12), spend: metric(180) })],
    }));
    expect(decision.primaryMetric.family).toBe('messaging');
    expect(decision.primaryMetric.resultMetricId).toBe('messaging_conversations_started_total');
    expect(decision.primaryMetric.costMetricId).toBe('cost_per_messaging_conversation');
    expect(decision.actual.resultCount).toBe(12);
    expect(decision.actual.costPerResult).toBe(15);
  });

  it('resolves the leads family to leads/CPL', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', { primaryConversionMetric: 'leads' }),
      metricGroups: [group({ leads: metric(6), spend: metric(120) })],
    }));
    expect(decision.primaryMetric.family).toBe('leads');
    expect(decision.primaryMetric.resultMetricId).toBe('leads');
    expect(decision.primaryMetric.costMetricId).toBe('cost_per_lead');
    expect(decision.actual.resultCount).toBe(6);
    expect(decision.actual.costPerResult).toBe(20);
  });

  it('never divides by the account-level blunt total spend when the metric is objective-scoped', () => {
    // Duas campanhas: uma de vendas (a que importa) e uma de reconhecimento
    // (gasta muito, mas não gera 'purchases'). O CPA deve usar apenas o gasto
    // da campanha de vendas, não a soma das duas.
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', { primaryConversionMetric: 'purchases' }),
      accountMetrics: { spend: metric(1000), purchases: metric(5) },
      metricGroups: [
        group({ purchases: metric(5), spend: metric(200) }, { campaignId: 'campaign-sales', classifiedObjective: 'SALES' }),
        group({ spend: metric(800) }, { campaignId: 'campaign-awareness', classifiedObjective: 'AWARENESS' }),
      ],
    }));
    expect(decision.actual.objectiveScoped).toBe(true);
    expect(decision.actual.spend).toBe(200);
    expect(decision.actual.costPerResult).toBe(40);
  });

  it('does not blend spend/results across two different linked Meta ad accounts', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', { primaryConversionMetric: 'purchases' }),
      accountMetrics: { spend: metric(1000), purchases: metric(15) },
      metricGroups: [
        group({ purchases: metric(5), spend: metric(200) }, { clientMetaAssetId: 'asset-1', campaignId: 'campaign-a' }),
        group({ purchases: metric(10), spend: metric(800) }, { clientMetaAssetId: 'asset-2', campaignId: 'campaign-b' }),
      ],
      resolvedTargets: [target('purchases', 'cost_per_result', 40, { clientMetaAssetId: 'asset-1' })],
    }));
    // Duas contas distintas não podem ser somadas silenciosamente em um único CPA.
    expect(decision.actual.objectiveScoped).toBe(false);
  });

  it('matches a cost_per_result target to the account the objective-scoped totals came from', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', { primaryConversionMetric: 'purchases' }),
      metricGroups: [group({ purchases: metric(5), spend: metric(200) }, { clientMetaAssetId: 'asset-1' })],
      resolvedTargets: [
        target('purchases', 'cost_per_result', 100, { clientMetaAssetId: 'asset-other' }),
        target('purchases', 'cost_per_result', 40, { clientMetaAssetId: 'asset-1' }),
      ],
    }));
    expect(decision.target.costCeiling).toBe(40);
  });

  it('does not fall back to the account-wide ROAS when the objective-scoped groups have no purchase_value', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', { primaryConversionMetric: 'purchases' }),
      accountMetrics: { purchase_roas: metric(9) },
      metricGroups: [group({ purchases: metric(5), spend: metric(200) })],
    }));
    expect(decision.actual.objectiveScoped).toBe(true);
    expect(decision.actual.roas).toBeNull();
  });

  it('keeps resultPacing consistent with the attention status when the projection falls short of the minimum volume', () => {
    const decision = buildClientAnalyticsDecision(baseInput({
      analysisProfile: defaultAnalysisProfile('client-1', {
        primaryConversionMetric: 'messaging_conversations_started_total',
        plannedBudget: 1000,
        budgetPeriod: 'monthly',
      }),
      // 10 dias decorridos, 22 conversas -> projeção de ~68 no mês (31 dias), 90% da meta de 80.
      metricGroups: [group({ messaging_conversations_started_total: metric(22), spend: metric(322.58) })],
      resolvedTargets: [target('messaging_conversations_started_total', 'minimum_results', 80)],
    }));
    expect(decision.status).toBe('attention');
    expect(decision.mainProblem).toBe('projection_below_target');
    expect(decision.resultPacing.status).toBe('behind');
  });
});

describe('deriveMonthPeriod', () => {
  it('returns the first and last day of the reference date month', () => {
    expect(deriveMonthPeriod(new Date(2026, 6, 15))).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(deriveMonthPeriod(new Date(2026, 1, 10))).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});
