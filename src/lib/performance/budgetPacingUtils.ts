export type BudgetPacingStatus = 
  | 'no_budget'
  | 'under_pacing'
  | 'on_track'
  | 'over_pacing'
  | 'budget_exceeded';

export interface BudgetPacingCalculation {
  plannedMonthlyBudget: number | null;
  actualSpend: number;
  remainingBudget: number | null;
  expectedSpendUntilToday: number | null;
  pacingPercent: number | null;
  budgetUsagePercent: number | null;
  status: BudgetPacingStatus;
  statusText: string;
}

/**
 * Gets the number of days in the current month (or a provided date's month).
 */
export function getDaysInMonth(date: Date = new Date()): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Calculates budget pacing metrics and status.
 */
export function calculateClientBudgetPacing(
  plannedBudget: number | null | undefined,
  budgetPeriod: 'daily' | 'weekly' | 'monthly' | null | undefined,
  actualSpend: number,
  currentDate: Date = new Date()
): BudgetPacingCalculation {
  if (!plannedBudget || !budgetPeriod) {
    return {
      plannedMonthlyBudget: null,
      actualSpend,
      remainingBudget: null,
      expectedSpendUntilToday: null,
      pacingPercent: null,
      budgetUsagePercent: null,
      status: 'no_budget',
      statusText: 'Orçamento não configurado'
    };
  }

  const daysInMonth = getDaysInMonth(currentDate);
  const elapsedDays = currentDate.getDate();

  let plannedMonthlyBudget = plannedBudget;
  if (budgetPeriod === 'daily') {
    plannedMonthlyBudget = plannedBudget * daysInMonth;
  } else if (budgetPeriod === 'weekly') {
    plannedMonthlyBudget = plannedBudget * (daysInMonth / 7);
  }

  const expectedSpendUntilToday = plannedMonthlyBudget * (elapsedDays / daysInMonth);
  const remainingBudget = plannedMonthlyBudget - actualSpend;
  
  const pacingPercent = expectedSpendUntilToday > 0 ? (actualSpend / expectedSpendUntilToday) * 100 : 0;
  const budgetUsagePercent = plannedMonthlyBudget > 0 ? (actualSpend / plannedMonthlyBudget) * 100 : 0;

  let status: BudgetPacingStatus = 'no_budget';
  let statusText = 'Pendente';

  if (actualSpend > plannedMonthlyBudget) {
    status = 'budget_exceeded';
    statusText = 'Orçamento excedido';
  } else if (actualSpend > expectedSpendUntilToday * 1.15) {
    status = 'over_pacing';
    statusText = 'Acima do ritmo';
  } else if (actualSpend < expectedSpendUntilToday * 0.75) {
    status = 'under_pacing';
    statusText = 'Abaixo do ritmo';
  } else {
    status = 'on_track';
    statusText = 'Dentro do ritmo';
  }

  return {
    plannedMonthlyBudget,
    actualSpend,
    remainingBudget,
    expectedSpendUntilToday,
    pacingPercent,
    budgetUsagePercent,
    status,
    statusText
  };
}
