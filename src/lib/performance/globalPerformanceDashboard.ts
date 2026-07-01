import { isSupabaseConfigured, supabase } from '../supabase';
import type { AnalyticsCapabilities, DashboardPeriod } from './analyticsCapabilities';
import { calculateBudgetPacing, combineBudgetPacingByCurrency } from './budgetPacing';
import { evaluatePerformanceTarget } from './evaluatePerformance';
import { calculatePerformanceScore, type PerformanceScore } from './performanceScore';
import { normalizeTraceableMetric, type TraceableMetric } from './traceableMetrics';
import {
  E2E_CLIENT_ID,
  E2E_LINK_ID,
  e2eMetric,
  isMetaE2EMode,
  metaE2EState,
} from '../meta/metaE2ERuntime';
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
  score?: PerformanceScore;
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
  if (period === 'this_month') start.setUTCDate(1);
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
        score: undefined,
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

    const scoredAccounts = accounts.map((account) => {
      const accountEvaluations = evaluations.filter(
        (evaluation) => evaluation.clientMetaAssetId === account.clientMetaAssetId
      );
      return {
        ...account,
        score: calculatePerformanceScore({
          clientStatus: normalizedRow.clientStatus,
          dataQuality: account.dataQuality,
          evaluations: accountEvaluations,
          budgetPacing: account.budgetPacing,
        }),
      };
    });

    const pacingResults = scoredAccounts
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
      accounts: scoredAccounts,
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
  if (isMetaE2EMode) {
    const accountMetrics = {
      spend: e2eMetric('spend', 350, 'account'),
      impressions: e2eMetric('impressions', 12000, 'account'),
      reach: e2eMetric('reach', 6000, 'account'),
      frequency: e2eMetric('frequency', 2, 'account'),
      cpm: e2eMetric('cpm', 29.1667, 'account'),
      link_clicks: e2eMetric('link_clicks', 420, 'account'),
      landing_page_views: e2eMetric('landing_page_views', 310, 'account'),
      messaging_conversations_started_total: e2eMetric('messaging_conversations_started_total', 28, 'account'),
      leads: e2eMetric('leads', 16, 'account'),
      purchases: e2eMetric('purchases', 3, 'account'),
      purchase_value: e2eMetric('purchase_value', 1400, 'account'),
      purchase_roas: e2eMetric('purchase_roas', 4, 'account'),
    };
    const campaignMetrics = {
      spend: e2eMetric('spend', 350, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      impressions: e2eMetric('impressions', 12000, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      reach: e2eMetric('reach', 6000, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      frequency: e2eMetric('frequency', 2, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      cpm: e2eMetric('cpm', 29.1667, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      link_clicks: e2eMetric('link_clicks', 420, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      landing_page_views: e2eMetric('landing_page_views', 310, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      messaging_conversations_started_total: e2eMetric('messaging_conversations_started_total', 28, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      leads: e2eMetric('leads', 16, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      purchases: e2eMetric('purchases', 3, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      purchase_value: e2eMetric('purchase_value', 1400, 'campaign', { campaignId: 'campaign-paused-e2e' }),
      purchase_roas: e2eMetric('purchase_roas', 4, 'campaign', { campaignId: 'campaign-paused-e2e' }),
    };
    const hasPeriod = metaE2EState.syncedPeriods.has(options.period);
    const rows: GlobalClientPerformance[] = [{
      clientId: E2E_CLIENT_ID,
      clientName: 'Clínica Mock',
      clientStatus: metaE2EState.linked ? (hasPeriod ? 'available' : 'never_synced') : 'not_connected',
      accounts: metaE2EState.linked ? [{
        clientMetaAssetId: E2E_LINK_ID,
        metaAssetId: '20000000-0000-0000-0000-00000000e2e0',
        integrationId: 'integration-e2e',
        adAccountId: 'act_e2e',
        accountName: 'Conta Meta Mock',
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
        dateStart: hasPeriod ? '2026-07-01' : null,
        dateStop: hasPeriod ? '2026-07-01' : null,
        metrics: hasPeriod ? accountMetrics : {},
        budgetPacing: null,
        dataQuality: { status: hasPeriod ? 'complete' : 'unavailable', reason: hasPeriod ? null : 'period_not_synced' },
        lastSuccessfulRun: hasPeriod ? {
          id: 'run-e2e', status: 'success', startedAt: '2026-07-01T17:59:00Z',
          finishedAt: '2026-07-01T18:00:00Z', terminationReason: 'completed',
        } : null,
        lastAttempt: null,
      }] : [],
      metrics: hasPeriod && metaE2EState.linked ? accountMetrics : {},
      metricGroups: metaE2EState.linked && hasPeriod ? [{
        clientMetaAssetId: E2E_LINK_ID,
        metaAssetId: '20000000-0000-0000-0000-00000000e2e0',
        currency: 'BRL',
        campaignId: 'campaign-paused-e2e',
        campaignName: 'Campanha histórica pausada',
        classifiedObjective: 'LEADS',
        destinationType: 'WHATSAPP',
        attributionSetting: '7d_click_1d_view',
        spend: 350,
        completenessStatus: 'complete',
        metrics: campaignMetrics,
      }] : [],
      resolvedTargets: metaE2EState.targets as unknown as PerformanceTarget[],
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
      dataQuality: { status: hasPeriod && metaE2EState.linked ? 'complete' : 'unavailable', reason: hasPeriod ? null : 'period_not_synced' },
      lastSuccessfulRun: null,
      lastAttempt: null,
      hasNewerPartial: false,
      hasNewerFailure: false,
    }];
    return enrichGlobalPerformanceDashboard(rows, options.period, new Date('2026-07-01T18:00:00Z'));
  }
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
