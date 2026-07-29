import { CamplyData, OperationalSignal, EntityType, SeverityLevel, SignalSourceDomain, SignalType, OperationalEvidence } from '../../types';
import { makeId } from '../../data/camplyStore';
import { operationalRuleRegistry, resolveRuleConfiguration } from './operationalRuleRegistry';

// Helper to calculate days between dates
function daysBetween(date1: string | Date, date2: string | Date): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function evaluateOperationalSignals(data: CamplyData): OperationalSignal[] {
  const signals: OperationalSignal[] = [];
  const today = new Date();
  const todayIso = today.toISOString();

  const addSignal = (
    relatedEntityId: string,
    relatedEntityType: EntityType,
    clientId: string | undefined,
    signalType: SignalType,
    sourceDomain: SignalSourceDomain,
    title: string,
    message: string,
    evidence: OperationalEvidence[],
    severity: SeverityLevel,
    suggestedAction?: string
  ) => {
    const deduplicationKey = `${clientId || 'global'}_${signalType}_${relatedEntityId}`;
    
    signals.push({
      id: makeId('signal'),
      signalType,
      sourceDomain,
      relatedEntityId,
      relatedEntityType,
      clientId,
      title,
      message,
      evidence,
      severity,
      status: 'active',
      suggestedAction,
      deduplicationKey,
      triggeredAt: todayIso,
      lastDetectedAt: todayIso,
      occurrenceCount: 1,
    });
  };

  // ==========================================
  // RULES FROM agentEngine (Tasks)
  // ==========================================
  const taskOverdueConfig = resolveRuleConfiguration(operationalRuleRegistry.task_overdue, data.agentRules);
  const taskTodayConfig = resolveRuleConfiguration(operationalRuleRegistry.task_deadline_today, data.agentRules);

  data.tasks.forEach((task) => {
    if (task.done) return;
    
    if (task.dueDate) {
      const days = daysBetween(todayIso, task.dueDate);
      
      if (days < 0 && taskOverdueConfig.enabled) {
        addSignal(
          task.id, 'task', task.clientId, 'tarefa_atrasada', 'tasks', 'Tarefa Atrasada',
          `A tarefa "${task.title}" está atrasada.`,
          [{ key: 'days_overdue', label: 'Dias Atraso', value: Math.abs(days), source: 'local', quality: 'computed', observedAt: todayIso }],
          taskOverdueConfig.severity, 'Concluir ou reagendar a tarefa.'
        );
      } else if (days === 0 && taskTodayConfig.enabled) {
        addSignal(
          task.id, 'task', task.clientId, 'tarefa_hoje', 'tasks', 'Vence Hoje',
          `A tarefa "${task.title}" vence hoje.`,
          [{ key: 'due_date', label: 'Vencimento', value: task.dueDate, source: 'local', quality: 'computed', observedAt: todayIso }],
          taskTodayConfig.severity, 'Priorizar a execução desta tarefa hoje.'
        );
      }
    }
  });

  // ==========================================
  // RULES FROM agentEngine (Projects)
  // ==========================================
  const projectOverdueConfig = resolveRuleConfiguration(operationalRuleRegistry.project_overdue, data.agentRules);
  const projectTodayConfig = resolveRuleConfiguration(operationalRuleRegistry.project_deadline_today, data.agentRules);
  const projectIdleConfig = resolveRuleConfiguration(operationalRuleRegistry.project_idle_days, data.agentRules);

  data.projects.forEach((project) => {
    if (project.status === 'done') return;
    
    // Alertas de atraso para projetos não recorrentes
    if (project.projectType !== 'traffic' && project.billingType !== 'recurring') {
      if (project.dueDate) {
        const days = daysBetween(todayIso, project.dueDate);
        
        if (days < 0 && projectOverdueConfig.enabled) {
          addSignal(
            project.id, 'project', project.clientId, 'projeto_atrasado', 'projects', 'Projeto Atrasado',
            `O projeto "${project.name}" passou do prazo.`,
            [{ key: 'days_overdue', label: 'Dias Atraso', value: Math.abs(days), source: 'local', quality: 'computed', observedAt: todayIso }],
            projectOverdueConfig.severity, 'Revisar cronograma e alinhar com o cliente.'
          );
        } else if (days === 0 && projectTodayConfig.enabled) {
          addSignal(
            project.id, 'project', project.clientId, 'projeto_entrega_hoje', 'projects', 'Entrega Hoje',
            `A entrega do projeto "${project.name}" é hoje.`,
            [{ key: 'due_date', label: 'Vencimento', value: project.dueDate, source: 'local', quality: 'computed', observedAt: todayIso }],
            projectTodayConfig.severity, 'Finalizar pendências e preparar entrega.'
          );
        } else if (days <= 7 && days > 0) {
          // Warning within 7 days
          addSignal(
            project.id, 'project', project.clientId, 'projeto_foco', 'projects', `Projeto em foco: ${project.name}`,
            `Prazo em ${project.dueDate} com ${project.progress}% de progresso.`,
            [
              { key: 'days_until_due', label: 'Dias Restantes', value: days, source: 'local', quality: 'computed', observedAt: todayIso },
              { key: 'progress', label: 'Progresso', value: `${project.progress}%`, source: 'local', quality: 'computed', observedAt: todayIso }
            ],
            'warning', project.nextAction
          );
        }
      }

      if (project.lastActivityAt && projectIdleConfig.enabled) {
        const idleDays = daysBetween(project.lastActivityAt, todayIso);
        const limit = projectIdleConfig.threshold || 7;
        if (idleDays >= limit && project.status !== 'waiting') {
          addSignal(
            project.id, 'project', project.clientId, 'projeto_parado', 'projects', 'Projeto Parado',
            `Projeto sem atualizações há mais de ${limit} dias.`,
            [{ key: 'idle_days', label: 'Dias Parado', value: idleDays, source: 'local', quality: 'computed', observedAt: todayIso }],
            projectIdleConfig.severity, 'Atualizar o andamento ou contatar o cliente.'
          );
        }
      }
    }
  });

  // ==========================================
  // RULES FROM buildInsights + agentEngine (Campaigns)
  // ==========================================
  const campaignIdleConfig = resolveRuleConfiguration(operationalRuleRegistry.campaign_idle_days, data.agentRules);
  const campaignBudgetConfig = resolveRuleConfiguration(operationalRuleRegistry.campaign_budget_consumption, data.agentRules);
  const campaignHighCostConfig = resolveRuleConfiguration(operationalRuleRegistry.campaign_high_cost, data.agentRules);

  data.campaigns.forEach((campaign) => {
    const client = data.clients.find((item) => item.id === campaign.clientId);
    const refDate = campaign.lastOptimizedAt || campaign.createdAt;
    
    if (['live', 'optimize'].includes(campaign.status)) {
      if (refDate && campaignIdleConfig.enabled) {
        const idleDays = daysBetween(refDate, todayIso);
        const limit = campaignIdleConfig.threshold || 3;
        if (idleDays >= limit) {
          addSignal(
            campaign.id, 'campaign', campaign.clientId, 'campanha_parada', 'campaigns', 'Campanha Parada',
            `Campanha sem otimização há ${idleDays} dias.`,
            [{ key: 'idle_days', label: 'Dias Sem Otimizar', value: idleDays, source: 'local', quality: 'computed', observedAt: todayIso }],
            campaignIdleConfig.severity, campaign.nextAction || 'Analisar métricas e registrar otimização.'
          );
        }
      }
    }

    if (campaignBudgetConfig.enabled && campaign.budget > 0) {
      const pct = (campaign.spent / campaign.budget) * 100;
      const warnThreshold = campaignBudgetConfig.threshold || 70;
      
      if (pct >= 90 && !['paused', 'setup'].includes(campaign.status)) {
        addSignal(
          campaign.id, 'campaign', campaign.clientId, 'operational_budget_consumption', 'campaigns', 'Budget Esgotando',
          `${campaign.name} consumiu ${pct.toFixed(0)}% do budget.`,
          [{ key: 'consumption_pct', label: 'Consumo', value: pct.toFixed(1), source: 'local', quality: 'computed', observedAt: todayIso }],
          'critical', 'Revisar orçamento ou pausar campanha'
        );
      } else if (pct >= warnThreshold && !['paused', 'setup'].includes(campaign.status)) {
        addSignal(
          campaign.id, 'campaign', campaign.clientId, 'operational_budget_consumption', 'campaigns', 'Budget Alto',
          `${campaign.name} já consumiu ${pct.toFixed(0)}% do budget.`,
          [{ key: 'consumption_pct', label: 'Consumo', value: pct.toFixed(1), source: 'local', quality: 'computed', observedAt: todayIso }],
          campaignBudgetConfig.severity, 'Monitorar consumo e ajustar se necessário'
        );
      }
    }

    if (campaignHighCostConfig.enabled && campaign.cpr !== undefined && client?.benchmarks?.cpr) {
      const ratio = campaign.cpr / client.benchmarks.cpr;
      if (ratio > 2) {
        addSignal(
          campaign.id, 'campaign', campaign.clientId, 'high_cost', 'campaigns', 'Custo por resultado alto',
          `${campaign.name}: CPR acima do benchmark`,
          [
            { key: 'current_cpr', label: 'CPR Atual', value: campaign.cpr, source: 'local', quality: 'computed', observedAt: todayIso },
            { key: 'benchmark_cpr', label: 'Benchmark', value: client.benchmarks.cpr, source: 'local', quality: 'computed', observedAt: todayIso }
          ],
          campaignHighCostConfig.severity, 'Revisar criativos e segmentação'
        );
      }
    }
  });

  // ==========================================
  // RULES FROM buildInsights (Receivables)
  // ==========================================
  const recOverdueConfig = resolveRuleConfiguration(operationalRuleRegistry.receivable_overdue, data.agentRules);
  const recUpcomingConfig = resolveRuleConfiguration(operationalRuleRegistry.receivable_upcoming, data.agentRules);

  data.receivables.forEach((item) => {
    const client = data.clients.find((clientItem) => clientItem.id === item.clientId);
    const distance = daysBetween(todayIso, item.dueDate);

    if (item.status === 'overdue' && recOverdueConfig.enabled) {
      addSignal(
        item.id, 'receivable', item.clientId, 'pagamento_atrasado', 'receivables', `Pagamento atrasado: ${client?.name || 'Desconhecido'}`,
        `${item.description} de ${item.amount} venceu há ${Math.abs(distance)} dias.`,
        [
          { key: 'days_overdue', label: 'Dias Atraso', value: Math.abs(distance), source: 'local', quality: 'computed', observedAt: todayIso },
          { key: 'amount', label: 'Valor', value: item.amount, source: 'local', quality: 'manual', observedAt: todayIso }
        ],
        recOverdueConfig.severity, 'Enviar cobrança e registrar retorno.'
      );
    } else if (item.status === 'pending' && distance >= 0 && distance <= (recUpcomingConfig.threshold || 3) && recUpcomingConfig.enabled) {
      addSignal(
        item.id, 'receivable', item.clientId, 'pagamento_proximo', 'receivables', `Pagamento próximo: ${client?.name || 'Desconhecido'}`,
        `${item.description} de ${item.amount} vence em ${distance} dias.`,
        [
          { key: 'days_until_due', label: 'Dias Restantes', value: distance, source: 'local', quality: 'computed', observedAt: todayIso },
          { key: 'amount', label: 'Valor', value: item.amount, source: 'local', quality: 'manual', observedAt: todayIso }
        ],
        recUpcomingConfig.severity, 'Preparar lembrete de cobrança.'
      );
    }
  });

  // ==========================================
  // RULES FROM agentEngine (Client Priorities)
  // ==========================================
  const clientPendingConfig = resolveRuleConfiguration(operationalRuleRegistry.client_many_pending, data.agentRules);

  if (clientPendingConfig.enabled) {
    data.clients.forEach((client) => {
      if (client.status !== 'active') return;

      const criticalCount = signals.filter(a => a.clientId === client.id && a.severity === 'critical').length;
      const limit = clientPendingConfig.threshold || 3;
      if (criticalCount >= limit) {
        addSignal(
          client.id, 'client', client.id, 'atencao_critica', 'system', 'Atenção Crítica',
          `O cliente possui ${criticalCount} pendências críticas acumuladas.`,
          [{ key: 'critical_count', label: 'Pendências Críticas', value: criticalCount, source: 'system', quality: 'computed', observedAt: todayIso }],
          clientPendingConfig.severity, 'Realizar força-tarefa para resolver pendências.'
        );
      }
    });
  }

  return signals;
}
