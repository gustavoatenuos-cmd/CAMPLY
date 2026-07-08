import { GlobalClientPerformance } from './globalPerformanceDashboard';
import { ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';

export interface ClientDecisionAlert {
  id: string;
  severity: 'info' | 'attention' | 'critical';
  title: string;
  description: string;
  evidence: string[];
  source: 'profile' | 'meta' | 'budget' | 'sync' | 'target';
}

export interface ClientDecisionState {
  clientId: string;
  clientName: string;

  macroStatus:
    | 'healthy'
    | 'attention'
    | 'critical'
    | 'no_data'
    | 'not_connected'
    | 'not_configured';

  dataStatus:
    | 'available'
    | 'partial'
    | 'not_connected'
    | 'never_synced'
    | 'period_not_synced'
    | 'sync_failed_recently'
    | 'sync_without_metrics';

  primaryMetric: {
    metricId: string | null;
    label: string;
    actualValue: number | null;
    formattedActual: string;
    targetValue: number | null;
    deviationPercent: number | null;
    status: 'healthy' | 'attention' | 'critical' | 'missing_target' | 'no_data';
  };

  efficiencyMetric?: {
    metricId: string;
    label: string;
    value: number | null;
    formattedValue: string;
    status: 'healthy' | 'attention' | 'critical' | 'no_data';
  };

  budget: {
    plannedMonthlyBudget: number | null;
    actualSpend: number;
    expectedSpendUntilToday: number | null;
    remainingBudget: number | null;
    budgetUsagePercent: number | null;
    pacingPercent: number | null;
    status:
      | 'no_budget'
      | 'under_spending'
      | 'on_track'
      | 'over_spending'
      | 'exceeded';
    label: string;
  };

  alerts: ClientDecisionAlert[];

  nextAction: {
    label: string;
    reason: string;
    priority: 'low' | 'medium' | 'high';
  } | null;

  microEntrypoints: {
    level: 'account' | 'campaign' | 'adset' | 'ad';
    reason: string;
    metricId?: string;
  }[];
}

interface ResolveDecisionParams {
  performance: GlobalClientPerformance;
  now?: Date;
}

export function resolveClientDecision({
  performance,
  now = new Date()
}: ResolveDecisionParams): ClientDecisionState {
  const profile = performance.analysisProfile || null;
  const metrics = performance.metrics || {};
  const alerts: ClientDecisionAlert[] = [];
  const evaluations = performance.evaluations || [];

  // 1. Data Status
  let dataStatus: ClientDecisionState['dataStatus'] = 'available';
  if (performance.accounts.length === 0) {
    dataStatus = 'not_connected';
    alerts.push({
      id: 'not_connected',
      severity: 'critical',
      title: 'Sem conta Meta',
      description: 'Nenhuma conta de anúncios foi vinculada a este cliente.',
      evidence: [],
      source: 'meta'
    });
  } else if (!performance.lastSuccessfulRun && !performance.lastAttempt) {
    dataStatus = 'never_synced';
    alerts.push({
      id: 'never_synced',
      severity: 'attention',
      title: 'Nunca sincronizado',
      description: 'Os dados deste cliente nunca foram sincronizados com a Meta.',
      evidence: [],
      source: 'sync'
    });
  } else if (!performance.lastSuccessfulRun && performance.lastAttempt?.status === 'failed') {
    dataStatus = 'sync_failed_recently';
    alerts.push({
      id: 'sync_failed_recently',
      severity: 'critical',
      title: 'Falha na sincronização',
      description: 'A última tentativa de sincronização falhou e não há dados históricos utilizáveis.',
      evidence: [`Sincronização falhou: ${performance.lastAttempt.terminationReason || 'Erro desconhecido'}`],
      source: 'sync'
    });
  } else if (performance.lastAttempt && performance.lastAttempt.status === 'failed' && performance.lastAttempt.terminationReason) {
    dataStatus = 'sync_failed_recently';
    alerts.push({
      id: 'last_sync_failed',
      severity: 'attention',
      title: 'Falha na última atualização',
      description: 'Estamos exibindo dados do último sucesso, pois a última sincronização falhou.',
      evidence: [performance.lastAttempt?.terminationReason || 'Erro desconhecido'],
      source: 'sync'
    });
  } else if (performance.lastSuccessfulRun && performance.hasNewerPartial) {
    dataStatus = 'partial';
  }

  // 2. Budget normalisation
  let plannedMonthlyBudget: number | null = null;
  if (profile?.plannedBudget) {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (profile.budgetPeriod === 'daily') {
      plannedMonthlyBudget = profile.plannedBudget * daysInMonth;
    } else if (profile.budgetPeriod === 'weekly') {
      plannedMonthlyBudget = profile.plannedBudget * (daysInMonth / 7);
    } else {
      plannedMonthlyBudget = profile.plannedBudget;
    }
  } else {
    alerts.push({
      id: 'missing_budget',
      severity: 'attention',
      title: 'Orçamento não configurado',
      description: 'Configure o orçamento mensal planejado para acompanhar o ritmo de gastos.',
      evidence: [],
      source: 'budget'
    });
  }

  const actualSpend = metrics['spend']?.value || 0;
  
  let budgetStatus: ClientDecisionState['budget']['status'] = 'no_budget';
  let expectedSpendUntilToday: number | null = null;
  let remainingBudget: number | null = null;
  let budgetUsagePercent: number | null = null;
  let pacingPercent: number | null = null;
  let budgetLabel = 'Sem orçamento';

  if (plannedMonthlyBudget !== null && plannedMonthlyBudget > 0) {
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    expectedSpendUntilToday = (plannedMonthlyBudget / daysInMonth) * dayOfMonth;
    remainingBudget = plannedMonthlyBudget - actualSpend;
    budgetUsagePercent = (actualSpend / plannedMonthlyBudget) * 100;
    
    // Pace: actual / expected
    pacingPercent = (actualSpend / expectedSpendUntilToday) * 100;

    if (actualSpend > plannedMonthlyBudget) {
      budgetStatus = 'exceeded';
      budgetLabel = 'Orçamento excedido';
      alerts.push({
        id: 'budget_exceeded',
        severity: 'critical',
        title: 'Orçamento mensal excedido',
        description: 'O gasto real já ultrapassou o orçamento planejado para o mês.',
        evidence: [`Gasto: R$ ${actualSpend.toFixed(2)}`, `Planejado: R$ ${plannedMonthlyBudget.toFixed(2)}`],
        source: 'budget'
      });
    } else if (pacingPercent < 85) {
      budgetStatus = 'under_spending';
      budgetLabel = 'Abaixo do ritmo';
      alerts.push({
        id: 'budget_under_pacing',
        severity: 'attention',
        title: 'Gasto abaixo do ritmo',
        description: 'As campanhas estão consumindo menos orçamento do que o esperado para o dia do mês.',
        evidence: [`Ritmo: ${pacingPercent.toFixed(0)}% do esperado`],
        source: 'budget'
      });
    } else if (pacingPercent > 115) {
      budgetStatus = 'over_spending';
      budgetLabel = 'Acima do ritmo';
      alerts.push({
        id: 'budget_over_pacing',
        severity: 'attention',
        title: 'Gasto acelerado',
        description: 'O consumo está mais rápido que o ideal e o orçamento pode acabar antes do fim do mês.',
        evidence: [`Ritmo: ${pacingPercent.toFixed(0)}% do esperado`],
        source: 'budget'
      });
    } else {
      budgetStatus = 'on_track';
      budgetLabel = 'Ritmo ideal';
    }
  }

  // 3. Primary Metric Resolution
  let pmId: string | null = null;
  let pmLabel = 'Não configurado';
  let pmActual: number | null = null;
  let pmTarget: number | null = null;
  let pmDev: number | null = null;
  let pmStatus: ClientDecisionState['primaryMetric']['status'] = 'no_data';
  let pmFormatted = '-';

  let efId = '';
  let efLabel = '';
  let efValue: number | null = null;
  let efStatus: NonNullable<ClientDecisionState['efficiencyMetric']>['status'] = 'no_data';
  let efFormatted = '-';
  
  let hasPrimaryConversions = false;

  if (!profile || !profile.primaryConversionMetric) {
    alerts.push({
      id: 'missing_primary_metric',
      severity: 'critical',
      title: 'Meta principal não configurada',
      description: 'O perfil do cliente precisa definir qual é a conversão principal da operação.',
      evidence: [],
      source: 'profile'
    });
  } else {
    const rawMetric = profile.primaryConversionMetric;
    
    // Purchases
    if (['purchases', 'compra_site', 'compra_checkout', 'pedido_realizado'].includes(rawMetric)) {
      pmId = 'purchases';
      pmLabel = 'Compras';
      efId = 'cost_per_purchase';
      efLabel = 'CPA (Custo por Compra)';
    } 
    // Conversations
    else if (['messaging_conversations_started_total', 'conversa_iniciada', 'whatsapp', 'mensagem_direct'].includes(rawMetric)) {
      pmId = 'messaging_conversations_started_total';
      pmLabel = 'Conversas';
      efId = 'cost_per_messaging_conversation';
      efLabel = 'Custo por Conversa';
    }
    // Leads
    else if (['leads', 'lead_gerado', 'agendamento_realizado', 'cadastro', 'orçamento', 'orcamento'].includes(rawMetric)) {
      pmId = 'leads';
      pmLabel = 'Leads';
      efId = 'cost_per_lead';
      efLabel = 'CPL (Custo por Lead)';
    }
    // Reach
    else if (['reach', 'alcance'].includes(rawMetric)) {
      pmId = 'reach';
      pmLabel = 'Alcance';
      efId = 'cpm';
      efLabel = 'CPM';
    }

    if (pmId) {
      pmActual = metrics[pmId]?.value ?? null;
      if (pmActual !== null && pmActual > 0) hasPrimaryConversions = true;
      pmFormatted = pmActual !== null ? String(pmActual) : '-';
      
      const evalMatch = evaluations.find(e => e.metricId === pmId);
      if (evalMatch) {
        pmTarget = evalMatch.targetValue;
        pmDev = evalMatch.differencePercent;
        pmStatus = evalMatch.status as any;
      } else {
        pmStatus = pmActual !== null ? 'missing_target' : 'no_data';
        if (dataStatus !== 'not_connected' && dataStatus !== 'never_synced') {
           alerts.push({
            id: 'missing_target_primary',
            severity: 'attention',
            title: 'Meta não configurada',
            description: `Não há um Target definido para ${pmLabel}.`,
            evidence: [],
            source: 'target'
          });
        }
      }

      efValue = metrics[efId]?.value ?? null;
      if (efValue !== null) {
        efFormatted = `R$ ${efValue.toFixed(2)}`;
        const efEval = evaluations.find(e => e.metricId === efId);
        if (efEval) {
          efStatus = (efEval as any).status;
          if ((efEval as any).status === 'critical') {
            alerts.push({
              id: 'cpa_critical',
              severity: 'critical',
              title: `${efLabel} acima da meta`,
              description: `O custo por aquisição está acima do esperado.`,
              evidence: [`Atual: ${efFormatted}`, `Meta: R$ ${efEval.targetValue.toFixed(2)}`],
              source: 'target'
            });
          }
        }
      }
    }
  }

  if (pmId && actualSpend > 0 && !hasPrimaryConversions && dataStatus !== 'not_connected') {
    alerts.push({
      id: 'spend_no_conversion',
      severity: 'critical',
      title: 'Gasto sem conversão principal',
      description: `A conta gastou R$ ${actualSpend.toFixed(2)} e não gerou resultados de ${pmLabel || 'conversão'}.`,
      evidence: [],
      source: 'meta'
    });
  }
  
  // ROAS check
  const roasEval = evaluations.find(e => e.metricId === 'purchase_roas');
  if (roasEval && roasEval.status === 'critical') {
    alerts.push({
      id: 'roas_critical',
      severity: 'critical',
      title: 'ROAS abaixo da meta',
      description: 'O retorno sobre investimento está crítico.',
      evidence: [`Atual: ${(roasEval as any).actualValue?.toFixed(2) || '0.00'}x`, `Meta: ${roasEval.targetValue.toFixed(2)}x`],
      source: 'target'
    });
  }

  // Profile incomplete check
  if (!profile || !profile.vertical || !profile.operationType) {
    alerts.push({
      id: 'profile_incomplete',
      severity: 'attention',
      title: 'Perfil incompleto',
      description: 'O perfil operacional deste cliente não está totalmente preenchido.',
      evidence: [],
      source: 'profile'
    });
  }

  // Macro Status definition
  let macroStatus: ClientDecisionState['macroStatus'] = 'healthy';
  if (dataStatus === 'not_connected') macroStatus = 'not_connected';
  else if (dataStatus === 'never_synced') macroStatus = 'no_data';
  else if (!profile || !profile.primaryConversionMetric) macroStatus = 'not_configured';
  else if (alerts.some(a => a.severity === 'critical')) macroStatus = 'critical';
  else if (alerts.some(a => a.severity === 'attention')) macroStatus = 'attention';

  return {
    clientId: performance.clientId,
    clientName: performance.clientName,
    macroStatus,
    dataStatus,
    primaryMetric: {
      metricId: pmId,
      label: pmLabel,
      actualValue: pmActual,
      formattedActual: pmFormatted,
      targetValue: pmTarget,
      deviationPercent: pmDev,
      status: pmStatus
    },
    efficiencyMetric: efId ? {
      metricId: efId,
      label: efLabel,
      value: efValue,
      formattedValue: efFormatted,
      status: efStatus
    } : undefined,
    budget: {
      plannedMonthlyBudget,
      actualSpend,
      expectedSpendUntilToday,
      remainingBudget,
      budgetUsagePercent,
      pacingPercent,
      status: budgetStatus,
      label: budgetLabel
    },
    alerts,
    nextAction: alerts.length > 0 ? {
      label: 'Analisar alertas',
      reason: alerts[0].title,
      priority: alerts.some(a => a.severity === 'critical') ? 'high' : 'medium'
    } : null,
    microEntrypoints: []
  };
}
