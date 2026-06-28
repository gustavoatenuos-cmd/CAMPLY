import type { MetaObjective } from "./objectives.ts";
import type { MetricValueMap } from './metricRegistry.ts';

export type MetaSyncStatus = 'success' | 'partial' | 'failed';
export type PeriodCompletenessStatus =
  | 'zero_delivery'
  | 'missing_insight_row'
  | 'partial_page'
  | 'timeout'
  | 'api_error'
  | 'validation_error'
  | 'complete';

export interface PeriodCompleteness {
  status: PeriodCompletenessStatus;
  reason?: string;
  sourceLevel: 'campaign' | 'adset';
  missingAdsetIds: string[];
  failedAdsetIds: string[];
  dateStart: string | null;
  dateStop: string | null;
  timezone: string;
  currency: string;
}

export interface GlobalMetrics {
  [key: string]: number | string | null | undefined;
  sourceLevel: 'campaign';
  dateStart: string | null;
  dateStop: string | null;
  timezone: string;
  currency: string;
}

export interface AttributionGroup {
  attributionSetting: string;
  classifiedObjective: MetaObjective;
  adsetIds: string[];
  metrics: MetricValueMap;
  sourceLevel: 'campaign' | 'adset';
  dateStart: string | null;
  dateStop: string | null;
  timezone: string;
  currency: string;
  completeness: PeriodCompletenessStatus;
}

export interface TrendAvailability {
  available: boolean;
  reason: string | null;
  comparedWith?: string;
}

export interface MetaSyncedAdSet {
  id: string;
  campaign_id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  optimization_goal?: string;
  destination_type?: string;
  attribution_setting?: string;
  classified_objective: MetaObjective;
}

export interface MetaSyncedCampaign {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  objective: string;
  daily_budget?: string | number;
  lifetime_budget?: string | number;
  activeAdsData?: Array<{ id: string; name: string; status: string }>;
  classifiedObjective: MetaObjective;
  classifiedAdsets: MetaSyncedAdSet[];
  structuralMixedAttribution: boolean;
  mixedAttribution: boolean;
  mixedAttributionByPeriod: Record<string, boolean>;
  mixedObjective: boolean;
  mixedDestination: boolean;
  globalMetricsByPeriod: Record<string, GlobalMetrics>;
  attributionGroupsByPeriod: Record<string, AttributionGroup[]>;
  completenessByPeriod: Record<string, PeriodCompleteness>;
  trendAvailabilityByPeriod: Record<string, TrendAvailability>;
  trendAvailable: boolean;
  trendUnavailableReason: string | null;
}

export interface MetaSyncResponse {
  success: boolean;
  status: MetaSyncStatus;
  runId: string;
  campaigns: MetaSyncedCampaign[];
  message?: string;
  completenessByPeriod: Record<string, PeriodCompletenessStatus>;
  failedAdsetIds: string[];
  timezone: string;
  currency: string;
}
