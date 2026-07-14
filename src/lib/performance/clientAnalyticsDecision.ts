import type { Client } from '../../types';
import type { BudgetPeriod, ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';
import { calculateClientBudgetPacing, type BudgetPacingStatus } from './budgetPacingUtils';
import type { DataQualityContract, GlobalClientStatus, GlobalMetricGroup, MetricContract, RunSummary } from './globalPerformanceDashboard';
import type { PerformanceTarget, TargetKind } from './types';

export type ClientAnalyticsDecisionStatus =
  | 'healthy'
  | 'attention'
  | 'critical'
  | 'no_profile'
  | 'no_data'
  | 'stale_data';

export type PrimaryMetricFamily = 'sales' | 'leads' | 'messaging' | 'awareness' | 'traffic' | 'unknown';

// Same aliases ClientPrimaryMetricBlock.tsx uses to branch `profile.primaryConversionMetric`
// into a rendering family - kept in sync so the engine and the card agree on what
// "the primary metric" means for a given client.
const FAMILY_ALIASES: Record<Exclude<PrimaryMetricFamily, 'unknown'>, string[]> = {
  sales: ['purchases', 'compra_site', 'compra_checkout', 'pedido_realizado'],
  messaging: ['messaging_conversations_started_total', 'conversa_iniciada', 'whatsapp', 'mensagem_direct'],
  leads: ['leads', 'lead_gerado', 'agendamento_realizado', 'orcamento_solicitado', 'cadastro_preenchido', 'ligacao_recebida', 'rota_solicitada'],
  awareness: ['reach', 'alcance'],
  traffic: ['traffic', 'cliques', 'visitas_site'],
};

interface FamilyMetricIds {
  resultMetricId: string | null;
  costMetricId: string | null;
  label: string;
}

const FAMILY_METRIC_IDS: Record<PrimaryMetricFamily, FamilyMetricIds> = {
  sales: { resultMetricId: 'purchases', costMetricId: 'cost_per_purchase', label: 'Compras' },
  leads: { resultMetricId: 'leads', costMetricId: 'cost_per_lead', label: 'Leads' },
  messaging: { resultMetricId: 'messaging_conversations_started_total', costMetricId: 'cost_per_messaging_conversation', label: 'Conversas' },
  awareness: { resultMetricId: 'reach', costMetricId: null, label: 'Alcance' },
  traffic: { resultMetricId: 'link_clicks', costMetricId: 'link_cpc', label: 'Cliques' },
  unknown: { resultMetricId: null, costMetricId: null, label: 'Métrica' },
};

// "Próximo de estourar meta": custo já está a partir de 85% do teto configurado.
const NEAR_TARGET_RATIO = 0.85;
// ROAS "perto de romper o mínimo": até 15% acima do piso ainda é motivo de atenção.
const NEAR_MINIMUM_ROAS_RATIO = 1.15;
// Snapshot é considerado desatualizado a partir de 24h sem sync bem-sucedido.
const STALE_DATA_HOURS = 24;
// "Orçamento consumido sem conversão": 90%+ do orçamento gasto sem nenhum resultado.
const HIGH_BUDGET_CONSUMPTION_RATIO = 0.9;

export interface AnalyticsPeriod {
  /** ISO date (YYYY-MM-DD), inclusive. */
  start: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  end: string;
}

function toLocalISODate(date: Date): string {
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  normalized.setMinutes(normalized.getMinutes() - normalized.getTimezoneOffset());
  return normalized.toISOString().slice(0, 10);
}

/** Calendar-month boundaries for `referenceDate`, used to scope the monthly projection. */
export function deriveMonthPeriod(referenceDate: Date): AnalyticsPeriod {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  return {
    start: toLocalISODate(new Date(year, month, 1)),
    end: toLocalISODate(new Date(year, month + 1, 0)),
  };
}

export interface ClientAnalyticsDecisionInput {
  client: Pick<Client, 'id' | 'name' | 'company'>;
  analysisProfile: ClientAnalysisProfile | null | undefined;
  globalPerformance: {
    clientStatus: GlobalClientStatus;
    dataQuality: DataQualityContract;
    lastSuccessfulRun: RunSummary | null;
  } | null | undefined;
  accountMetrics: Record<string, MetricContract>;
  metricGroups: GlobalMetricGroup[];
  resolvedTargets: PerformanceTarget[];
  period: AnalyticsPeriod;
  currentDate: Date;
}

export interface ClientAnalyticsDecision {
  clientId: string;
  status: ClientAnalyticsDecisionStatus;
  primaryMetric: {
    family: PrimaryMetricFamily;
    metricId: string | null;
    resultMetricId: string | null;
    costMetricId: string | null;
    label: string;
  };
  target: {
    costCeiling: number | null;
    minRoas: number | null;
    minVolume: number | null;
    plannedBudget: number | null;
    budgetPeriod: BudgetPeriod | null;
  };
  actual: {
    resultCount: number | null;
    spend: number | null;
    costPerResult: number | null;
    roas: number | null;
    objectiveScoped: boolean;
  };
  gap: {
    costDifferenceValue: number | null;
    costDifferencePercent: number | null;
    volumeDeficit: number | null;
  };
  projection: {
    daysElapsed: number;
    daysRemaining: number;
    totalDays: number;
    dailySpendRate: number | null;
    dailyResultRate: number | null;
    projectedSpend: number | null;
    projectedResult: number | null;
  };
  budgetPacing: {
    status: BudgetPacingStatus;
    plannedMonthlyBudget: number | null;
    actualSpend: number;
    remainingBudget: number | null;
  };
  resultPacing: {
    status: 'no_target' | 'behind' | 'on_track' | 'ahead';
  };
  dataQuality: {
    status: 'complete' | 'partial' | 'unavailable';
    reason: string | null;
    lastSyncAgeHours: number | null;
  };
  mainProblem: string | null;
  recommendation: string;
}

function resolvePrimaryMetricFamily(metricId: string | null | undefined): PrimaryMetricFamily {
  if (!metricId) return 'unknown';
  for (const family of Object.keys(FAMILY_ALIASES) as Array<keyof typeof FAMILY_ALIASES>) {
    if (FAMILY_ALIASES[family].includes(metricId)) return family;
  }
  return 'unknown';
}

interface ObjectiveScopedTotals {
  resultValue: number;
  spendValue: number | null;
  purchaseValue: number | null;
  /** Set only when every contributing group belongs to the same Meta ad account. */
  clientMetaAssetId: string | null;
  mixedScope: boolean;
  allComplete: boolean;
}

/**
 * Reproduces the same accumulation `evaluateTarget` (globalPerformanceDashboard.ts)
 * performs before evaluating a target: sum spend/result only across the metricGroups
 * that actually carry the resolved result metric, so CPA/CPL/custo-por-conversa never
 * divides by the account's blunt total spend when the primary metric is objective-scoped.
 */
function accumulateObjectiveScoped(metricGroups: GlobalMetricGroup[], resultMetricId: string): ObjectiveScopedTotals | null {
  const relevant = metricGroups.filter((group) => group.metrics[resultMetricId]?.available);
  if (relevant.length === 0) return null;

  const attributions = new Set(relevant.map((group) => group.attributionSetting ?? 'none'));
  // Clientes com mais de uma conta Meta vinculada não podem ter o gasto somado
  // entre contas - cada conta tem seu próprio teto de custo configurado.
  const accounts = new Set(relevant.map((group) => group.clientMetaAssetId));
  const mixedScope = attributions.size > 1 || accounts.size > 1;
  let resultValue = 0;
  let spendValue = 0;
  let purchaseValue = 0;
  let hasSpend = false;
  let hasPurchaseValue = false;
  let allComplete = true;

  for (const group of relevant) {
    const result = group.metrics[resultMetricId];
    if (typeof result?.value === 'number') resultValue += result.value;

    const spend = group.metrics.spend;
    if (spend?.available && typeof spend.value === 'number') {
      spendValue += spend.value;
      hasSpend = true;
    }

    const value = group.metrics.purchase_value;
    if (value?.available && typeof value.value === 'number') {
      purchaseValue += value.value;
      hasPurchaseValue = true;
    }

    const completeness = result?.completenessStatus ?? group.completenessStatus;
    if (completeness && !['complete', 'zero_delivery'].includes(completeness)) allComplete = false;
  }

  return {
    resultValue,
    spendValue: hasSpend ? spendValue : null,
    purchaseValue: hasPurchaseValue ? purchaseValue : null,
    clientMetaAssetId: accounts.size === 1 ? Array.from(accounts)[0] : null,
    mixedScope,
    allComplete,
  };
}

function metricValue(metrics: Record<string, MetricContract>, metricId: string): number | null {
  const metric = metrics[metricId];
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

/**
 * When `clientMetaAssetId` is given (the single account the objective-scoped
 * totals were accumulated from), only match targets configured for that same
 * account - a client with two linked ad accounts can have two different KPI
 * ceilings for the same metric id. Falls back to matching by metricId alone
 * when the caller has no single resolved account (blunt/unscoped fallback).
 */
function findTargetValue(
  targets: PerformanceTarget[],
  metricId: string | null,
  kinds: TargetKind[],
  clientMetaAssetId: string | null = null
): number | null {
  if (!metricId) return null;
  const candidates = targets.filter((target) => target.metricId === metricId && kinds.includes(target.targetKind));
  if (clientMetaAssetId) {
    const scoped = candidates.find((target) => target.clientMetaAssetId === clientMetaAssetId);
    if (scoped) return scoped.targetValue;
  }
  return candidates[0]?.targetValue ?? null;
}

function daysInclusive(startISO: string, endISO: string): number {
  const start = new Date(`${startISO}T00:00:00`);
  const end = new Date(`${endISO}T00:00:00`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function computeProjection(
  spend: number | null,
  resultCount: number | null,
  period: AnalyticsPeriod,
  currentDate: Date
): ClientAnalyticsDecision['projection'] {
  const totalDays = daysInclusive(period.start, period.end);
  const start = new Date(`${period.start}T00:00:00`);
  const elapsedMs = currentDate.getTime() - start.getTime();
  const daysElapsed = Math.min(totalDays, Math.max(1, Math.ceil(elapsedMs / 86_400_000)));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);

  const dailySpendRate = spend !== null ? spend / daysElapsed : null;
  const dailyResultRate = resultCount !== null ? resultCount / daysElapsed : null;

  return {
    daysElapsed,
    daysRemaining,
    totalDays,
    dailySpendRate,
    dailyResultRate,
    projectedSpend: dailySpendRate !== null ? dailySpendRate * totalDays : null,
    projectedResult: dailyResultRate !== null ? dailyResultRate * totalDays : null,
  };
}

// Mesmo limiar usado em collectReasons para 'projection_below_target': qualquer
// projeção abaixo da meta já conta como 'behind' aqui, para que resultPacing
// nunca contradiga o status/mainProblem calculados a partir da mesma projeção.
function resultPacingStatus(minVolume: number | null, projectedResult: number | null): ClientAnalyticsDecision['resultPacing']['status'] {
  if (minVolume === null || projectedResult === null) return 'no_target';
  if (projectedResult < minVolume) return 'behind';
  if (projectedResult > minVolume / NEAR_TARGET_RATIO) return 'ahead';
  return 'on_track';
}

interface StatusReason {
  severity: 'critical' | 'attention';
  code: string;
}

function collectReasons(input: {
  costCeiling: number | null;
  actualCost: number | null;
  minRoas: number | null;
  roas: number | null;
  minVolume: number | null;
  projectedResult: number | null;
  spend: number | null;
  resultCount: number | null;
  plannedBudget: number | null;
  budgetPacingStatus: BudgetPacingStatus;
  dataQualityStatus: 'complete' | 'partial' | 'unavailable';
  objectiveDataIncomplete: boolean;
}): StatusReason[] {
  const reasons: StatusReason[] = [];
  const { costCeiling, actualCost, minRoas, roas, minVolume, projectedResult, spend, resultCount, plannedBudget, budgetPacingStatus, dataQualityStatus, objectiveDataIncomplete } = input;

  if (costCeiling !== null && actualCost !== null) {
    if (actualCost > costCeiling) reasons.push({ severity: 'critical', code: 'cost_above_target' });
    else if (actualCost >= costCeiling * NEAR_TARGET_RATIO) reasons.push({ severity: 'attention', code: 'cost_near_target' });
  }

  if (minRoas !== null && roas !== null) {
    if (roas < minRoas) reasons.push({ severity: 'critical', code: 'roas_below_minimum' });
    else if (roas <= minRoas * NEAR_MINIMUM_ROAS_RATIO) reasons.push({ severity: 'attention', code: 'roas_near_minimum' });
  }

  const noResultYet = resultCount === null || resultCount === 0;
  if (plannedBudget && spend !== null && spend / plannedBudget >= HIGH_BUDGET_CONSUMPTION_RATIO && noResultYet) {
    reasons.push({ severity: 'critical', code: 'budget_consumed_without_conversion' });
  } else if (costCeiling !== null && spend !== null && spend > costCeiling && noResultYet) {
    reasons.push({ severity: 'critical', code: 'spend_without_result' });
  }

  if (minVolume !== null && projectedResult !== null && projectedResult < minVolume) {
    reasons.push({ severity: 'attention', code: 'projection_below_target' });
  }

  if (budgetPacingStatus === 'over_pacing' || budgetPacingStatus === 'under_pacing' || budgetPacingStatus === 'budget_exceeded') {
    reasons.push({ severity: 'attention', code: 'budget_pacing_off' });
  }

  if (dataQualityStatus === 'partial' || objectiveDataIncomplete) {
    reasons.push({ severity: 'attention', code: 'partial_data' });
  }

  return reasons;
}

const REASON_PRIORITY = [
  'cost_above_target',
  'roas_below_minimum',
  'budget_consumed_without_conversion',
  'spend_without_result',
  'cost_near_target',
  'roas_near_minimum',
  'projection_below_target',
  'budget_pacing_off',
  'partial_data',
];

function pickMainProblem(reasons: StatusReason[]): StatusReason | null {
  if (reasons.length === 0) return null;
  return [...reasons].sort((a, b) => REASON_PRIORITY.indexOf(a.code) - REASON_PRIORITY.indexOf(b.code))[0];
}

function money(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const FAMILY_CHANNEL_HINT: Record<PrimaryMetricFamily, string> = {
  sales: 'vendas',
  leads: 'geração de leads',
  messaging: 'mensageria',
  awareness: 'alcance',
  traffic: 'tráfego',
  unknown: 'operação',
};

function buildRecommendation(
  mainProblem: StatusReason | null,
  ctx: {
    label: string;
    family: PrimaryMetricFamily;
    costCeiling: number | null;
    actualCost: number | null;
    minRoas: number | null;
    roas: number | null;
    minVolume: number | null;
    projectedResult: number | null;
    spend: number | null;
    budgetPacingStatus: BudgetPacingStatus;
  }
): string {
  const { label, family, costCeiling, actualCost, minRoas, roas, minVolume, projectedResult, spend, budgetPacingStatus } = ctx;
  const channel = FAMILY_CHANNEL_HINT[family];

  switch (mainProblem?.code) {
    case 'cost_above_target':
      return `Custo por ${label.toLowerCase()} acima da meta: alvo ${money(costCeiling ?? 0)}, atual ${money(actualCost ?? 0)}. Verificar campanhas de ${channel}.`;
    case 'cost_near_target':
      return `Custo por ${label.toLowerCase()} próximo do teto: alvo ${money(costCeiling ?? 0)}, atual ${money(actualCost ?? 0)}. Acompanhar de perto antes de estourar a meta.`;
    case 'roas_below_minimum':
      return `ROAS abaixo do mínimo: alvo ${(minRoas ?? 0).toFixed(2)}x, atual ${(roas ?? 0).toFixed(2)}x.`;
    case 'roas_near_minimum':
      return `ROAS próximo do mínimo aceitável: alvo ${(minRoas ?? 0).toFixed(2)}x, atual ${(roas ?? 0).toFixed(2)}x.`;
    case 'budget_consumed_without_conversion':
      return `Orçamento consumido sem conversão: já investiu ${money(spend ?? 0)} sem gerar ${label.toLowerCase()} no período. Revisar segmentação e criativos.`;
    case 'spend_without_result':
      return `Gasto alto sem resultado: já investiu ${money(spend ?? 0)} sem gerar ${label.toLowerCase()} no período. Revisar segmentação e criativos.`;
    case 'projection_below_target':
      return `Está abaixo do ritmo: com o volume atual, a conta deve entregar ${Math.round(projectedResult ?? 0)} ${label.toLowerCase()} até o fim do mês, contra uma meta de ${minVolume}.`;
    case 'budget_pacing_off':
      return budgetPacingStatus === 'under_pacing'
        ? 'Ritmo de gasto abaixo do esperado: orçamento corre risco de não ser entregue totalmente no período.'
        : 'Ritmo de gasto acima do esperado: orçamento pode se esgotar antes do fim do período.';
    case 'partial_data':
      return 'Dados parciais — leitura limitada. Verificar sincronização e rastreamento antes de decidir.';
    default:
      return 'Operação dentro do esperado. Continue monitorando o ritmo de entrega.';
  }
}

export function buildClientAnalyticsDecision(input: ClientAnalyticsDecisionInput): ClientAnalyticsDecision {
  const { client, analysisProfile, globalPerformance, accountMetrics, metricGroups, resolvedTargets, period, currentDate } = input;

  const family = resolvePrimaryMetricFamily(analysisProfile?.primaryConversionMetric);
  const familyIds = FAMILY_METRIC_IDS[family];
  const primaryMetric: ClientAnalyticsDecision['primaryMetric'] = {
    family,
    metricId: analysisProfile?.primaryConversionMetric ?? null,
    resultMetricId: familyIds.resultMetricId,
    costMetricId: familyIds.costMetricId,
    label: familyIds.label,
  };

  const dataQualityStatus = globalPerformance?.dataQuality?.status ?? 'unavailable';
  const clientStatus = globalPerformance?.clientStatus;
  const lastSuccessfulRun = globalPerformance?.lastSuccessfulRun ?? null;

  const lastSyncAgeHours = lastSuccessfulRun?.finishedAt
    ? (currentDate.getTime() - new Date(lastSuccessfulRun.finishedAt).getTime()) / 3_600_000
    : null;

  const emptyProjection = computeProjection(null, null, period, currentDate);

  // Gate 1: no profile configured at all - nothing downstream can be evaluated.
  if (!analysisProfile || !analysisProfile.analysisEnabled || !analysisProfile.primaryConversionMetric) {
    return {
      clientId: client.id,
      status: 'no_profile',
      primaryMetric,
      target: { costCeiling: null, minRoas: null, minVolume: null, plannedBudget: null, budgetPeriod: null },
      actual: { resultCount: null, spend: null, costPerResult: null, roas: null, objectiveScoped: false },
      gap: { costDifferenceValue: null, costDifferencePercent: null, volumeDeficit: null },
      projection: emptyProjection,
      budgetPacing: { status: 'no_budget', plannedMonthlyBudget: null, actualSpend: 0, remainingBudget: null },
      resultPacing: { status: 'no_target' },
      dataQuality: { status: 'unavailable', reason: null, lastSyncAgeHours },
      mainProblem: 'no_profile',
      recommendation: 'Perfil de análise não configurado. Configure metas para ativar a leitura operacional.',
    };
  }

  const resultMetricId = familyIds.resultMetricId;
  const scoped = resultMetricId ? accumulateObjectiveScoped(metricGroups, resultMetricId) : null;
  const objectiveScoped = scoped !== null && !scoped.mixedScope;
  const scopedAccountId = objectiveScoped ? scoped!.clientMetaAssetId : null;

  const resultCount = objectiveScoped ? scoped!.resultValue : resultMetricId ? metricValue(accountMetrics, resultMetricId) : null;
  const spend = objectiveScoped ? scoped!.spendValue : metricValue(accountMetrics, 'spend');
  const purchaseValue = objectiveScoped ? scoped!.purchaseValue : metricValue(accountMetrics, 'purchase_value');
  // ROAS segue a mesma regra de escopo do CPA: quando os grupos já foram
  // isolados por objetivo/conta mas nenhum deles carrega purchase_value, não
  // cai para o ROAS bruto da conta (misturaria escopos) - fica indisponível.
  const roas = purchaseValue !== null && spend !== null && spend > 0
    ? purchaseValue / spend
    : objectiveScoped
      ? null
      : metricValue(accountMetrics, 'purchase_roas');

  const hasReliableData = (spend !== null && spend > 0) || (resultCount !== null && resultCount > 0)
    || ['impressions', 'reach'].some((id) => (metricValue(accountMetrics, id) ?? 0) > 0);
  const noAccountConnection = clientStatus
    ? ['not_connected', 'never_synced', 'sync_without_metrics', 'no_delivery'].includes(clientStatus)
    : false;

  // Gate 2: profile is configured, but there is nothing usable to evaluate against it.
  if (!hasReliableData && (noAccountConnection || dataQualityStatus === 'unavailable')) {
    return {
      clientId: client.id,
      status: 'no_data',
      primaryMetric,
      target: {
        costCeiling: findTargetValue(resolvedTargets, resultMetricId, ['cost_per_result'], scopedAccountId),
        minRoas: findTargetValue(resolvedTargets, 'purchase_roas', ['minimum_metric'], scopedAccountId),
        minVolume: findTargetValue(resolvedTargets, resultMetricId, ['minimum_results'], scopedAccountId),
        plannedBudget: analysisProfile.plannedBudget,
        budgetPeriod: analysisProfile.budgetPeriod,
      },
      actual: { resultCount: null, spend: null, costPerResult: null, roas: null, objectiveScoped: false },
      gap: { costDifferenceValue: null, costDifferencePercent: null, volumeDeficit: null },
      projection: emptyProjection,
      budgetPacing: { status: 'no_budget', plannedMonthlyBudget: null, actualSpend: 0, remainingBudget: null },
      resultPacing: { status: 'no_target' },
      dataQuality: { status: dataQualityStatus, reason: globalPerformance?.dataQuality?.reason ?? null, lastSyncAgeHours },
      mainProblem: 'no_data',
      recommendation: 'Sem dados suficientes: último sync parcial ou sem entrega real no período. Sincronize a conta Meta.',
    };
  }

  // Gate 3: profile + data exist, but the last successful sync is too old to trust.
  if (lastSyncAgeHours !== null && lastSyncAgeHours >= STALE_DATA_HOURS) {
    return {
      clientId: client.id,
      status: 'stale_data',
      primaryMetric,
      target: {
        costCeiling: findTargetValue(resolvedTargets, resultMetricId, ['cost_per_result'], scopedAccountId),
        minRoas: findTargetValue(resolvedTargets, 'purchase_roas', ['minimum_metric'], scopedAccountId),
        minVolume: findTargetValue(resolvedTargets, resultMetricId, ['minimum_results'], scopedAccountId),
        plannedBudget: analysisProfile.plannedBudget,
        budgetPeriod: analysisProfile.budgetPeriod,
      },
      actual: { resultCount, spend, costPerResult: null, roas, objectiveScoped },
      gap: { costDifferenceValue: null, costDifferencePercent: null, volumeDeficit: null },
      projection: emptyProjection,
      budgetPacing: { status: 'no_budget', plannedMonthlyBudget: null, actualSpend: spend ?? 0, remainingBudget: null },
      resultPacing: { status: 'no_target' },
      dataQuality: { status: dataQualityStatus, reason: globalPerformance?.dataQuality?.reason ?? null, lastSyncAgeHours },
      mainProblem: 'stale_data',
      recommendation: `Dados desatualizados: último sincronismo confiável há mais de ${STALE_DATA_HOURS}h. Sincronize a conta Meta para uma leitura confiável.`,
    };
  }

  const costCeiling = findTargetValue(resolvedTargets, resultMetricId, ['cost_per_result'], scopedAccountId);
  const minRoas = findTargetValue(resolvedTargets, 'purchase_roas', ['minimum_metric'], scopedAccountId);
  const minVolume = findTargetValue(resolvedTargets, resultMetricId, ['minimum_results'], scopedAccountId);
  const plannedBudget = analysisProfile.plannedBudget;

  const actualCost = spend !== null && resultCount !== null && resultCount > 0 ? spend / resultCount : null;
  const costDifferenceValue = costCeiling !== null && actualCost !== null ? actualCost - costCeiling : null;
  const costDifferencePercent = costDifferenceValue !== null && costCeiling ? (costDifferenceValue / costCeiling) * 100 : null;

  const projection = computeProjection(spend, resultCount, period, currentDate);
  const volumeDeficit = minVolume !== null && projection.projectedResult !== null
    ? Math.max(0, minVolume - projection.projectedResult)
    : null;

  const budgetPacingCalc = calculateClientBudgetPacing(plannedBudget, analysisProfile.budgetPeriod, spend ?? 0, currentDate);

  const reasons = collectReasons({
    costCeiling,
    actualCost,
    minRoas,
    roas,
    minVolume,
    projectedResult: projection.projectedResult,
    spend,
    resultCount,
    plannedBudget,
    budgetPacingStatus: budgetPacingCalc.status,
    dataQualityStatus,
    objectiveDataIncomplete: scoped ? !scoped.allComplete : false,
  });
  const mainProblem = pickMainProblem(reasons);
  const status: ClientAnalyticsDecisionStatus = mainProblem?.severity === 'critical'
    ? 'critical'
    : mainProblem?.severity === 'attention'
      ? 'attention'
      : 'healthy';

  return {
    clientId: client.id,
    status,
    primaryMetric,
    target: { costCeiling, minRoas, minVolume, plannedBudget, budgetPeriod: analysisProfile.budgetPeriod },
    actual: { resultCount, spend, costPerResult: actualCost, roas, objectiveScoped },
    gap: { costDifferenceValue, costDifferencePercent, volumeDeficit },
    projection,
    budgetPacing: {
      status: budgetPacingCalc.status,
      plannedMonthlyBudget: budgetPacingCalc.plannedMonthlyBudget,
      actualSpend: budgetPacingCalc.actualSpend,
      remainingBudget: budgetPacingCalc.remainingBudget,
    },
    resultPacing: { status: resultPacingStatus(minVolume, projection.projectedResult) },
    dataQuality: { status: dataQualityStatus, reason: globalPerformance?.dataQuality?.reason ?? null, lastSyncAgeHours },
    mainProblem: mainProblem?.code ?? null,
    recommendation: buildRecommendation(mainProblem, {
      label: familyIds.label,
      family,
      costCeiling,
      actualCost,
      minRoas,
      roas,
      minVolume,
      projectedResult: projection.projectedResult,
      spend,
      budgetPacingStatus: budgetPacingCalc.status,
    }),
  };
}
