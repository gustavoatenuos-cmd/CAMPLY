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
    });
  });

  it('marks costs up to 10 percent above target as attention', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'leads', targetKind: 'cost_per_result', targetValue: 20 },
      { value: 10, available: true, completenessStatus: 'complete' },
      { spend: 220 }
    ).status).toBe('attention');
  });

  it('marks costs more than 10 percent above target as critical', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'leads', targetKind: 'cost_per_result', targetValue: 20 },
      { value: 10, available: true, completenessStatus: 'complete' },
      { spend: 230 }
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
      ],
      evaluations: [],
      budgetPacing: null,
      dataQuality: { status: 'complete', reason: null },
      lastSuccessfulRun: null,
      lastAttempt: null,
      hasNewerPartial: false,
      hasNewerFailure: false,
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
  });
});
