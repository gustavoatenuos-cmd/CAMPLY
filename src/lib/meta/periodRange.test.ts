import { describe, expect, it } from 'vitest';
import { exactPeriodRange, matchesExactPeriodRange } from './periodRange';

describe('exactPeriodRange', () => {
  it('uses the account timezone for the exact current month', () => {
    const instant = new Date('2026-07-01T01:30:00.000Z');

    expect(exactPeriodRange('this_month', 'America/Sao_Paulo', instant)).toEqual({
      dateStart: '2026-06-01',
      dateStop: '2026-06-30',
    });
    expect(exactPeriodRange('this_month', 'UTC', instant)).toEqual({
      dateStart: '2026-07-01',
      dateStop: '2026-07-01',
    });
  });

  it('rejects a rolling 30-day range as this_month', () => {
    expect(matchesExactPeriodRange(
      'this_month',
      'America/Sao_Paulo',
      '2026-06-02',
      '2026-06-30',
      new Date('2026-07-01T01:30:00.000Z')
    )).toBe(false);
  });

  it('calculates this_week from Monday to local today', () => {
    expect(exactPeriodRange('this_week', 'America/Sao_Paulo', new Date('2026-07-02T15:00:00.000Z'))).toEqual({
      dateStart: '2026-06-29',
      dateStop: '2026-07-02',
    });
    expect(matchesExactPeriodRange(
      'this_week',
      'America/Sao_Paulo',
      '2026-06-29',
      '2026-07-02',
      new Date('2026-07-02T15:00:00.000Z')
    )).toBe(true);
  });
});
