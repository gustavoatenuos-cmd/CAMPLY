import { isSupabaseConfigured, supabase } from '../supabase';
import type { BudgetPacingResult, PerformanceEvaluation, PerformanceTarget } from './types';

export type GlobalClientStatus =
  | 'not_connected'
  | 'never_synced'
  | 'syncing'
  | 'no_delivery'
  | 'available'
  | 'stale'
  | 'partial'
  | 'failed';

export type DashboardPeriod = 'today' | 'last_7d' | 'last_30d';

export interface MetricContract {
  value: number | null;
  available: boolean;
  completenessStatus: string | null;
}

export interface RunSummary {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  terminationReason: string | null;
}

export interface GlobalMetricGroup {
  campaignId: string;
  campaignName: string;
  classifiedObjective: string | null;
  destinationType: string | null;
  attributionSetting: string | null;
  spend: number | null;
  metrics: Record<string, number | null>;
}

export interface GlobalPerformanceAccount {
  metaAssetId: string;
  integrationId: string;
  adAccountId: string;
  accountName: string;
  currency: string | null;
  timezone: string | null;
}

export interface GlobalClientPerformance {
  clientId: string;
  clientName: string;
  clientStatus: GlobalClientStatus;
  accounts: GlobalPerformanceAccount[];
  metrics: Record<string, MetricContract>;
  metricGroups: GlobalMetricGroup[];
  resolvedTargets: PerformanceTarget[];
  evaluations: PerformanceEvaluation[];
  budgetPacing: BudgetPacingResult | null;
  dataQuality: {
    status: 'complete' | 'partial' | 'unavailable';
    reason: string | null;
  };
  lastSuccessfulRun: RunSummary | null;
  lastAttempt: RunSummary | null;
  hasNewerPartial: boolean;
  hasNewerFailure: boolean;
}

export async function loadGlobalPerformanceDashboard(options: {
  period: DashboardPeriod;
  clientIds?: string[];
  assetIds?: string[];
}): Promise<GlobalClientPerformance[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase.rpc('get_global_performance_dashboard', {
    p_period: options.period,
    p_client_ids: options.clientIds?.length ? options.clientIds : null,
    p_asset_ids: options.assetIds?.length ? options.assetIds : null,
  });

  if (error) {
    throw new Error(`Failed to load global performance dashboard: ${error.message}`);
  }

  return Array.isArray(data) ? data as GlobalClientPerformance[] : [];
}
