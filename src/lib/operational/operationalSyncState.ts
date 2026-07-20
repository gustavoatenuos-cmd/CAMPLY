import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import type {
  DataQualityContract,
  MetricContract,
  RunSummary,
} from '../performance/globalPerformanceDashboard';
import { resolveSyncCoverageForPeriod, type SyncCoverageResolution } from './syncCoverage';

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
  coverage: SyncCoverageResolution | null;
  canUseData: boolean;
  warning?: string;
  reason: string;
  action: string;
}

type RunWithPeriod = RunSummary & {
  requestedPeriod?: DashboardPeriod | null;
  requested_period?: DashboardPeriod | null;
  period?: DashboardPeriod | null;
};

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  this_month: 'Mês atual',
  this_week: 'Semana atual',
  today: 'Hoje',
  yesterday: 'Ontem',
  today_and_yesterday: 'Hoje e ontem',
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  last_90d: 'Últimos 90 dias',
};

function runPeriod(
  run: OperationalSyncRun | RunSummary | null,
  fallbackPeriod: DashboardPeriod | null,
): DashboardPeriod | null {
  if (!run) return null;
  const rawRun = run as RunWithPeriod;
  return rawRun.requestedPeriod ?? rawRun.requested_period ?? rawRun.period ?? fallbackPeriod;
}

function lastKnownPeriod(input: ExplainOperationalSyncStateInput): DashboardPeriod | null {
  return runPeriod(input.lastAttempt, null)
    ?? runPeriod(input.lastSuccessfulRun, null)
    ?? input.requestedPeriod;
}

export function explainOperationalSyncState(
  input: ExplainOperationalSyncStateInput,
): OperationalSyncExplanation {
  if (!input.selectedPeriod) throw new Error('selectedPeriod is required');

  const metricsAvailable = Object.entries(input.metrics)
    .filter(([, metric]) => metric.available && typeof metric.value === 'number')
    .map(([metricId]) => metricId);
  const knownSyncedPeriod = lastKnownPeriod(input);
  const base = {
    selectedPeriod: input.selectedPeriod,
    syncedPeriod: knownSyncedPeriod,
    exactRange: input.exactRange,
    metricsAvailable,
  };

  if (input.accounts.length === 0) {
    return {
      ...base,
      coverage: null,
      status: 'no_account',
      trustedRun: null,
      latestAttempt: null,
      canUseData: false,
      reason: 'Nenhuma conta Meta está vinculada a este cliente.',
      action: 'Vincular uma conta Meta.',
    };
  }

  const coverage = resolveSyncCoverageForPeriod({
    selectedPeriod: input.selectedPeriod,
    selectedDateStart: input.exactRange?.dateStart ?? null,
    selectedDateStop: input.exactRange?.dateStop ?? null,
    availableRuns: [input.lastSuccessfulRun, input.lastAttempt],
    metricsCoverage: input.exactRange,
    stale: input.dataQuality.reason === 'stale' || input.dataQuality.reason === 'stale_data',
  });

  if (coverage.status === 'covered' || coverage.status === 'stale') {
    const trustedRun = input.lastSuccessfulRun?.id === coverage.coveringRunId
      ? input.lastSuccessfulRun
      : null;
    const latestAttempt = input.lastAttempt ?? trustedRun;
    return {
      ...base,
      coverage,
      status: coverage.status === 'stale' ? 'stale' : 'success',
      trustedRun,
      latestAttempt,
      canUseData: coverage.canUseData && metricsAvailable.length > 0,
      warning: coverage.warning,
      reason: metricsAvailable.length > 0
        ? coverage.reason
        : 'A sincronização cobre o intervalo, mas não há métricas disponíveis para uso.',
      action: coverage.action,
    };
  }

  if (coverage.status === 'partial_coverage') {
    const partialRun = input.lastAttempt?.id === coverage.coveringRunId
      ? input.lastAttempt
      : input.lastSuccessfulRun?.id === coverage.coveringRunId
        ? input.lastSuccessfulRun
        : null;
    return {
      ...base,
      coverage,
      status: 'partial',
      trustedRun: null,
      latestAttempt: partialRun,
      canUseData: false,
      reason: coverage.reason,
      action: coverage.action,
    };
  }

  if (coverage.status === 'failed') {
    return {
      ...base,
      coverage,
      status: 'failed',
      trustedRun: null,
      latestAttempt: input.lastAttempt,
      canUseData: false,
      reason: coverage.reason,
      action: coverage.action,
    };
  }

  return {
    ...base,
    coverage,
    status: 'not_synced',
    trustedRun: null,
    latestAttempt: null,
    canUseData: false,
    reason: knownSyncedPeriod && knownSyncedPeriod !== input.selectedPeriod
      ? `${coverage.reason} Último período sincronizado: ${PERIOD_LABELS[knownSyncedPeriod]}.`
      : coverage.reason,
    action: coverage.action,
  };
}
