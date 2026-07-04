import type { ClientIntelligenceAIContextDTO, ClientIntelligenceAlertDTO, ClientIntelligenceDashboardDTO, IntelligenceAvailability, IntelligencePeriod } from '../contracts/clientIntelligence';
import { supabaseData } from '../lib/supabase';
import { metricCatalog, isCanonicalMetricId, type PrimaryObjective } from '../lib/metrics/metricCatalog';
import { evaluatePerformanceTarget } from '../lib/performance/evaluatePerformance';
import { calculateBudgetPacing } from '../lib/performance/budgetPacing';
import { calculatePerformanceScore } from '../lib/performance/performanceScore';
import type { PerformanceTarget, TargetKind } from '../lib/performance/types';

type Json = Record<string, unknown>;
const supportedRpcPeriods: Record<IntelligencePeriod, string> = {
  today: 'today', yesterday: 'today', this_week: 'last_7d', last_week: 'last_7d',
  this_month: 'this_month', last_month: 'last_30d',
};

function object(value: unknown): Json { return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}; }
function array(value: unknown): Json[] { return Array.isArray(value) ? value.filter((item): item is Json => Boolean(item && typeof item === 'object')) : []; }
function number(value: unknown): number | null { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function string(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }

function targetKind(expectation: string): TargetKind {
  if (expectation === 'maximum') return 'maximum_metric';
  if (expectation === 'range') return 'target_range';
  if (expectation === 'quantity_minimum') return 'minimum_results';
  return 'minimum_metric';
}

function alert(row: Json): ClientIntelligenceAlertDTO {
  return {
    id: String(row.id ?? ''), clientId: String(row.client_id ?? row.clientId ?? ''),
    campaignId: string(row.campaign_id ?? row.campaignId), campaignName: string(row.campaign_name ?? row.campaignName),
    metricId: String(row.metric_name ?? row.metricId ?? ''), ruleKey: String(row.rule_key ?? row.ruleKey ?? ''),
    severity: row.severity === 'critical' || row.severity === 'warning' ? row.severity : 'info',
    status: row.status === 'acknowledged' || row.status === 'resolved' ? row.status : 'active',
    message: String(row.message ?? ''), currentValue: number(row.current_value ?? row.currentValue),
    thresholdValue: number(row.threshold_value ?? row.thresholdValue),
    lastTriggeredAt: String(row.last_triggered_at ?? row.lastTriggeredAt ?? ''),
  };
}

export async function getClientIntelligenceDashboard(clientId: string, period: IntelligencePeriod): Promise<ClientIntelligenceDashboardDTO> {
  if (!supabaseData) throw new Error('Backend analítico indisponível. Nenhum dado local foi usado como substituto.');
  const { data, error } = await supabaseData.rpc('get_client_intelligence_dashboard_v1', {
    p_client_id: clientId, p_period: supportedRpcPeriods[period],
  });
  if (error) throw new Error(`Não foi possível carregar a inteligência oficial: ${error.message}`);
  const raw = object(data); const rawClient = object(raw.client); const profile = object(raw.profile);
  const rawMetrics = object(raw.metrics); const targets = array(raw.targets); const alerts = array(raw.alerts).map(alert);
  const accounts = array(raw.accounts); const firstAccount = accounts[0] ?? {};
  const dataQualityRaw = object(raw.dataQuality); const reliable = object(raw.reliableRun); const latest = object(raw.latestAttempt);
  const timezone = string(firstAccount.timezone) ?? 'America/Sao_Paulo';
  const currency = string(firstAccount.currency); const dateStart = string(firstAccount.dateStart); const dateStop = string(firstAccount.dateStop);

  const evaluations = targets.map((target) => {
    const metricId = String(target.metricId ?? ''); const metric = object(rawMetrics[metricId]);
    const performanceTarget: PerformanceTarget = {
      id: string(target.id) ?? undefined, metricId, targetKind: targetKind(String(target.expectationType ?? 'minimum')),
      targetValue: number(target.targetValue) ?? 0, targetMin: number(target.targetMin), targetMax: number(target.targetMax),
      warningTolerancePercent: number(target.warningTolerancePercent), criticalTolerancePercent: number(target.criticalTolerancePercent),
      priorityWeight: number(target.weight), evaluationPeriod: string(target.evaluationPeriod),
    };
    return evaluatePerformanceTarget(performanceTarget, {
      value: number(metric.value), available: metric.available === true, completenessStatus: string(metric.completenessStatus),
    });
  });

  const planned = number(profile.planned_budget); const spendMetric = object(rawMetrics.spend); const actualSpend = number(spendMetric.value);
  const pacing = planned != null && actualSpend != null && dateStart && dateStop ? calculateBudgetPacing({
    actualSpend, targetDailyBudget: planned / Math.max(1, Math.round((new Date(`${dateStop}T12:00:00`).getTime() - new Date(`${dateStart}T12:00:00`).getTime()) / 86_400_000) + 1),
    periodStart: dateStart, periodEnd: dateStop, timezone, currency,
  }) : null;
  const qualityStatus = dataQualityRaw.status === 'complete' || dataQualityRaw.status === 'partial' ? dataQualityRaw.status : 'unavailable';
  const score = calculatePerformanceScore({
    clientStatus: reliable.id ? (qualityStatus === 'partial' ? 'partial' : 'available') : 'never_synced',
    dataQuality: { status: qualityStatus, reason: string(dataQualityRaw.reason) }, evaluations, budgetPacing: pacing,
    profile: { primaryConversionMetric: string(profile.primary_conversion_metric), secondaryMetrics: Array.isArray(profile.secondary_metrics) ? profile.secondary_metrics as string[] : [] },
  });

  const metricRows = evaluations.flatMap((evaluation) => {
    if (!isCanonicalMetricId(evaluation.metricId)) return [];
    const target = evaluation.targetKind === 'target_range'
      ? { min: evaluation.targetMin ?? 0, max: evaluation.targetMax ?? 0 } : evaluation.targetValue;
    const status: IntelligenceAvailability = evaluation.status === 'on_track' ? 'healthy' : evaluation.status === 'attention' ? 'attention' : evaluation.status === 'critical' ? 'critical' : evaluation.status === 'unavailable' ? 'unavailable' : 'insufficient_data';
    return [{
      metricId: evaluation.metricId, label: metricCatalog[evaluation.metricId].label, unit: metricCatalog[evaluation.metricId].unit,
      target, actual: evaluation.actualValue, previous: null, difference: evaluation.differenceValue,
      percentageDifference: evaluation.differencePercent,
      status,
      trend: 'unavailable' as const, confidence: evaluation.confidence, explanation: evaluation.reason,
    }];
  });
  const campaigns = array(raw.campaigns).map((campaign) => ({
    campaignId: String(campaign.campaignId ?? ''), campaignName: String(campaign.campaignName ?? ''),
    status: String(campaign.status ?? campaign.effectiveStatus ?? 'unknown'), objective: string(campaign.classifiedObjective),
    spend: number(campaign.spend), metrics: object(campaign.metrics),
    alerts: alerts.filter((item) => item.campaignId === campaign.campaignId),
  }));
  const factors = score.signals.map((signal) => ({ title: signal.title, evidence: signal.evidence, severity: signal.severity }));

  return {
    client: { id: String(rawClient.id ?? clientId), name: String(rawClient.name ?? ''), company: string(rawClient.company),
      status: reliable.id ? 'active' : 'unavailable', vertical: String(rawClient.vertical ?? 'Outros'), subsegment: String(rawClient.subsegment ?? 'Outros'),
      primaryObjective: (string(rawClient.primaryObjective) as PrimaryObjective | null), primaryChannel: String(rawClient.primaryChannel ?? 'Misto') },
    period, dataQuality: { status: qualityStatus, reliableRunId: string(reliable.id), latestAttemptRunId: string(latest.id),
      latestAttemptStatus: string(latest.status), timezone, currency, dateStart, dateStop, message: string(dataQualityRaw.reason) },
    budgetPacing: { period: String(profile.budget_period ?? 'monthly'), planned, actual: actualSpend,
      expectedNow: pacing?.expectedSpendUntilNow ?? null, balance: pacing?.remainingBalance ?? null,
      consumedPercent: pacing?.consumedPercent ?? null, expectedPercent: pacing?.elapsedPercent ?? null,
      projectedEnd: pacing?.projectedMonthlySpend ?? null, status: pacing?.rhythmStatus ?? 'unavailable' },
    score: { value: score.value, status: score.status, confidence: score.confidence, explanation: score.summary, factors },
    metrics: metricRows, campaigns, alerts, priorities: factors,
  };
}

export async function listClientIntelligenceOverview(period: IntelligencePeriod): Promise<ClientIntelligenceDashboardDTO[]> {
  if (!supabaseData) return [];
  const { data: clients, error } = await supabaseData.from('client_identity').select('client_id').is('archived_at', null);
  if (error) throw new Error('Não foi possível listar os clientes oficiais.');
  return Promise.all((clients ?? []).map((row) => getClientIntelligenceDashboard(String(row.client_id), period)));
}

export async function acknowledgeClientAlert(alertId: string): Promise<void> {
  if (!supabaseData) throw new Error('Backend indisponível.');
  const { error } = await supabaseData.from('budget_alerts').update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() }).eq('id', alertId).select('id').single();
  if (error) throw new Error(`Não foi possível confirmar o alerta: ${error.message}`);
}

export async function resolveClientAlert(alertId: string): Promise<void> {
  if (!supabaseData) throw new Error('Backend indisponível.');
  const { error } = await supabaseData.from('budget_alerts').update({ status: 'resolved', is_resolved: true, resolved_at: new Date().toISOString() }).eq('id', alertId).select('id').single();
  if (error) throw new Error(`Não foi possível resolver o alerta: ${error.message}`);
}

export function buildClientIntelligenceAIContext(dto: ClientIntelligenceDashboardDTO): ClientIntelligenceAIContextDTO {
  return { client: dto.client, objective: dto.client.primaryObjective, vertical: dto.client.vertical, subsegment: dto.client.subsegment,
    period: dto.period, dataQuality: dto.dataQuality, budgetPacing: dto.budgetPacing, evaluatedMetrics: dto.metrics,
    score: dto.score, activeAlerts: dto.alerts.filter((item) => item.status !== 'resolved'), priorities: dto.priorities,
    previousPeriodComparison: { available: dto.metrics.some((metric) => metric.previous != null), reason: dto.metrics.some((metric) => metric.previous != null) ? null : 'previous_period_not_persisted' } };
}
