import { describe, it, expect } from 'vitest';
import { syncOperationalSignals } from './syncOperationalSignals';
import { OperationalSignal } from '../../types';

describe('syncOperationalSignals', () => {
  const now = '2026-07-29T20:00:00.000Z';

  it('handles new signal correctly', () => {
    const evaluated = [{ deduplicationKey: 'k1', id: '1' } as OperationalSignal];
    const { signals, transitions } = syncOperationalSignals([], evaluated, { now });
    expect(signals[0].status).toBe('active');
    expect(signals[0].triggeredAt).toBe(now);
    expect(signals[0].lastDetectedAt).toBe(now);
    expect(signals[0].occurrenceCount).toBe(1);
    expect(signals[0].resolvedAt).toBeUndefined();
    expect(signals[0].dismissedAt).toBeUndefined();
  });

  it('handles existing active signal', () => {
    const current = [{ deduplicationKey: 'k1', id: '1', status: 'active', triggeredAt: 'old', lastDetectedAt: 'old', occurrenceCount: 1 } as OperationalSignal];
    const evaluated = [{ deduplicationKey: 'k1', id: '1' } as OperationalSignal];
    const { signals } = syncOperationalSignals(current, evaluated, { now });
    expect(signals[0].status).toBe('active');
    expect(signals[0].triggeredAt).toBe('old');
    expect(signals[0].lastDetectedAt).toBe(now);
    expect(signals[0].occurrenceCount).toBe(1);
  });

  it('resolves absent signals', () => {
    const current = [{ deduplicationKey: 'k1', id: '1', status: 'active', triggeredAt: 'old', occurrenceCount: 1 } as OperationalSignal];
    const { signals, transitions } = syncOperationalSignals(current, [], { now });
    expect(signals[0].status).toBe('resolved');
    expect(signals[0].resolvedAt).toBe(now);
    expect(transitions[0].newStatus).toBe('resolved');
  });

  it('reactivates resolved signals', () => {
    const current = [{ deduplicationKey: 'k1', id: '1', status: 'resolved', resolvedAt: 'old_res', triggeredAt: 'old', occurrenceCount: 1 } as OperationalSignal];
    const evaluated = [{ deduplicationKey: 'k1', id: '1' } as OperationalSignal];
    const { signals, transitions } = syncOperationalSignals(current, evaluated, { now });
    expect(signals[0].status).toBe('active');
    expect(signals[0].resolvedAt).toBeUndefined();
    expect(signals[0].occurrenceCount).toBe(2);
    expect(transitions[0].newStatus).toBe('active');
  });

  it('preserves dismissed status when still detected', () => {
    const current = [{ deduplicationKey: 'k1', id: '1', status: 'dismissed', dismissedAt: 'old_dis', triggeredAt: 'old', occurrenceCount: 1 } as OperationalSignal];
    const evaluated = [{ deduplicationKey: 'k1', id: '1' } as OperationalSignal];
    const { signals } = syncOperationalSignals(current, evaluated, { now });
    expect(signals[0].status).toBe('dismissed');
    expect(signals[0].dismissedAt).toBe('old_dis');
    expect(signals[0].lastDetectedAt).toBe(now);
  });
});
