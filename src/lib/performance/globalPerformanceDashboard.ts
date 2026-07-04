import { isSupabaseConfigured, supabaseData } from '../supabase';
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
import { loadClientAnalysisProfile, mapClientProfileRow, type ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';
import { exactPeriodRange } from '../meta/periodRange';
import { withTimeout } from '../withTimeout';
import { invokeFunction } from '../invokeFunction';
import type {
  BudgetPacingResult,
  MetricDatum,
  PerformanceEvaluation,
  PerformanceTarget,
} from './types';
import type { PerformanceGoal } from '../analysis/clientAnalysisProfile';

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
  analysisProfile?: ClientAnalysisProfile | null;
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

function availableMetricValue(metrics: Record<string, MetricContract>, metricId: string): number | null {
  const metric = metrics[metricId];
  return metric?.available && typeof metric.value === 'number' && Number.isFinite(metric.value) ? metric.value : null;
}

const costGoalResultMetric: Record<string, string> = {
  cost_per_messaging_conversation: 'messaging_conversations_started_total',
  cost_per_lead: 'leads',
  cost_per_registration: 'registrations',
  cost_per_purchase: 'purchases',
  cost_per_landing_page_view: 'landing_page_views',
};

function profileGoalTarget(goal: PerformanceGoal, clientMetaAssetId: string, profile: ClientAnalysisProfile): PerformanceTarget | null {
  const isRange = goal.expectationType === 'range';
  const targetValue = isRange ? goal.maxValue : goal.value;
  if (targetValue == null || targetValue <= 0) return null;
  const costResultMetric = costGoalResultMetric[goal.metricId];
  const targetKind = costResultMetric
    ? 'cost_per_result'
    : goal.expectationType === 'maximum'
      ? 'maximum_metric'
      : goal.expectationType === 'range'
        ? 'target_range'
        : goal.expectationType === 'quantity_minimum'
          ? 'minimum_results'
          : 'minimum_metric';
  return {
    id: `profile:${profile.clientId}:${goal.id}:${clientMetaAssetId}`,
    clientMetaAssetId,
    metricId: costResultMetric || goal.metricId,
    targetKind,
    targetValue,
    targetMin: goal.minValue,
    targetMax: goal.maxValue,
    warningTolerancePercent: goal.warningTolerancePercent,
    criticalTolerancePercent: goal.criticalTolerancePercent,
    priorityWeight: goal.weight,
    evaluationPeriod: profile.budgetPeriod === 'daily' ? 'today' : profile.budgetPeriod === 'weekly' ? 'this_week' : 'this_month',
    effectiveFrom: profile.updatedAt || profile.createdAt,
  };
}

function profileTargets(profile: ClientAnalysisProfile | null | undefined, accounts: GlobalPerformanceAccount[]): PerformanceTarget[] {
  const goals = profile?.performanceGoals || [];
  if (!profile?.analysisEnabled || goals.length === 0) return [];
  return accounts.flatMap((account) => goals
    .map((goal) => profileGoalTarget(goal, account.clientMetaAssetId, profile))
    .filter((target): target is PerformanceTarget => target !== null));
}

function profileDataGateReason(client: GlobalClientPerformance, currentDate: Date): string | null {
  const profile = client.analysisProfile;
  if (!profile?.analysisEnabled) return null;
  const spend = availableMetricValue(client.metrics, 'spend') ?? 0;
  if (profile.minimumEvaluationSpend > 0 && spend < profile.minimumEvaluationSpend) return 'minimum_evaluation_spend_not_reached';
  const impressions = availableMetricValue(client.metrics, 'impressions') ?? 0;
  if (profile.minimumImpressions > 0 && impressions < profile.minimumImpressions) return 'minimum_impressions_not_reached';
  const results = availableMetricValue(client.metrics, profile.primaryConversionMetric) ?? 0;
  if (profile.minimumResults > 0 && results < profile.minimumResults) return 'minimum_results_not_reached';
  const successfulAccountRuns = client.accounts
    .map((account) => account.lastSuccessfulRun?.finishedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastSuccess = client.lastSuccessfulRun?.finishedAt || successfulAccountRuns[successfulAccountRuns.length - 1];
  if (results === 0 && profile.attributionDelayHours > 0 && lastSuccess) {
    const elapsedHours = (currentDate.getTime() - new Date(lastSuccess).getTime()) / 3_600_000;
    if (elapsedHours >= 0 && elapsedHours < profile.attributionDelayHours) return 'attribution_delay_window';
  }
  return null;
}

function applyProfileDataGate(
  evaluations: PerformanceEvaluation[],
  reason: string | null
): PerformanceEvaluation[] {
  if (!reason) return evaluations;
  return evaluations.map((evaluation) => ({
    ...evaluation,
    status: 'insufficient_data',
    reason,
    confidence: Math.min(evaluation.confidence, 35),
  }));
}

function fallbackRange(period: DashboardPeriod, currentDate: Date): { start: Date; end: Date } {
  const end = new Date(currentDate);
  const start = new Date(currentDate);
  if (period === 'this_month') {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  }
  if (period === 'this_week') {
    const day = start.getUTCDay();
    const daysFromMonday = (day + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysFromMonday);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  }
  if (period === 'last_7d') start.setUTCDate(start.getUTCDate() - 6);
  if (period === 'last_30d') start.setUTCDate(start.getUTCDate() - 29);
  return { start, end };
}

function fullBudgetRange(
  period: DashboardPeriod,
  timezone: string,
  currentDate: Date,
  fallback: { start: Date; end: Date }
): { start: string | Date; end: string | Date } {
  if (!['today', 'this_week', 'this_month'].includes(period)) return fallback;
  const exact = exactPeriodRange(period, timezone, currentDate);
  if (period === 'today') return { start: exact.dateStart, end: exact.dateStop };
  if (period === 'this_week') {
    const end = new Date(`${exact.dateStart}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    return { start: exact.dateStart, end: end.toISOString().slice(0, 10) };
  }
  const [year, month] = exact.dateStart.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0, 12));
  return { start: exact.dateStart, end: end.toISOString().slice(0, 10) };
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
    targetMin: target.targetMin ?? null,
    targetMax: target.targetMax ?? null,
    priorityWeight: target.priorityWeight ?? null,
    effectiveFrom: target.effectiveFrom,
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
  const periodProgressPercent = account.budgetPacing
    ? account.budgetPacing.elapsedDays / account.budgetPacing.totalDays * 100
    : null;

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
      periodProgressPercent,
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
  return evaluatePerformanceTarget(target, metric, { spend: spend?.value ?? null, periodProgressPercent });
}

function calculateAccountPacing(
  account: GlobalPerformanceAccount,
  targets: PerformanceTarget[],
  period: DashboardPeriod,
  currentDate: Date,
  profile: ClientAnalysisProfile | null | undefined,
  useProfileBudget: boolean
): BudgetPacingResult | null {
  const spend = normalizeMetric('spend', account.metrics.spend);
  if (!spend?.available || spend.value === null || !account.timezone) return null;

  const accountTargets = targets.filter(
    (target) => target.clientMetaAssetId === account.clientMetaAssetId && !target.campaignId
  );
  const daily = accountTargets.find((target) => target.targetKind === 'daily_budget');
  const weekly = accountTargets.find((target) => target.targetKind === 'weekly_budget');
  const monthly = accountTargets.find((target) => target.targetKind === 'monthly_budget');
  const profileBudget = useProfileBudget && profile?.analysisEnabled && profile.plannedBudget && (
    (profile.budgetPeriod === 'daily' && period === 'today')
    || (profile.budgetPeriod === 'weekly' && period === 'this_week')
    || (profile.budgetPeriod === 'monthly' && period === 'this_month')
  ) ? profile.plannedBudget : null;

  const fallback = fallbackRange(period, currentDate);
  const targetDailyBudget = daily?.targetValue ?? (profile?.budgetPeriod === 'daily' ? profileBudget : null);
  const targetPeriodBudget = period === 'this_week'
    ? weekly?.targetValue ?? (profile?.budgetPeriod === 'weekly' ? profileBudget : null)
    : period === 'this_month'
      ? monthly?.targetValue ?? (profile?.budgetPeriod === 'monthly' ? profileBudget : null)
      : null;
  if (!targetDailyBudget && !targetPeriodBudget) return null;
  const budgetRange = fullBudgetRange(period, account.timezone, currentDate, fallback);
  const result = calculateBudgetPacing({
    actualSpend: spend.value,
    targetDailyBudget,
    targetMonthlyBudget: targetPeriodBudget,
    periodStart: ['today', 'this_week', 'this_month'].includes(period) ? budgetRange.start : account.dateStart ?? fallback.start,
    periodEnd: ['today', 'this_week', 'this_month'].includes(period) ? budgetRange.end : account.dateStop ?? fallback.end,
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
    const configuredProfileTargets = profileTargets(row.analysisProfile, row.accounts ?? []);
    const sourceTargets = configuredProfileTargets.length > 0 ? configuredProfileTargets : row.resolvedTargets ?? [];
    const targets = sourceTargets.map((target) => ({
      ...target,
      targetValue: asFiniteNumber(target.targetValue) ?? 0,
      targetMin: asFiniteNumber(target.targetMin),
      targetMax: asFiniteNumber(target.targetMax),
      warningTolerancePercent: asFiniteNumber(target.warningTolerancePercent),
      criticalTolerancePercent: asFiniteNumber(target.criticalTolerancePercent),
      priorityWeight: asFiniteNumber(target.priorityWeight),
    }));
    const targetsForPeriod = targets.filter((target) => (
      !target.evaluationPeriod
      || target.evaluationPeriod === 'inherit'
      || target.evaluationPeriod === period
    ));

    const sourceAccounts = row.accounts ?? [];
    const accounts = sourceAccounts.map((account) => {
      const normalizedAccount: GlobalPerformanceAccount = {
        ...account,
        metrics: normalizeMetricMap(account.metrics),
        budgetPacing: null,
        score: undefined,
      };
      return {
        ...normalizedAccount,
        budgetPacing: calculateAccountPacing(
          normalizedAccount,
          targetsForPeriod,
          period,
          currentDate,
          row.analysisProfile,
          sourceAccounts.length === 1
        ),
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

    const rawEvaluations = targetsForPeriod
      .filter((target) => !['daily_budget', 'weekly_budget', 'monthly_budget'].includes(target.targetKind))
      .map((target) => evaluateTarget(normalizedRow, target));
    const dataGateReason = profileDataGateReason(normalizedRow, currentDate);
    const evaluations = applyProfileDataGate(rawEvaluations, dataGateReason);

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
          budgetPacing: dataGateReason ? null : account.budgetPacing,
          profile: normalizedRow.analysisProfile,
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
      budgetPacing: dataGateReason ? null : budgetPacing,
      profile: normalizedRow.analysisProfile,
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
    type E2EFixture = {
      clientId: string;
      clientName: string;
      linkId: string;
      assetId: string;
      accountId: string;
      accountName: string;
      campaignId: string;
      campaignName: string;
      profile: ClientAnalysisProfile;
      metricValues: Record<string, number>;
      targets: Array<Omit<PerformanceTarget, 'clientMetaAssetId'>>;
      connected?: boolean;
    };

    const defaultProfile = (input: Partial<ClientAnalysisProfile> & Pick<ClientAnalysisProfile, 'clientId' | 'vertical' | 'subsegment' | 'primaryConversionMetric' | 'budgetPeriod' | 'plannedBudget'>): ClientAnalysisProfile => ({
      customVertical: null,
      customSubsegment: null,
      businessModel: 'negócio local',
      secondaryMetrics: ['cpm', 'link_ctr', 'frequency'],
      primaryChannel: 'Misto',
      primaryObjective: input.primaryConversionMetric === 'purchases'
        ? 'sales'
        : input.primaryConversionMetric === 'leads'
          ? 'leads'
          : input.primaryConversionMetric === 'registrations'
            ? 'registrations'
            : 'whatsapp_messages',
      budgetPlatform: 'meta',
      performanceGoals: [],
      minimumEvaluationSpend: 0,
      minimumImpressions: 0,
      minimumResults: 0,
      attributionDelayHours: 0,
      analysisEnabled: true,
      ...input,
    });

    const baseMetrics = (overrides: Record<string, number>): Record<string, number> => ({
      spend: 350,
      impressions: 12000,
      reach: 6000,
      frequency: 2,
      cpm: 29.1667,
      link_clicks: 420,
      landing_page_views: 310,
      messaging_conversations_started_total: 28,
      leads: 16,
      purchases: 3,
      purchase_value: 1400,
      purchase_roas: 4,
      ...overrides,
    });

    const buildMetricMap = (
      fixture: E2EFixture,
      level: 'account' | 'campaign'
    ): Record<string, MetricContract> => Object.fromEntries(Object.entries(fixture.metricValues).map(([metricId, value]) => {
      const metric = e2eMetric(metricId, value, level, level === 'campaign' ? { campaignId: fixture.campaignId } : {});
      return [metricId, {
        ...metric,
        clientMetaAssetId: fixture.linkId,
        accountId: fixture.accountId,
        accountName: fixture.accountName,
        campaignId: level === 'campaign' ? fixture.campaignId : null,
        classifiedObjective: fixture.profile.primaryConversionMetric === 'purchases' ? 'SALES' : 'LEADS',
        destinationType: fixture.profile.primaryChannel.toUpperCase(),
      }];
    })) as Record<string, MetricContract>;

    const emptyScore = (): PerformanceScore => ({
      value: null,
      status: 'unavailable',
      confidence: 0,
      coveragePercent: 0,
      summary: 'Pontuação ainda não calculada.',
      signals: [],
    });

    const buildFixture = (fixture: E2EFixture): GlobalClientPerformance => {
      const connected = fixture.connected !== false;
      const accountMetrics = buildMetricMap(fixture, 'account');
      const campaignMetrics = buildMetricMap(fixture, 'campaign');
      const run = {
        id: `run-${fixture.clientId}`,
        status: 'success',
        startedAt: '2026-07-01T17:59:00Z',
        finishedAt: '2026-07-01T18:00:00Z',
        terminationReason: 'completed',
      };
      return {
        clientId: fixture.clientId,
        clientName: fixture.clientName,
        clientStatus: connected ? 'available' : 'not_connected',
        accounts: connected ? [{
          clientMetaAssetId: fixture.linkId,
          metaAssetId: fixture.assetId,
          integrationId: `integration-${fixture.clientId}`,
          adAccountId: fixture.accountId,
          accountName: fixture.accountName,
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          dateStart: '2026-07-01',
          dateStop: '2026-07-01',
          metrics: accountMetrics,
          budgetPacing: null,
          dataQuality: { status: 'complete', reason: null },
          lastSuccessfulRun: run,
          lastAttempt: run,
        }] : [],
        metrics: connected ? accountMetrics : {},
        metricGroups: connected ? [{
          clientMetaAssetId: fixture.linkId,
          metaAssetId: fixture.assetId,
          currency: 'BRL',
          campaignId: fixture.campaignId,
          campaignName: fixture.campaignName,
          classifiedObjective: fixture.profile.primaryConversionMetric === 'purchases' ? 'SALES' : 'LEADS',
          destinationType: fixture.profile.primaryChannel.toUpperCase(),
          attributionSetting: '7d_click_1d_view',
          spend: fixture.metricValues.spend ?? null,
          completenessStatus: 'complete',
          metrics: campaignMetrics,
        }] : [],
        resolvedTargets: fixture.targets.map((target, index) => ({
          ...target,
          id: `${fixture.clientId}-target-${index + 1}`,
          clientMetaAssetId: fixture.linkId,
          effectiveFrom: '2026-06-01T00:00:00Z',
        })),
        evaluations: [],
        budgetPacing: null,
        score: emptyScore(),
        dataQuality: { status: connected ? 'complete' : 'unavailable', reason: connected ? null : 'account_not_connected' },
        lastSuccessfulRun: connected ? run : null,
        lastAttempt: connected ? run : null,
        hasNewerPartial: false,
        hasNewerFailure: false,
        analysisProfile: fixture.profile,
      };
    };

    const persistedClinicProfile = await loadClientAnalysisProfile(E2E_CLIENT_ID);
    const clinicProfile = persistedClinicProfile ?? defaultProfile({
      clientId: E2E_CLIENT_ID,
      vertical: 'Saúde',
      subsegment: 'Odontologia',
      businessModel: 'clínica local',
      primaryConversionMetric: 'messaging_conversations_started_total',
      secondaryMetrics: ['cost_per_messaging_conversation', 'cpm', 'link_ctr', 'frequency'],
      primaryChannel: 'WhatsApp',
      budgetPeriod: 'monthly',
      plannedBudget: 1500,
    });
    const clinicTargets: Array<Omit<PerformanceTarget, 'clientMetaAssetId'>> = [
      { metricId: 'messaging_conversations_started_total', targetKind: 'cost_per_result', targetValue: 15, warningTolerancePercent: 10, criticalTolerancePercent: 25, priorityWeight: 2, evaluationPeriod: 'inherit' },
      { metricId: 'cpm', targetKind: 'maximum_metric', targetValue: 25, warningTolerancePercent: 10, criticalTolerancePercent: 25, priorityWeight: 1, evaluationPeriod: 'inherit' },
    ];
    const rows: GlobalClientPerformance[] = [
      buildFixture({
        clientId: E2E_CLIENT_ID,
        clientName: 'Clínica Mock',
        linkId: E2E_LINK_ID,
        assetId: '20000000-0000-0000-0000-00000000e2e0',
        accountId: 'act_e2e',
        accountName: 'Conta Meta Mock',
        campaignId: 'campaign-active-e2e',
        campaignName: 'Campanha ativa mock',
        profile: clinicProfile,
        metricValues: baseMetrics({}),
        targets: [
          ...clinicTargets,
          ...(metaE2EState.targets as unknown as Array<PerformanceTarget & { active?: boolean }>)
            .filter((target) => target.active !== false)
            .map(({ clientMetaAssetId: _clientMetaAssetId, active: _active, ...target }) => target),
        ],
        connected: metaE2EState.linked && metaE2EState.syncedPeriods.has(options.period),
      }),
      buildFixture({
        clientId: 'client-delivery-e2e',
        clientName: 'Delivery Mock',
        linkId: '10000000-0000-0000-0000-00000000e2e1',
        assetId: '20000000-0000-0000-0000-00000000e2e1',
        accountId: 'act_delivery_e2e',
        accountName: 'Conta Delivery Mock',
        campaignId: 'campaign-delivery-e2e',
        campaignName: 'Pedidos da semana',
        profile: defaultProfile({
          clientId: 'client-delivery-e2e', vertical: 'Alimentação', subsegment: 'Delivery',
          businessModel: 'delivery local', primaryConversionMetric: 'purchases',
          secondaryMetrics: ['cost_per_purchase', 'purchase_roas', 'cpm'], primaryChannel: 'Site',
          budgetPeriod: 'weekly', plannedBudget: 700,
        }),
        metricValues: baseMetrics({ spend: 280, purchases: 10, purchase_value: 1120, purchase_roas: 4, impressions: 14000, cpm: 20 }),
        targets: [
          { metricId: 'purchases', targetKind: 'cost_per_result', targetValue: 30, warningTolerancePercent: 10, criticalTolerancePercent: 25, priorityWeight: 2, evaluationPeriod: 'inherit' },
          { metricId: 'purchases', targetKind: 'minimum_results', targetValue: 12, warningTolerancePercent: 10, criticalTolerancePercent: 25, priorityWeight: 1.5, evaluationPeriod: 'this_week' },
        ],
      }),
      buildFixture({
        clientId: 'client-shoes-e2e',
        clientName: 'Loja de Calçados Mock',
        linkId: '10000000-0000-0000-0000-00000000e2e2',
        assetId: '20000000-0000-0000-0000-00000000e2e2',
        accountId: 'act_shoes_e2e',
        accountName: 'Conta Calçados Mock',
        campaignId: 'campaign-shoes-e2e',
        campaignName: 'Coleção de inverno',
        profile: defaultProfile({
          clientId: 'client-shoes-e2e', vertical: 'Varejo local', subsegment: 'Calçados',
          businessModel: 'loja física', primaryConversionMetric: 'purchases',
          secondaryMetrics: ['cost_per_purchase', 'cpm', 'link_ctr'], primaryChannel: 'Site',
          budgetPeriod: 'monthly', plannedBudget: 2400,
        }),
        metricValues: baseMetrics({ spend: 600, purchases: 4, purchase_value: 720, purchase_roas: 1.2, impressions: 12000, cpm: 50, link_clicks: 180 }),
        targets: [
          { metricId: 'purchases', targetKind: 'cost_per_result', targetValue: 100, warningTolerancePercent: 10, criticalTolerancePercent: 25, priorityWeight: 2, evaluationPeriod: 'inherit' },
          { metricId: 'cpm', targetKind: 'maximum_metric', targetValue: 25, warningTolerancePercent: 10, criticalTolerancePercent: 25, priorityWeight: 1.5, evaluationPeriod: 'inherit' },
        ],
      }),
      buildFixture({
        clientId: 'client-products-e2e',
        clientName: 'Loja de Produtos Mock',
        linkId: '10000000-0000-0000-0000-00000000e2e3',
        assetId: '20000000-0000-0000-0000-00000000e2e3',
        accountId: 'act_products_e2e',
        accountName: 'Conta Produtos Mock',
        campaignId: 'campaign-products-e2e',
        campaignName: 'Catálogo de produtos',
        profile: defaultProfile({
          clientId: 'client-products-e2e', vertical: 'Varejo local', subsegment: 'Produtos físicos',
          businessModel: 'varejo híbrido', primaryConversionMetric: 'purchases',
          secondaryMetrics: ['cost_per_purchase', 'purchase_roas', 'purchase_value'], primaryChannel: 'Site',
          budgetPeriod: 'monthly', plannedBudget: 3200,
        }),
        metricValues: baseMetrics({ spend: 800, purchases: 8, purchase_value: 2400, purchase_roas: 3, impressions: 32000, cpm: 25 }),
        targets: [
          { metricId: 'purchases', targetKind: 'cost_per_result', targetValue: 80, warningTolerancePercent: 10, criticalTolerancePercent: 25, priorityWeight: 2, evaluationPeriod: 'inherit' },
          { metricId: 'purchase_roas', targetKind: 'minimum_metric', targetValue: 3.5, warningTolerancePercent: 10, criticalTolerancePercent: 25, priorityWeight: 1.5, evaluationPeriod: 'inherit' },
        ],
      }),
    ];
    return enrichGlobalPerformanceDashboard(rows, options.period, new Date('2026-07-01T18:00:00Z'));
  }
  if (!isSupabaseConfigured || !supabaseData) return [];

  const response = await invokeFunction<{ dashboard: unknown }>(
    'analytics-dashboard',
    {
      action: 'dashboard',
      period: options.period,
      clientIds: options.clientIds?.length ? options.clientIds : null,
      assetIds: options.assetIds?.length ? options.assetIds : null,
    },
    30_000
  );

  const rows = Array.isArray(response.dashboard)
    ? response.dashboard as GlobalClientPerformance[]
    : [];
  const clientIds = rows.map((row) => row.clientId).filter(Boolean);
  if (clientIds.length > 0) {
    try {
      const { data: profileRows, error: profileError } = await withTimeout(
        supabaseData
          .from('client_analysis_profiles')
          .select('*')
          .in('client_id', clientIds),
        6_000,
        'A leitura dos perfis analíticos demorou mais que o esperado.'
      );
      if (!profileError) {
        const profiles = new Map((profileRows || []).map((row) => {
          const profile = mapClientProfileRow(row as Record<string, unknown>);
          return [profile.clientId, profile];
        }));
        rows.forEach((row) => {
          row.analysisProfile = profiles.get(row.clientId) ?? null;
        });
      }
    } catch (error) {
      console.warn('Client analysis profiles skipped:', error instanceof Error ? error.message : String(error));
    }
  }
  return enrichGlobalPerformanceDashboard(rows, options.period);
}
