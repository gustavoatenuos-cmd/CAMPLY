import { describe, expect, it } from 'vitest';
import { aggregateMetricTotal, aggregateRatio } from './aggregateMetrics';
import { unavailableTraceableMetric, type TraceableMetric } from './traceableMetrics';

function metric(overrides: Partial<TraceableMetric>): TraceableMetric {
  return {
    ...unavailableTraceableMetric(overrides.metricId || 'spend'),
    value: 0,
    available: true,
    completenessStatus: 'complete',
    currency: 'BRL',
    ...overrides,
  };
}

describe('aggregateMetricTotal', () => {
  it('sums available metrics across accounts', () => {
    const result = aggregateMetricTotal([
      metric({ value: 350 }),
      metric({ value: 280 }),
      metric({ value: 600 }),
    ], { monetary: true });

    expect(result.value).toBe(1230);
    expect(result.available).toBe(true);
    expect(result.currency).toBe('BRL');
    expect(result.accountsUsed).toBe(3);
    expect(result.partial).toBe(false);
  });

  it('ignores unavailable metrics instead of treating them as zero', () => {
    const result = aggregateMetricTotal([
      metric({ value: 100 }),
      unavailableTraceableMetric('spend'),
      undefined,
    ], { monetary: true });

    expect(result.value).toBe(100);
    expect(result.accountsUsed).toBe(1);
  });

  it('returns unavailable when no account has data', () => {
    const result = aggregateMetricTotal([unavailableTraceableMetric('spend'), undefined]);
    expect(result.available).toBe(false);
    expect(result.value).toBeNull();
    expect(result.accountsUsed).toBe(0);
  });

  it('refuses to sum monetary values across different currencies', () => {
    const result = aggregateMetricTotal([
      metric({ value: 100, currency: 'BRL' }),
      metric({ value: 50, currency: 'USD' }),
    ], { monetary: true });

    expect(result.available).toBe(false);
    expect(result.mixedCurrency).toBe(true);
  });

  it('flags the total as partial when any contributor has incomplete data', () => {
    const result = aggregateMetricTotal([
      metric({ value: 100 }),
      metric({ value: 50, completenessStatus: 'partial_page' }),
    ], { monetary: true });

    expect(result.available).toBe(true);
    expect(result.partial).toBe(true);
  });

  it('treats counts as currency-free', () => {
    const result = aggregateMetricTotal([
      metric({ metricId: 'purchases', value: 4, currency: 'BRL' }),
      metric({ metricId: 'purchases', value: 6, currency: 'USD' }),
    ]);

    expect(result.value).toBe(10);
    expect(result.currency).toBeNull();
  });
});

describe('aggregateRatio', () => {
  const spend = aggregateMetricTotal([
    metric({ value: 350 }),
    metric({ value: 280 }),
  ], { monetary: true });

  it('computes weighted cost per result across accounts', () => {
    const conversations = aggregateMetricTotal([
      metric({ metricId: 'messaging_conversations_started_total', value: 28 }),
      metric({ metricId: 'messaging_conversations_started_total', value: 14 }),
    ]);

    const costPerConversation = aggregateRatio(spend, conversations);
    expect(costPerConversation.value).toBe(15);
    expect(costPerConversation.currency).toBe('BRL');
  });

  it('computes CPM with the multiplier', () => {
    const impressions = aggregateMetricTotal([
      metric({ metricId: 'impressions', value: 12000 }),
      metric({ metricId: 'impressions', value: 14000 }),
    ]);

    const cpm = aggregateRatio(spend, impressions, 1000);
    expect(cpm.value).toBeCloseTo((630 / 26000) * 1000, 5);
  });

  it('makes ROAS adimensional when both sides are monetary', () => {
    const purchaseValue = aggregateMetricTotal([
      metric({ metricId: 'purchase_value', value: 1400 }),
      metric({ metricId: 'purchase_value', value: 1120 }),
    ], { monetary: true });

    const roas = aggregateRatio(purchaseValue, spend);
    expect(roas.value).toBe(4);
    expect(roas.currency).toBeNull();
  });

  it('is unavailable when the denominator is zero or missing', () => {
    const noPurchases = aggregateMetricTotal([metric({ metricId: 'purchases', value: 0 })]);
    expect(aggregateRatio(spend, noPurchases).available).toBe(false);

    const missing = aggregateMetricTotal([undefined]);
    expect(aggregateRatio(spend, missing).available).toBe(false);
  });

  it('blocks ratios between different currencies', () => {
    const usdValue = aggregateMetricTotal([
      metric({ metricId: 'purchase_value', value: 100, currency: 'USD' }),
    ], { monetary: true });

    const roas = aggregateRatio(usdValue, spend);
    expect(roas.available).toBe(false);
    expect(roas.mixedCurrency).toBe(true);
  });

  it('propagates the partial flag from either side', () => {
    const partialSpend = aggregateMetricTotal([
      metric({ value: 100, completenessStatus: 'timeout' }),
    ], { monetary: true });
    const conversations = aggregateMetricTotal([
      metric({ metricId: 'messaging_conversations_started_total', value: 10 }),
    ]);

    const ratio = aggregateRatio(partialSpend, conversations);
    expect(ratio.available).toBe(true);
    expect(ratio.partial).toBe(true);
  });
});
