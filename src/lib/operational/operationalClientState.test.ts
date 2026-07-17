import { describe, expect, it } from 'vitest';
import type { ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';
import type { GlobalClientPerformance } from '../performance/globalPerformanceDashboard';
import {
  buildOperationalClientState,
  type OperationalClientStateInput,
} from './operationalClientState';

const profile = {
  clientId: 'client-1',
  analysisEnabled: true,
  primaryConversionMetric: 'leads',
  plannedBudget: 1000,
  primaryChannel: 'formulario',
  salesModels: ['formulario'],
} as ClientAnalysisProfile;

const performance = {
  clientId: 'client-1',
  clientName: 'Cliente 1',
  clientStatus: 'available',
  accounts: [],
  metrics: {},
  metricGroups: [],
  resolvedTargets: [],
  evaluations: [],
  budgetPacing: null,
  score: { value: null, status: 'unavailable', reasons: [] },
  dataQuality: { status: 'complete', reason: null },
  lastSuccessfulRun: {
    id: 'run-success',
    status: 'success',
    startedAt: '2026-07-17T10:00:00.000Z',
    finishedAt: '2026-07-17T10:05:00.000Z',
    terminationReason: null,
  },
  lastAttempt: {
    id: 'run-success',
    status: 'success',
    startedAt: '2026-07-17T10:00:00.000Z',
    finishedAt: '2026-07-17T10:05:00.000Z',
    terminationReason: null,
  },
  hasNewerPartial: false,
  hasNewerFailure: false,
} as unknown as GlobalClientPerformance;

function input(overrides: Partial<OperationalClientStateInput> = {}): OperationalClientStateInput {
  return {
    clientId: 'client-1',
    clientName: 'Cliente 1',
    selectedPeriod: 'last_7d',
    profile: undefined,
    performance: undefined,
    receivables: undefined,
    ...overrides,
  };
}

describe('buildOperationalClientState', () => {
  it('requires an explicit selected period at runtime instead of silently using this_month', () => {
    expect(() => buildOperationalClientState({
      ...input(),
      selectedPeriod: undefined,
    } as unknown as OperationalClientStateInput)).toThrow('selectedPeriod is required');
  });

  it('maps undefined sources to not_evaluated', () => {
    const state = buildOperationalClientState(input());

    expect(state.profile.status).toBe('not_evaluated');
    expect(state.sync.status).toBe('not_evaluated');
    expect(state.actual.status).toBe('not_evaluated');
    expect(state.readiness.finance.status).toBe('not_evaluated');
    expect(state.diagnosis.status).toBe('not_evaluated');
  });

  it('maps null sources to confirmed absence', () => {
    const state = buildOperationalClientState(input({
      profile: null,
      performance: null,
      receivables: null,
    }));

    expect(state.profile.status).toBe('absent');
    expect(state.sync.status).toBe('absent');
    expect(state.actual.status).toBe('absent');
    expect(state.readiness.finance.status).toBe('absent');
    expect(state.diagnosis.status).toBe('blocked');
    expect(state.diagnosis.reasons).toContain('profile_absent');
    expect(state.diagnosis.reasons).toContain('sync_absent');
  });

  it('maps loaded values to available sections', () => {
    const state = buildOperationalClientState(input({
      profile,
      performance,
      receivables: [],
    }));

    expect(state.profile.status).toBe('available');
    if (state.profile.status !== 'available') throw new Error('profile should be available');
    expect(state.profile.value).toBe(profile);
    expect(state.sync.status).toBe('available');
    expect(state.actual.status).toBe('available');
    expect(state.readiness.finance.status).toBe('blocked');
  });

  it('does not let unloaded receivables block analytics readiness', () => {
    const state = buildOperationalClientState(input({
      profile,
      performance,
      receivables: undefined,
    }));

    expect(state.readiness.finance.status).toBe('not_evaluated');
    expect(state.readiness.analytics.status).toBe('ready');
    expect(state.readiness.overall.status).toBe('ready');
  });

  it('does not report an unloaded profile as an absent profile', () => {
    const state = buildOperationalClientState(input({
      profile: undefined,
      performance,
    }));

    expect(state.profile.status).toBe('not_evaluated');
    expect(state.readiness.analytics.status).toBe('not_evaluated');
    expect(state.diagnosis.reasons).not.toContain('profile_absent');
  });

  it('carries traceable sync evidence for loaded dashboard data', () => {
    const state = buildOperationalClientState(input({ performance }));

    expect(state.sync.status).toBe('available');
    expect(state.sync.evidence).toMatchObject({
      source: 'analytics_dashboard',
      selectedPeriod: 'last_7d',
      trustedRunId: 'run-success',
      latestAttemptId: 'run-success',
      dataQuality: { status: 'complete', reason: null },
    });
    expect(state.evidence).toContainEqual(expect.objectContaining({
      source: 'analytics_dashboard',
      period: 'last_7d',
      sourceId: 'run-success',
    }));
  });
});
