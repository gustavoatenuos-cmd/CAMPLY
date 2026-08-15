import { describe, expect, it } from 'vitest';
import type { AgentAlert } from '../../types';
import { syncOperationalSignals } from './syncOperationalSignals';

const active: AgentAlert = {
  id: 'signal:client-1:task_overdue:task-1',
  relatedEntityId: 'task-1',
  relatedEntityType: 'task',
  clientId: 'client-1',
  title: 'Tarefa atrasada',
  message: 'Atrasada',
  severity: 'critical',
  status: 'active',
  suggestedAction: 'Resolver',
  triggeredAt: '2026-08-10T12:00:00.000Z',
};

describe('syncOperationalSignals', () => {
  it('keeps a dismissed signal dismissed while its condition remains true', () => {
    const current: AgentAlert[] = [{ ...active, status: 'dismissed' }];
    const evaluated: AgentAlert[] = [{ ...active, triggeredAt: '2026-08-15T12:00:00.000Z' }];

    const result = syncOperationalSignals(current, evaluated, new Date('2026-08-15T12:00:00Z'));

    expect(result[0].status).toBe('dismissed');
    expect(result[0].triggeredAt).toBe('2026-08-10T12:00:00.000Z');
  });

  it('resolves a signal when the condition disappears', () => {
    const result = syncOperationalSignals([active], [], new Date('2026-08-15T12:00:00Z'));

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('resolved');
  });

  it('returns the same array when no material lifecycle state changed', () => {
    const evaluated: AgentAlert[] = [{ ...active, triggeredAt: '2026-08-15T12:00:00.000Z' }];
    const result = syncOperationalSignals([active], evaluated);

    expect(result[0].triggeredAt).toBe(active.triggeredAt);
  });
});
