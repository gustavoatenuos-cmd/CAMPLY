import { describe, expect, it } from 'vitest';
import type { GlobalClientPerformance } from './globalPerformanceDashboard';
import type { ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';
import {
  buildClientPriorityEntries,
  classifyAccountReliability,
  groupByPriorityTier,
  operationalHealthTagFor,
  reasonLabel,
  summarizeDiagnosis,
} from './clientPriorityGrouping';

function metric(value: number | null, available = true) {
  return { value, available, partial: false } as any;
}

function baseClient(overrides: Partial<GlobalClientPerformance> = {}): GlobalClientPerformance {
  return {
    clientId: 'c1',
    clientName: 'Cliente Um',
    clientStatus: 'available',
    accounts: [],
    metrics: {},
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: { value: 80, status: 'healthy', summary: '', confidence: 90, coveragePercent: 100 } as any,
    dataQuality: { status: 'complete', reason: null },
    lastSuccessfulRun: null,
    lastAttempt: null,
    hasNewerPartial: false,
    hasNewerFailure: false,
    analysisProfile: null,
    ...overrides,
  };
}

function profile(overrides: Partial<ClientAnalysisProfile> = {}): ClientAnalysisProfile {
  return {
    clientId: 'c1',
    vertical: 'saude',
    subsegment: 'outros',
    customVertical: null,
    customSubsegment: null,
    operationType: null,
    salesModels: [],
    secondaryChannel: null,
    secondaryConversionMetric: null,
    businessModel: '',
    primaryConversionMetric: 'leads',
    secondaryMetrics: [],
    primaryChannel: 'meta',
    budgetPeriod: 'monthly',
    plannedBudget: 1000,
    minimumEvaluationSpend: 0,
    minimumImpressions: 0,
    minimumResults: 0,
    attributionDelayHours: 0,
    analysisEnabled: true,
    ...overrides,
  };
}

describe('classifyAccountReliability', () => {
  it('classifies an account with a complete data quality and a successful run as reliable', () => {
    const account: any = {
      dataQuality: { status: 'complete', reason: null },
      lastSuccessfulRun: { id: '1', status: 'success', startedAt: '', finishedAt: '2026-01-01', terminationReason: null },
      lastAttempt: { id: '1', status: 'success', startedAt: '', finishedAt: '2026-01-01', terminationReason: null },
    };
    expect(classifyAccountReliability(account)).toBe('reliable');
  });

  it('classifies an account without any successful run as a problem', () => {
    const account: any = {
      dataQuality: { status: 'unavailable', reason: 'account_not_connected' },
      lastSuccessfulRun: null,
      lastAttempt: null,
    };
    expect(classifyAccountReliability(account)).toBe('problem');
  });

  it('classifies an account whose latest attempt failed after a previous success as a problem', () => {
    const account: any = {
      dataQuality: { status: 'partial', reason: 'partial_sync' },
      lastSuccessfulRun: { id: '1', status: 'success', startedAt: '', finishedAt: '2026-01-01', terminationReason: null },
      lastAttempt: { id: '2', status: 'failed', startedAt: '', finishedAt: '2026-01-02', terminationReason: 'error' },
    };
    expect(classifyAccountReliability(account)).toBe('problem');
  });
});

describe('buildClientPriorityEntries', () => {
  it('flags a client with no analysis profile as no_profile / exige ação agora', () => {
    const client = baseClient({ analysisProfile: null, score: { value: null, status: 'unavailable' } as any });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.tier).toBe('action_now');
    expect(entry.reasons).toContain('no_profile');
  });

  it('flags a client whose latest Meta sync failed', () => {
    const client = baseClient({
      clientStatus: 'failed',
      analysisProfile: profile(),
      dataQuality: { status: 'unavailable', reason: 'sync_failed' },
    });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.reasons).toContain('sync_failed');
    expect(entry.tier).toBe('action_now');
  });

  it('flags a client with a partial Meta sync as attention', () => {
    const client = baseClient({
      clientStatus: 'partial',
      analysisProfile: profile(),
      dataQuality: { status: 'partial', reason: 'partial_sync' },
      score: { value: 60, status: 'attention' } as any,
    });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.reasons).toContain('sync_partial');
    expect(entry.tier).toBe('attention');
  });

  it('flags a client with spend but no conversions as no_conversion / attention', () => {
    const client = baseClient({
      analysisProfile: profile({ primaryConversionMetric: 'leads' }),
      metrics: { spend: metric(500), leads: metric(0) },
      score: { value: 55, status: 'attention' } as any,
    });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.reasons).toContain('no_conversion');
  });

  it('flags a client with a cost evaluation above target as cost_above_target', () => {
    const client = baseClient({
      analysisProfile: profile(),
      evaluations: [{
        metricId: 'cost_per_lead',
        targetKind: 'cost_per_result',
        actualValue: 80,
        targetValue: 40,
        differenceValue: 40,
        differencePercent: 100,
        status: 'critical',
        confidence: 90,
      } as any],
      score: { value: 20, status: 'critical' } as any,
    });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.reasons).toContain('cost_above_target');
    expect(entry.tier).toBe('action_now');
  });

  it('marks a fully healthy client as healthy with no blocking reasons', () => {
    const client = baseClient({
      analysisProfile: profile(),
      metrics: { spend: metric(500), leads: metric(20) },
      score: { value: 90, status: 'healthy' } as any,
    });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.reasons).toEqual(['healthy']);
    expect(entry.tier).toBe('healthy');
  });

  it('flags a non-cost evaluation miss (e.g. a minimum-results goal) even though it is not a cost metric', () => {
    const client = baseClient({
      analysisProfile: profile(),
      metrics: { spend: metric(500), leads: metric(3) },
      evaluations: [{
        metricId: 'leads',
        targetKind: 'minimum_results',
        actualValue: 3,
        targetValue: 20,
        differenceValue: -17,
        differencePercent: -85,
        status: 'attention',
        confidence: 90,
      } as any],
      score: { value: 55, status: 'attention' } as any,
    });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.reasons).toContain('goal_below_target');
    expect(entry.reasons).not.toContain('cost_above_target');
    expect(entry.reasons).not.toContain('healthy');
    expect(entry.tier).toBe('attention');
  });

  it('does not misattribute a non-cost maximum_metric breach (e.g. frequency cap) to cost_above_target', () => {
    const client = baseClient({
      analysisProfile: profile(),
      metrics: { spend: metric(500), leads: metric(20) },
      evaluations: [{
        metricId: 'frequency',
        targetKind: 'maximum_metric',
        actualValue: 8,
        targetValue: 4,
        differenceValue: 4,
        differencePercent: 100,
        status: 'critical',
        confidence: 90,
      } as any],
      score: { value: 30, status: 'critical' } as any,
    });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.reasons).toContain('goal_below_target');
    expect(entry.reasons).not.toContain('cost_above_target');
  });

  it('keeps a real cost-per-result breach classified as cost_above_target, not goal_below_target', () => {
    const client = baseClient({
      analysisProfile: profile(),
      evaluations: [{
        metricId: 'cost_per_lead',
        targetKind: 'cost_per_result',
        actualValue: 80,
        targetValue: 40,
        differenceValue: 40,
        differencePercent: 100,
        status: 'critical',
        confidence: 90,
      } as any],
      score: { value: 20, status: 'critical' } as any,
    });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.reasons).toContain('cost_above_target');
    expect(entry.reasons).not.toContain('goal_below_target');
  });

  it('treats an in-progress or not-yet-synced-period client the same as a partial sync (attention)', () => {
    const syncing = baseClient({ clientId: 'syncing', clientStatus: 'syncing', analysisProfile: profile() });
    const periodNotSynced = baseClient({ clientId: 'pns', clientStatus: 'period_not_synced', analysisProfile: profile() });
    const [syncingEntry] = buildClientPriorityEntries([syncing], []);
    const [pnsEntry] = buildClientPriorityEntries([periodNotSynced], []);
    expect(syncingEntry.reasons).toContain('sync_partial');
    expect(pnsEntry.reasons).toContain('sync_partial');
  });

  it('distinguishes a client with no profile at all from a client whose analysis was intentionally disabled', () => {
    const missingProfile = baseClient({ clientId: 'missing', analysisProfile: null });
    const disabledProfile = baseClient({ clientId: 'disabled', analysisProfile: profile({ analysisEnabled: false }) });

    const [missingEntry] = buildClientPriorityEntries([missingProfile], []);
    const [disabledEntry] = buildClientPriorityEntries([disabledProfile], []);

    expect(missingEntry.reasons).toContain('no_profile');
    expect(missingEntry.tier).toBe('action_now');

    expect(disabledEntry.reasons).toContain('analysis_disabled');
    expect(disabledEntry.reasons).not.toContain('no_profile');
    expect(disabledEntry.tier).toBe('attention');
  });

  it('never produces a critical tier alongside a healthy-only diagnosis (reasons and tier stay consistent)', () => {
    const client = baseClient({
      analysisProfile: profile(),
      metrics: { spend: metric(500), leads: metric(20) },
      evaluations: [{
        metricId: 'leads',
        targetKind: 'minimum_results',
        actualValue: 2,
        targetValue: 20,
        differenceValue: -18,
        differencePercent: -90,
        status: 'critical',
        confidence: 90,
      } as any],
      score: { value: 10, status: 'critical' } as any,
    });
    const [entry] = buildClientPriorityEntries([client], []);
    expect(entry.tier).toBe('action_now');
    expect(entry.reasons).not.toEqual(['healthy']);
  });
});

describe('groupByPriorityTier', () => {
  it('buckets entries into the three tiers, ordering action_now first', () => {
    const healthy = baseClient({ clientId: 'h', analysisProfile: profile(), metrics: { spend: metric(100), leads: metric(5) }, score: { value: 90, status: 'healthy' } as any });
    const critical = baseClient({ clientId: 'x', analysisProfile: null, score: { value: null, status: 'unavailable' } as any });
    const entries = buildClientPriorityEntries([healthy, critical], []);
    const grouped = groupByPriorityTier(entries);
    expect(grouped.action_now.map((e) => e.client.clientId)).toEqual(['x']);
    expect(grouped.healthy.map((e) => e.client.clientId)).toEqual(['h']);
    expect(grouped.attention).toEqual([]);
  });
});

describe('reasonLabel / summarizeDiagnosis', () => {
  it('provides a human readable label for each reason', () => {
    expect(reasonLabel('sync_failed')).toMatch(/falha/i);
    expect(reasonLabel('healthy')).toMatch(/saud/i);
  });

  it('summarizes multiple reasons into one short sentence', () => {
    const text = summarizeDiagnosis(baseClient(), ['sync_partial', 'no_conversion']);
    expect(text.toLowerCase()).toContain('parcial');
    expect(text.toLowerCase()).toContain('convers');
  });

  it('summarizes a healthy diagnosis', () => {
    expect(summarizeDiagnosis(baseClient(), ['healthy']).toLowerCase()).toMatch(/saud/);
  });

  it('appends the technical reason when the client is partial and the backend reported one', () => {
    const client = baseClient({ dataQuality: { status: 'partial', reason: 'rate_limit_exhausted' } });
    const text = summarizeDiagnosis(client, ['sync_partial']);
    expect(text).toContain('Motivo técnico:');
    expect(text.toLowerCase()).toContain('limitou a taxa de requisições');
  });

  it('does not append a technical reason when the backend did not report one', () => {
    const client = baseClient({ dataQuality: { status: 'partial', reason: null } });
    const text = summarizeDiagnosis(client, ['sync_partial']);
    expect(text).not.toContain('Motivo técnico:');
  });
});

describe('operationalHealthTagFor', () => {
  it('prioritizes sync_failed over other reasons', () => {
    expect(operationalHealthTagFor({ tier: 'action_now', reasons: ['sync_failed', 'no_profile'] })).toBe('sync_failed');
  });

  it('prioritizes sync_partial over a generic attention tier', () => {
    expect(operationalHealthTagFor({ tier: 'attention', reasons: ['sync_partial', 'no_conversion'] })).toBe('sync_partial');
  });

  it('falls back to the tier when no sync-specific reason is present', () => {
    expect(operationalHealthTagFor({ tier: 'action_now', reasons: ['no_profile'] })).toBe('critical');
    expect(operationalHealthTagFor({ tier: 'attention', reasons: ['cost_above_target'] })).toBe('attention');
    expect(operationalHealthTagFor({ tier: 'healthy', reasons: ['healthy'] })).toBe('ready');
  });
});
