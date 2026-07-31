import { OperationalSignal } from '../../types';

export function normalizeOperationalSignal(legacy: any, now: string): OperationalSignal {
  let triggeredAt = legacy.triggeredAt;
  let lastDetectedAt = legacy.lastDetectedAt;

  if (!triggeredAt) {
    triggeredAt = lastDetectedAt || now;
  }
  if (!lastDetectedAt) {
    lastDetectedAt = triggeredAt || now;
  }

  let occurrenceCount = legacy.occurrenceCount;
  if (typeof occurrenceCount !== 'number' || occurrenceCount <= 0 || isNaN(occurrenceCount)) {
    occurrenceCount = 1;
  }

  let status = legacy.status || 'active';
  let resolvedAt = legacy.resolvedAt;
  let dismissedAt = legacy.dismissedAt;

  if (status === 'active') {
    resolvedAt = undefined;
  } else if (status === 'resolved' && !resolvedAt) {
    resolvedAt = lastDetectedAt || triggeredAt || now;
  } else if (status === 'dismissed' && !dismissedAt) {
    dismissedAt = lastDetectedAt || triggeredAt || now;
  }

  return {
    ...legacy,
    triggeredAt,
    lastDetectedAt,
    occurrenceCount,
    status,
    resolvedAt,
    dismissedAt
  };
}

export interface OperationalSignalValidationResult {
  valid: boolean;
  issues: string[];
}

export function validateOperationalSignal(signal: OperationalSignal): OperationalSignalValidationResult {
  const issues: string[] = [];
  
  if (signal.status === 'active' && signal.resolvedAt) issues.push('active com resolvedAt');
  if (signal.status === 'resolved' && !signal.resolvedAt) issues.push('resolved sem resolvedAt');
  if (signal.status === 'dismissed' && !signal.dismissedAt) issues.push('dismissed sem dismissedAt');
  if (signal.occurrenceCount < 1) issues.push('occurrenceCount menor que 1');
  if (!signal.lastDetectedAt) issues.push('lastDetectedAt ausente');
  if (signal.occurrenceCount === 1 && (!signal.evidence || signal.evidence.length === 0)) issues.push('evidence vazio em novo sinal');

  return { valid: issues.length === 0, issues };
}
