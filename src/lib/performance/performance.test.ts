import { describe, expect, it } from 'vitest';
import { calculateBudgetPacing, combineBudgetPacingByCurrency } from './budgetPacing';
import { evaluatePerformanceTarget } from './evaluatePerformance';
import { resolveTarget } from './resolveTarget';
import type { PerformanceTarget } from './types';

describe('evaluatePerformanceTarget', () => {
  it('treats lower cost than target as on track', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'cost_per_messaging_conversation', targetKind: 'cost_per_result', targetValue: 20 },
      { value: 18, available: true, completenessStatus: 'complete' }
    )).toMatchObject({
      status: 'on_track',
      differenceValue: -2,
      differencePercent: -10,
    });
  });

  it('marks costs up to 10 percent above target as attention', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'cost_per_messaging_conversation', targetKind: 'cost_per_result', targetValue: 20 },
      { value: 22, available: true, completenessStatus: 'complete' }
    ).status).toBe('attention');
  });

  it('marks costs more than 10 percent above target as critical', () => {
    expect(evaluatePerformanceTarget(
      { metricId: 'cost_per_messaging_conversation', targetKind: 'cost_per_result', targetValue: 20 },
      { value: 23, available: true, completenessStatus: 'complete' }
    ).status).toBe('critical');
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
      metricId: 'cost_per_messaging_conversation',
      targetKind: 'cost_per_result',
      targetValue: 25,
      effectiveFrom: '2026-06-01T00:00:00Z',
    },
    {
      id: 'campaign-target',
      campaignId: 'campaign_1',
      metricId: 'cost_per_messaging_conversation',
      targetKind: 'cost_per_result',
      targetValue: 18,
      effectiveFrom: '2026-06-10T00:00:00Z',
    },
  ];

  it('uses campaign override before account-level target', () => {
    expect(resolveTarget(targets, {
      metricId: 'cost_per_messaging_conversation',
      targetKind: 'cost_per_result',
      campaignId: 'campaign_1',
      at: '2026-06-15T00:00:00Z',
    })?.id).toBe('campaign-target');
  });

  it('falls back to account-level target when no campaign override exists', () => {
    expect(resolveTarget(targets, {
      metricId: 'cost_per_messaging_conversation',
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
