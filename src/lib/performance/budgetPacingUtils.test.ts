import { describe, it, expect } from 'vitest';
import { calculateClientBudgetPacing, getDaysInMonth } from './budgetPacingUtils';

describe('budgetPacingUtils', () => {
  it('handles missing budget gracefully', () => {
    const result = calculateClientBudgetPacing(null, null, 100);
    expect(result.status).toBe('no_budget');
    expect(result.statusText).toBe('Orçamento não configurado');
    expect(result.plannedMonthlyBudget).toBeNull();
    expect(result.actualSpend).toBe(100);
  });

  it('normalizes daily budget to monthly', () => {
    const testDate = new Date('2026-07-15T12:00:00Z');
    const result = calculateClientBudgetPacing(100, 'daily', 500, testDate);
    // July has 31 days. 100 * 31 = 3100
    expect(result.plannedMonthlyBudget).toBe(3100);
  });

  it('normalizes weekly budget to monthly', () => {
    const testDate = new Date('2026-07-15T12:00:00Z');
    const result = calculateClientBudgetPacing(700, 'weekly', 500, testDate);
    // July has 31 days. 700 * (31 / 7) = 3100
    expect(result.plannedMonthlyBudget).toBe(3100);
  });

  it('calculates pacing status correctly (on_track)', () => {
    // 30 day month. day 15. planned = 3000. Expected spend today = 1500.
    const testDate = new Date('2026-06-15T12:00:00Z');
    const result = calculateClientBudgetPacing(3000, 'monthly', 1500, testDate);
    expect(result.expectedSpendUntilToday).toBe(1500);
    expect(result.status).toBe('on_track');
    expect(result.statusText).toBe('Dentro do ritmo');
  });

  it('calculates pacing status correctly (under_pacing)', () => {
    // 30 day month. day 15. planned = 3000. Expected spend today = 1500.
    // 0.75 * 1500 = 1125. Spend = 1000.
    const testDate = new Date('2026-06-15T12:00:00Z');
    const result = calculateClientBudgetPacing(3000, 'monthly', 1000, testDate);
    expect(result.status).toBe('under_pacing');
  });

  it('calculates pacing status correctly (over_pacing)', () => {
    // 30 day month. day 15. planned = 3000. Expected spend today = 1500.
    // 1.15 * 1500 = 1725. Spend = 2000.
    const testDate = new Date('2026-06-15T12:00:00Z');
    const result = calculateClientBudgetPacing(3000, 'monthly', 2000, testDate);
    expect(result.status).toBe('over_pacing');
  });

  it('calculates pacing status correctly (budget_exceeded)', () => {
    // 30 day month. day 15. planned = 3000. Expected spend today = 1500.
    // Spend = 3500.
    const testDate = new Date('2026-06-15T12:00:00Z');
    const result = calculateClientBudgetPacing(3000, 'monthly', 3500, testDate);
    expect(result.status).toBe('budget_exceeded');
  });
});
