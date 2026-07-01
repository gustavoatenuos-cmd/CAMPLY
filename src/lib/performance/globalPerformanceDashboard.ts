import { isSupabaseConfigured, supabase } from '../supabase';
import type { AnalyticsCapabilities, DashboardPeriod } from './analyticsCapabilities';
import { calculateBudgetPacing, combineBudgetPacingByCurrency } from './budgetPacing';
import { evaluatePerformanceTarget } from './evaluatePerformance';
import { calculatePerformanceScore, type PerformanceScore } from './performanceScore';
import { normalizeTraceableMetric, type TraceableMetric } from './traceableMetrics';
import type {
  BudgetPacingResult,
  MetricDatum,
  PerformanceEvaluation,
  PerformanceTarget,
} from './types';

export type GlobalClientStatus =
  | 'not_connected'
  | 'never_synced'
  | 'syncing'
  | 'no_delivery'
  | 'available'
  | 'stale'
  | 'partial'
  | 'failed';

export type { DashboardPeriod } from './analyticsCapabilities';

export type MetricContract = TraceableMetric;

export interface RunSummary {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  terminationReason: string | null;
}

export interface DataQualityContract {
  status: 'complete' | 'partial' | 'unavailable';
  reason: string | null;
}

export interface GlobalMetricGroup {
  clientMetaAssetId: string;
  metaAssetId: string;
  currency: string | null;
  campaignId: string;
  campaignName: string;
  classifiedObjective: string | null;
  destinationType: string | null;
  attributionSetting: string | null;
  spend: number | null;
  completenessStatus: string | null;
  metrics: Record<string, MetricContract>;
}

export interface GlobalPerformanceAccount {
  clientMetaAssetId: string;
  metaAssetId: string;
  integrationId: string;
  adAccountId: string;
  accountName: string;
  currency: string | null;
  timezone: string | null;
  dateStart: string | null;
  dateStop: string | null;
  metrics: Record<string, MetricContract>;
  budgetPacing: BudgetPacingResult | null;
  dataQuality: DataQualityContract;
  lastSuccessfulRun: RunSummary | null;
  lastAttempt: RunSummary | null;
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
  score: PerformanceScore;
  dataQuality: DataQualityContract;
  lastSuccessfulRun: RunSummary | null;
  lastAttempt: RunSummary | null;
  hasNewerPartial: boolean;
  hasNewerFailure: boolean;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeMetric(metricId: string, metric: MetricContract | undefined): MetricContract | undefined {
  if (!metric) return undefined;
  return normalizeTraceableMetric(metricId, metric);
}

function normalizeMetricMap(metrics: Record<string, MetricContract> | undefined): Record<string, MetricContract> {
  const result: Record<string, MetricContract> = {};
  for (const [metricId, metric] of Object.entries(metrics ?? {})) {
    const normalized = normalizeMetric(metricId, metric);
    if (normalized) result[metricId] = normalized;
  }
  return result;
}

function fallbackRange(period: DashboardPeriod, currentDate: Date): { start: Date; end: Date } {
  const end = new Date(currentDate);
  const start = new Date(currentDate);
  if (period === 'last_7d') start.setUTCDate(start.getUTCDate() - 6);
  if (period === 'last_30d') start.setUTCDate(start.getUTCDate() - 29);
  return { start, end };
}

function buildUnavailableEvaluation(
  target: PerformanceTarget,
  reason: string,
  dimensions: Partial<PerformanceEvaluation> = {}
): PerformanceEvaluation {
  return {
    clientMetaAssetId: target.clientMetaAssetId,
    campaignId: target.campaignId ?? null,
    classifiedObjective: dimensions.classifiedObjective ?? null,
    destinationType: dimensions.destinationType ?? null,
    attributionSetting: dimensions.attributionSetting ?? null,
    metricId: target.metricId,
    targetKind: target.targetKind,
    actualValue: null,
    targetValue: target.targetValue,
    differenceValue: null,
    differencePercent: null,
    status: 'unavailable',
    reason,
    confidence: 0,
  };
}

function evaluateTarget(
  client: GlobalClientPerformance,
  target: PerformanceTarget
): PerformanceEvaluation {
  const account = client.accounts.find((item) => item.clientMetaAssetId === target.clientMetaAssetId);
  if (!account) return buildUnavailableEvaluation(target, 'account_not_found');

  const relevantGroups = client.metricGroups.filter((group) => {
    if (group.clientMetaAssetId !== target.clientMetaAssetId) return false;
    if (target.campaignId && group.campaignId !== target.campaignId) return false;
    const metric = normalizeMetric(target.metricId, group.metrics[target.metricId]);
    return Boolean(metric?.available);
  });

  if (relevantGroups.length > 0) {
    const attributions = new Set(relevantGroups.map((group) => group.attributionSetting ?? 'none'));
    if (attributions.size > 1) {
      return buildUnavailableEvaluation(target, 'mixed_attribution_requires_filter');
    }

    let resultValue = 0;
    let spendValue = 0;
    let hasSpend = false;
    let partialStatus: string | null = null;

    for (const group of relevantGroups) {
      const resultMetric = normalizeMetric(target.metricId, group.metrics[target.metricId]);
      const spendMetric = normalizeMetric('spend', group.metrics.spend);
      if (resultMetric?.value !== null && resultMetric?.value !== undefined) resultValue += resultMetric.value;
      if (spendMetric?.available && spendMetric.value !== null) {
        spendValue += spendMetric.value;
        hasSpend = true;
      }

      const status = resultMetric?.completenessStatus ?? group.completenessStatus;
      if (status && !['complete', 'zero_delivery'].includes(status)) partialStatus = status;
    }

    const metric: MetricDatum = {
      value: resultValue,
      available: true,
      completenessStatus: partialStatus ?? 'complete',
    };

    const evaluation = evaluatePerformanceTarget(target, metric, {
      spend: hasSpend ? spendValue : null,
    });

    const sample = relevantGroups[0];
    return {
      ...evaluation,
      classifiedObjective: relevantGroups.length === 1 ? sample.classifiedObjective : null,
      destinationType: relevantGroups.length === 1 ? sample.destinationType : null,
      attributionSetting: sample.attributionSetting,
    };
  }

  if (target.campaignId) {
    return buildUnavailableEvaluation(target, 'campaign_metric_unavailable');
  }

  const metric = normalizeMetric(target.metricId, account.metrics[target.metricId]);
  const spend = normalizeMetric('spend', account.metrics.spend);
  return evaluatePerformanceTarget(target, metric, { spend: spend?.value ?? null });
}

function calculateAccountPacing(
  account: GlobalPerformanceAccount,
  targets: PerformanceTarget[],
  period: DashboardPeriod,
  currentDate: Date
): BudgetPacingResult | null {
  const spend = normalizeMetric('spend', account.metrics.spend);
  if (!spend?.available || spend.value === null || !account.timezone) return null;

  const accountTargets = targets.filter(
    (target) => target.clientMetaAssetId === account.clientMetaAssetId && !target.campaignId
  );
  const daily = accountTargets.find((target) => target.targetKind === 'daily_budget');
  const monthly = accountTargets.find((target) => target.targetKind === 'monthly_budget');
  if (!daily && !monthly) return null;

  const fallback = fallbackRange(period, currentDate);
  const result = calculateBudgetPacing({
    actualSpend: spend.value,
    targetDailyBudget: daily?.targetValue ?? null,
    targetMonthlyBudget: monthly?.targetValue ?? null,
    periodStart: account.dateStart ?? fallback.start,
    periodEnd: account.dateStop ?? fallback.end,
    currentDate,
    timezone: account.timezone,
    currency: account.currency,
  });

  return { ...result, clientMetaAssetId: account.clientMetaAssetId };
}

export function enrichGlobalPerformanceDashboard(
  rows: GlobalClientPerformance[],
  period: DashboardPeriod,
  currentDate = new Date()
): GlobalClientPerformance[] {
  return rows.map((row) => {
    const targets = (row.resolvedTargets ?? []).map((target) => ({
      ...target,
      targetValue: asFiniteNumber(target.targetValue) ?? 0,
    }));

    const accounts = (row.accounts ?? []).map((account) => {
      const normalizedAccount: GlobalPerformanceAccount = {
        ...account,
        metrics: normalizeMetricMap(account.metrics),
        budgetPacing: null,
      };
      return {
        ...normalizedAccount,
        budgetPacing: calculateAccountPacing(normalizedAccount, targets, period, currentDate),
      };
    });

    const normalizedGroups = (row.metricGroups ?? []).map((group) => ({
      ...group,
      spend: asFiniteNumber(group.spend),
      metrics: normalizeMetricMap(group.metrics),
    }));

    const normalizedRow: GlobalClientPerformance = {
      ...row,
      accounts,
      metrics: normalizeMetricMap(row.metrics),
      metricGroups: normalizedGroups,
      resolvedTargets: targets,
      evaluations: [],
      budgetPacing: null,
      score: {
        value: null,
        status: 'unavailable',
        confidence: 0,
        coveragePercent: 0,
        summary: 'Pontuação ainda não calculada.',
        signals: [],
      },
    };

    const evaluations = targets
      .filter((target) => !['daily_budget', 'monthly_budget'].includes(target.targetKind))
      .map((target) => evaluateTarget(normalizedRow, target));

    const pacingResults = accounts
      .map((account) => account.budgetPacing)
      .filter((value): value is BudgetPacingResult => value !== null);
    const budgetPacing = combineBudgetPacingByCurrency(pacingResults);
    const score = calculatePerformanceScore({
      clientStatus: normalizedRow.clientStatus,
      dataQuality: normalizedRow.dataQuality,
      evaluations,
      budgetPacing,
    });

    return {
      ...normalizedRow,
      evaluations,
      budgetPacing,
      score,
    };
  });
}

export async function loadGlobalPerformanceDashboard(options: {
  period: DashboardPeriod;
  clientIds?: string[];
  assetIds?: string[];
  dashboardRpc: AnalyticsCapabilities['dashboardRpc'];
}): Promise<GlobalClientPerformance[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase.rpc(
    options.dashboardRpc,
    {
      p_period: options.period,
      p_client_ids: options.clientIds?.length ? options.clientIds : null,
      p_asset_ids: options.assetIds?.length ? options.assetIds : null,
    }
  );

  if (error) {
    throw new Error(`Failed to load global performance dashboard: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data as GlobalClientPerformance[] : [];
  return enrichGlobalPerformanceDashboard(rows, options.period);
}
