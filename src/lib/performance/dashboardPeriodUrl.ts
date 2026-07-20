import type { DashboardPeriod } from './analyticsCapabilities';

const VALID_PERIODS: DashboardPeriod[] = ['this_month', 'this_week', 'today', 'last_7d', 'last_30d', 'last_90d'];

export function isDashboardPeriod(value: unknown): value is DashboardPeriod {
  return typeof value === 'string' && (VALID_PERIODS as string[]).includes(value);
}

export function periodFromUrl(search: string): DashboardPeriod | null {
  const period = new URLSearchParams(search).get('period');
  return isDashboardPeriod(period) ? period : null;
}

export function resolveDashboardPeriod(search: string, storedPeriod: DashboardPeriod | undefined, fallback: DashboardPeriod): DashboardPeriod {
  return periodFromUrl(search) ?? storedPeriod ?? fallback;
}

export function writeDashboardPeriodToUrl(period: DashboardPeriod): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get('period') === period) return;
  url.searchParams.set('period', period);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
