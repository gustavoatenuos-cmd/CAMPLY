import { CamplyData, AgentAlert } from '../types';

// ============================================================
// CLAUDE AI SERVICE - Camada de inteligência interpretativa
// ============================================================
// O Claude NÃO é responsável pela lógica crítica.
// Ele recebe os alertas já calculados pelo backend (agentEngine)
// e gera resumos humanos, explicações e sugestões de próxima ação.
// ============================================================

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// A chave deve ser configurada via variável de ambiente
function getApiKey(): string | null {
  return (import.meta.env.VITE_CLAUDE_API_KEY as string) || null;
}

export function isClaudeConfigured(): boolean {
  return !!getApiKey();
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

function buildContext(data: CamplyData): ClaudeAgentContext {
  const activeAlerts = (data.agentAlerts || []).filter(a => a.status === 'active');

  return {
    user: 'Gustavo',
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

const SYSTEM_PROMPT = `Você é o agente operacional inteligente do CRM Camply.
Seu papel é analisar os alertas e dados operacionais gerados pelo backend e produzir um resumo executivo claro e acionável.

REGRAS:
- Seja direto e objetivo, como um briefing militar.
- Use linguagem profissional mas acessível.
- Priorize os itens mais urgentes primeiro.
- Sugira ações concretas e específicas.
- NUNCA invente dados que não estejam no contexto.
- Responda SEMPRE em português brasileiro.
- Mantenha o resumo entre 2-4 frases curtas.
- Se não houver alertas, diga que está tudo operacional.

FORMATO DE RESPOSTA (JSON):
{
  "summary_title": "Título curto do resumo",
  "summary_text": "Texto do resumo executivo em 2-4 frases",
  "urgency_level": "critical|high|medium|low",
  "recommended_actions": ["ação 1", "ação 2"]
}`;

export async function generateAgentSummary(data: CamplyData): Promise<ClaudeAgentResponse | null> {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    // Fallback local quando não há API key configurada
    return generateLocalSummary(data);
  }

  const context = buildContext(data);

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Analise o seguinte contexto operacional e gere o resumo:\n\n${JSON.stringify(context, null, 2)}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn('[ClaudeService] API error, falling back to local summary');
      return generateLocalSummary(data);
    }

    const result = await response.json();
    const text = result.content?.[0]?.text;

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
