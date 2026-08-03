import { metricLabels } from '../analysis/clientAnalysisProfile';
import { getClientPrimaryMetricView } from './clientAnalyticsDecision';
import type { GlobalClientPerformance, MetricContract } from './globalPerformanceDashboard';
import type { PerformanceEvaluation, PerformanceStatus, TargetKind } from './types';

export type ClientMetricComparisonStatus = PerformanceStatus | 'observed';
export type ClientMetricValueFormat = 'currency' | 'number' | 'percent' | 'multiplier';

export interface ClientMetricComparison {
  key: string;
  metricId: string;
  label: string;
  actualValue: number | null;
  targetKind: TargetKind | 'none' | 'budget_pacing';
  targetValue: number | null;
  targetMin: number | null;
  targetMax: number | null;
  differencePercent: number | null;
  status: ClientMetricComparisonStatus;
  confidence: number;
  format: ClientMetricValueFormat;
  currency: string | null;
  scopeLabel: string;
  source: 'target' | 'profile' | 'budget';
  priority: number;
}

const RESULT_COST_METRICS: Record<string, string> = {
  messaging_conversations_started_total: 'cost_per_messaging_conversation',
  whatsapp_conversations_started: 'cost_per_messaging_conversation',
  messenger_conversations_started: 'cost_per_messaging_conversation',
  instagram_direct_conversations_started: 'cost_per_messaging_conversation',
  messaging_conversations_started_generic: 'cost_per_messaging_conversation',
  leads: 'cost_per_lead',
  purchases: 'cost_per_purchase',
};

const COST_RESULT_METRICS: Record<string, string> = {
  cost_per_messaging_conversation: 'messaging_conversations_started_total',
  cost_per_lead: 'leads',
  cost_per_purchase: 'purchases',
};

function metricValue(metrics: Record<string, MetricContract>, metricId: string): number | null {
  const metric = metrics[metricId];
  return metric?.available && typeof metric.value === 'number' && Number.isFinite(metric.value)
    ? metric.value
    : null;
}

function metricFormat(metricId: string, targetKind?: TargetKind): ClientMetricValueFormat {
  if (targetKind === 'cost_per_result') return 'currency';
  if (metricId === 'purchase_roas') return 'multiplier';
  if (metricId.includes('ctr')) return 'percent';
  if (
    metricId === 'spend'
    || metricId === 'cpm'
    || metricId === 'link_cpc'
    || metricId === 'purchase_value'
    || metricId.startsWith('cost_per_')
  ) return 'currency';
  return 'number';
}

function displayMetricId(evaluation: PerformanceEvaluation): string {
  if (evaluation.targetKind !== 'cost_per_result') return evaluation.metricId;
  return RESULT_COST_METRICS[evaluation.metricId] ?? `cost_per_${evaluation.metricId}`;
}

function scopeLabel(client: GlobalClientPerformance, evaluation: PerformanceEvaluation): string {
  const account = client.accounts.find((item) => item.clientMetaAssetId === evaluation.clientMetaAssetId);
  if (evaluation.campaignId) return `${account?.accountName || 'Conta Meta'} · campanha`;
  return account?.accountName || (client.accounts.length > 1 ? 'Conta Meta' : 'Cliente');
}

function comparisonFromEvaluation(
  client: GlobalClientPerformance,
  evaluation: PerformanceEvaluation,
  index: number,
  desiredOrder: Map<string, number>
): ClientMetricComparison {
  const metricId = displayMetricId(evaluation);
  const account = client.accounts.find((item) => item.clientMetaAssetId === evaluation.clientMetaAssetId);
  const isPrimaryMetricTarget = evaluation.metricId === client.analysisProfile?.primaryConversionMetric;
  return {
    key: `target:${evaluation.clientMetaAssetId || 'client'}:${evaluation.campaignId || 'account'}:${evaluation.metricId}:${evaluation.targetKind}:${index}`,
    metricId,
    label: metricLabels[metricId] || metricId.split('_').join(' '),
    actualValue: evaluation.actualValue,
    targetKind: evaluation.targetKind,
    targetValue: evaluation.targetValue,
    targetMin: evaluation.targetMin ?? null,
    targetMax: evaluation.targetMax ?? null,
    differencePercent: evaluation.differencePercent,
    status: evaluation.status,
    confidence: evaluation.confidence,
    format: metricFormat(metricId, evaluation.targetKind),
    currency: account?.currency ?? null,
    scopeLabel: scopeLabel(client, evaluation),
    source: 'target',
    priority: desiredOrder.get(metricId)
      ?? (isPrimaryMetricTarget ? 0.5 : 100 + index - (evaluation.priorityWeight ?? 0)),
  };
}

function monitoredActual(
  client: GlobalClientPerformance,
  metricId: string,
  primaryView: ReturnType<typeof getClientPrimaryMetricView>
): number | null {
  if (metricId === client.analysisProfile?.primaryConversionMetric && primaryView.status === 'ok') {
    return primaryView.actual;
  }

  const primaryCostMetricId = client.analysisProfile?.primaryConversionMetric
    ? RESULT_COST_METRICS[client.analysisProfile.primaryConversionMetric]
    : null;
  if (metricId === primaryCostMetricId && primaryView.costMetric) return primaryView.costMetric.value;
  if (metricId === 'purchase_roas' && primaryView.secondaryMetric?.label === 'ROAS') return primaryView.secondaryMetric.value;

  const direct = metricValue(client.metrics, metricId);
  if (direct !== null) return direct;

  const resultMetricId = COST_RESULT_METRICS[metricId];
  const spend = metricValue(client.metrics, 'spend');
  const results = resultMetricId ? metricValue(client.metrics, resultMetricId) : null;
  return spend !== null && results !== null && results > 0 ? spend / results : null;
}

export function buildClientMetricComparisons(client: GlobalClientPerformance): ClientMetricComparison[] {
  const profile = client.analysisProfile;
  const desiredMetricIds = Array.from(new Set([
    profile?.primaryConversionMetric,
    ...(profile?.secondaryMetrics ?? []),
  ].filter((value): value is string => Boolean(value))));
  const desiredOrder = new Map(desiredMetricIds.map((metricId, index) => [metricId, index]));
  const primaryView = getClientPrimaryMetricView(
    profile,
    client.metrics ?? {},
    client.metricGroups ?? [],
    client.resolvedTargets ?? []
  );

  const comparisons = (client.evaluations ?? []).map((evaluation, index) => (
    comparisonFromEvaluation(client, evaluation, index, desiredOrder)
  ));
  const representedMetrics = new Set(comparisons.map((item) => item.metricId));

  desiredMetricIds.forEach((metricId, index) => {
    if (representedMetrics.has(metricId)) return;
    const actualValue = monitoredActual(client, metricId, primaryView);
    comparisons.push({
      key: `profile:${metricId}`,
      metricId,
      label: metricLabels[metricId] || metricId.split('_').join(' '),
      actualValue,
      targetKind: 'none',
      targetValue: null,
      targetMin: null,
      targetMax: null,
      differencePercent: null,
      status: actualValue === null ? 'unavailable' : 'observed',
      confidence: actualValue === null ? 0 : client.dataQuality.status === 'complete' ? 90 : 55,
      format: metricFormat(metricId),
      currency: client.accounts.length === 1 ? client.accounts[0].currency : null,
      scopeLabel: 'Perfil do cliente',
      source: 'profile',
      priority: index,
    });
  });

  if (client.budgetPacing) {
    comparisons.push({
      key: 'budget:pacing',
      metricId: 'spend',
      label: 'Investimento vs. ritmo',
      actualValue: client.budgetPacing.actualSpend,
      targetKind: 'budget_pacing',
      targetValue: client.budgetPacing.expectedSpendUntilNow,
      targetMin: null,
      targetMax: null,
      differencePercent: client.budgetPacing.differencePercent,
      status: client.budgetPacing.status,
      confidence: 95,
      format: 'currency',
      currency: client.budgetPacing.currency,
      scopeLabel: 'Período selecionado',
      source: 'budget',
      priority: desiredMetricIds.length + 1,
    });
  }

  return comparisons.sort((left, right) => left.priority - right.priority || right.confidence - left.confidence);
}
