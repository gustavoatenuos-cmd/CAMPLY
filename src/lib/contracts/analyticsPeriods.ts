export const ANALYTICS_PERIODS = [
  'today',
  'yesterday',
  'today_and_yesterday',
  'last_7d',
  'last_30d',
  'last_90d',
] as const;

export type AnalyticsPeriod = typeof ANALYTICS_PERIODS[number];

export const legacyPeriods = ['this_month', 'this_week'] as const;
export type LegacyPeriod = typeof legacyPeriods[number];

export type DashboardPeriod = AnalyticsPeriod | LegacyPeriod;

export function isCanonicalPeriod(period: string): period is AnalyticsPeriod {
  return ANALYTICS_PERIODS.includes(period as AnalyticsPeriod);
}

export function normalizeLegacyPeriod(period: DashboardPeriod): AnalyticsPeriod {
  if (isCanonicalPeriod(period)) {
    return period;
  }
  // Mapping legacy periods to a canonical fallback
  if (period === 'this_month') return 'last_30d';
  if (period === 'this_week') return 'last_7d';
  return 'last_30d';
}

export const periodLabels: Record<DashboardPeriod, string> = {
  this_month: 'Mês atual',
  this_week: 'Semana atual',
  today: 'Hoje',
  yesterday: 'Ontem',
  today_and_yesterday: 'Hoje e ontem',
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  last_90d: 'Últimos 90 dias',
};
