/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  readPendingClientSelection,
  setPendingClientSelection,
  readPendingAnalyticsPeriod,
  setPendingAnalyticsPeriod,
} from './pendingClientSelection';

describe('pendingClientSelection', () => {
  afterEach(() => window.sessionStorage.clear());

  it('returns null when nothing was set', () => {
    expect(readPendingClientSelection()).toBeNull();
  });

  it('returns the last client id that was set', () => {
    setPendingClientSelection('client-1');
    expect(readPendingClientSelection()).toBe('client-1');
    setPendingClientSelection('client-2');
    expect(readPendingClientSelection()).toBe('client-2');
  });
});

describe('pendingAnalyticsPeriod', () => {
  afterEach(() => window.sessionStorage.clear());

  it('returns null when nothing was set', () => {
    expect(readPendingAnalyticsPeriod()).toBeNull();
  });

  it('carries the Dashboard-selected period across to Analytics - the "Ver análise" handoff', () => {
    setPendingAnalyticsPeriod('last_7d');
    expect(readPendingAnalyticsPeriod()).toBe('last_7d');
    setPendingAnalyticsPeriod('today_and_yesterday');
    expect(readPendingAnalyticsPeriod()).toBe('today_and_yesterday');
  });

  it('ignores a stale/invalid stored value instead of returning garbage', () => {
    window.sessionStorage.setItem('camply:pending-analytics-period', 'not_a_real_period');
    expect(readPendingAnalyticsPeriod()).toBeNull();
  });
});
