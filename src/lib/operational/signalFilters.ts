import { OperationalSignal } from '../../types';

export function isActionableSignal(signal: OperationalSignal): boolean {
  return signal.status === 'active' && signal.signalType !== 'all_clear';
}

export function selectActiveActionableSignals(signals: OperationalSignal[] | undefined): OperationalSignal[] {
  if (!signals) return [];
  return signals.filter(isActionableSignal);
}

export function countActiveActionableSignals(signals: OperationalSignal[] | undefined): number {
  return selectActiveActionableSignals(signals).length;
}
