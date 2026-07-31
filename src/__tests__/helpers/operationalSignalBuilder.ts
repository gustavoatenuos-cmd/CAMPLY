import { OperationalSignal } from '../../types';

export function makeOperationalSignal(overrides: Partial<OperationalSignal> = {}): OperationalSignal {
  const now = new Date().toISOString();
  return {
    id: `sig_${Math.random().toString(36).substring(2, 9)}`,
    signalType: 'generic_signal',
    sourceDomain: 'system',
    relatedEntityId: 'entity_1',
    relatedEntityType: 'task',
    title: 'Test Signal',
    message: 'This is a test signal',
    severity: 'info',
    status: 'active',
    deduplicationKey: `dedup_${Math.random().toString(36).substring(2, 9)}`,
    triggeredAt: now,
    lastDetectedAt: now,
    occurrenceCount: 1,
    clientId: 'client_1',
    ...overrides,
  };
}
