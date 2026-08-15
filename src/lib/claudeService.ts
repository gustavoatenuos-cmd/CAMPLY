import type { CamplyData } from '../types';
import { invokeFunction } from './invokeFunction';

// ============================================================
// INTERPRETIVE AI LAYER
// ============================================================
//
// This service is deliberately downstream of deterministic CAMPLY contracts.
// It may explain canonical operational signals, but it must never calculate
// media performance from manual campaign fields. Meta performance, targets,
// budget pacing and account-manager diagnoses belong to the Analytics engine.

export function isClaudeConfigured(): boolean {
  // The provider secret lives behind the backend proxy. The frontend can always
  // attempt the request and use the deterministic local fallback on failure.
  return true;
}

interface ClaudeAgentContext {
  user: string;
  totalClients: number;
  totalCampaigns: number;
  totalProjects: number;
  totalTasks: number;
  activeAlerts: Array<{
    entity_type: string;
    title: string;
    message: string;
    severity: string;
    suggested_action?: string;
  }>;
  criticalCount: number;
  warningCount: number;
}

export interface ClaudeAgentResponse {
  summary_title: string;
  summary_text: string;
  urgency_level: 'critical' | 'high' | 'medium' | 'low';
  recommended_actions: string[];
}

function buildContext(data: CamplyData, userEmail?: string | null): ClaudeAgentContext {
  const activeAlerts = (data.agentAlerts || []).filter((alert) => alert.status === 'active');

  return {
    user: userEmail ?? 'Gestor',
    totalClients: data.clients.filter((client) => client.status === 'active').length,
    totalCampaigns: data.campaigns.filter((campaign) => !['paused', 'setup'].includes(campaign.status)).length,
    totalProjects: data.projects.filter((project) => project.status !== 'done' && project.status !== 'archived').length,
    totalTasks: data.tasks.filter((task) => !task.done).length,
    activeAlerts: activeAlerts.map((alert) => ({
      entity_type: alert.relatedEntityType,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      suggested_action: alert.suggestedAction,
    })),
    criticalCount: activeAlerts.filter((alert) => alert.severity === 'critical').length,
    warningCount: activeAlerts.filter((alert) => alert.severity === 'warning').length,
  };
}

export async function generateAgentSummary(
  data: CamplyData,
  userEmail?: string | null
): Promise<ClaudeAgentResponse | null> {
  const context = buildContext(data, userEmail);

  try {
    const responseData = await invokeFunction<any>('claude-proxy', {
      mode: 'operational_summary',
      userMessage: [
        'Explique apenas os sinais operacionais canônicos abaixo.',
        'Não invente métricas de mídia, orçamento, CPA, CPR, ROAS, CTR ou impacto esperado.',
        'Quando uma decisão depender de performance da Meta, oriente o usuário a consultar o Analytics do CAMPLY.',
        'Retorne JSON com summary_title, summary_text, urgency_level e recommended_actions.',
        '',
        JSON.stringify(context, null, 2),
      ].join('\n'),
      maxTokens: 512,
    });

    const text = responseData.result?.content?.[0]?.text;
    if (!text) return generateLocalSummary(data);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return generateLocalSummary(data);

    try {
      return JSON.parse(jsonMatch[0]) as ClaudeAgentResponse;
    } catch {
      return generateLocalSummary(data);
    }
  } catch (error) {
    console.warn('[ClaudeService] Error calling interpretive AI, using local fallback:', error);
    return generateLocalSummary(data);
  }
}

function generateLocalSummary(data: CamplyData): ClaudeAgentResponse {
  const activeAlerts = (data.agentAlerts || []).filter((alert) => alert.status === 'active');
  const criticals = activeAlerts.filter((alert) => alert.severity === 'critical');
  const warnings = activeAlerts.filter((alert) => alert.severity === 'warning');
  const taskAlerts = activeAlerts.filter((alert) => alert.relatedEntityType === 'task');
  const campaignAlerts = activeAlerts.filter((alert) => alert.relatedEntityType === 'campaign');
  const projectAlerts = activeAlerts.filter((alert) => alert.relatedEntityType === 'project');
  const clientAlerts = activeAlerts.filter((alert) => alert.relatedEntityType === 'client');

  if (activeAlerts.length === 0) {
    return {
      summary_title: 'Operação sem pendências críticas',
      summary_text: 'Nenhum sinal operacional ativo no workspace. A performance de mídia deve ser acompanhada separadamente no Analytics.',
      urgency_level: 'low',
      recommended_actions: ['Revisar o Analytics dos clientes prioritários', 'Conferir os próximos prazos operacionais'],
    };
  }

  const parts: string[] = [];
  const actions = new Set<string>();

  if (taskAlerts.length > 0) {
    parts.push(`${taskAlerts.length} tarefa${taskAlerts.length > 1 ? 's' : ''} com sinal ativo`);
    actions.add('Priorizar tarefas vencidas ou com prazo imediato');
  }
  if (projectAlerts.length > 0) {
    parts.push(`${projectAlerts.length} projeto${projectAlerts.length > 1 ? 's' : ''} exige${projectAlerts.length > 1 ? 'm' : ''} acompanhamento`);
    actions.add('Revisar cronograma e próxima ação dos projetos sinalizados');
  }
  if (campaignAlerts.length > 0) {
    parts.push(`${campaignAlerts.length} campanha${campaignAlerts.length > 1 ? 's' : ''} sem revisão operacional recente`);
    actions.add('Abrir o Analytics antes de decidir qualquer ajuste de mídia');
  }
  if (clientAlerts.length > 0) {
    parts.push(`${clientAlerts.length} pendência${clientAlerts.length > 1 ? 's' : ''} ligada${clientAlerts.length > 1 ? 's' : ''} a cliente`);
    actions.add('Resolver pendências críticas de cliente e cobrança');
  }

  return {
    summary_title: criticals.length > 0 ? 'Atenção operacional necessária' : 'Operação com pontos de atenção',
    summary_text: `Há ${parts.join(', ')}. ${criticals.length > 0 ? `${criticals.length} sinal(is) crítico(s) precisam de ação prioritária.` : `${warnings.length} sinal(is) pedem acompanhamento.`}`,
    urgency_level: criticals.length >= 3 ? 'critical' : criticals.length > 0 ? 'high' : 'medium',
    recommended_actions: Array.from(actions).slice(0, 4),
  };
}
