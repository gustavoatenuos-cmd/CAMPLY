import { describe, expect, it } from 'vitest';
import {
  isCanonicalPeriod,
  normalizeLegacyPeriod,
  ANALYTICS_PERIODS,
} from './analyticsPeriods';

describe('Analytics Periods Contract', () => {
  it('should identify canonical periods correctly', () => {
    expect(isCanonicalPeriod('today')).toBe(true);
    expect(isCanonicalPeriod('last_30d')).toBe(true);
    expect(isCanonicalPeriod('this_month')).toBe(false);
    expect(isCanonicalPeriod('this_week')).toBe(false);
    expect(isCanonicalPeriod('invalid')).toBe(false);
  });

  it('should normalize legacy periods correctly', () => {
    // Normalizes correctly
    expect(normalizeLegacyPeriod('this_month')).toBe('last_30d');
    expect(normalizeLegacyPeriod('this_week')).toBe('last_7d');
    
    // Canonical stays canonical
    expect(normalizeLegacyPeriod('last_90d')).toBe('last_90d');
    expect(normalizeLegacyPeriod('today')).toBe('today');
  });

  it('contains expected list of periods', () => {
    expect(ANALYTICS_PERIODS).toEqual([
      'today',
      'yesterday',
      'today_and_yesterday',
      'last_7d',
      'last_30d',
      'last_90d',
    ]);
  });
});
