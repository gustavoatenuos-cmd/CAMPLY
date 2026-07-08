import { describe, it, expect } from 'vitest';
import { resolveClientDecision } from './clientDecisionState';
import { GlobalClientPerformance } from './globalPerformanceDashboard';
import { ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';

describe('clientDecisionState', () => {
  const baseProfile: ClientAnalysisProfile = {
    clientId: 'c1',
    vertical: 'saude',
    subsegment: 'clinica',
    customVertical: null,
    customSubsegment: null,
    operationType: 'local',
    salesModels: ['whatsapp'],
    secondaryChannel: null,
    secondaryConversionMetric: null,
    businessModel: 'local',
    primaryConversionMetric: 'messaging_conversations_started_total',
    secondaryMetrics: [],
    primaryChannel: 'whatsapp',
    budgetPeriod: 'monthly',
    plannedBudget: 5000,
    minimumEvaluationSpend: 100,
    minimumImpressions: 1000,
    minimumResults: 10,
    attributionDelayHours: 24,
    analysisEnabled: true
  };

  const basePerformance: any = {
    clientId: 'c1',
    clientName: 'Client 1',
    clientStatus: 'active',
    accounts: [{ clientMetaAssetId: 'a1', metaAssetId: 'm1', accountName: 'Conta', currency: 'BRL', timezone: 'UTC' }],
    metrics: {
      spend: { metricId: 'spend', value: 2500, status: 'info' },
      messaging_conversations_started_total: { metricId: 'messaging_conversations_started_total', value: 50, status: 'info' }
    },
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [
      { metricId: 'messaging_conversations_started_total', targetValue: 100, value: 50, differencePercent: -50, status: 'attention', campaignId: null }
    ],
    budgetPacing: null,
    score: { total: 1, healthyCount: 0, criticalCount: 0, scorePercent: 50, overallStatus: 'attention' },
    dataQuality: { score: 100, hasDataGaps: false, partialDays: [], periodStatus: 'complete' },
    lastSuccessfulRun: { id: 'r1', status: 'success', startedAt: '2026-07-08T00:00:00Z', finishedAt: '2026-07-08T00:05:00Z', range_diagnostics_by_period: {} },
    lastAttempt: { id: 'r1', status: 'success', startedAt: '2026-07-08T00:00:00Z', finishedAt: '2026-07-08T00:05:00Z', range_diagnostics_by_period: {} },
    hasNewerPartial: false,
    hasNewerFailure: false,
    analysisProfile: baseProfile
  };

  it('resolves healthy client correctly', () => {
    const p = {
      ...basePerformance,
      evaluations: [
        { metricId: 'messaging_conversations_started_total', targetValue: 40, value: 50, differencePercent: 25, status: 'healthy' as const, campaignId: null }
      ]
    };
    
    // Middle of month, spend 2500, budget 5000 -> pace 100% -> on_track
    const now = new Date(2026, 6, 15); // July 15 (half month)
    const state = resolveClientDecision({ performance: p as any as any, now });
    
    expect(state.macroStatus).toBe('healthy');
    expect(state.budget.status).toBe('on_track');
    expect(state.primaryMetric.metricId).toBe('messaging_conversations_started_total');
    expect(state.primaryMetric.status).toBe('healthy');
    expect(state.alerts.length).toBe(0);
  });

  it('resolves critical client correctly (budget exceeded)', () => {
    const p = {
      ...basePerformance,
      metrics: {
        spend: { metricId: 'spend', value: 6000, status: 'info' as const },
        messaging_conversations_started_total: { metricId: 'messaging_conversations_started_total', value: 10, status: 'info' as const }
      }
    };
    const now = new Date(2026, 6, 15);
    const state = resolveClientDecision({ performance: p as any as any, now });
    
    expect(state.macroStatus).toBe('critical');
    expect(state.budget.status).toBe('exceeded');
    expect(state.alerts.some(a => a.id === 'budget_exceeded')).toBe(true);
  });

  it('client with metric and recent failure becomes sync_failed_recently/attention', () => {
    const p = {
      ...basePerformance,
      hasNewerFailure: true,
      lastAttempt: { id: 'r2', status: 'failed' as const, startedAt: '2026-07-08T12:00:00Z', finishedAt: '2026-07-08T12:05:00Z', terminationReason: 'API Error', range_diagnostics_by_period: {} }
    };
    const state = resolveClientDecision({ performance: p as any });
    
    expect(state.dataStatus).toBe('sync_failed_recently');
    expect(state.macroStatus).toBe('attention'); // Due to recent sync failure alert
    expect(state.alerts.some(a => a.id === 'last_sync_failed')).toBe(true);
  });

  it('client without account becomes not_connected', () => {
    const p = { ...basePerformance, accounts: [] };
    const state = resolveClientDecision({ performance: p as any });
    expect(state.dataStatus).toBe('not_connected');
    expect(state.macroStatus).toBe('not_connected');
    expect(state.alerts.some(a => a.id === 'not_connected')).toBe(true);
  });

  it('client without primary metric becomes not_configured', () => {
    const p = { ...basePerformance, analysisProfile: { ...baseProfile, primaryConversionMetric: '' } };
    const state = resolveClientDecision({ performance: p as any });
    expect(state.macroStatus).toBe('not_configured');
    expect(state.alerts.some(a => a.id === 'missing_primary_metric')).toBe(true);
  });

  it('budget daily normalizes to month', () => {
    const p = { ...basePerformance, analysisProfile: { ...baseProfile, budgetPeriod: 'daily' as const, plannedBudget: 100 } };
    // July has 31 days. 100 * 31 = 3100.
    const now = new Date(2026, 6, 15);
    const state = resolveClientDecision({ performance: p as any, now });
    expect(state.budget.plannedMonthlyBudget).toBe(3100);
  });

  it('budget weekly normalizes to month', () => {
    const p = { ...basePerformance, analysisProfile: { ...baseProfile, budgetPeriod: 'weekly' as const, plannedBudget: 700 } };
    // July has 31 days. 700 * (31/7) = 3100.
    const now = new Date(2026, 6, 15);
    const state = resolveClientDecision({ performance: p as any, now });
    expect(state.budget.plannedMonthlyBudget).toBe(3100);
  });

  it('spend without primary conversion generates alert', () => {
    const p = {
      ...basePerformance,
      metrics: {
        spend: { metricId: 'spend', value: 2500, status: 'info' as const }
      }
    };
    const state = resolveClientDecision({ performance: p as any });
    expect(state.alerts.some(a => a.id === 'spend_no_conversion')).toBe(true);
    expect(state.macroStatus).toBe('critical'); // spend without conversion is critical
  });

  it('cliente sem sync vira never_synced', () => {
    const p = { ...basePerformance, lastSuccessfulRun: null, lastAttempt: null };
    const state = resolveClientDecision({ performance: p as any });
    expect(state.dataStatus).toBe('never_synced');
    expect(state.macroStatus).toBe('no_data');
  });

  it('orçamento monthly usa valor direto', () => {
    const p = { ...basePerformance, analysisProfile: { ...baseProfile, budgetPeriod: 'monthly' as const, plannedBudget: 5000 } };
    const state = resolveClientDecision({ performance: p as any });
    expect(state.budget.plannedMonthlyBudget).toBe(5000);
  });

  it('gasto abaixo do ritmo gera alerta', () => {
    const p = { ...basePerformance, metrics: { spend: { metricId: 'spend', value: 500, status: 'info' as const }, messaging_conversations_started_total: { metricId: 'messaging_conversations_started_total', value: 50, status: 'info' as const } } };
    const now = new Date(2026, 6, 15);
    const state = resolveClientDecision({ performance: p as any, now });
    expect(state.budget.status).toBe('under_spending');
    expect(state.alerts.some(a => a.id === 'budget_under_pacing')).toBe(true);
  });

  it('gasto acima do ritmo gera alerta', () => {
    const p = { ...basePerformance, metrics: { spend: { metricId: 'spend', value: 4000, status: 'info' as const }, messaging_conversations_started_total: { metricId: 'messaging_conversations_started_total', value: 50, status: 'info' as const } } };
    const now = new Date(2026, 6, 15);
    const state = resolveClientDecision({ performance: p as any, now });
    expect(state.budget.status).toBe('over_spending');
    expect(state.alerts.some(a => a.id === 'budget_over_pacing')).toBe(true);
  });
});
