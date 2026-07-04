import type { CanonicalMetricId, MetricUnit, PrimaryObjective } from '../lib/metrics/metricCatalog';

export type IntelligencePeriod = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month';
export type IntelligenceAvailability = 'excellent' | 'healthy' | 'attention' | 'critical' | 'insufficient_data' | 'unavailable';

export interface ClientIntelligenceMetricDTO {
  metricId: CanonicalMetricId;
  label: string;
  unit: MetricUnit;
  target: number | { min: number; max: number } | null;
  actual: number | null;
  previous: number | null;
  difference: number | null;
  percentageDifference: number | null;
  status: IntelligenceAvailability;
  trend: 'up' | 'down' | 'stable' | 'unavailable';
  confidence: number;
  explanation: string;
}

export interface ClientIntelligenceAlertDTO {
  id: string;
  clientId: string;
  campaignId: string | null;
  campaignName: string | null;
  metricId: string;
  ruleKey: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'active' | 'acknowledged' | 'resolved';
  message: string;
  currentValue: number | null;
  thresholdValue: number | null;
  lastTriggeredAt: string;
}

export interface ClientIntelligenceDashboardDTO {
  client: { id: string; name: string; company: string | null; status: string; vertical: string; subsegment: string; primaryObjective: PrimaryObjective | null; primaryChannel: string };
  period: IntelligencePeriod;
  dataQuality: { status: 'complete' | 'partial' | 'unavailable'; reliableRunId: string | null; latestAttemptRunId: string | null; latestAttemptStatus: string | null; timezone: string | null; currency: string | null; dateStart: string | null; dateStop: string | null; message: string | null };
  budgetPacing: { period: string; planned: number | null; actual: number | null; expectedNow: number | null; balance: number | null; consumedPercent: number | null; expectedPercent: number | null; projectedEnd: number | null; status: string };
  score: { value: number | null; status: string; confidence: number; explanation: string; factors: Array<{ title: string; evidence: string; severity: string }> };
  metrics: ClientIntelligenceMetricDTO[];
  campaigns: Array<{ campaignId: string; campaignName: string; status: string; objective: string | null; spend: number | null; metrics: Record<string, unknown>; alerts: ClientIntelligenceAlertDTO[] }>;
  alerts: ClientIntelligenceAlertDTO[];
  priorities: Array<{ title: string; evidence: string; severity: string }>;
}

export interface ClientIntelligenceAIContextDTO {
  client: ClientIntelligenceDashboardDTO['client'];
  objective: PrimaryObjective | null;
  vertical: string;
  subsegment: string;
  period: IntelligencePeriod;
  dataQuality: ClientIntelligenceDashboardDTO['dataQuality'];
  budgetPacing: ClientIntelligenceDashboardDTO['budgetPacing'];
  evaluatedMetrics: ClientIntelligenceMetricDTO[];
  score: ClientIntelligenceDashboardDTO['score'];
  activeAlerts: ClientIntelligenceAlertDTO[];
  priorities: ClientIntelligenceDashboardDTO['priorities'];
  previousPeriodComparison: { available: boolean; reason: string | null };
}

