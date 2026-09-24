import type { AgentAlert, CamplyData, EntityType, SeverityLevel } from '../../types';

interface RuleConfig {
  enabled: boolean;
  severity: SeverityLevel;
  threshold?: number;
}

function resolveRule(
  data: CamplyData,
  entityType: EntityType,
  conditionType: 'deadline_today' | 'overdue' | 'idle_days' | 'attention_required' | 'many_pending',
  defaults: Omit<RuleConfig, 'enabled'> & { enabled?: boolean }
): RuleConfig {
  const override = data.agentRules.find(
    (rule) => rule.entityType === entityType && rule.conditionType === conditionType
  );
  return {
    enabled: override?.enabled ?? defaults.enabled ?? true,
    severity: override?.severity ?? defaults.severity,
    threshold: override?.thresholdValue ?? defaults.threshold,
  };
}

function normalizeDate(value: string | Date): Date | null {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysBetween(from: string | Date, to: string | Date): number | null {
  const start = normalizeDate(from);
  const end = normalizeDate(to);
  if (!start || !end) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

function signalId(signalType: string, entityId: string, clientId?: string): string {
  return `signal:${clientId || 'global'}:${signalType}:${entityId}`;
}

function makeSignal(input: {
  signalType: string;
  entityId: string;
  entityType: EntityType;
  clientId?: string;
  title: string;
  message: string;
  severity: SeverityLevel;
  suggestedAction?: string;
  nowIso: string;
}): AgentAlert {
  return {
    id: signalId(input.signalType, input.entityId, input.clientId),
    relatedEntityId: input.entityId,
    relatedEntityType: input.entityType,
    clientId: input.clientId,
    title: input.title,
    message: input.message,
    severity: input.severity,
    status: 'active',
    suggestedAction: input.suggestedAction,
    triggeredAt: input.nowIso,
  };
}

/**
 * Canonical evaluator for workspace/operational facts only.
 *
 * Media performance is intentionally excluded. Spend, CPR, CPA, ROAS, pacing and
 * other Meta-derived decisions belong to the trusted Analytics contract, where
 * data quality, period coverage and objective-aware metrics are available.
 */
export function evaluateOperationalSignals(data: CamplyData, now = new Date()): AgentAlert[] {
  const signals: AgentAlert[] = [];
  const nowIso = now.toISOString();

  const taskOverdue = resolveRule(data, 'task', 'overdue', { severity: 'critical' });
  const taskToday = resolveRule(data, 'task', 'deadline_today', { severity: 'warning' });

  for (const task of data.tasks) {
    if (task.done || !task.dueDate) continue;
    const distance = daysBetween(now, task.dueDate);
    if (distance === null) continue;

    if (distance < 0 && taskOverdue.enabled) {
      signals.push(makeSignal({
        signalType: 'task_overdue',
        entityId: task.id,
        entityType: 'task',
        clientId: task.clientId,
        title: 'Tarefa atrasada',
        message: `A tarefa “${task.title}” está atrasada há ${Math.abs(distance)} dia(s).`,
        severity: taskOverdue.severity,
        suggestedAction: 'Concluir ou reagendar a tarefa.',
        nowIso,
      }));
    } else if (distance === 0 && taskToday.enabled) {
      signals.push(makeSignal({
        signalType: 'task_deadline_today',
        entityId: task.id,
        entityType: 'task',
        clientId: task.clientId,
        title: 'Vence hoje',
        message: `A tarefa “${task.title}” vence hoje.`,
        severity: taskToday.severity,
        suggestedAction: 'Priorizar a execução desta tarefa hoje.',
        nowIso,
      }));
    }
  }

  const projectOverdue = resolveRule(data, 'project', 'overdue', { severity: 'critical' });
  const projectToday = resolveRule(data, 'project', 'deadline_today', { severity: 'warning' });
  const projectIdle = resolveRule(data, 'project', 'idle_days', { severity: 'warning', threshold: 7 });

  for (const project of data.projects) {
    if (project.status === 'done' || project.status === 'archived') continue;
    const recurring = project.projectType === 'traffic' || project.billingType === 'recurring';

    if (!recurring && project.dueDate) {
      const distance = daysBetween(now, project.dueDate);
      if (distance !== null && distance < 0 && projectOverdue.enabled) {
        signals.push(makeSignal({
          signalType: 'project_overdue',
          entityId: project.id,
          entityType: 'project',
          clientId: project.clientId,
          title: 'Projeto atrasado',
          message: `O projeto “${project.name}” passou do prazo há ${Math.abs(distance)} dia(s).`,
          severity: projectOverdue.severity,
          suggestedAction: 'Revisar cronograma e alinhar a próxima entrega.',
          nowIso,
        }));
      } else if (distance === 0 && projectToday.enabled) {
        signals.push(makeSignal({
          signalType: 'project_deadline_today',
          entityId: project.id,
          entityType: 'project',
          clientId: project.clientId,
          title: 'Entrega hoje',
          message: `A entrega do projeto “${project.name}” é hoje.`,
          severity: projectToday.severity,
          suggestedAction: 'Finalizar pendências e preparar a entrega.',
          nowIso,
        }));
      }
    }

    if (project.lastActivityAt && project.status !== 'waiting' && projectIdle.enabled) {
      const idleDays = daysBetween(project.lastActivityAt, now);
      const limit = projectIdle.threshold ?? 7;
      if (idleDays !== null && idleDays >= limit) {
        signals.push(makeSignal({
          signalType: 'project_idle',
          entityId: project.id,
          entityType: 'project',
          clientId: project.clientId,
          title: 'Projeto parado',
          message: `O projeto “${project.name}” está sem atualização há ${idleDays} dia(s).`,
          severity: projectIdle.severity,
          suggestedAction: 'Atualizar o andamento ou contatar o cliente.',
          nowIso,
        }));
      }
    }
  }

  // Campaign workspace data is used only for maintenance cadence. Media
  // performance decisions (including budget consumption and CPR) are forbidden
  // here because those fields can be manual/stale and do not carry Meta quality.
  const campaignIdle = resolveRule(data, 'campaign', 'idle_days', { severity: 'warning', threshold: 3 });
  for (const campaign of data.campaigns) {
    if (!['live', 'optimize'].includes(campaign.status) || !campaignIdle.enabled) continue;
    const reference = campaign.lastOptimizedAt || campaign.createdAt;
    if (!reference) continue;
    const idleDays = daysBetween(reference, now);
    const limit = campaignIdle.threshold ?? 3;
    if (idleDays !== null && idleDays >= limit) {
      signals.push(makeSignal({
        signalType: 'campaign_optimization_idle',
        entityId: campaign.id,
        entityType: 'campaign',
        clientId: campaign.clientId,
        title: 'Campanha sem revisão operacional',
        message: `“${campaign.name}” está há ${idleDays} dia(s) sem otimização registrada no CAMPLY.`,
        severity: campaignIdle.severity,
        suggestedAction: campaign.nextAction || 'Revisar no Analytics e registrar a próxima ação.',
        nowIso,
      }));
    }
  }

  // Receivables use a client-related alert for backward compatibility with the
  // current persisted AgentAlert contract. The stable signal id still includes
  // the receivable id, so multiple charges do not collide.
  for (const item of data.receivables) {
    if (!item.dueDate) continue;
    const client = data.clients.find((candidate) => candidate.id === item.clientId);
    const distance = daysBetween(now, item.dueDate);
    if (distance === null) continue;

    if (item.status === 'overdue' || (item.status === 'pending' && distance < 0)) {
      signals.push(makeSignal({
        signalType: 'receivable_overdue',
        entityId: item.id,
        entityType: 'client',
        clientId: item.clientId,
        title: `Pagamento atrasado: ${client?.name || 'cliente'}`,
        message: `${item.description} está vencido há ${Math.abs(distance)} dia(s).`,
        severity: 'critical',
        suggestedAction: 'Enviar cobrança e registrar o retorno.',
        nowIso,
      }));
    } else if (item.status === 'pending' && distance >= 0 && distance <= 3) {
      signals.push(makeSignal({
        signalType: 'receivable_upcoming',
        entityId: item.id,
        entityType: 'client',
        clientId: item.clientId,
        title: `Pagamento próximo: ${client?.name || 'cliente'}`,
        message: `${item.description} vence em ${distance} dia(s).`,
        severity: 'warning',
        suggestedAction: 'Preparar lembrete de cobrança.',
        nowIso,
      }));
    }
  }

  const manyPending = resolveRule(data, 'client', 'many_pending', { severity: 'critical', threshold: 3 });
  if (manyPending.enabled) {
    for (const client of data.clients) {
      if (client.status !== 'active') continue;
      const criticalCount = signals.filter(
        (signal) => signal.clientId === client.id && signal.severity === 'critical'
      ).length;
      const limit = manyPending.threshold ?? 3;
      if (criticalCount >= limit) {
        signals.push(makeSignal({
          signalType: 'client_many_critical_pending',
          entityId: client.id,
          entityType: 'client',
          clientId: client.id,
          title: 'Atenção crítica',
          message: `${client.name} possui ${criticalCount} pendência(s) críticas operacionais.`,
          severity: manyPending.severity,
          suggestedAction: 'Priorizar uma força-tarefa para reduzir as pendências.',
          nowIso,
        }));
      }
    }
  }

  return signals;
}
