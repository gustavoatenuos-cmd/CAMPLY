import type { Client } from '../../types';
import { clientSeverity, effectiveClientProfile } from '../../components/performance/CommercialDecisionOverview';
import type { GlobalClientPerformance, GlobalPerformanceAccount, MetricContract } from './globalPerformanceDashboard';
import { describeDataQualityReason } from './dataQualityReason';
import type { DashboardPeriod } from './analyticsCapabilities';
import { explainDashboardClientSync } from './explainClientSyncState';
import { explainOperationalSyncState } from '../operational/operationalSyncState';

/**
 * Camada de leitura para o dashboard operacional (OverviewView): agrupa os
 * mesmos dados já usados por clientSeverity/PerformanceEvaluation em uma
 * classificação de prioridade (o que exige ação agora) com o motivo exato,
 * em vez de cada bloco da tela (resumo, prioridade, cards) reinterpretar o
 * cliente à sua maneira.
 */

export type PriorityTier = 'action_now' | 'attention' | 'healthy';

export type ClientDiagnosisReason =
  | 'sync_failed'
  | 'sync_partial'
  | 'sync_stale'
  | 'not_synced'
  | 'no_profile'
  | 'analysis_disabled'
  | 'insufficient_data'
  | 'cost_above_target'
  | 'goal_below_target'
  | 'no_conversion'
  | 'healthy';

export interface ClientPriorityEntry {
  client: GlobalClientPerformance;
  workspaceClient: Client | undefined;
  tier: PriorityTier;
  reasons: ClientDiagnosisReason[];
}

export type AccountReliability = 'reliable' | 'problem' | 'not_synced';

function isCostMetric(metricId: string): boolean {
  return metricId.startsWith('cost_per') || metricId === 'cpm';
}

function metricNumber(metric: MetricContract | undefined): number | null {
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

/**
 * Uma conta só é "sync confiável" quando já teve sucesso e a leitura mais
 * recente não regrediu. Sem NENHUMA tentativa para o período (`lastAttempt`
 * nulo) é `not_synced`, não `problem` — ausência de sync não é falha do
 * cliente (ver regra de contrato período<->sync do dashboard).
 */
export function classifyAccountReliability(
  account: Pick<GlobalPerformanceAccount, 'clientMetaAssetId' | 'accountName' | 'dateStart' | 'dateStop' | 'metrics' | 'dataQuality' | 'lastSuccessfulRun' | 'lastAttempt'>,
  selectedPeriod: DashboardPeriod,
): AccountReliability {
  const explanation = explainOperationalSyncState({
    selectedPeriod,
    clientId: account.clientMetaAssetId,
    clientName: account.accountName,
    accounts: [{ clientMetaAssetId: account.clientMetaAssetId, accountName: account.accountName }],
    lastSuccessfulRun: account.lastSuccessfulRun,
    lastAttempt: account.lastAttempt,
    dataQuality: account.dataQuality,
    requestedPeriod: null,
    exactRange: { dateStart: account.dateStart, dateStop: account.dateStop },
    metrics: account.metrics,
  });
  if (explanation.status === 'not_synced') return 'not_synced';
  if (explanation.status === 'success' && explanation.canUseData) return 'reliable';
  return 'problem';
}
function collectReasons(client: GlobalClientPerformance, selectedPeriod: DashboardPeriod): ClientDiagnosisReason[] {
  const reasons: ClientDiagnosisReason[] = [];
  const profile = effectiveClientProfile(client);

  // client.analysisProfile ausente = nunca configurado; presente mas
  // analysisEnabled=false = opt-out intencional - motivos e severidade
  // diferentes (ver CommercialDecisionOverview.pendingReasons, que já separa os dois casos).
  if (!client.analysisProfile) reasons.push('no_profile');
  else if (!client.analysisProfile.analysisEnabled) reasons.push('analysis_disabled');

  const sync = explainDashboardClientSync(client, selectedPeriod);
  if (sync.status === 'failed') reasons.push('sync_failed');
  else if (sync.status === 'stale') reasons.push('sync_stale');
  else if (sync.status === 'not_synced' || sync.status === 'no_account') reasons.push('not_synced');
  else if (sync.status === 'partial') reasons.push('sync_partial');

  // Se o motivo já é "não sincronizado", clientSeverity() também classificaria
  // como no_data (never_synced está nesse balde) — mas insufficient_data
  // implica tier action_now, que é exatamente o que a regra de contrato
  // período<->sync proíbe para "ainda não sincronizou". not_synced é mutuamente
  // exclusivo com insufficient_data por design.
  if (clientSeverity(client) === 'no_data' && !reasons.includes('not_synced')) reasons.push('insufficient_data');

  // Qualquer meta (de custo ou não) fora da tolerância vira motivo - nunca
  // deixamos uma avaliação attention/critical sem um reason correspondente,
  // senão o badge (derivado de tier/hasCriticalEvaluation) e o texto de
  // diagnóstico (derivado de reasons) podem divergir para o mesmo cliente.
  const offTargetEvaluations = client.evaluations.filter((evaluation) => (
    evaluation.status === 'critical' || evaluation.status === 'attention'
  ));
  if (offTargetEvaluations.some((evaluation) => isCostMetric(evaluation.metricId))) {
    reasons.push('cost_above_target');
  }
  if (offTargetEvaluations.some((evaluation) => !isCostMetric(evaluation.metricId))) {
    reasons.push('goal_below_target');
  }

  const spend = metricNumber(client.metrics.spend);
  const primaryMetricId = profile?.primaryConversionMetric;
  if (primaryMetricId && spend !== null && spend > 0) {
    const primaryValue = metricNumber(client.metrics[primaryMetricId]);
    if (primaryValue === 0) reasons.push('no_conversion');
  }

  if (reasons.length === 0) reasons.push('healthy');
  return reasons;
}

function tierFor(client: GlobalClientPerformance, reasons: ClientDiagnosisReason[]): PriorityTier {
  const hasCriticalEvaluation = client.evaluations.some((evaluation) => evaluation.status === 'critical');
  if (
    reasons.includes('no_profile')
    || reasons.includes('sync_failed')
    || reasons.includes('insufficient_data')
    || hasCriticalEvaluation
  ) {
    return 'action_now';
  }
  if (
    reasons.includes('sync_partial')
    || reasons.includes('sync_stale')
    || reasons.includes('not_synced')
    || reasons.includes('cost_above_target')
    || reasons.includes('goal_below_target')
    || reasons.includes('no_conversion')
    || reasons.includes('analysis_disabled')
  ) {
    return 'attention';
  }
  return 'healthy';
}

export function buildClientPriorityEntries(
  clients: GlobalClientPerformance[],
  workspaceClients: Client[],
  selectedPeriod: DashboardPeriod,
): ClientPriorityEntry[] {
  return clients.map((client) => {
    const reasons = collectReasons(client, selectedPeriod);
    return {
      client,
      workspaceClient: workspaceClients.find((candidate) => candidate.id === client.clientId),
      tier: tierFor(client, reasons),
      reasons,
    };
  });
}

/** Investimento do cliente no recorte - usado tanto para ordenar quanto para exibir, nunca os dois separadamente (ver ClientPriorityBoard). */
export function clientSpend(client: GlobalClientPerformance): number {
  const clientLevel = metricNumber(client.metrics.spend);
  if (clientLevel !== null) return clientLevel;
  return client.accounts.reduce((total, account) => total + (metricNumber(account.metrics.spend) ?? 0), 0);
}

export function groupByPriorityTier(entries: ClientPriorityEntry[]): Record<PriorityTier, ClientPriorityEntry[]> {
  const groups: Record<PriorityTier, ClientPriorityEntry[]> = { action_now: [], attention: [], healthy: [] };
  for (const entry of entries) groups[entry.tier].push(entry);
  (Object.keys(groups) as PriorityTier[]).forEach((tier) => {
    groups[tier].sort((a, b) => clientSpend(b.client) - clientSpend(a.client));
  });
  return groups;
}

const REASON_LABELS: Record<ClientDiagnosisReason, string> = {
  sync_failed: 'Falha de sincronização Meta',
  sync_partial: 'Sincronização parcial',
  sync_stale: 'Sincronização desatualizada',
  not_synced: 'Período não sincronizado',
  no_profile: 'Meta principal não configurada',
  analysis_disabled: 'Análise desativada para este cliente',
  insufficient_data: 'Poucos dados confiáveis',
  cost_above_target: 'Custo acima da meta',
  goal_below_target: 'Resultado abaixo da meta principal',
  no_conversion: 'Investimento sem conversão registrada',
  healthy: 'Situação saudável',
};

export function reasonLabel(reason: ClientDiagnosisReason): string {
  return REASON_LABELS[reason];
}

/**
 * Motivo técnico exato por trás de uma sincronização parcial ou falha (ex.:
 * "partial_page", "rate_limit_exhausted", "timeout"), traduzido para uma
 * frase legível. `sync_partial`/`sync_failed` sozinhos só dizem "algo não
 * fechou" — isso complementa com o porquê, quando o backend informou um.
 */
export function technicalSyncReason(client: GlobalClientPerformance): string | null {
  if (client.dataQuality.status === 'complete') return null;
  return describeDataQualityReason(client.dataQuality.reason);
}

/** Frase curta de diagnóstico exibida no card do cliente. */
export function summarizeDiagnosis(client: GlobalClientPerformance, reasons: ClientDiagnosisReason[]): string {
  const meaningful = reasons.filter((reason) => reason !== 'healthy');
  if (meaningful.length === 0) return 'Situação saudável — sem pendências identificadas.';
  const base = `${meaningful.map((reason) => reasonLabel(reason)).join('; ')}.`;
  const technical = (reasons.includes('sync_partial') || reasons.includes('sync_failed'))
    ? technicalSyncReason(client)
    : null;
  return technical ? `${base} Motivo técnico: ${technical}` : base;
}

export const PRIORITY_TIER_LABELS: Record<PriorityTier, string> = {
  action_now: 'Exige ação agora',
  attention: 'Em atenção',
  healthy: 'Saudáveis',
};

/** Os 7 status visuais padronizados do dashboard operacional (OperationalHealthBadge). */
export type OperationalHealthTag =
  | 'ready'
  | 'attention'
  | 'critical'
  | 'insufficient_data'
  | 'sync_failed'
  | 'sync_partial'
  | 'not_synced';

const REASON_TAG_PRIORITY: Array<[ClientDiagnosisReason, OperationalHealthTag]> = [
  ['sync_failed', 'sync_failed'],
  ['sync_partial', 'sync_partial'],
  ['not_synced', 'not_synced'],
  ['insufficient_data', 'insufficient_data'],
];

/** Reduz o conjunto de motivos de um cliente a UM único badge dominante (a lista completa continua disponível em `reasons`). */
export function operationalHealthTagFor(entry: Pick<ClientPriorityEntry, 'tier' | 'reasons'>): OperationalHealthTag {
  for (const [reason, tag] of REASON_TAG_PRIORITY) {
    if (entry.reasons.includes(reason)) return tag;
  }
  if (entry.tier === 'action_now') return 'critical';
  if (entry.tier === 'attention') return 'attention';
  return 'ready';
}
