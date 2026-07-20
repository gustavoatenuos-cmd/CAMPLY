import { describe, expect, it } from 'vitest';
import { buildOperationalSyncLedger } from './operationalSyncLedger';
import type { GlobalClientPerformance } from '../performance/globalPerformanceDashboard';

function client(overrides: Partial<GlobalClientPerformance> = {}): GlobalClientPerformance {
  return {
    clientId: 'client-1',
    clientName: 'Cliente 1',
    clientStatus: 'available',
    accounts: [{
      clientMetaAssetId: 'asset-1',
      metaAssetId: 'meta-1',
      integrationId: 'integration-1',
      adAccountId: 'act_1',
      accountName: 'Conta 1',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      dateStart: '2026-07-13',
      dateStop: '2026-07-19',
      metrics: {},
      budgetPacing: null,
      dataQuality: { status: 'complete', reason: null },
      lastSuccessfulRun: null,
      lastAttempt: null,
    }],
    metrics: { spend: { value: 100, available: true, partial: false } as any },
    metricGroups: [{ campaignId: 'campaign-1' } as any],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: { value: 90, status: 'healthy', summary: '', confidence: 90, coveragePercent: 100 } as any,
    dataQuality: { status: 'complete', reason: null },
    lastSuccessfulRun: {
      id: 'run-success',
      status: 'success',
      requestedPeriod: 'last_7d',
      dateStart: '2026-07-14',
      dateStop: '2026-07-20',
      runScope: 'full_account',
      startedAt: '2026-07-19T10:00:00.000Z',
      finishedAt: '2026-07-19T10:05:00.000Z',
      terminationReason: null,
      metricsCount: 12,
      metricGroupsCount: 1,
    },
    lastAttempt: {
      id: 'run-success',
      status: 'success',
      requestedPeriod: 'last_7d',
      dateStart: '2026-07-14',
      dateStop: '2026-07-20',
      runScope: 'full_account',
      startedAt: '2026-07-19T10:00:00.000Z',
      finishedAt: '2026-07-19T10:05:00.000Z',
      terminationReason: null,
      metricsCount: 12,
      metricGroupsCount: 1,
    },
    hasNewerPartial: false,
    hasNewerFailure: false,
    analysisProfile: null,
    ...overrides,
  };
}

describe('buildOperationalSyncLedger', () => {
  it('builds JSON with selectedPeriod, requestedPeriod and runId', () => {
    const [entry] = buildOperationalSyncLedger([client()], 'last_7d');

    expect(entry.selectedPeriod).toBe('last_7d');
    expect(entry.clientMetaAssetId).toBe('asset-1');
    expect(entry.lastSuccessfulRun?.id).toBe('run-success');
    expect(entry.lastSuccessfulRun?.requestedPeriod).toBe('last_7d');
    expect(entry.coverageStatus).toBe('covered');
    expect(entry.coveringRunId).toBe('run-success');
    expect(entry.selectedDateStart).toBe('2026-07-14');
    expect(entry.selectedDateStop).toBe('2026-07-20');
    expect(entry.coveredDateStart).toBe('2026-07-14');
    expect(entry.coveredDateStop).toBe('2026-07-20');
    expect(entry.lastAttempt?.id).toBe('run-success');
    expect(entry.metricsAvailable).toEqual(['spend']);
    expect(entry.metricGroupsCount).toBe(1);
    expect(entry.decision).toBe('success');
  });

  it('shows not_synced when no run covers the selected range', () => {
    const [entry] = buildOperationalSyncLedger([
      client({
        lastSuccessfulRun: { id: 'run-old', status: 'success', requestedPeriod: 'this_month', dateStart: '2026-07-01', dateStop: '2026-07-10', startedAt: '', finishedAt: '2026-07-10T10:00:00.000Z', terminationReason: null },
        lastAttempt: { id: 'run-old', status: 'success', requestedPeriod: 'this_month', dateStart: '2026-07-01', dateStop: '2026-07-10', startedAt: '', finishedAt: '2026-07-10T10:00:00.000Z', terminationReason: null },
      }),
    ], 'last_7d');

    expect(entry.decision).toBe('not_synced');
    expect(entry.reason).toContain('sincronizado');
  });
});
