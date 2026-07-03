import type { BudgetPacingInput, BudgetPacingResult, PerformanceStatus } from './types';

const DAY_MS = 86_400_000;

function toLocalDateKey(value: string | Date, timezone: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value instanceof Date ? value : new Date(value));
}

function dayNumber(value: string | Date, timezone: string): number {
  const [year, month, day] = toLocalDateKey(value, timezone).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pacingStatus(differencePercent: number): PerformanceStatus {
  const absolute = Math.abs(differencePercent);
  if (absolute <= 10) return 'on_track';
  if (absolute <= 25) return 'attention';
  return 'critical';
}

function rhythmStatus(differencePercent: number, actualSpend: number, plannedBudget: number): BudgetPacingResult['rhythmStatus'] {
  if (plannedBudget <= 0) return 'unavailable';
  if (actualSpend > plannedBudget) return 'exceeded';
  if (differencePercent > 25) return 'well_above';
  if (differencePercent > 10) return 'above';
  if (differencePercent < -10) return 'below';
  return 'on_track';
}

function budgetControl(actualSpend: number, targetDailyBudget: number, elapsedDays: number, totalDays: number) {
  const plannedBudget = targetDailyBudget * totalDays;
  const remainingBalance = Math.max(plannedBudget - actualSpend, 0);
  const exceededAmount = Math.max(actualSpend - plannedBudget, 0);
  const consumedPercent = plannedBudget > 0 ? actualSpend / plannedBudget * 100 : 0;
  const elapsedPercent = totalDays > 0 ? elapsedDays / totalDays * 100 : 100;
  const daysRemaining = Math.max(totalDays - elapsedDays, 0);
  const requiredDailySpend = daysRemaining > 0 ? remainingBalance / daysRemaining : 0;
  return { plannedBudget, remainingBalance, exceededAmount, consumedPercent, elapsedPercent, daysRemaining, requiredDailySpend };
}

export function calculateBudgetPacing(input: BudgetPacingInput): BudgetPacingResult {
  const periodStartDay = dayNumber(input.periodStart, input.timezone);
  const periodEndDay = dayNumber(input.periodEnd, input.timezone);
  const currentDay = dayNumber(input.currentDate ?? new Date(), input.timezone);
  const totalDays = Math.max(periodEndDay - periodStartDay + 1, 1);
  const elapsedDays = clamp(currentDay - periodStartDay + 1, 1, totalDays);
  const targetDailyBudget = input.targetDailyBudget ?? (input.targetMonthlyBudget ? input.targetMonthlyBudget / totalDays : 0);

  if (!Number.isFinite(targetDailyBudget) || targetDailyBudget <= 0) {
    const control = budgetControl(input.actualSpend, 0, elapsedDays, totalDays);
    return {
      actualSpend: input.actualSpend,
      targetDailyBudget: 0,
      expectedSpendUntilNow: 0,
      actualDailyAverage: input.actualSpend / elapsedDays,
      projectedMonthlySpend: 0,
      differenceValue: 0,
      differencePercent: 0,
      status: 'unavailable',
      currency: input.currency,
      elapsedDays,
      totalDays,
      ...control,
      rhythmStatus: 'unavailable',
    };
  }

  const expectedSpendUntilNow = targetDailyBudget * elapsedDays;
  const actualDailyAverage = input.actualSpend / elapsedDays;
  const projectedMonthlySpend = actualDailyAverage * totalDays;
  const differenceValue = input.actualSpend - expectedSpendUntilNow;
  const differencePercent = (differenceValue / expectedSpendUntilNow) * 100;
  const control = budgetControl(input.actualSpend, targetDailyBudget, elapsedDays, totalDays);

  return {
    actualSpend: input.actualSpend,
    targetDailyBudget,
    expectedSpendUntilNow,
    actualDailyAverage,
    projectedMonthlySpend,
    differenceValue,
    differencePercent,
    status: pacingStatus(differencePercent),
    currency: input.currency,
    elapsedDays,
    totalDays,
    ...control,
    rhythmStatus: rhythmStatus(differencePercent, input.actualSpend, control.plannedBudget),
  };
}

export function combineBudgetPacingByCurrency(results: BudgetPacingResult[]): BudgetPacingResult | null {
  if (results.length === 0) return null;
  const currencies = new Set(results.map((result) => result.currency || ''));
  if (currencies.size > 1) return null;

  const [first] = results;
  const actualSpend = results.reduce((sum, result) => sum + result.actualSpend, 0);
  const expectedSpendUntilNow = results.reduce((sum, result) => sum + result.expectedSpendUntilNow, 0);
  const projectedMonthlySpend = results.reduce((sum, result) => sum + result.projectedMonthlySpend, 0);
  const targetDailyBudget = results.reduce((sum, result) => sum + result.targetDailyBudget, 0);
  const differenceValue = actualSpend - expectedSpendUntilNow;
  const differencePercent = expectedSpendUntilNow > 0 ? (differenceValue / expectedSpendUntilNow) * 100 : 0;

  const elapsedDays = first.elapsedDays;
  const plannedBudget = results.reduce((sum, result) => sum + (result.plannedBudget ?? result.targetDailyBudget * result.totalDays), 0);
  const remainingBalance = results.reduce((sum, result) => sum + (result.remainingBalance ?? Math.max((result.plannedBudget ?? 0) - result.actualSpend, 0)), 0);
  const exceededAmount = results.reduce((sum, result) => sum + (result.exceededAmount ?? Math.max(result.actualSpend - (result.plannedBudget ?? 0), 0)), 0);
  const consumedPercent = plannedBudget > 0 ? actualSpend / plannedBudget * 100 : 0;
  const daysRemaining = first.daysRemaining ?? Math.max(first.totalDays - first.elapsedDays, 0);

  return {
    actualSpend,
    targetDailyBudget,
    expectedSpendUntilNow,
    actualDailyAverage: actualSpend / elapsedDays,
    projectedMonthlySpend,
    differenceValue,
    differencePercent,
    status: expectedSpendUntilNow > 0 ? pacingStatus(differencePercent) : 'unavailable',
    currency: first.currency,
    elapsedDays,
    totalDays: first.totalDays,
    plannedBudget,
    remainingBalance,
    exceededAmount,
    consumedPercent,
    elapsedPercent: first.elapsedPercent ?? first.elapsedDays / first.totalDays * 100,
    daysRemaining,
    requiredDailySpend: daysRemaining > 0 ? remainingBalance / daysRemaining : 0,
    rhythmStatus: rhythmStatus(differencePercent, actualSpend, plannedBudget),
  };
}
