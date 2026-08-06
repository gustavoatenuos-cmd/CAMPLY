import { describe, it, expect } from 'vitest';
import { parseGlobalPerformanceDashboard } from './parseGlobalPerformanceDashboard';
import type { GlobalPerformanceAccount } from './globalPerformanceDashboard';

describe('parseGlobalPerformanceDashboard', () => {
  it('correctly aggregates dataFreshness and dataQuality from multiple accounts', () => {
    const rawData = [
      {
        clientId: 'client_1',
        clientName: 'Test Client',
        clientStatus: 'available',
        metrics: {},
        accounts: [
          {
            adAccountId: 'act_1',
            accountName: 'Account 1',
            dataQuality: { status: 'complete' },
            dataRun: { id: 'run_1', finishedAt: '2026-08-01T10:00:00Z' }
          },
          {
            adAccountId: 'act_2',
            accountName: 'Account 2',
            dataQuality: { status: 'partial' },
            dataRun: { id: 'run_2', finishedAt: '2026-08-01T08:00:00Z' }
          }
        ]
      }
    ];

    const result = parseGlobalPerformanceDashboard(rawData);
    expect(result.length).toBe(1);
    
    const client = result[0];
    
    // Aggregated quality is the worst among active accounts (unavailable > partial > zero_delivery > complete)
    expect(client.dataQuality.status).toBe('partial');

    // Freshness
    expect(client.dataFreshness.runCount).toBe(2);
    expect(client.dataFreshness.oldestAnchor).toBe('2026-08-01T08:00:00Z');
    expect(client.dataFreshness.reason).toBe('oldest_of_multiple');
    expect(client.dataFreshness.anchorAccountId).toBe('act_2');
    expect(client.dataFreshness.anchorAccountName).toBe('Account 2');
    expect(client.dataFreshness.sources.length).toBe(2);
  });

  it('correctly aggregates dataQuality when one is unavailable', () => {
    const rawData = [
      {
        clientId: 'client_1',
        accounts: [
          {
            adAccountId: 'act_1',
            dataQuality: { status: 'complete' },
            dataRun: { id: 'run_1', finishedAt: '2026-08-01T10:00:00Z' }
          },
          {
            adAccountId: 'act_2',
            dataQuality: { status: 'unavailable' },
            dataRun: { id: 'run_2', finishedAt: '2026-08-01T08:00:00Z' }
          }
        ]
      }
    ];

    const result = parseGlobalPerformanceDashboard(rawData);
    expect(result[0].dataQuality.status).toBe('unavailable');
  });
});
