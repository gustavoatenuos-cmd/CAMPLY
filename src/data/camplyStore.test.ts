import { describe, expect, it } from 'vitest';
import {
  createActivityLog,
  inferProjectPaymentStatus,
  initialData,
  makeId,
  MAX_ACTIVITY_LOGS,
  MAX_AGENT_ALERTS,
  MAX_AGENT_LOGS,
  normalizeData,
  sanitizeWorkspaceData,
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

describe('history caps', () => {
  const oversized = {
    ...initialData,
    activityLogs: Array.from({ length: MAX_ACTIVITY_LOGS + 200 }, (_, i) => ({ id: `log-${i}` })),
    agentAlerts: Array.from({ length: MAX_AGENT_ALERTS + 200 }, (_, i) => ({ id: `alert-${i}` })),
    agentLogs: Array.from({ length: MAX_AGENT_LOGS + 200 }, (_, i) => ({ id: `agentlog-${i}` })),
  } as never;

  it('caps unbounded history on load, keeping the newest entries', () => {
    const normalized = normalizeData(oversized);

    expect(normalized.activityLogs).toHaveLength(MAX_ACTIVITY_LOGS);
    expect(normalized.agentAlerts).toHaveLength(MAX_AGENT_ALERTS);
    expect(normalized.agentLogs).toHaveLength(MAX_AGENT_LOGS);
    // Listas são newest-first: o corte descarta o fim (mais antigo).
    expect(normalized.activityLogs[0].id).toBe('log-0');
  });

  it('caps unbounded history before saving the workspace blob', () => {
    const sanitized = sanitizeWorkspaceData(oversized);

    expect(sanitized.activityLogs).toHaveLength(MAX_ACTIVITY_LOGS);
    expect(sanitized.agentAlerts).toHaveLength(MAX_AGENT_ALERTS);
    expect(sanitized.agentLogs).toHaveLength(MAX_AGENT_LOGS);
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
