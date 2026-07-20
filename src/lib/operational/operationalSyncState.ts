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

type RunWithPeriod = RunSummary & {
  requestedPeriod?: DashboardPeriod | null;
  requested_period?: DashboardPeriod | null;
  period?: DashboardPeriod | null;
};

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  this_month: 'M\u00eas atual',
  this_week: 'Semana atual',
  today: 'Hoje',
  last_7d: '\u00daltimos 7 dias',
  last_30d: '\u00daltimos 30 dias',
  last_90d: '\u00daltimos 90 dias',
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

function belongsToPeriod(
  run: OperationalSyncRun | RunSummary | null,
  selectedPeriod: DashboardPeriod,
  fallbackPeriod: DashboardPeriod | null,
): boolean {
  return Boolean(run && runPeriod(run, fallbackPeriod) === selectedPeriod);
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
      status: 'no_account',
      trustedRun: null,
      latestAttempt: null,
      canUseData: false,
      reason: 'Nenhuma conta Meta est\u00e1 vinculada a este cliente.',
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
      reason: knownSyncedPeriod && knownSyncedPeriod !== input.selectedPeriod
        ? `Este per\u00edodo ainda n\u00e3o foi sincronizado. \u00daltimo per\u00edodo sincronizado: ${PERIOD_LABELS[knownSyncedPeriod]}.`
        : 'Este per\u00edodo ainda n\u00e3o foi sincronizado.',
      action: 'Sincronizar per\u00edodo',
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
        ? '\u00daltimo dado confi\u00e1vel em uso; tentativa mais recente incompleta.'
        : undefined,
      reason: stale
        ? 'O \u00faltimo dado confi\u00e1vel est\u00e1 desatualizado.'
        : metricsAvailable.length > 0
          ? 'Existe uma sincroniza\u00e7\u00e3o confi\u00e1vel para o per\u00edodo selecionado.'
          : 'A sincroniza\u00e7\u00e3o concluiu, mas n\u00e3o h\u00e1 m\u00e9tricas dispon\u00edveis para uso.',
      action: stale ? 'Sincronizar o per\u00edodo novamente.' : 'Usar o \u00faltimo dado confi\u00e1vel.',
    };
  }

  if (latestAttempt?.status === 'partial' || latestAttempt?.status === 'running') {
    return {
      ...base,
      status: 'partial',
      trustedRun: null,
      latestAttempt,
      canUseData: false,
      reason: 'A \u00fanica tentativa deste per\u00edodo terminou parcialmente.',
      action: 'Sincronizar o per\u00edodo novamente antes de analisar.',
    };
  }

  return {
    ...base,
    status: 'failed',
    trustedRun: null,
    latestAttempt,
    canUseData: false,
    reason: 'A sincroniza\u00e7\u00e3o deste per\u00edodo falhou.',
    action: 'Corrigir a falha e sincronizar o per\u00edodo novamente.',
  };
}
