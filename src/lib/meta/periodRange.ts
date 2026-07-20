import type { DashboardPeriod } from '../performance/analyticsCapabilities';

function dateParts(date: Date, timezone: string): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: values.year, month: values.month, day: values.day };
}

export function exactPeriodRange(
  period: DashboardPeriod,
  timezone: string,
  now = new Date()
): { dateStart: string; dateStop: string } {
  const current = dateParts(now, timezone);
  const dateStop = `${current.year}-${current.month}-${current.day}`;
  if (period === 'this_month') {
    return { dateStart: `${current.year}-${current.month}-01`, dateStop };
  }
  if (period === 'this_week') {
    const localNoon = new Date(`${dateStop}T12:00:00.000Z`);
    const day = localNoon.getUTCDay();
    const daysFromMonday = (day + 6) % 7;
    localNoon.setUTCDate(localNoon.getUTCDate() - daysFromMonday);
    return { dateStart: localNoon.toISOString().slice(0, 10), dateStop };
  }
  if (period === 'today') return { dateStart: dateStop, dateStop };
  if (period === 'yesterday') {
    const yesterday = new Date(`${dateStop}T12:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const value = yesterday.toISOString().slice(0, 10);
    return { dateStart: value, dateStop: value };
  }
  if (period === 'today_and_yesterday') {
    const yesterday = new Date(`${dateStop}T12:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return { dateStart: yesterday.toISOString().slice(0, 10), dateStop };
  }

  const days = period === 'last_7d' ? 7 : period === 'last_90d' ? 90 : 30;
  const utcStop = new Date(`${dateStop}T12:00:00.000Z`);
  utcStop.setUTCDate(utcStop.getUTCDate() - (days - 1));
  return { dateStart: utcStop.toISOString().slice(0, 10), dateStop };
}

export function matchesExactPeriodRange(
  period: DashboardPeriod,
  timezone: string,
  dateStart: string | null,
  dateStop: string | null,
  now = new Date()
): boolean {
  if (!dateStart || !dateStop) return false;
  const expected = exactPeriodRange(period, timezone, now);
  return dateStart === expected.dateStart && dateStop === expected.dateStop;
}
