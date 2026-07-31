import { OperationalSignal } from '../../types';

export function dismissOperationalSignal(
  signal: OperationalSignal,
  dismissedAt: string
): OperationalSignal {
  if (signal.status === 'resolved' || signal.status === 'dismissed') {
    return signal;
  }

  return {
    ...signal,
    status: 'dismissed',
    dismissedAt,
    resolvedAt: undefined
  };
}
