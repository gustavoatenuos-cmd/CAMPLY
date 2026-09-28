import { describe, expect, it } from 'vitest';
import { describeBulkSyncResult, describeMetaRunHealth } from './metaSyncHealth';
import type { MetaRunSummary } from './clientMetaAssetService';

function run(overrides: Partial<MetaRunSummary> = {}): MetaRunSummary {
  return {
    id: 'run-1',
    status: 'success',
    period: 'last_90d',
    level: 'creative',
    scope: 'full_account',
    startedAt: '2026-09-28T16:00:00.000Z',
    finishedAt: '2026-09-28T16:01:00.000Z',
    terminationReason: 'completed',
    ...overrides,
  };
}

describe('metaSyncHealth', () => {
  it('treats one-day Meta range lag as delayed, not as collection failure', () => {
    const health = describeMetaRunHealth(run({
      status: 'partial',
      terminationReason: 'partial_collection',
      errorMessage: 'Account insights last_90d: Meta last_90d range differs from local expectation; using returned range.',
      metadata: {
        collection_errors: [],
        collection_warnings: ['Meta last_90d range differs from local expectation; using returned range.'],
        range_diagnostics_by_period: {
          last_90d: {
            expectedDateStop: '2026-09-28',
            returnedDateStop: '2026-09-27',
          },
        },
      },
    }));

    expect(health.state).toBe('delayed');
    expect(health.label).toBe('Atualizada até ontem');
    expect(health.retryRecommended).toBe(false);
    expect(health.lagDays).toBe(1);
  });

  it('shows a multi-day Meta lag explicitly', () => {
    const health = describeMetaRunHealth(run({
      status: 'partial',
      errorMessage: 'Account insights last_90d: Meta last_90d range differs from local expectation; using returned range.',
      metadata: {
        collection_errors: [],
        range_diagnostics_by_period: {
          last_90d: {
            expectedDateStop: '2026-09-28',
            returnedDateStop: '2026-09-26',
          },
        },
      },
    }));

    expect(health.state).toBe('delayed');
    expect(health.label).toBe('Meta com atraso de 2 dias');
    expect(health.detail).toContain('26/09/2026');
  });

  it('keeps a real ad collection error as a retryable failure', () => {
    const health = describeMetaRunHealth(run({
      status: 'partial',
      terminationReason: 'partial_collection',
      errorMessage: 'Ad collection: Meta API Error [1]: An unknown error occurred',
      metadata: {
        collection_errors: [],
        range_diagnostics_by_period: {
          last_90d: {
            expectedDateStop: '2026-09-28',
            returnedDateStop: '2026-09-28',
          },
        },
      },
    }));

    expect(health.state).toBe('needs_retry');
    expect(health.label).toBe('Criativos precisam de nova tentativa');
    expect(health.retryRecommended).toBe(true);
  });

  it('keeps complete runs as updated', () => {
    const health = describeMetaRunHealth(run());
    expect(health.state).toBe('updated');
    expect(health.label).toBe('Atualizada');
  });

  it('also softens range lag inside advanced bulk diagnostics', () => {
    const health = describeBulkSyncResult({
      clientId: 'client-1',
      clientName: 'Cliente',
      clientMetaAssetId: 'link-1',
      accountName: 'Conta',
      adAccountId: 'act_1',
      status: 'partial',
      message: 'Account insights last_90d: Meta last_90d range differs from local expectation; using returned range.',
    });

    expect(health.state).toBe('delayed');
    expect(health.retryRecommended).toBe(false);
  });
});
