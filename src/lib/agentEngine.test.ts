import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialData } from '../data/camplyStore';
import { runAgentEngine } from './agentEngine';

describe('runAgentEngine', () => {
  afterEach(() => vi.useRealTimers());

  it('creates a critical alert for an overdue task', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-27T12:00:00-03:00'));

    const result = runAgentEngine({
      ...initialData,
      tasks: [{
        id: 'task-1',
        title: 'Revisar campanha',
        dueDate: '2026-06-26',
        area: 'tráfego',
        taskType: 'otimizacao',
        done: false,
      }],
    });

    expect(result.newAlerts).toHaveLength(1);
    expect(result.newAlerts[0]).toMatchObject({
      relatedEntityId: 'task-1',
      title: 'Tarefa Atrasada',
      severity: 'critical',
    });
  });

  it('does not duplicate an active alert with the same reason', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-27T12:00:00-03:00'));

    const result = runAgentEngine({
      ...initialData,
      tasks: [{
        id: 'task-1',
        title: 'Revisar campanha',
        dueDate: '2026-06-26',
        area: 'tráfego',
        taskType: 'otimizacao',
        done: false,
      }],
      agentAlerts: [{
        id: 'alert-1',
        relatedEntityId: 'task-1',
        relatedEntityType: 'task',
        title: 'Tarefa Atrasada',
        message: 'Já registrado',
        severity: 'critical',
        status: 'active',
        triggeredAt: '2026-06-26T12:00:00-03:00',
      }],
    });

    expect(result.newAlerts).toHaveLength(0);
  });
});
