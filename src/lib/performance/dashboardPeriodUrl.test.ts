/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveDashboardPeriod, writeDashboardPeriodToUrl } from './dashboardPeriodUrl';

describe('dashboardPeriodUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses URL period before sessionStorage period', () => {
    expect(resolveDashboardPeriod('?period=last_7d', 'this_month', 'last_90d')).toBe('last_7d');
  });

  it('makes PC and tablet deterministic when both open the same URL', () => {
    const url = '?period=last_7d';
    const pcPeriod = resolveDashboardPeriod(url, 'this_month', 'last_90d');
    const tabletPeriod = resolveDashboardPeriod(url, 'last_30d', 'last_90d');

    expect(pcPeriod).toBe('last_7d');
    expect(tabletPeriod).toBe('last_7d');
  });

  it('writes the selected period to the current URL', () => {
    window.history.replaceState({}, '', '/dashboard?foo=bar');
    writeDashboardPeriodToUrl('last_7d');

    expect(window.location.search).toContain('foo=bar');
    expect(window.location.search).toContain('period=last_7d');
  });
});
