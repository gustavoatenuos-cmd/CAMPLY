import { CamplyData, OperationalSignal, EntityType, SeverityLevel, SignalSourceDomain, SignalType } from '../../types';
import { makeId } from '../../data/camplyStore';

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
      severity,
      status: 'active',
      suggestedAction,
      deduplicationKey,
      triggeredAt: todayIso,
    });
  };

  // ==========================================
  // RULES FROM agentEngine (Tasks)
  // ==========================================
  data.tasks.forEach((task) => {
    if (task.done) return;
    
    if (task.dueDate) {
      const days = daysBetween(todayIso, task.dueDate);
      if (days < 0) {
        addSignal(task.id, 'task', task.clientId, 'tarefa_atrasada', 'tasks', 'Tarefa Atrasada', `A tarefa "${task.title}" está atrasada.`, 'critical', 'Concluir ou reagendar a tarefa.');
      } else if (days === 0) {
        addSignal(task.id, 'task', task.clientId, 'tarefa_hoje', 'tasks', 'Vence Hoje', `A tarefa "${task.title}" vence hoje.`, 'warning', 'Priorizar a execução desta tarefa hoje.');
      }
    }
  });

  // ==========================================
  // RULES FROM agentEngine (Projects)
  // ==========================================
  data.projects.forEach((project) => {
    if (project.status === 'done') return;
    
    // Alertas de atraso para projetos não recorrentes
    if (project.projectType !== 'traffic' && project.billingType !== 'recurring') {
      if (project.dueDate) {
        const days = daysBetween(todayIso, project.dueDate);
        if (days < 0) {
          addSignal(project.id, 'project', project.clientId, 'projeto_atrasado', 'projects', 'Projeto Atrasado', `O projeto "${project.name}" passou do prazo.`, 'critical', 'Revisar cronograma e alinhar com o cliente.');
        } else if (days === 0) {
          addSignal(project.id, 'project', project.clientId, 'projeto_entrega_hoje', 'projects', 'Entrega Hoje', `A entrega do projeto "${project.name}" é hoje.`, 'warning', 'Finalizar pendências e preparar entrega.');
        } else if (days <= 7 && days > 0) {
          // Ex-buildInsights alert for projects due soon
          addSignal(project.id, 'project', project.clientId, 'projeto_foco', 'projects', `Projeto em foco: ${project.name}`, `Prazo em ${project.dueDate} com ${project.progress}% de progresso.`, 'warning', project.nextAction); // 'warning' used to be 'info', adapting to valid SeverityLevel
        }
      }

      if (project.lastActivityAt) {
        const idleDays = daysBetween(project.lastActivityAt, todayIso);
        if (idleDays > 7 && project.status !== 'waiting') {
          addSignal(project.id, 'project', project.clientId, 'projeto_parado', 'projects', 'Projeto Parado', `Projeto sem atualizações há mais de 7 dias.`, 'warning', 'Atualizar o andamento ou contatar o cliente.');
        }
      }
    }
  });

  // ==========================================
  // RULES FROM buildInsights + agentEngine (Campaigns)
  // ==========================================
  data.campaigns.forEach((campaign) => {
    const client = data.clients.find((item) => item.id === campaign.clientId);
    const refDate = campaign.lastOptimizedAt || campaign.createdAt;
    
    // Idle campaign check (combining >= 4 and >= 3 days logic into one standard >= 4 from buildInsights, or using >= 3 from agentEngine. Let's use >= 3 from agentEngine which is more strict).
    if (['live', 'optimize'].includes(campaign.status)) {
      if (refDate) {
        const idleDays = daysBetween(refDate, todayIso);
        if (idleDays >= 3) {
          addSignal(campaign.id, 'campaign', campaign.clientId, 'campanha_parada', 'campaigns', 'Campanha Parada', `Campanha sem otimização há ${idleDays} dias.`, 'warning', campaign.nextAction || 'Analisar métricas e registrar otimização.');
        }
      }
    }

    // Budget check (Manual)
    const spentRate = campaign.budget ? campaign.spent / campaign.budget : 0;
    if (!campaign.metaCampaignId && spentRate >= 0.8 && campaign.spent > 0) {
      addSignal(campaign.id, 'campaign', campaign.clientId, 'verba_operacional_critica', 'campaigns', `${campaign.name} está perto do limite de verba (Manual)`, `${client?.name ?? 'Cliente'} já consumiu ${Math.round(spentRate * 100)}% da verba operacional cadastrada.`, 'critical', 'Verifique se os dados estão atualizados ou aumente o limite de verba.');
    }
  });

  // ==========================================
  // RULES FROM buildInsights (Receivables)
  // ==========================================
  data.receivables.forEach((item) => {
    const client = data.clients.find((clientItem) => clientItem.id === item.clientId);
    const distance = daysBetween(todayIso, item.dueDate);

    if (item.status === 'overdue' || (item.status === 'pending' && distance <= 3)) {
      addSignal(item.id, 'receivable', item.clientId, item.status === 'overdue' ? 'pagamento_atrasado' : 'pagamento_proximo', 'receivables', item.status === 'overdue' ? `Pagamento atrasado: ${client?.name}` : `Pagamento próximo: ${client?.name}`, `${item.description} de ${item.amount} vence${distance < 0 ? 'u' : ''} em ${item.dueDate}.`, item.status === 'overdue' ? 'critical' : 'warning', item.status === 'overdue' ? 'Enviar cobrança e registrar retorno.' : 'Preparar lembrete de mensalidade.');
    }
  });

  // ==========================================
  // RULES FROM agentEngine (Client Priorities)
  // ==========================================
  data.clients.forEach((client) => {
    if (client.status !== 'active') return;

    const criticalCount = signals.filter(a => a.clientId === client.id && a.severity === 'critical').length;
    if (criticalCount >= 3) {
      addSignal(client.id, 'client', client.id, 'atencao_critica', 'system', 'Atenção Crítica', `O cliente possui ${criticalCount} pendências críticas acumuladas.`, 'critical', 'Realizar força-tarefa para resolver pendências.');
    }
  });

  if (signals.length === 0) {
    addSignal('all-clear', 'system', undefined, 'all_clear', 'system', 'Operação sem alertas críticos', 'Nenhum pagamento, campanha ou projeto exige atenção imediata agora.', 'good', 'Aproveite para revisar criativos, métricas e próximos testes.');
  }

  return signals;
}
