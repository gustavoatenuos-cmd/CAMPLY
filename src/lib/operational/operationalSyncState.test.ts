import { describe, expect, it } from 'vitest';
import { explainOperationalSyncState, type OperationalSyncRun } from './operationalSyncState';

const successRun: OperationalSyncRun = {
  id: 'success-1',
  status: 'success',
  requestedPeriod: 'last_30d',
  startedAt: '2026-07-17T10:00:00.000Z',
  finishedAt: '2026-07-17T10:05:00.000Z',
  terminationReason: null,
};

const partialRun: OperationalSyncRun = {
  id: 'partial-1',
  status: 'partial',
  requestedPeriod: 'last_30d',
  startedAt: '2026-07-17T11:00:00.000Z',
  finishedAt: '2026-07-17T11:05:00.000Z',
  terminationReason: 'rate_limit_exhausted',
};

function explain(overrides: Partial<Parameters<typeof explainOperationalSyncState>[0]> = {}) {
  return explainOperationalSyncState({
    selectedPeriod: 'last_30d',
    clientId: 'client-1',
    clientName: 'Cliente 1',
    accounts: [{ clientMetaAssetId: 'asset-1', accountName: 'Conta 1' }],
    lastSuccessfulRun: successRun,
    lastAttempt: successRun,
    dataQuality: { status: 'complete', reason: null },
    requestedPeriod: 'last_30d',
    exactRange: { dateStart: '2026-06-18', dateStop: '2026-07-17' },
    metrics: { spend: { value: 100, available: true } as any },
    ...overrides,
  });
}

describe('explainOperationalSyncState', () => {
  it('does not let a this_month sync validate last_30d', () => {
    const state = explain({
      requestedPeriod: 'this_month',
      lastSuccessfulRun: { ...successRun, requestedPeriod: 'this_month' },
      lastAttempt: { ...successRun, requestedPeriod: 'this_month' },
    });

    expect(state.status).toBe('not_synced');
    expect(state.canUseData).toBe(false);
    expect(state.syncedPeriod).toBe('this_month');
    expect(state.reason).toBe('O período selecionado ainda não foi sincronizado.');
  });

  it('accepts a successful last_30d sync for a last_30d dashboard', () => {
    const state = explain();

    expect(state.status).toBe('success');
    expect(state.canUseData).toBe(true);
    expect(state.trustedRun?.id).toBe('success-1');
  });

  it('keeps trusted success when a newer partial attempt exists', () => {
    const state = explain({
      lastAttempt: partialRun,
      dataQuality: { status: 'partial', reason: 'rate_limit_exhausted' },
    });

    expect(state.status).toBe('success');
    expect(state.canUseData).toBe(true);
    expect(state.latestAttempt?.id).toBe('partial-1');
    expect(state.warning).toBe('Último dado confiável em uso; tentativa mais recente incompleta.');
  });

  it('returns partial when there is only a partial attempt', () => {
    const state = explain({
      lastSuccessfulRun: null,
      lastAttempt: partialRun,
      dataQuality: { status: 'partial', reason: 'rate_limit_exhausted' },
    });

    expect(state.status).toBe('partial');
    expect(state.canUseData).toBe(false);
  });

  it('returns failed when there is only a failed attempt', () => {
    const state = explain({
      lastSuccessfulRun: null,
      lastAttempt: { ...partialRun, id: 'failed-1', status: 'failed' },
      dataQuality: { status: 'unavailable', reason: 'sync_failed' },
    });

    expect(state.status).toBe('failed');
    expect(state.canUseData).toBe(false);
  });

  it('returns not_synced, never partial, when the selected period has no attempt', () => {
    const state = explain({
      lastSuccessfulRun: null,
      lastAttempt: null,
      requestedPeriod: null,
      dataQuality: { status: 'unavailable', reason: 'period_not_synced' },
      metrics: {},
    });

    expect(state.status).toBe('not_synced');
    expect(state.canUseData).toBe(false);
  });

  it('returns no_account before evaluating runs', () => {
    const state = explain({ accounts: [] });

    expect(state.status).toBe('no_account');
    expect(state.canUseData).toBe(false);
  });
});
