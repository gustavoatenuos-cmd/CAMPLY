import { describe, expect, it } from 'vitest';
import {
  createActivityLog,
  inferProjectPaymentStatus,
  makeId,
  normalizeData,
  setActivityActor,
} from './camplyStore';

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

describe('makeId', () => {
  it('generates prefixed unique ids without relying on millisecond randomness', () => {
    const ids = Array.from({ length: 100 }, () => makeId('client'));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('client-'))).toBe(true);
  });
});

describe('createActivityLog', () => {
  it('uses the authenticated actor configured by the app instead of a hardcoded name', () => {
    setActivityActor('gestor@camply.test');

    const log = createActivityLog({
      action: 'client_created',
      title: 'Cliente criado',
      description: 'Teste',
      projectId: '',
      clientId: 'client-1',
      campaignId: '',
      receivableId: '',
      taskId: '',
    });

    expect(log.actor).toBe('gestor@camply.test');
    expect(log.actor).not.toBe('Gustavo');
  });
});
