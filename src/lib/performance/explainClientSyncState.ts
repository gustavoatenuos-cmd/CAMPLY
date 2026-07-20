import type { EnrichedGlobalClientPerformance } from './usePerformanceDashboard';
import type { DashboardPeriod } from './analyticsCapabilities';
import { explainOperationalSyncState, type OperationalSyncExplanation } from '../operational/operationalSyncState';
import { exactPeriodRange } from '../meta/periodRange';

export interface DashboardClientSyncDebug extends OperationalSyncExplanation {
  clientName: string;
  clientStatus: EnrichedGlobalClientPerformance['clientStatus'];
  lastSuccessfulRun: EnrichedGlobalClientPerformance['lastSuccessfulRun'];
  lastAttempt: EnrichedGlobalClientPerformance['lastAttempt'];
  dataQuality: EnrichedGlobalClientPerformance['dataQuality'];
  reasonUsedByDashboard: string;
}

export function explainDashboardClientSync(
  performance: EnrichedGlobalClientPerformance,
  selectedPeriod: DashboardPeriod,
): DashboardClientSyncDebug {
  const firstAccount = performance.accounts[0];
  const selectedRange = exactPeriodRange(selectedPeriod, firstAccount?.timezone || 'America/Sao_Paulo');
  const explanation = explainOperationalSyncState({
    selectedPeriod,
    clientId: performance.clientId,
    clientName: performance.clientName,
    accounts: performance.accounts.map((account) => ({
      clientMetaAssetId: account.clientMetaAssetId,
      accountName: account.accountName,
    })),
    lastSuccessfulRun: performance.lastSuccessfulRun,
    lastAttempt: performance.lastAttempt,
    dataQuality: performance.dataQuality,
    requestedPeriod: null,
    exactRange: selectedRange,
    metrics: performance.metrics,
  });

  return {
    ...explanation,
    clientName: performance.clientName,
    clientStatus: performance.clientStatus,
    lastSuccessfulRun: performance.lastSuccessfulRun,
    lastAttempt: performance.lastAttempt,
    dataQuality: performance.dataQuality,
    reasonUsedByDashboard: explanation.reason,
  };
}

export const explainClientSyncState = explainDashboardClientSync;

export function debugDashboardClientSync(
  performance: EnrichedGlobalClientPerformance,
  selectedPeriod: DashboardPeriod,
): void {
  if (!import.meta.env.DEV) return;
  console.debug('[debugDashboardClientSync]', explainDashboardClientSync(performance, selectedPeriod));
}
