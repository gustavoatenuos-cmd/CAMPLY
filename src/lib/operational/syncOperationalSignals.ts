import type { AgentAlert } from '../../types';

function comparable(signal: AgentAlert): string {
  return JSON.stringify({
    id: signal.id,
    relatedEntityId: signal.relatedEntityId,
    relatedEntityType: signal.relatedEntityType,
    clientId: signal.clientId,
    title: signal.title,
    message: signal.message,
    severity: signal.severity,
    status: signal.status,
    suggestedAction: signal.suggestedAction,
    readAt: signal.readAt,
  });
}

/**
 * Reconciles deterministic operational signals with their previous lifecycle.
 *
 * Stable ids are the deduplication contract. A dismissed signal stays dismissed
 * while the condition is still true. A signal that disappears is retained as
 * resolved for history instead of being recreated on every render.
 */
export function syncOperationalSignals(
  current: AgentAlert[] = [],
  evaluated: AgentAlert[] = [],
  now = new Date()
): AgentAlert[] {
  const evaluatedById = new Map(evaluated.map((signal) => [signal.id, signal]));
  const currentById = new Map(current.map((signal) => [signal.id, signal]));
  const result: AgentAlert[] = [];
  const nowIso = now.toISOString();

  for (const next of evaluated) {
    const previous = currentById.get(next.id);
    if (!previous) {
      result.push(next);
      continue;
    }

    result.push({
      ...next,
      triggeredAt: previous.triggeredAt || next.triggeredAt,
      readAt: previous.readAt,
      status: previous.status === 'dismissed' ? 'dismissed' : 'active',
    });
  }

  for (const previous of current) {
    if (evaluatedById.has(previous.id)) continue;
    if (previous.status === 'resolved') {
      result.push(previous);
      continue;
    }
    result.push({
      ...previous,
      status: 'resolved',
      readAt: previous.readAt || nowIso,
    });
  }

  // Avoid propagating a new workspace object when nothing material changed.
  if (
    result.length === current.length
    && result.every((signal, index) => comparable(signal) === comparable(current[index]))
  ) {
    return current;
  }

  return result;
}

export function reconcileOperationalSignals(data: { agentAlerts: AgentAlert[] }, evaluated: AgentAlert[]) {
  const agentAlerts = syncOperationalSignals(data.agentAlerts, evaluated);
  return agentAlerts === data.agentAlerts ? data : { ...data, agentAlerts };
}
