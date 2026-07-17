import type { EnrichedGlobalClientPerformance } from './usePerformanceDashboard';
import type { DashboardPeriod } from './analyticsCapabilities';
import type { GlobalClientStatus, RunSummary, DataQualityContract, GlobalPerformanceAccount } from './globalPerformanceDashboard';

export interface ClientSyncStateExplanation {
  clientId: string;
  clientName: string;
  selectedPeriod: DashboardPeriod;
  clientStatus: GlobalClientStatus;
  lastSuccessfulRun: RunSummary | null;
  lastAttempt: RunSummary | null;
  dataQuality: DataQualityContract;
  hasNewerPartial: boolean;
  hasNewerFailure: boolean;
  accounts: Array<Pick<GlobalPerformanceAccount, 'clientMetaAssetId' | 'accountName' | 'dataQuality' | 'lastSuccessfulRun' | 'lastAttempt'>>;
}

/**
 * Rastreabilidade de por que um cliente está mostrando o status de sync que
 * está mostrando, para o período selecionado - útil quando "sincronizei e
 * recarreguei, mas continua parcial" precisa ser depurado sem abrir o
 * Supabase direto. Chamar só em dev (ver uso em ClientAnalyticsCard.tsx) ou
 * atrás de uma flag - nunca em produção sem intenção explícita, porque expõe
 * ids de execução de sync no console.
 */
export function explainClientSyncState(
  performance: EnrichedGlobalClientPerformance,
  selectedPeriod: DashboardPeriod
): ClientSyncStateExplanation {
  return {
    clientId: performance.clientId,
    clientName: performance.clientName,
    selectedPeriod,
    clientStatus: performance.clientStatus,
    lastSuccessfulRun: performance.lastSuccessfulRun,
    lastAttempt: performance.lastAttempt,
    dataQuality: performance.dataQuality,
    hasNewerPartial: performance.hasNewerPartial,
    hasNewerFailure: performance.hasNewerFailure,
    accounts: performance.accounts.map((account) => ({
      clientMetaAssetId: account.clientMetaAssetId,
      accountName: account.accountName,
      dataQuality: account.dataQuality,
      lastSuccessfulRun: account.lastSuccessfulRun,
      lastAttempt: account.lastAttempt,
    })),
  };
}
