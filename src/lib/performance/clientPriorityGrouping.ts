import type { Client } from '../../types';
import { clientSeverity, effectiveClientProfile } from '../../components/performance/CommercialDecisionOverview';
import type { GlobalClientPerformance, GlobalPerformanceAccount, MetricContract } from './globalPerformanceDashboard';

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

export type AccountReliability = 'reliable' | 'problem';

// clientStatus cujo estado da sincronização já não é sucesso limpo, mas
// também não é falha nem "sem dados" — mesmo balde de atenção que
// clientSeverity() usa (CommercialDecisionOverview.tsx).
const ATTENTION_SYNC_STATUSES: GlobalClientPerformance['clientStatus'][] = ['partial', 'syncing', 'period_not_synced'];

function isCostMetric(metricId: string): boolean {
  return metricId.startsWith('cost_per') || metricId === 'cpm';
}

function metricNumber(metric: MetricContract | undefined): number | null {
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

/** Uma conta só é "sync confiável" quando já teve sucesso e a leitura mais recente não regrediu. */
export function classifyAccountReliability(
  account: Pick<GlobalPerformanceAccount, 'dataQuality' | 'lastSuccessfulRun' | 'lastAttempt'>
): AccountReliability {
  if (!account.lastSuccessfulRun) return 'problem';
  if (account.dataQuality.status !== 'complete') return 'problem';
  if (
    account.lastAttempt
    && account.lastAttempt.id !== account.lastSuccessfulRun.id
    && account.lastAttempt.status !== 'success'
  ) {
    return 'problem';
  }
  return 'reliable';
}

function collectReasons(client: GlobalClientPerformance): ClientDiagnosisReason[] {
  const reasons: ClientDiagnosisReason[] = [];
  const profile = effectiveClientProfile(client);

  // client.analysisProfile ausente = nunca configurado; presente mas
  // analysisEnabled=false = opt-out intencional - motivos e severidade
  // diferentes (ver CommercialDecisionOverview.pendingReasons, que já separa os dois casos).
  if (!client.analysisProfile) reasons.push('no_profile');
  else if (!client.analysisProfile.analysisEnabled) reasons.push('analysis_disabled');

  if (client.clientStatus === 'failed') reasons.push('sync_failed');
  else if (client.clientStatus === 'stale') reasons.push('sync_stale');
  else if (ATTENTION_SYNC_STATUSES.includes(client.clientStatus)) reasons.push('sync_partial');

  if (clientSeverity(client) === 'no_data') reasons.push('insufficient_data');

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
  workspaceClients: Client[]
): ClientPriorityEntry[] {
  return clients.map((client) => {
    const reasons = collectReasons(client);
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

/** Frase curta de diagnóstico exibida no card do cliente. */
export function summarizeDiagnosis(reasons: ClientDiagnosisReason[]): string {
  const meaningful = reasons.filter((reason) => reason !== 'healthy');
  if (meaningful.length === 0) return 'Situação saudável — sem pendências identificadas.';
  return `${meaningful.map((reason) => reasonLabel(reason)).join('; ')}.`;
}

export const PRIORITY_TIER_LABELS: Record<PriorityTier, string> = {
  action_now: 'Exige ação agora',
  attention: 'Em atenção',
  healthy: 'Saudáveis',
};

/** Os 6 status visuais padronizados do dashboard operacional (OperationalHealthBadge). */
export type OperationalHealthTag =
  | 'ready'
  | 'attention'
  | 'critical'
  | 'insufficient_data'
  | 'sync_failed'
  | 'sync_partial';

const REASON_TAG_PRIORITY: Array<[ClientDiagnosisReason, OperationalHealthTag]> = [
  ['sync_failed', 'sync_failed'],
  ['sync_partial', 'sync_partial'],
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
