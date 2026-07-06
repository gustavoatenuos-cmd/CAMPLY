// src/lib/performance/dashboardTrace.ts

export interface DashboardTraceData {
  clientId: string;
  clientName: string;
  hasIdentity: boolean;
  hasProfile: boolean;
  hasMetaLink: boolean;
  hasMetaAsset: boolean;
  hasIntegration: boolean;
  lastSyncRunId?: string;
  lastSuccessfulRunId?: string;
  metricLevelsAvailable: string[];
  dashboardStatus: string;
  missingReason?: string;
  diagnosticReason?: string;
}

export function traceDashboardClient(trace: DashboardTraceData) {
  if (import.meta.env.DEV || (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')) {
    console.debug(`[Dashboard Trace] Client: ${trace.clientName} (${trace.clientId})`, trace);
    if (trace.dashboardStatus === 'not_connected' || trace.dashboardStatus === 'never_synced' || trace.missingReason) {
      console.warn(`[Dashboard Trace Warning] Client missing data: ${trace.clientName} - Reason: ${trace.missingReason || trace.diagnosticReason || trace.dashboardStatus}`);
    }
  }
}
