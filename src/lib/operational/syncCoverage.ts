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
    this_month: 'M?s atual',
    this_week: 'Semana atual',
    today: 'Hoje',
    last_7d: '?ltimos 7 dias',
    last_30d: '?ltimos 30 dias',
    last_90d: '?ltimos 90 dias',
  };
  return period ? labels[period] : 'per?odo sincronizado';
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
      reason: 'Intervalo selecionado indispon?vel para validar cobertura de sincroniza??o.',
      action: 'Selecione um per?odo expl?cito e sincronize novamente.',
    };
  }

  const successfulRuns = runs.filter((run) => run.status === 'success');
  const coveringRun = newest(successfulRuns.filter((run) => coversRange(run, selectedDateStart, selectedDateStop)));
  const latestIncomplete = newest(runs.filter((run) => run.status !== 'success'));

  if (coveringRun) {
    const stale = Boolean(input.stale);
    const incompleteWarning = latestIncomplete && runStartedAt(latestIncomplete) > runStartedAt(coveringRun)
      ? '?ltimo dado confi?vel em uso; tentativa mais recente incompleta.'
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
      action: stale ? 'Sincronizar o per?odo novamente.' : 'Usar o ?ltimo dado confi?vel.',
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
      reason: 'Existe sincroniza??o confi?vel cobrindo apenas parte do intervalo selecionado.',
      action: 'Sincronizar o intervalo completo antes de analisar.',
    };
  }

  const failedRun = newest(runs.filter((run) => run.status === 'failed' && overlapsRange(run, selectedDateStart, selectedDateStop)));
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
      reason: 'A tentativa de sincroniza??o que alcan?a este intervalo falhou.',
      action: 'Corrigir a falha e sincronizar o per?odo novamente.',
    };
  }

  const partialAttempt = newest(runs.filter((run) => (run.status === 'partial' || run.status === 'running') && overlapsRange(run, selectedDateStart, selectedDateStop)));
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
      reason: 'A tentativa dispon?vel cobre apenas parte do intervalo ou terminou parcialmente.',
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
    reason: 'Este intervalo ainda n?o foi sincronizado.',
    action: 'Sincronizar per?odo',
  };
}
