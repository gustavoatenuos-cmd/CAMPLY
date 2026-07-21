import { describe, expect, it } from 'vitest';
import { exactPeriodRange, matchesExactPeriodRange } from './periodRange';

describe('exactPeriodRange', () => {
  it('calculates yesterday correctly based on timezone', () => {
    const instant = new Date('2026-07-01T01:30:00.000Z');

    expect(exactPeriodRange('yesterday', 'America/Sao_Paulo', instant)).toEqual({
      dateStart: '2026-06-29',
      dateStop: '2026-06-29',
    });
    expect(exactPeriodRange('yesterday', 'UTC', instant)).toEqual({
      dateStart: '2026-06-30',
      dateStop: '2026-06-30',
    });
  });

  it('calculates today_and_yesterday correctly', () => {
    expect(exactPeriodRange('today_and_yesterday', 'America/Sao_Paulo', new Date('2026-07-02T15:00:00.000Z'))).toEqual({
      dateStart: '2026-07-01',
      dateStop: '2026-07-02',
    });
    expect(matchesExactPeriodRange(
      'today_and_yesterday',
      'America/Sao_Paulo',
      '2026-07-01',
      '2026-07-02',
      new Date('2026-07-02T15:00:00.000Z')
    )).toBe(true);
  });

  it('calculates rolling last_7d range', () => {
    expect(exactPeriodRange('last_7d', 'America/Sao_Paulo', new Date('2026-07-05T15:00:00Z'))).toEqual({
      dateStart: '2026-06-29',
      dateStop: '2026-07-05',
    });
  });

  it('handles year boundaries in last_30d', () => {
    expect(exactPeriodRange('last_30d', 'America/Sao_Paulo', new Date('2027-01-01T15:00:00Z'))).toEqual({
      dateStart: '2026-12-03',
      dateStop: '2027-01-01',
    });
  });
});
