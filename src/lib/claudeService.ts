import { CamplyData, AgentAlert, Campaign, Client } from '../types';
import { invokeFunction } from './invokeFunction';


// ============================================================
// CLAUDE AI SERVICE - Camada de inteligência interpretativa
// ============================================================

export function isClaudeConfigured(): boolean {
  // Now relies on backend secret, so we assume true for the frontend 
  // or we can just always attempt and fallback if it fails.
  return true;
}

// Estrutura de entrada para o Claude (contexto estruturado)
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

// Estrutura de saída esperada do Claude
export interface ClaudeAgentResponse {
  summary_title: string;
  summary_text: string;
  urgency_level: 'critical' | 'high' | 'medium' | 'low';
  recommended_actions: string[];
}

function buildContext(data: CamplyData, userEmail?: string | null): ClaudeAgentContext {
  const activeAlerts = (data.agentAlerts || []).filter(a => a.status === 'active');

  return {
    user: userEmail ?? 'Gestor',
    totalClients: data.clients.filter(c => c.status === 'active').length,
    totalCampaigns: data.campaigns.filter(c => !['paused', 'setup'].includes(c.status)).length,
    totalProjects: data.projects.filter(p => p.status !== 'done').length,
    totalTasks: data.tasks.filter(t => !t.done).length,
    activeAlerts: activeAlerts.map(a => ({
      entity_type: a.relatedEntityType,
      title: a.title,
      message: a.message,
      severity: a.severity,
      suggested_action: a.suggestedAction,
    })),
    criticalCount: activeAlerts.filter(a => a.severity === 'critical').length,
    warningCount: activeAlerts.filter(a => a.severity === 'warning').length,
  };
}

export async function generateAgentSummary(data: CamplyData, userEmail?: string | null): Promise<ClaudeAgentResponse | null> {
  const context = buildContext(data, userEmail);


  try {
    const responseData = await invokeFunction<any>('claude-proxy', {
      mode: 'operational_summary',
      userMessage: `Analise o seguinte contexto operacional e gere o resumo:\n\n${JSON.stringify(context, null, 2)}`,
      maxTokens: 512,
    });

    const text = responseData.result?.content?.[0]?.text;

    if (!text) {
      return generateLocalSummary(data);
    }

    // Extrair JSON da resposta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ClaudeAgentResponse;
    }

    return generateLocalSummary(data);
  } catch (error) {
    console.warn('[ClaudeService] Error calling Claude API, using local fallback:', error);
    return generateLocalSummary(data);
  }
}

// Fallback determinístico quando o Claude não está disponível
function generateLocalSummary(data: CamplyData): ClaudeAgentResponse {
  const activeAlerts = (data.agentAlerts || []).filter(a => a.status === 'active');
  const criticals = activeAlerts.filter(a => a.severity === 'critical');
  const warnings = activeAlerts.filter(a => a.severity === 'warning');

  const taskAlerts = activeAlerts.filter(a => a.relatedEntityType === 'task');
  const campaignAlerts = activeAlerts.filter(a => a.relatedEntityType === 'campaign');
  const projectAlerts = activeAlerts.filter(a => a.relatedEntityType === 'project');

  if (activeAlerts.length === 0) {
    return {
      summary_title: 'Operação Saudável',
      summary_text: 'Nenhum alerta operacional ativo. Todas as campanhas, projetos e tarefas estão dentro do esperado. Continue monitorando.',
      urgency_level: 'low',
      recommended_actions: ['Revisar campanhas ativas', 'Verificar prazos da semana'],
    };
  }

  const parts: string[] = [];
  const actions: string[] = [];

  if (taskAlerts.length > 0) {
    const atrasadas = taskAlerts.filter(a => a.title.includes('Atrasada')).length;
    const hoje = taskAlerts.filter(a => a.title.includes('Hoje')).length;
    if (atrasadas > 0) parts.push(`${atrasadas} tarefa${atrasadas > 1 ? 's' : ''} atrasada${atrasadas > 1 ? 's' : ''}`);
    if (hoje > 0) parts.push(`${hoje} tarefa${hoje > 1 ? 's' : ''} vence${hoje > 1 ? 'm' : ''} hoje`);
    actions.push('Priorizar conclusão das tarefas vencidas');
  }

  if (campaignAlerts.length > 0) {
    parts.push(`${campaignAlerts.length} campanha${campaignAlerts.length > 1 ? 's' : ''} precisa${campaignAlerts.length > 1 ? 'm' : ''} de revisão`);
    actions.push('Analisar métricas das campanhas paradas');
  }

  if (projectAlerts.length > 0) {
    const atrasados = projectAlerts.filter(a => a.title.includes('Atrasado')).length;
    const parados = projectAlerts.filter(a => a.title.includes('Parado')).length;
    if (atrasados > 0) parts.push(`${atrasados} projeto${atrasados > 1 ? 's' : ''} atrasado${atrasados > 1 ? 's' : ''}`);
    if (parados > 0) parts.push(`${parados} projeto${parados > 1 ? 's' : ''} parado${parados > 1 ? 's' : ''}`);
    actions.push('Revisar cronograma dos projetos com alerta');
  }

  const summaryText = parts.length > 0
    ? `Você possui ${parts.join(', ')}. ${criticals.length > 0 ? 'Há itens críticos que precisam de ação imediata.' : 'Fique atento aos prazos.'}`
    : 'Há alertas operacionais que merecem atenção. Verifique a central de inteligência.';

  return {
    summary_title: criticals.length > 0 ? 'Atenção Necessária' : 'Operação com Alertas',
    summary_text: summaryText,
    urgency_level: criticals.length >= 3 ? 'critical' : criticals.length > 0 ? 'high' : 'medium',
    recommended_actions: actions.length > 0 ? actions : ['Verificar alertas na central de inteligência'],
  };
}

// ============================================================
// CHAT & COMANDOS (VOZ/TEXTO)
// ============================================================


// ============================================================
// CAMPAIGN DEEP ANALYSIS (Phase 1)
// ============================================================

export interface CampaignAnalysisContext {
  campaign: {
    name: string;
    objective: string;
    platform: string;
    status: string;
    budget: number;
    spent: number;
    lastOptimizedAt?: string;
  };
  client: {
    name: string;
    category?: string;
    benchmarks?: Record<string, number>;
  };
  alerts: Array<{ title: string; message: string; severity: string }>;
}

export interface CampaignAnalysisResponse {
  health_score: number;          // 0-100
  diagnosis: string;             // O que está acontecendo
  primary_issue: string | null;  // Problema principal detectado
  budget_assessment: 'too_low' | 'adequate' | 'too_high' | 'exhausted';
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    action: string;
    reason: string;
    expected_impact: string;
  }>;
}

export async function generateCampaignAnalysis(
  campaign: Campaign,
  client: Client,
  data: CamplyData
): Promise<CampaignAnalysisResponse | null> {
  const campaignAlerts = (data.agentAlerts || [])
    .filter(a => a.relatedEntityId === campaign.id && a.status === 'active')
    .map(a => ({ title: a.title, message: a.message, severity: a.severity }));

  const context: CampaignAnalysisContext = {
    campaign: {
      name: campaign.name,
      objective: campaign.objective as string,
      platform: campaign.platform,
      status: campaign.status,
      budget: campaign.budget,
      spent: campaign.spent,
      lastOptimizedAt: campaign.lastOptimizedAt,
    },
    client: {
      name: client.name,
      category: client.category,
      benchmarks: client.benchmarks as Record<string, number> | undefined,
    },
    alerts: campaignAlerts,
  };

  try {
    const responseData = await invokeFunction<any>('claude-proxy', {
      mode: 'campaign_analysis',
      userMessage: `Analise detalhadamente esta campanha e retorne um JSON com health_score (0-100), diagnosis, primary_issue, budget_assessment e recommendations:\n\n${JSON.stringify(context, null, 2)}`,
      maxTokens: 1024,
    });

    const text = responseData.result?.content?.[0]?.text;
    if (!text) return generateLocalCampaignAnalysis(campaign, campaignAlerts);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as CampaignAnalysisResponse;
    }
    return generateLocalCampaignAnalysis(campaign, campaignAlerts);
  } catch {
    return generateLocalCampaignAnalysis(campaign, campaignAlerts);
  }
}

function generateLocalCampaignAnalysis(
  campaign: Campaign,
  alerts: Array<{ title: string; severity: string }>
): CampaignAnalysisResponse {
  const criticals = alerts.filter(a => a.severity === 'critical').length;
  const warnings = alerts.filter(a => a.severity === 'warning').length;

  // Calcular health score base
  let healthScore = 100;
  healthScore -= criticals * 20;
  healthScore -= warnings * 10;

  // Checar budget
  const budgetPct = campaign.budget > 0 ? (campaign.spent / campaign.budget) * 100 : 0;
  let budgetAssessment: CampaignAnalysisResponse['budget_assessment'] = 'adequate';
  if (budgetPct >= 90) { budgetAssessment = 'exhausted'; healthScore -= 15; }
  else if (budgetPct < 20 && campaign.status === 'live') { budgetAssessment = 'too_low'; }

  healthScore = Math.max(0, Math.min(100, healthScore));

  const primaryIssue = criticals > 0
    ? alerts.find(a => a.severity === 'critical')?.title ?? null
    : warnings > 0
    ? alerts.find(a => a.severity === 'warning')?.title ?? null
    : null;

  const recommendations = [];
  if (budgetAssessment === 'exhausted') {
    recommendations.push({
      priority: 'high' as const,
      action: 'Revisar orçamento da campanha',
      reason: 'Budget esgotado pode interromper a entrega de anúncios',
      expected_impact: 'Retomar alcance e impressões',
    });
  }
  if (campaign.lastOptimizedAt) {
    const daysSince = Math.floor((Date.now() - new Date(campaign.lastOptimizedAt).getTime()) / 86400000);
    if (daysSince >= 3) {
      recommendations.push({
        priority: 'high' as const,
        action: `Otimizar campanha (${daysSince} dias sem otimização)`,
        reason: 'Campanhas sem otimização perdem performance ao longo do tempo',
        expected_impact: 'Melhora de CTR e redução de CPM',
      });
    }
  }
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'low' as const,
      action: 'Continuar monitorando métricas',
      reason: 'Campanha aparentemente saudável',
      expected_impact: 'Manutenção da performance atual',
    });
  }

  return {
    health_score: healthScore,
    diagnosis: healthScore >= 80
      ? 'Campanha funcionando dentro do esperado.'
      : healthScore >= 50
      ? 'Campanha com pontos de atenção que requerem revisão.'
      : 'Campanha com problemas críticos que precisam de ação imediata.',
    primary_issue: primaryIssue,
    budget_assessment: budgetAssessment,
    recommendations,
  };
}
