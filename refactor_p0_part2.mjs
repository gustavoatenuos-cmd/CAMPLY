import fs from 'fs';

// normalizeOperationalSignal.ts
const normalizeCode = `import { OperationalSignal } from '../types';

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
`;
fs.writeFileSync('src/lib/operational/normalizeOperationalSignal.ts', normalizeCode);

// dismissOperationalSignal.ts
const dismissCode = `import { OperationalSignal } from '../types';

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
`;
fs.writeFileSync('src/lib/operational/dismissOperationalSignal.ts', dismissCode);

// syncOperationalSignals.ts
const syncCode = `import { OperationalSignal } from '../types';
import { normalizeOperationalSignal, validateOperationalSignal } from './normalizeOperationalSignal';

export interface OperationalSignalTransition {
  signalId: string;
  deduplicationKey: string;
  previousStatus: string;
  newStatus: string;
  occurredAt: string;
  occurrenceCount: number;
}

export interface OperationalSignalSyncResult {
  signals: OperationalSignal[];
  transitions: OperationalSignalTransition[];
}

export function syncOperationalSignals(
  currentState: OperationalSignal[],
  evaluatedSignals: OperationalSignal[],
  options?: { now?: string }
): OperationalSignalSyncResult {
  const now = options?.now ?? new Date().toISOString();
  const transitions: OperationalSignalTransition[] = [];
  
  const currentMap = new Map<string, OperationalSignal>();
  for (const c of currentState) {
    currentMap.set(c.deduplicationKey, normalizeOperationalSignal(c, now));
  }

  const newSignals: OperationalSignal[] = [];

  for (const evaluated of evaluatedSignals) {
    const existing = currentMap.get(evaluated.deduplicationKey);
    
    if (existing) {
      currentMap.delete(existing.deduplicationKey);

      if (existing.status === 'active' || existing.status === 'resolved') {
        const isReactivating = existing.status === 'resolved';
        if (isReactivating) {
          transitions.push({
            signalId: existing.id,
            deduplicationKey: existing.deduplicationKey,
            previousStatus: 'resolved',
            newStatus: 'active',
            occurredAt: now,
            occurrenceCount: existing.occurrenceCount + 1
          });
        }
        newSignals.push({
          ...existing,
          title: evaluated.title,
          message: evaluated.message,
          evidence: evaluated.evidence,
          severity: evaluated.severity,
          suggestedAction: evaluated.suggestedAction,
          status: 'active',
          lastDetectedAt: now,
          resolvedAt: undefined,
          dismissedAt: undefined,
          occurrenceCount: isReactivating ? existing.occurrenceCount + 1 : existing.occurrenceCount
        });
      } else if (existing.status === 'dismissed') {
        newSignals.push({
          ...existing,
          title: evaluated.title,
          message: evaluated.message,
          evidence: evaluated.evidence,
          severity: evaluated.severity,
          suggestedAction: evaluated.suggestedAction,
          lastDetectedAt: now
        });
      }
    } else {
      const newSignal = {
        ...evaluated,
        status: 'active' as const,
        triggeredAt: now,
        lastDetectedAt: now,
        occurrenceCount: 1,
        resolvedAt: undefined,
        dismissedAt: undefined
      };
      
      const validation = validateOperationalSignal(newSignal);
      if (validation.valid) {
        newSignals.push(newSignal);
      }
    }
  }

  for (const remaining of currentMap.values()) {
    if (remaining.status === 'active') {
      transitions.push({
        signalId: remaining.id,
        deduplicationKey: remaining.deduplicationKey,
        previousStatus: 'active',
        newStatus: 'resolved',
        occurredAt: now,
        occurrenceCount: remaining.occurrenceCount
      });
      newSignals.push({
        ...remaining,
        status: 'resolved',
        resolvedAt: now
      });
    } else if (remaining.status === 'dismissed') {
      transitions.push({
        signalId: remaining.id,
        deduplicationKey: remaining.deduplicationKey,
        previousStatus: 'dismissed',
        newStatus: 'resolved',
        occurredAt: now,
        occurrenceCount: remaining.occurrenceCount
      });
      newSignals.push({
        ...remaining,
        status: 'resolved',
        resolvedAt: now
      });
    } else {
      newSignals.push(remaining);
    }
  }

  return { signals: newSignals, transitions };
}
`;
fs.writeFileSync('src/lib/operational/syncOperationalSignals.ts', syncCode);

