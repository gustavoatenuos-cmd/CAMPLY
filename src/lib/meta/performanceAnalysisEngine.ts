import { MetaObjective } from './objectives';

export interface AnalysisAlert {
  status: 'active' | 'resolved' | 'ignored';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  objective: MetaObjective;
  metricId: string;
  currentValue: number;
  referenceValue?: number;
  absoluteChange?: number;
  percentageChange?: number;
  sampleSize: number;
  confidence: number;
  evidence: string;
  hypothesis: string;
  recommendation: string;
  priority: number;
}

export function generatePerformanceAlerts(
  objective: MetaObjective,
  currentMetrics: Record<string, number>,
  previousMetrics?: Record<string, number>,
  customGoal?: number
): AnalysisAlert[] {
  const alerts: AnalysisAlert[] = [];
  const spend = currentMetrics.spend || 0;
  const impressions = currentMetrics.impressions || 0;

  if (spend === 0 && impressions === 0) {
    alerts.push({
      status: 'active',
      severity: 'warning',
      title: 'Campanha sem entrega',
      objective,
      metricId: 'impressions',
      currentValue: 0,
      sampleSize: 0,
      confidence: 100,
      evidence: 'Impressões e investimento estão zerados.',
      hypothesis: 'A campanha pode estar pausada, reprovada, fora do período de veiculação, ou o público é extremamente restrito.',
      recommendation: 'Verifique o status efetivo no Gerenciador de Anúncios e confira o orçamento e público.',
      priority: 1
    });
    return alerts;
  }

  // Ensure minimum sample size for reliable heuristics
  if (impressions < 500 && spend < 20) {
    return alerts; // Insufficient data to conclude
  }

  if (objective === 'WHATSAPP') {
    const linkClicks = currentMetrics.link_clicks || 0;
    const conversations = currentMetrics.whatsapp_conversations_started || 0;
    
    if (linkClicks > 20 && conversations === 0) {
      alerts.push({
        status: 'active',
        severity: 'critical',
        title: 'Fuga no carregamento do WhatsApp',
        objective,
        metricId: 'whatsapp_conversations_started',
        currentValue: conversations,
        referenceValue: linkClicks,
        sampleSize: linkClicks,
        confidence: 85,
        evidence: `Houve ${linkClicks} cliques no link, mas nenhuma conversa foi iniciada.`,
        hypothesis: 'Existe forte indício de perda entre o clique e a abertura do app. Pode ser demora no redirecionamento, link quebrado ou perda de interesse na mensagem pré-definida.',
        recommendation: 'Teste o link da campanha em conexões 3G, verifique o tempo de abertura do WhatsApp e reduza o atrito da mensagem inicial.',
        priority: 2
      });
    }
  }

  if (objective === 'SALES') {
    const checkouts = currentMetrics.checkouts || 0;
    const purchases = currentMetrics.purchases || 0;
    
    if (checkouts > 15 && purchases === 0) {
      alerts.push({
        status: 'active',
        severity: 'warning',
        title: 'Abandono massivo de carrinho',
        objective,
        metricId: 'purchases',
        currentValue: purchases,
        referenceValue: checkouts,
        sampleSize: checkouts,
        confidence: 80,
        evidence: `${checkouts} inícios de checkout registrados sem nenhuma compra concluída.`,
        hypothesis: 'O tráfego chega à etapa de pagamento mas desiste. Sugere-se problema de frete alto, falta de opções de pagamento ou erro no gateway.',
        recommendation: 'Revise o checkout de forma anônima e simule uma compra completa para validar meios de pagamento e frete.',
        priority: 2
      });
    }
  }

  return alerts;
}
