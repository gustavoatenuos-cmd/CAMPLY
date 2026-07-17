import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import type {
  DataQualityContract,
  MetricContract,
  RunSummary,
} from '../performance/globalPerformanceDashboard';

export type OperationalSyncStatus = 'success' | 'not_synced' | 'partial' | 'failed' | 'stale' | 'no_account';

export interface OperationalSyncRun extends RunSummary {
  requestedPeriod: DashboardPeriod | null;
}

export interface OperationalSyncAccount {
  clientMetaAssetId: string;
  accountName: string;
}

export interface OperationalSyncExactRange {
  dateStart: string | null;
  dateStop: string | null;
}

export interface ExplainOperationalSyncStateInput {
  selectedPeriod: DashboardPeriod;
  clientId: string;
  clientName: string;
  accounts: OperationalSyncAccount[];
  lastSuccessfulRun: OperationalSyncRun | RunSummary | null;
  lastAttempt: OperationalSyncRun | RunSummary | null;
  dataQuality: DataQualityContract;
  requestedPeriod: DashboardPeriod | null;
  exactRange: OperationalSyncExactRange | null;
  metrics: Record<string, MetricContract>;
}

export interface OperationalSyncExplanation {
  status: OperationalSyncStatus;
  trustedRun: OperationalSyncRun | RunSummary | null;
  latestAttempt: OperationalSyncRun | RunSummary | null;
  selectedPeriod: DashboardPeriod;
  syncedPeriod: DashboardPeriod | null;
  exactRange: OperationalSyncExactRange | null;
  metricsAvailable: string[];
  canUseData: boolean;
  warning?: string;
  reason: string;
  action: string;
}

function runPeriod(
  run: OperationalSyncRun | RunSummary | null,
  requestedPeriod: DashboardPeriod | null,
): DashboardPeriod | null {
  if (run && 'requestedPeriod' in run) return run.requestedPeriod;
  return requestedPeriod;
}

function belongsToPeriod(
  run: OperationalSyncRun | RunSummary | null,
  selectedPeriod: DashboardPeriod,
  requestedPeriod: DashboardPeriod | null,
): boolean {
  return Boolean(run && runPeriod(run, requestedPeriod) === selectedPeriod);
}

function isNewerAttempt(attempt: RunSummary, trustedRun: RunSummary): boolean {
  return new Date(attempt.startedAt).getTime() > new Date(trustedRun.startedAt).getTime();
}

export function explainOperationalSyncState(
  input: ExplainOperationalSyncStateInput,
): OperationalSyncExplanation {
  if (!input.selectedPeriod) throw new Error('selectedPeriod is required');

  const metricsAvailable = Object.entries(input.metrics)
    .filter(([, metric]) => metric.available && typeof metric.value === 'number')
    .map(([metricId]) => metricId);
  const base = {
    selectedPeriod: input.selectedPeriod,
    syncedPeriod: input.requestedPeriod,
    exactRange: input.exactRange,
    metricsAvailable,
  };

  if (input.accounts.length === 0) {
    return {
      ...base,
      status: 'no_account',
      trustedRun: null,
      latestAttempt: null,
      canUseData: false,
      reason: 'Nenhuma conta Meta está vinculada a este cliente.',
      action: 'Vincular uma conta Meta.',
    };
  }

  const trustedRun = belongsToPeriod(input.lastSuccessfulRun, input.selectedPeriod, input.requestedPeriod)
    ? input.lastSuccessfulRun
    : null;
  const latestAttempt = belongsToPeriod(input.lastAttempt, input.selectedPeriod, input.requestedPeriod)
    ? input.lastAttempt
    : null;

  if (!trustedRun && !latestAttempt) {
    return {
      ...base,
      status: 'not_synced',
      trustedRun: null,
      latestAttempt: null,
      canUseData: false,
      reason: input.requestedPeriod && input.requestedPeriod !== input.selectedPeriod
        ? 'O período selecionado ainda não foi sincronizado.'
        : 'Este período ainda não foi sincronizado.',
      action: `Sincronizar o período ${input.selectedPeriod}.`,
    };
  }

  if (trustedRun) {
    const hasNewerIncompleteAttempt = Boolean(
      latestAttempt
      && latestAttempt.id !== trustedRun.id
      && latestAttempt.status !== 'success'
      && isNewerAttempt(latestAttempt, trustedRun),
    );
    const stale = input.dataQuality.reason === 'stale' || input.dataQuality.reason === 'stale_data';
    return {
      ...base,
      status: stale ? 'stale' : 'success',
      trustedRun,
      latestAttempt: latestAttempt ?? trustedRun,
      canUseData: metricsAvailable.length > 0,
      warning: hasNewerIncompleteAttempt
        ? 'Último dado confiável em uso; tentativa mais recente incompleta.'
        : undefined,
      reason: stale
        ? 'O último dado confiável está desatualizado.'
        : metricsAvailable.length > 0
          ? 'Existe uma sincronização confiável para o período selecionado.'
          : 'A sincronização concluiu, mas não há métricas disponíveis para uso.',
      action: stale ? 'Sincronizar o período novamente.' : 'Usar o último dado confiável.',
    };
  }

  if (latestAttempt?.status === 'partial' || latestAttempt?.status === 'running') {
    return {
      ...base,
      status: 'partial',
      trustedRun: null,
      latestAttempt,
      canUseData: false,
      reason: 'A única tentativa deste período terminou parcialmente.',
      action: 'Sincronizar o período novamente antes de analisar.',
    };
  }

  return {
    ...base,
    status: 'failed',
    trustedRun: null,
    latestAttempt,
    canUseData: false,
    reason: 'A sincronização deste período falhou.',
    action: 'Corrigir a falha e sincronizar o período novamente.',
  };
}
