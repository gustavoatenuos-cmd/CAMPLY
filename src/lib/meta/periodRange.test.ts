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

  it('keeps Monday and Sunday inside the same calendar week', () => {
    expect(exactPeriodRange('this_week', 'America/Sao_Paulo', new Date('2029-01-01T15:00:00Z'))).toEqual({
      dateStart: '2029-01-01',
      dateStop: '2029-01-01',
    });
    expect(exactPeriodRange('this_week', 'America/Sao_Paulo', new Date('2026-07-05T15:00:00Z'))).toEqual({
      dateStart: '2026-06-29',
      dateStop: '2026-07-05',
    });
  });

  it('handles a calendar week crossing month and year boundaries', () => {
    expect(exactPeriodRange('this_week', 'America/Sao_Paulo', new Date('2027-01-01T15:00:00Z'))).toEqual({
      dateStart: '2026-12-28',
      dateStop: '2027-01-01',
    });
  });

  it('uses the requested timezone through daylight-saving transitions', () => {
    expect(exactPeriodRange('this_week', 'America/New_York', new Date('2026-03-08T06:30:00Z'))).toEqual({
      dateStart: '2026-03-02',
      dateStop: '2026-03-08',
    });
  });
});
