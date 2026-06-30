export type PerformanceStatus =
  | 'on_track'
  | 'attention'
  | 'critical'
  | 'insufficient_data'
  | 'partial_data'
  | 'unavailable';

export type TargetKind = 'cost_per_result' | 'daily_budget' | 'monthly_budget' | 'minimum_results';

export interface MetricDatum {
  value: number | null;
  available: boolean;
  completenessStatus?: string | null;
}

export interface PerformanceTarget {
  id?: string;
  clientMetaAssetId?: string;
  campaignId?: string | null;
  metricId: string;
  targetKind: TargetKind;
  targetValue: number;
  effectiveFrom?: string | Date;
  effectiveTo?: string | Date | null;
}

export interface PerformanceEvaluation {
  clientMetaAssetId?: string;
  campaignId?: string | null;
  metricId: string;
  targetKind: TargetKind;
  actualValue: number | null;
  targetValue: number;
  differenceValue: number | null;
  differencePercent: number | null;
  status: PerformanceStatus;
  reason: string;
  confidence: number;
}

export interface BudgetPacingInput {
  actualSpend: number;
  targetDailyBudget?: number | null;
  targetMonthlyBudget?: number | null;
  periodStart: string | Date;
  periodEnd: string | Date;
  currentDate?: string | Date;
  timezone: string;
  currency: string | null;
}

export interface BudgetPacingResult {
  clientMetaAssetId?: string;
  actualSpend: number;
  targetDailyBudget: number;
  expectedSpendUntilNow: number;
  actualDailyAverage: number;
  projectedMonthlySpend: number;
  differenceValue: number;
  differencePercent: number;
  status: PerformanceStatus;
  currency: string | null;
  elapsedDays: number;
  totalDays: number;
}
