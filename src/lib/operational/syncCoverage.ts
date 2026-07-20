import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import type { RunSummary } from '../performance/globalPerformanceDashboard';

export type SyncCoverageStatus = 'covered' | 'not_covered' | 'partial_coverage' | 'failed' | 'stale';

export interface SyncCoverageRange {
  dateStart: string | null;
  dateStop: string | null;
}

export interface SyncCoverageRun extends RunSummary {
  requestedPeriod?: DashboardPeriod | null;
  requested_period?: DashboardPeriod | null;
  period?: DashboardPeriod | null;
  dateStart?: string | null;
  dateStop?: string | null;
  date_start?: string | null;
  date_stop?: string | null;
}

export interface ResolveSyncCoverageInput {
  selectedPeriod: DashboardPeriod;
  selectedDateStart: string | null;
  selectedDateStop: string | null;
  availableRuns: Array<SyncCoverageRun | null | undefined>;
  metricsCoverage?: SyncCoverageRange | null;
  stale?: boolean;
}

export interface SyncCoverageResolution {
  status: SyncCoverageStatus;
  coveringRunId: string | null;
  coveringRequestedPeriod: DashboardPeriod | null;
  coveredDateStart: string | null;
  coveredDateStop: string | null;
  selectedDateStart: string | null;
  selectedDateStop: string | null;
  canUseData: boolean;
  warning?: string;
  reason: string;
  action: string;
}

function requestedPeriod(run: SyncCoverageRun): DashboardPeriod | null {
  return run.requestedPeriod ?? run.requested_period ?? run.period ?? null;
}

function runDateStart(run: SyncCoverageRun): string | null {
  return run.dateStart ?? run.date_start ?? null;
}

function runDateStop(run: SyncCoverageRun): string | null {
  return run.dateStop ?? run.date_stop ?? null;
}

function runStartedAt(run: SyncCoverageRun): number {
  const value = new Date(run.startedAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

function coversRange(run: SyncCoverageRun, selectedDateStart: string, selectedDateStop: string): boolean {
  const dateStart = runDateStart(run);
  const dateStop = runDateStop(run);
  return Boolean(dateStart && dateStop && dateStart <= selectedDateStart && dateStop >= selectedDateStop);
}

function overlapsRange(run: SyncCoverageRun, selectedDateStart: string, selectedDateStop: string): boolean {
  const dateStart = runDateStart(run);
  const dateStop = runDateStop(run);
  return Boolean(dateStart && dateStop && dateStart <= selectedDateStop && dateStop >= selectedDateStart);
}

function newest(runs: SyncCoverageRun[]): SyncCoverageRun | null {
  return runs.slice().sort((left, right) => runStartedAt(right) - runStartedAt(left))[0] ?? null;
}

function formatRunPeriod(period: DashboardPeriod | null): string {
  const labels: Record<DashboardPeriod, string> = {
    this_month: 'Mês atual',
    this_week: 'Semana atual',
    today: 'Hoje',
    yesterday: 'Ontem',
    today_and_yesterday: 'Hoje e ontem',
    last_7d: 'Últimos 7 dias',
    last_30d: 'Últimos 30 dias',
    last_90d: 'Últimos 90 dias',
  };
  return period ? labels[period] : 'período sincronizado';
}

export function resolveSyncCoverageForPeriod(input: ResolveSyncCoverageInput): SyncCoverageResolution {
  const selectedDateStart = input.selectedDateStart;
  const selectedDateStop = input.selectedDateStop;
  const runs = input.availableRuns.filter((run): run is SyncCoverageRun => Boolean(run));

  if (!selectedDateStart || !selectedDateStop) {
    return {
      status: 'not_covered',
      coveringRunId: null,
      coveringRequestedPeriod: null,
      coveredDateStart: null,
      coveredDateStop: null,
      selectedDateStart,
      selectedDateStop,
      canUseData: false,
      reason: 'Intervalo selecionado indisponível para validar cobertura de sincronização.',
      action: 'Selecione um período explícito e sincronize novamente.',
    };
  }

  const officialRuns = runs.filter((run) => requestedPeriod(run) === 'last_90d');
  const successfulRuns = officialRuns.filter((run) => run.status === 'success');
  const coveringRun = newest(successfulRuns.filter((run) => coversRange(run, selectedDateStart, selectedDateStop)));
  const latestIncomplete = newest(officialRuns.filter((run) => run.status !== 'success'));

  if (coveringRun) {
    const stale = Boolean(input.stale);
    const incompleteWarning = latestIncomplete && runStartedAt(latestIncomplete) > runStartedAt(coveringRun)
      ? 'Último dado confiável em uso; tentativa mais recente incompleta.'
      : undefined;
    return {
      status: stale ? 'stale' : 'covered',
      coveringRunId: coveringRun.id,
      coveringRequestedPeriod: requestedPeriod(coveringRun),
      coveredDateStart: runDateStart(coveringRun),
      coveredDateStop: runDateStop(coveringRun),
      selectedDateStart,
      selectedDateStop,
      canUseData: true,
      warning: incompleteWarning,
      reason: `${formatRunPeriod(input.selectedPeriod)} coberto pelo sync de ${formatRunPeriod(requestedPeriod(coveringRun))}.`,
      action: stale ? 'Sincronizar o período novamente.' : 'Usar o último dado confiável.',
    };
  }

  const partialRun = newest(successfulRuns.filter((run) => overlapsRange(run, selectedDateStart, selectedDateStop)));
  if (partialRun) {
    return {
      status: 'partial_coverage',
      coveringRunId: partialRun.id,
      coveringRequestedPeriod: requestedPeriod(partialRun),
      coveredDateStart: runDateStart(partialRun),
      coveredDateStop: runDateStop(partialRun),
      selectedDateStart,
      selectedDateStop,
      canUseData: false,
      reason: 'Existe sincronização confiável cobrindo apenas parte do intervalo selecionado.',
      action: 'Sincronizar o intervalo completo antes de analisar.',
    };
  }

  const failedRun = newest(officialRuns.filter((run) => run.status === 'failed' && overlapsRange(run, selectedDateStart, selectedDateStop)));
  if (failedRun) {
    return {
      status: 'failed',
      coveringRunId: failedRun.id,
      coveringRequestedPeriod: requestedPeriod(failedRun),
      coveredDateStart: runDateStart(failedRun),
      coveredDateStop: runDateStop(failedRun),
      selectedDateStart,
      selectedDateStop,
      canUseData: false,
      reason: 'A tentativa de sincronização que alcança este intervalo falhou.',
      action: 'Corrigir a falha e sincronizar o período novamente.',
    };
  }

  const partialAttempt = newest(officialRuns.filter((run) => (run.status === 'partial' || run.status === 'running') && overlapsRange(run, selectedDateStart, selectedDateStop)));
  if (partialAttempt) {
    return {
      status: 'partial_coverage',
      coveringRunId: partialAttempt.id,
      coveringRequestedPeriod: requestedPeriod(partialAttempt),
      coveredDateStart: runDateStart(partialAttempt),
      coveredDateStop: runDateStop(partialAttempt),
      selectedDateStart,
      selectedDateStop,
      canUseData: false,
      reason: 'A tentativa disponível cobre apenas parte do intervalo ou terminou parcialmente.',
      action: 'Sincronizar o intervalo completo antes de analisar.',
    };
  }

  return {
    status: 'not_covered',
    coveringRunId: null,
    coveringRequestedPeriod: null,
    coveredDateStart: null,
    coveredDateStop: null,
    selectedDateStart,
    selectedDateStop,
    canUseData: false,
    reason: 'Base Meta Ads não sincronizada.',
    action: 'Ir para Integração Meta Ads',
  };
}
