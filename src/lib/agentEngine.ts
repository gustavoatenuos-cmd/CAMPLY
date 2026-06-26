import { CamplyData, AgentAlert, AgentRule, AgentActivityLog, EntityType, SeverityLevel } from '../types';
import { makeId } from '../data/camplyStore';

// Helper to calculate days between dates
function daysBetween(date1: string | Date, date2: string | Date): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function runAgentEngine(data: CamplyData): {
  newAlerts: AgentAlert[];
  newLogs: AgentActivityLog[];
} {
  const newAlerts: AgentAlert[] = [];
  const newLogs: AgentActivityLog[] = [];
  const today = new Date();
  const todayIso = today.toISOString();

  // Helper to add an alert
  const addAlert = (
    relatedEntityId: string,
    relatedEntityType: EntityType,
    clientId: string | undefined,
    title: string,
    message: string,
    severity: SeverityLevel,
    suggestedAction?: string
  ) => {
    // Prevent duplicate active alerts for the same entity and reason
    const existingActive = data.agentAlerts.find(
      (a) => a.relatedEntityId === relatedEntityId && a.title === title && a.status === 'active'
    );
    if (!existingActive) {
      newAlerts.push({
        id: makeId('alert'),
        relatedEntityId,
        relatedEntityType,
        clientId,
        title,
        message,
        severity,
        status: 'active',
        suggestedAction,
        triggeredAt: todayIso,
      });
    }
  };

  // 1 & 2: PRAZO HOJE e PRAZO VENCIDO para TAREFAS
  data.tasks.forEach((task) => {
    if (task.done) return; // ignore completed
    
    if (task.dueDate) {
      const days = daysBetween(todayIso, task.dueDate);
      if (days < 0) {
        addAlert(task.id, 'task', task.clientId, 'Tarefa Atrasada', `A tarefa "${task.title}" está atrasada.`, 'critical', 'Concluir ou reagendar a tarefa.');
      } else if (days === 0) {
        addAlert(task.id, 'task', task.clientId, 'Vence Hoje', `A tarefa "${task.title}" vence hoje.`, 'warning', 'Priorizar a execução desta tarefa hoje.');
      }
    }
  });

  // 1 & 2: PRAZO HOJE e PRAZO VENCIDO para PROJETOS
  data.projects.forEach((project) => {
    if (project.status === 'done') return;
    
    if (project.dueDate) {
      const days = daysBetween(todayIso, project.dueDate);
      if (days < 0) {
        addAlert(project.id, 'project', project.clientId, 'Projeto Atrasado', `O projeto "${project.name}" passou do prazo.`, 'critical', 'Revisar cronograma e alinhar com o cliente.');
      } else if (days === 0) {
        addAlert(project.id, 'project', project.clientId, 'Entrega Hoje', `A entrega do projeto "${project.name}" é hoje.`, 'warning', 'Finalizar pendências e preparar entrega.');
      }
    }

    // 3. ITEM PARADO (Sem atualização)
    if (project.lastActivityAt) {
      const idleDays = daysBetween(project.lastActivityAt, todayIso);
      if (idleDays > 7 && project.status !== 'waiting') {
        addAlert(project.id, 'project', project.clientId, 'Projeto Parado', `Projeto sem atualizações há mais de 7 dias.`, 'warning', 'Atualizar o andamento ou contatar o cliente.');
      }
    }
  });

  // 5. CAMPANHA EM ATENÇÃO (Revisão próxima)
  data.campaigns.forEach((campaign) => {
    if (campaign.status === 'paused' || campaign.status === 'setup') return;

    if (campaign.lastOptimizedAt) {
      const idleDays = daysBetween(campaign.lastOptimizedAt, todayIso);
      if (idleDays >= 3) {
        addAlert(campaign.id, 'campaign', campaign.clientId, 'Campanha Parada', `Campanha sem otimização há ${idleDays} dias.`, 'warning', 'Analisar métricas e registrar otimização.');
      }
    }
  });

  // 4 & 6: CLIENTE ESTRATÉGICO / MUITAS PENDÊNCIAS
  data.clients.forEach((client) => {
    if (client.status !== 'active') return;

    // Check how many critical/urgent alerts this client has
    const clientAlerts = newAlerts.filter(a => a.clientId === client.id);
    const criticalCount = clientAlerts.filter(a => a.severity === 'critical').length;
    
    if (criticalCount >= 3) {
      addAlert(client.id, 'client', client.id, 'Atenção Crítica', `O cliente possui ${criticalCount} pendências críticas acumuladas.`, 'critical', 'Realizar força-tarefa para resolver pendências.');
    }
  });

  return { newAlerts, newLogs };
}
