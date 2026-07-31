import { describe, it, expect } from 'vitest';
import { isActionableSignal, selectActiveActionableSignals, countActiveActionableSignals } from './signalFilters';
import { OperationalSignal } from '../../types';

describe('signalFilters', () => {
  const s1 = { status: 'active', severity: 'critical', signalType: 'budget' } as OperationalSignal;
  const s2 = { status: 'active', severity: 'warning', signalType: 'budget' } as OperationalSignal;
  const s3 = { status: 'active', severity: 'good', signalType: 'budget' } as OperationalSignal;
  const s4 = { status: 'resolved', severity: 'critical', signalType: 'budget' } as OperationalSignal;
  const s5 = { status: 'dismissed', severity: 'critical', signalType: 'budget' } as OperationalSignal;
  const s6 = { status: 'active', severity: 'info', signalType: 'all_clear' } as OperationalSignal;

  it('identifies actionable signals correctly', () => {
    expect(isActionableSignal(s1)).toBe(true);
    expect(isActionableSignal(s2)).toBe(true);
    expect(isActionableSignal(s3)).toBe(false); // good
    expect(isActionableSignal(s4)).toBe(false); // resolved
    expect(isActionableSignal(s5)).toBe(false); // dismissed
    expect(isActionableSignal(s6)).toBe(false); // all_clear
  });

  it('selects and counts actionable signals', () => {
    const list = [s1, s2, s3, s4, s5, s6];
    const filtered = selectActiveActionableSignals(list);
    expect(filtered.length).toBe(2);
    expect(countActiveActionableSignals(list)).toBe(2);
    expect(countActiveActionableSignals(undefined)).toBe(0);
  });
});
