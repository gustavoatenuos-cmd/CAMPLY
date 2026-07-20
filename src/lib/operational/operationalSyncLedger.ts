import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import type { EnrichedGlobalClientPerformance } from '../performance/usePerformanceDashboard';
import type { GlobalClientPerformance, RunSummary } from '../performance/globalPerformanceDashboard';
import { explainDashboardClientSync } from '../performance/explainClientSyncState';

export interface OperationalSyncLedgerRun {
  id: string;
  status: string;
  requestedPeriod: DashboardPeriod | null;
  runScope: string | null;
  dateStart: string | null;
  dateStop: string | null;
  finishedAt: string | null;
  terminationReason: string | null;
  metricsCount: number | null;
  metricGroupsCount: number | null;
}

export interface OperationalSyncLedgerEntry {
  clientName: string;
  clientId: string;
  clientMetaAssetId: string | null;
  selectedPeriod: DashboardPeriod;
  selectedDateStart: string | null;
  selectedDateStop: string | null;
  exactRangeShown: { dateStart: string | null; dateStop: string | null } | null;
  coverageStatus: string | null;
  coveringRunId: string | null;
  coveringRequestedPeriod: DashboardPeriod | null;
  coveredDateStart: string | null;
  coveredDateStop: string | null;
  dashboardStatus: string;
  dataQuality: GlobalClientPerformance['dataQuality'];
  metricsAvailable: string[];
  metricGroupsCount: number;
  lastSuccessfulRun: OperationalSyncLedgerRun | null;
  lastAttempt: OperationalSyncLedgerRun | null;
  decision: string;
  reason: string;
}

function runRequestedPeriod(run: RunSummary | null): DashboardPeriod | null {
  return run?.requestedPeriod ?? run?.requested_period ?? null;
}

function runScope(run: RunSummary | null): string | null {
  return run?.runScope ?? run?.run_scope ?? null;
}

function runDateStart(run: RunSummary | null): string | null {
  return run?.dateStart ?? run?.date_start ?? null;
}

function runDateStop(run: RunSummary | null): string | null {
  return run?.dateStop ?? run?.date_stop ?? null;
}

function ledgerRun(run: RunSummary | null): OperationalSyncLedgerRun | null {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    requestedPeriod: runRequestedPeriod(run),
    runScope: runScope(run),
    dateStart: runDateStart(run),
    dateStop: runDateStop(run),
    finishedAt: run.finishedAt,
    terminationReason: run.terminationReason,
    metricsCount: run.metricsCount ?? null,
    metricGroupsCount: run.metricGroupsCount ?? null,
  };
}

function availableMetricIds(metrics: GlobalClientPerformance['metrics']): string[] {
  return Object.entries(metrics)
    .filter(([, metric]) => metric.available && typeof metric.value === 'number')
    .map(([metricId]) => metricId);
}

export function buildOperationalSyncLedger(
  clients: Array<GlobalClientPerformance | EnrichedGlobalClientPerformance>,
  selectedPeriod: DashboardPeriod,
): OperationalSyncLedgerEntry[] {
  return clients.map((client) => {
    const firstAccount = client.accounts[0] ?? null;
    const explanation = explainDashboardClientSync(client, selectedPeriod);
    return {
      clientName: client.clientName,
      clientId: client.clientId,
      clientMetaAssetId: firstAccount?.clientMetaAssetId ?? null,
      selectedPeriod,
      selectedDateStart: explanation.coverage?.selectedDateStart ?? firstAccount?.dateStart ?? null,
      selectedDateStop: explanation.coverage?.selectedDateStop ?? firstAccount?.dateStop ?? null,
      exactRangeShown: firstAccount ? { dateStart: firstAccount.dateStart, dateStop: firstAccount.dateStop } : null,
      coverageStatus: explanation.coverage?.status ?? null,
      coveringRunId: explanation.coverage?.coveringRunId ?? null,
      coveringRequestedPeriod: explanation.coverage?.coveringRequestedPeriod ?? null,
      coveredDateStart: explanation.coverage?.coveredDateStart ?? null,
      coveredDateStop: explanation.coverage?.coveredDateStop ?? null,
      dashboardStatus: client.clientStatus,
      dataQuality: client.dataQuality,
      metricsAvailable: availableMetricIds(client.metrics),
      metricGroupsCount: client.metricGroups.length,
      lastSuccessfulRun: ledgerRun(client.lastSuccessfulRun),
      lastAttempt: ledgerRun(client.lastAttempt),
      decision: explanation.status,
      reason: explanation.reason,
    };
  });
}

export function publishOperationalSyncLedger(
  clients: Array<GlobalClientPerformance | EnrichedGlobalClientPerformance>,
  selectedPeriod: DashboardPeriod,
): OperationalSyncLedgerEntry[] {
  const ledger = buildOperationalSyncLedger(clients, selectedPeriod);
  if (typeof window !== 'undefined') {
    window.CAMPLY_OPERATIONAL_SYNC_LEDGER = {
      selectedPeriod,
      latest: ledger,
      exportJson: () => JSON.stringify(ledger, null, 2),
      table: () => console.table(ledger.map((entry) => ({
        clientName: entry.clientName,
        clientId: entry.clientId,
        selectedPeriod: entry.selectedPeriod,
        dashboardStatus: entry.dashboardStatus,
        coverageStatus: entry.coverageStatus,
        selectedDateStart: entry.selectedDateStart,
        selectedDateStop: entry.selectedDateStop,
        coveringRunId: entry.coveringRunId,
        coveringRequestedPeriod: entry.coveringRequestedPeriod,
        coveredDateStart: entry.coveredDateStart,
        coveredDateStop: entry.coveredDateStop,
        decision: entry.decision,
        lastSuccessfulRunId: entry.lastSuccessfulRun?.id ?? null,
        lastSuccessfulRunPeriod: entry.lastSuccessfulRun?.requestedPeriod ?? null,
        lastAttemptId: entry.lastAttempt?.id ?? null,
        lastAttemptPeriod: entry.lastAttempt?.requestedPeriod ?? null,
        reason: entry.reason,
      }))),
    };
  }
  return ledger;
}

declare global {
  interface Window {
    CAMPLY_OPERATIONAL_SYNC_LEDGER?: {
      selectedPeriod: DashboardPeriod;
      latest: OperationalSyncLedgerEntry[];
      exportJson: () => string;
      table: () => void;
    };
  }
}
