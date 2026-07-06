import { describe, expect, it } from 'vitest';
import { calculateBudgetPacing, combineBudgetPacingByCurrency } from './budgetPacing';
import { evaluatePerformanceTarget } from './evaluatePerformance';
import {
  enrichGlobalPerformanceDashboard,
  type GlobalClientPerformance,
} from './globalPerformanceDashboard';
import { resolveTarget } from './resolveTarget';
import { unavailableTraceableMetric } from './traceableMetrics';
import type { PerformanceTarget } from './types';

const traceMetric = (metricId: string, value: number) => ({
  ...unavailableTraceableMetric(metricId),
  value,
  available: true,
  completenessStatus: 'complete' as const,
  currency: 'BRL',
  dateStart: '2026-06-01',
  dateStop: '2026-06-07',
  timezone: 'America/Sao_Paulo',
  syncRunId: 'run_1',
  collectedAt: '2026-06-07T12:00:00Z',
  clientMetaAssetId: 'link_1',
  accountId: 'act_1',
  accountName: 'Conta 1',
});

describe('evaluatePerformanceTarget', () => {
  it('calculates cost per result from spend and result volume', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'leads', targetKind: 'cost_per_result', targetValue: 20 },
      { value: 10, available: true, completenessStatus: 'complete' },
      { spend: 180 }
    )).toMatchObject({
      status: 'on_track',
      actualValue: 18,
      differenceValue: -2,
      differencePercent: -10,
      confidence: 90,
    });
  });

  it('marks costs up to 10 percent above target as attention', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'leads', targetKind: 'cost_per_result', targetValue: 20 },
      { value: 10, available: true, completenessStatus: 'complete' },
      { spend: 220 }
    ).status).toBe('attention');
  });

  it('marks costs above the default critical tolerance as critical', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'leads', targetKind: 'cost_per_result', targetValue: 20 },
      { value: 10, available: true, completenessStatus: 'complete' },
      { spend: 260 }
    ).status).toBe('critical');
  });

  it('uses spend evidence before judging zero results', () => {
    const target = { metricId: 'purchases', targetKind: 'cost_per_result' as const, targetValue: 100 };
    const metric = { value: 0, available: true, completenessStatus: 'zero_delivery' };

    expect(evaluatePerformanceTarget(target, metric, { spend: 20 }).status).toBe('insufficient_data');
    expect(evaluatePerformanceTarget(target, metric, { spend: 80 }).status).toBe('attention');
    expect(evaluatePerformanceTarget(target, metric, { spend: 120 }).status).toBe('critical');
  });

  it('does not turn unavailable metrics into zero', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'leads', targetKind: 'minimum_results', targetValue: 10 },
      { value: null, available: false, completenessStatus: null }
    )).toMatchObject({
      status: 'unavailable',
      actualValue: null,
    });
  });

  it('preserves partial data as partial_data instead of critical', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'leads', targetKind: 'minimum_results', targetValue: 10 },
      { value: 3, available: true, completenessStatus: 'partial_page' }
    ).status).toBe('partial_data');
  });

  it('evaluates maximum metric targets with configurable tolerances', () => {
    const target = {
      metricId: 'cpm',
      targetKind: 'maximum_metric' as const,
      targetValue: 25,
      warningTolerancePercent: 20,
      criticalTolerancePercent: 40,
    };

    expect(evaluatePerformanceTarget(target, { value: 24, available: true }).status).toBe('on_track');
    expect(evaluatePerformanceTarget(target, { value: 30, available: true }).status).toBe('attention');
    expect(evaluatePerformanceTarget(target, { value: 36, available: true }).status).toBe('critical');
  });

  it('evaluates minimum metric targets with configurable tolerances', () => {
    const target = {
      metricId: 'link_ctr',
      targetKind: 'minimum_metric' as const,
      targetValue: 1.2,
      warningTolerancePercent: 25,
      criticalTolerancePercent: 35,
    };

    expect(evaluatePerformanceTarget(target, { value: 1.3, available: true }).status).toBe('on_track');
    expect(evaluatePerformanceTarget(target, { value: 1, available: true }).status).toBe('attention');
    expect(evaluatePerformanceTarget(target, { value: 0.7, available: true }).status).toBe('critical');
  });

  it('does not create an early false alert before enough of the evaluation period elapsed', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'leads', targetKind: 'minimum_results', targetValue: 40 },
      { value: 5, available: true, completenessStatus: 'complete' },
      { periodProgressPercent: 10 }
    )).toMatchObject({ status: 'insufficient_data', reason: 'evaluation_period_too_early', confidence: 40 });
  });

  it('evaluates target ranges without collapsing the range into one fake average', () => {
    const target = {
      metricId: 'frequency',
      targetKind: 'target_range' as const,
      targetValue: 3,
      targetMin: 1.5,
      targetMax: 3,
      warningTolerancePercent: 20,
      criticalTolerancePercent: 40,
    };

    expect(evaluatePerformanceTarget(target, { value: 2.2, available: true })).toMatchObject({
      status: 'on_track',
      targetMin: 1.5,
      targetMax: 3,
    });
    expect(evaluatePerformanceTarget(target, { value: 3.4, available: true }).status).toBe('attention');
    expect(evaluatePerformanceTarget(target, { value: 4.5, available: true }).status).toBe('critical');
  });
});

describe('resolveTarget', () => {
  const targets: PerformanceTarget[] = [
    {
      id: 'account-target',
      metricId: 'messaging_conversations_started_total',
      targetKind: 'cost_per_result',
      targetValue: 25,
      effectiveFrom: '2026-06-01T00:00:00Z',
    },
    {
      id: 'campaign-target',
      campaignId: 'campaign_1',
      metricId: 'messaging_conversations_started_total',
      targetKind: 'cost_per_result',
      targetValue: 18,
      effectiveFrom: '2026-06-10T00:00:00Z',
    },
  ];

  it('uses campaign override before account-level target', () => {
    expect(resolveTarget(targets, {
      metricId: 'messaging_conversations_started_total',
      targetKind: 'cost_per_result',
      campaignId: 'campaign_1',
      at: '2026-06-15T00:00:00Z',
    })?.id).toBe('campaign-target');
  });

  it('falls back to account-level target when no campaign override exists', () => {
    expect(resolveTarget(targets, {
      metricId: 'messaging_conversations_started_total',
      targetKind: 'cost_per_result',
      campaignId: 'campaign_2',
      at: '2026-06-15T00:00:00Z',
    })?.id).toBe('account-target');
  });
});

describe('performance score availability', () => {
  it('does not mark clients as healthy without a reliable decision basis', () => {
    const base: GlobalClientPerformance = {
      clientId: 'client_without_data',
      clientName: 'Cliente sem dados',
      clientStatus: 'never_synced',
      accounts: [],
      metrics: {},
      metricGroups: [],
      resolvedTargets: [],
      evaluations: [],
      budgetPacing: null,
      score: {
        value: 85,
        status: 'healthy',
        confidence: 90,
        coveragePercent: 100,
        summary: 'Valor legado que não deve sobreviver ao enriquecimento.',
        signals: [],
      },
      dataQuality: { status: 'unavailable', reason: 'sync_not_started' },
      lastSuccessfulRun: null,
      lastAttempt: null,
      hasNewerPartial: false,
      hasNewerFailure: false,
      analysisProfile: null,
    };

    const cases: Array<Pick<GlobalClientPerformance, 'clientStatus' | 'dataQuality' | 'resolvedTargets' | 'analysisProfile'>> = [
      {
        clientStatus: 'not_connected',
        dataQuality: { status: 'unavailable', reason: 'meta_account_not_linked' },
        resolvedTargets: [],
        analysisProfile: null,
      },
      {
        clientStatus: 'never_synced',
        dataQuality: { status: 'unavailable', reason: 'sync_not_started' },
        resolvedTargets: [],
        analysisProfile: null,
      },
      {
        clientStatus: 'no_delivery',
        dataQuality: { status: 'unavailable', reason: 'no_delivery' },
        resolvedTargets: [],
        analysisProfile: null,
      },
      {
        clientStatus: 'available',
        dataQuality: { status: 'complete', reason: null },
        resolvedTargets: [],
        analysisProfile: null,
      },
    ];

    for (const item of cases) {
      const [result] = enrichGlobalPerformanceDashboard([{ ...base, ...item }], 'this_month');
      expect(result.score).toMatchObject({
        value: null,
        status: 'unavailable',
      });
      expect(result.score.summary).not.toContain('saudável');
    }
  });
});

describe('calculateBudgetPacing', () => {
  it('calculates expected spend, projection and status in the account timezone', () => {
    const pacing = calculateBudgetPacing({
      actualSpend: 350,
      targetDailyBudget: 100,
      periodStart: '2026-06-01T03:00:00Z',
      periodEnd: '2026-06-30T03:00:00Z',
      currentDate: '2026-06-04T15:00:00Z',
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
    });

    expect(pacing.elapsedDays).toBe(4);
    expect(pacing.expectedSpendUntilNow).toBe(400);
    expect(pacing.projectedMonthlySpend).toBe(2625);
    expect(pacing.status).toBe('attention');
  });

  it('does not combine pacing across different currencies', () => {
    const brl = calculateBudgetPacing({
      actualSpend: 100,
      targetDailyBudget: 100,
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      currentDate: '2026-06-01',
      timezone: 'UTC',
      currency: 'BRL',
    });
    const usd = { ...brl, currency: 'USD' };

    expect(combineBudgetPacingByCurrency([brl, usd])).toBeNull();
  });

  it('calculates weekly budget pacing from the full calendar week', () => {
    const pacing = calculateBudgetPacing({
      actualSpend: 280,
      targetMonthlyBudget: 700,
      periodStart: '2026-06-29',
      periodEnd: '2026-07-05',
      currentDate: '2026-07-02T15:00:00Z',
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
    });

    expect(pacing.totalDays).toBe(7);
    expect(pacing.elapsedDays).toBe(4);
    expect(pacing.expectedSpendUntilNow).toBe(400);
    expect(pacing.projectedMonthlySpend).toBe(490);
    expect(pacing.status).toBe('critical');
  });
});

describe('enrichGlobalPerformanceDashboard', () => {
  it('connects account targets to scoped metrics and budget pacing', () => {
    const raw: GlobalClientPerformance = {
      clientId: 'client_1',
      clientName: 'Cliente 1',
      clientStatus: 'available',
      accounts: [
        {
          clientMetaAssetId: 'link_1',
          metaAssetId: 'asset_1',
          integrationId: 'integration_1',
          adAccountId: 'act_1',
          accountName: 'Conta 1',
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          dateStart: '2026-06-01',
          dateStop: '2026-06-07',
          metrics: {
            spend: traceMetric('spend', 180),
            leads: traceMetric('leads', 10),
          },
          budgetPacing: null,
          dataQuality: { status: 'complete', reason: null },
          lastSuccessfulRun: null,
          lastAttempt: null,
        },
      ],
      metrics: {
        spend: traceMetric('spend', 180),
        leads: traceMetric('leads', 10),
      },
      metricGroups: [
        {
          clientMetaAssetId: 'link_1',
          metaAssetId: 'asset_1',
          currency: 'BRL',
          campaignId: 'campaign_1',
          campaignName: 'Campanha 1',
          classifiedObjective: 'LEADS',
          destinationType: null,
          attributionSetting: '7d_click',
          spend: 180,
          completenessStatus: 'complete',
          metrics: {
            spend: traceMetric('spend', 180),
            leads: traceMetric('leads', 10),
          },
        },
      ],
      resolvedTargets: [
        {
          clientMetaAssetId: 'link_1',
          metricId: 'leads',
          targetKind: 'cost_per_result',
          targetValue: 20,
        },
        {
          clientMetaAssetId: 'link_1',
          metricId: 'spend',
          targetKind: 'daily_budget',
          targetValue: 30,
        },
        {
          clientMetaAssetId: 'link_1',
          metricId: 'cpm',
          targetKind: 'maximum_metric',
          targetValue: 25,
          evaluationPeriod: 'today',
        },
      ],
      evaluations: [],
      budgetPacing: null,
      score: {
        value: null,
        status: 'unavailable',
        confidence: 0,
        coveragePercent: 0,
        summary: 'Pontuação ainda não calculada.',
        signals: [],
      },
      dataQuality: { status: 'complete', reason: null },
      lastSuccessfulRun: null,
      lastAttempt: null,
      hasNewerPartial: false,
      hasNewerFailure: false,
      analysisProfile: {
        clientId: 'client_1',
        vertical: 'Saúde',
        subsegment: 'Odontologia',
        customVertical: null,
        customSubsegment: null,
        businessModel: 'geração de leads',
        primaryConversionMetric: 'leads',
        secondaryMetrics: ['cost_per_lead'],
        primaryChannel: 'Site',
        budgetPeriod: 'weekly',
        plannedBudget: 210,
        minimumEvaluationSpend: 100,
        minimumImpressions: 0,
        minimumResults: 5,
        attributionDelayHours: 24,
        analysisEnabled: true,
      },
    };

    const [result] = enrichGlobalPerformanceDashboard(
      [raw],
      'last_7d',
      new Date('2026-06-07T15:00:00Z')
    );

    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0]).toMatchObject({
      metricId: 'leads',
      actualValue: 18,
      status: 'on_track',
      attributionSetting: '7d_click',
    });
    expect(result.accounts[0].budgetPacing).toMatchObject({
      targetDailyBudget: 30,
      actualSpend: 180,
      currency: 'BRL',
    });
    expect(result.budgetPacing?.actualSpend).toBe(180);
    expect(result.score.value).not.toBeNull();

    const [insufficient] = enrichGlobalPerformanceDashboard(
      [{
        ...raw,
        analysisProfile: {
          ...raw.analysisProfile!,
          minimumEvaluationSpend: 200,
        },
      }],
      'last_7d',
      new Date('2026-06-07T15:00:00Z')
    );
    expect(insufficient.evaluations[0]).toMatchObject({
      status: 'insufficient_data',
      reason: 'minimum_evaluation_spend_not_reached',
    });
    expect(insufficient.score.value).toBeNull();
    expect(insufficient.score.summary).toContain('dados conclusivos suficientes');

    const [profileWeeklyPacing] = enrichGlobalPerformanceDashboard(
      [{
        ...raw,
        accounts: raw.accounts.map((account) => ({
          ...account,
          metrics: { ...account.metrics, spend: traceMetric('spend', 60) },
        })),
        metrics: { ...raw.metrics, spend: traceMetric('spend', 60) },
        resolvedTargets: raw.resolvedTargets.filter((target) => target.targetKind !== 'daily_budget'),
        analysisProfile: {
          ...raw.analysisProfile!,
          plannedBudget: 210,
          minimumEvaluationSpend: 0,
        },
      }],
      'this_week',
      new Date('2026-07-02T15:00:00Z')
    );
    expect(profileWeeklyPacing.accounts[0].budgetPacing).toMatchObject({
      actualSpend: 60,
      targetDailyBudget: 30,
      expectedSpendUntilNow: 120,
      projectedMonthlySpend: 105,
      totalDays: 7,
    });

    const [profileMonthlyAtTimezoneBoundary] = enrichGlobalPerformanceDashboard(
      [{
        ...raw,
        accounts: raw.accounts.map((account) => ({
          ...account,
          metrics: { ...account.metrics, spend: traceMetric('spend', 3000) },
        })),
        metrics: { ...raw.metrics, spend: traceMetric('spend', 3000) },
        resolvedTargets: [],
        analysisProfile: {
          ...raw.analysisProfile!,
          budgetPeriod: 'monthly',
          plannedBudget: 3000,
          minimumEvaluationSpend: 0,
        },
      }],
      'this_month',
      new Date('2026-07-01T01:30:00Z')
    );
    expect(profileMonthlyAtTimezoneBoundary.accounts[0].budgetPacing).toMatchObject({
      expectedSpendUntilNow: 3000,
      totalDays: 30,
      elapsedDays: 30,
    });
  });
});
