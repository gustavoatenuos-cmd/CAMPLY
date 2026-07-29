import { OperationalSignal } from '../../types';

export function syncOperationalSignals(
  currentState: OperationalSignal[],
  evaluatedSignals: OperationalSignal[]
): OperationalSignal[] {
  const evaluatedMap = new Map<string, OperationalSignal>();
  evaluatedSignals.forEach((signal) => {
    evaluatedMap.set(signal.deduplicationKey, signal);
  });

  const nextState: OperationalSignal[] = [];

  // Process existing signals
  for (const existing of currentState) {
    const isEvaluated = evaluatedMap.has(existing.deduplicationKey);

    if (existing.status === 'dismissed') {
      // Keep dismissed signals, even if they are still evaluated as active
      nextState.push(existing);
    } else if (existing.status === 'resolved') {
      // If a resolved signal comes back, we might want to re-activate it.
      // But usually 'resolved' means the condition went away. If the condition comes back, it's a new issue.
      if (isEvaluated) {
        // Re-activate
        const evaluated = evaluatedMap.get(existing.deduplicationKey)!;
        nextState.push({
          ...existing,
          status: 'active',
          // Update details from evaluation
          title: evaluated.title,
          message: evaluated.message,
          severity: evaluated.severity,
          suggestedAction: evaluated.suggestedAction,
          triggeredAt: new Date().toISOString(), // new trigger time
        });
      } else {
        // Stay resolved
        nextState.push(existing);
      }
    } else if (existing.status === 'active') {
      if (isEvaluated) {
        // Still active, update details if needed
        const evaluated = evaluatedMap.get(existing.deduplicationKey)!;
        nextState.push({
          ...existing,
          title: evaluated.title,
          message: evaluated.message,
          severity: evaluated.severity,
          suggestedAction: evaluated.suggestedAction,
        });
      } else {
        // No longer evaluated -> resolved
        nextState.push({
          ...existing,
          status: 'resolved',
        });
      }
    }
  }

  // Add new evaluated signals that didn't exist before
  for (const evaluated of evaluatedSignals) {
    const exists = currentState.some((s) => s.deduplicationKey === evaluated.deduplicationKey);
    if (!exists) {
      nextState.push(evaluated);
    }
  }

  return nextState;
}
