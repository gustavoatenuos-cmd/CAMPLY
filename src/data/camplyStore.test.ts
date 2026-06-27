import { describe, expect, it } from 'vitest';
import { inferProjectPaymentStatus, normalizeData } from './camplyStore';

describe('normalizeData', () => {
  it('adds all collections required by the agent to legacy data', () => {
    const normalized = normalizeData({ clients: [], campaigns: [], receivables: [], projects: [], tasks: [], activityLogs: [] });

    expect(normalized.agentRules).toEqual([]);
    expect(normalized.agentAlerts).toEqual([]);
    expect(normalized.agentLogs).toEqual([]);
  });
});

describe('inferProjectPaymentStatus', () => {
  it('marks a fully received project as paid', () => {
    expect(inferProjectPaymentStatus(2_000, 2_000)).toBe('paid');
  });

  it('keeps partially received projects pending', () => {
    expect(inferProjectPaymentStatus(2_000, 1_000)).toBe('pending');
  });
});
