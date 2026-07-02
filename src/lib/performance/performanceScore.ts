import type { BudgetPacingResult, PerformanceEvaluation, PerformanceStatus } from './types';

export type PerformanceScoreStatus = 'excellent' | 'healthy' | 'attention' | 'critical' | 'unavailable';
export type DecisionSignalKind = 'performance' | 'pacing' | 'data_quality' | 'sync';

export interface DecisionSignal {
  kind: DecisionSignalKind;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  evidence: string;
  nextAction: string;
  confidence: number;
  metricId?: string;
  campaignId?: string | null;
}

export interface PerformanceScore {
  value: number | null;
  status: PerformanceScoreStatus;
  confidence: number;
  coveragePercent: number;
  summary: string;
  signals: DecisionSignal[];
}

export interface PerformanceScoreInput {
  clientStatus:
    | 'not_connected'
    | 'never_synced'
    | 'syncing'
    | 'no_delivery'
    | 'available'
    | 'stale'
    | 'partial'
    | 'failed';
  dataQuality: {
    status: 'complete' | 'partial' | 'unavailable';
    reason: string | null;
  };
  evaluations: PerformanceEvaluation[];
  budgetPacing: BudgetPacingResult | null;
  profile?: {
    primaryConversionMetric?: string | null;
    secondaryMetrics?: string[] | null;
  } | null;
}

const evaluationPoints: Record<PerformanceStatus, number | null> = {
  on_track: 45,
  attention: 25,
  critical: 5,
  insufficient_data: null,
  partial_data: null,
  unavailable: null,
};

const pacingPoints: Record<PerformanceStatus, number | null> = {
  on_track: 15,
  attention: 8,
  critical: 2,
  insufficient_data: null,
  partial_data: null,
  unavailable: null,
};

const syncPoints: Record<PerformanceScoreInput['clientStatus'], number> = {
  available: 15,
  syncing: 8,
  stale: 7,
  partial: 5,
  no_delivery: 4,
  never_synced: 1,
  not_connected: 0,
  failed: 0,
};

const qualityPoints: Record<PerformanceScoreInput['dataQuality']['status'], number> = {
  complete: 25,
  partial: 12,
  unavailable: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreStatus(value: number): Exclude<PerformanceScoreStatus, 'unavailable'> {
  if (value >= 85) return 'excellent';
  if (value >= 70) return 'healthy';
  if (value >= 50) return 'attention';
  return 'critical';
}

function evaluationSignal(evaluation: PerformanceEvaluation): DecisionSignal | null {
  const evidenceLabels: Record<string, string> = {
    cost_above_warning_tolerance: 'O custo está acima da faixa de atenção configurada.',
    cost_above_critical_tolerance: 'O custo ultrapassou a tolerância crítica configurada.',
    metric_below_warning_tolerance: 'O resultado está abaixo da faixa de atenção configurada.',
    metric_below_critical_tolerance: 'O resultado está abaixo da tolerância crítica configurada.',
    metric_above_warning_tolerance: 'A métrica está acima da faixa de atenção configurada.',
    metric_above_critical_tolerance: 'A métrica ultrapassou a tolerância crítica configurada.',
    range_deviation_warning_tolerance: 'A métrica saiu da faixa esperada e exige acompanhamento.',
    range_deviation_critical_tolerance: 'A métrica está muito distante da faixa esperada.',
  };
  const evidence = evidenceLabels[evaluation.reason] || 'O resultado observado está fora da expectativa configurada.';
  if (evaluation.status === 'critical') {
    return {
      kind: 'performance',
      severity: 'critical',
      title: `${evaluation.metricId} fora da meta`,
      evidence,
      nextAction: evaluation.campaignId
        ? 'Abrir a campanha, validar o grupo responsável e revisar a distribuição de verba antes de escalar.'
        : 'Abrir a conta, identificar as campanhas responsáveis e revisar a meta configurada.',
      confidence: evaluation.confidence,
      metricId: evaluation.metricId,
      campaignId: evaluation.campaignId,
    };
  }

  if (evaluation.status === 'attention') {
    return {
      kind: 'performance',
      severity: 'warning',
      title: `${evaluation.metricId} exige acompanhamento`,
      evidence,
      nextAction: 'Acompanhar a próxima janela de dados e revisar criativo, público ou oferta se a diferença aumentar.',
      confidence: evaluation.confidence,
      metricId: evaluation.metricId,
      campaignId: evaluation.campaignId,
    };
  }

  if (evaluation.status === 'partial_data') {
    return {
      kind: 'data_quality',
      severity: 'warning',
      title: 'Avaliação baseada em dados parciais',
      evidence: 'A sincronização ainda não possui completude suficiente para uma decisão definitiva.',
      nextAction: 'Concluir uma sincronização completa antes de tomar uma decisão de otimização.',
      confidence: evaluation.confidence,
      metricId: evaluation.metricId,
      campaignId: evaluation.campaignId,
    };
  }

  return null;
}

function metricProfileWeight(evaluation: PerformanceEvaluation, input: PerformanceScoreInput): number {
  const configuredWeight = evaluation.priorityWeight;
  if (typeof configuredWeight === 'number' && Number.isFinite(configuredWeight) && configuredWeight > 0) {
    return configuredWeight;
  }

  const primary = input.profile?.primaryConversionMetric;
  const secondary = new Set(input.profile?.secondaryMetrics ?? []);
  if (primary && evaluation.metricId === primary) return 2.5;
  if (primary === 'messaging_conversations_started_total' && evaluation.metricId === 'cost_per_messaging_conversation') return 2.5;
  if (primary === 'leads' && evaluation.metricId === 'cost_per_lead') return 2.5;
  if (primary === 'purchases' && ['cost_per_purchase', 'purchase_roas', 'purchase_value'].includes(evaluation.metricId)) return 2.5;
  if (secondary.has(evaluation.metricId)) return 1.35;
  return input.profile ? 0.75 : 1;
}

function buildSignals(input: PerformanceScoreInput): DecisionSignal[] {
  const signals = input.evaluations
    .map(evaluationSignal)
    .filter((signal): signal is DecisionSignal => signal !== null);

  if (input.budgetPacing?.status === 'critical' || input.budgetPacing?.status === 'attention') {
    signals.push({
      kind: 'pacing',
      severity: input.budgetPacing.status === 'critical' ? 'critical' : 'warning',
      title: 'Ritmo de investimento fora do esperado',
      evidence: `Diferença de ${input.budgetPacing.differencePercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% em relação ao gasto esperado até agora.`,
      nextAction: input.budgetPacing.differencePercent < 0
        ? 'Revisar limite, entrega, público e programação para evitar subinvestimento.'
        : 'Revisar orçamento e distribuição para evitar ultrapassar o planejamento.',
      confidence: 95,
    });
  }

  if (input.dataQuality.status !== 'complete') {
    signals.push({
      kind: 'data_quality',
      severity: input.dataQuality.status === 'unavailable' ? 'critical' : 'warning',
      title: input.dataQuality.status === 'unavailable' ? 'Dados indisponíveis' : 'Dados incompletos',
      evidence: input.dataQuality.reason || 'A coleta não possui completude suficiente para uma leitura definitiva.',
      nextAction: 'Executar nova sincronização e validar período, nível e atribuição antes de otimizar.',
      confidence: 100,
    });
  }

  if (['failed', 'stale', 'never_synced', 'not_connected'].includes(input.clientStatus)) {
    const title = input.clientStatus === 'not_connected'
      ? 'Conta Meta não vinculada'
      : input.clientStatus === 'never_synced'
        ? 'Conta nunca sincronizada'
        : input.clientStatus === 'stale'
          ? 'Dados desatualizados'
          : 'Última sincronização falhou';
    signals.push({
      kind: 'sync',
      severity: input.clientStatus === 'stale' ? 'warning' : 'critical',
      title,
      evidence: `Estado atual da conta: ${input.clientStatus}.`,
      nextAction: input.clientStatus === 'not_connected'
        ? 'Vincular oficialmente uma conta de anúncios ao cliente.'
        : 'Abrir o centro de sincronização, corrigir a falha e executar novamente o período.',
      confidence: 100,
    });
  }

  const severityWeight = { critical: 3, warning: 2, info: 1 } as const;
  return signals
    .sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity] || b.confidence - a.confidence)
    .slice(0, 5);
}

export function calculatePerformanceScore(input: PerformanceScoreInput): PerformanceScore {
  const conclusiveEvaluations = input.evaluations.filter((evaluation) => evaluationPoints[evaluation.status] !== null);
  const averageEvaluationPoints = conclusiveEvaluations.length > 0
    ? conclusiveEvaluations.reduce((total, evaluation) => {
        const base = evaluationPoints[evaluation.status] ?? 0;
        return total + base * clamp(evaluation.confidence, 0, 100) / 100 * metricProfileWeight(evaluation, input);
      }, 0) / conclusiveEvaluations.reduce((total, evaluation) => total + metricProfileWeight(evaluation, input), 0)
    : null;

  const pacing = input.budgetPacing ? pacingPoints[input.budgetPacing.status] : null;
  const availableWeight = 25 + 15 + (averageEvaluationPoints === null ? 0 : 45) + (pacing === null ? 0 : 15);
  const hasDecisionBasis = averageEvaluationPoints !== null || pacing !== null;
  const coveragePercent = Math.round(availableWeight);
  const signals = buildSignals(input);

  if (!hasDecisionBasis || availableWeight < 55) {
    return {
      value: null,
      status: 'unavailable',
      confidence: 0,
      coveragePercent,
      summary: input.clientStatus === 'not_connected'
        ? 'Vincule uma conta Meta para iniciar a leitura.'
        : input.evaluations.length === 0
          ? 'Configure metas e sincronize o período para gerar uma pontuação confiável.'
          : 'Ainda não há dados conclusivos suficientes para pontuar esta operação.',
      signals,
    };
  }

  const earnedPoints = qualityPoints[input.dataQuality.status]
    + syncPoints[input.clientStatus]
    + (averageEvaluationPoints ?? 0)
    + (pacing ?? 0);
  const normalizedScore = Math.round(clamp(earnedPoints / availableWeight * 100, 0, 100));
  const evaluationConfidence = conclusiveEvaluations.length > 0
    ? conclusiveEvaluations.reduce((total, evaluation) => total + evaluation.confidence, 0) / conclusiveEvaluations.length
    : 70;
  const confidence = Math.round(clamp(evaluationConfidence * (coveragePercent / 100), 0, 100));
  const status = scoreStatus(normalizedScore);
  const summaries: Record<Exclude<PerformanceScoreStatus, 'unavailable'>, string> = {
    excellent: 'Operação consistente, dentro das metas e com dados confiáveis.',
    healthy: 'Operação saudável, com poucos pontos que exigem acompanhamento.',
    attention: 'Existem desvios relevantes que devem ser revisados antes de aumentar o investimento.',
    critical: 'A operação possui falhas ou desvios que exigem ação prioritária.',
  };

  return {
    value: normalizedScore,
    status,
    confidence,
    coveragePercent,
    summary: summaries[status],
    signals,
  };
}
