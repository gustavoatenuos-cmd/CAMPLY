import { describe, expect, it } from 'vitest';
import { calculateObjectiveScopedCosts, emptyObjectiveScopedCosts, groupsForCostObjective } from './objectiveScopedMetrics';
import { unavailableTraceableMetric, type TraceableMetric } from './traceableMetrics';
import type { GlobalMetricGroup } from './globalPerformanceDashboard';

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

function group(overrides: Partial<GlobalMetricGroup> & { metrics?: Record<string, TraceableMetric> }): GlobalMetricGroup {
  return {
    clientMetaAssetId: 'asset-1',
    metaAssetId: 'meta-asset-1',
    currency: 'BRL',
    campaignId: 'campaign-1',
    campaignName: 'Campanha',
    classifiedObjective: null,
    destinationType: null,
    attributionSetting: null,
    spend: null,
    completenessStatus: 'complete',
    metrics: {},
    ...overrides,
  };
}

describe('calculateObjectiveScopedCosts', () => {
  it('computes CPA only from SALES spend and SALES purchases', () => {
    const groups: GlobalMetricGroup[] = [
      group({
        campaignId: 'sales-1',
        classifiedObjective: 'SALES',
        metrics: {
          spend: metric({ metricId: 'spend', value: 300 }),
          purchases: metric({ metricId: 'purchases', value: 3 }),
          purchase_value: metric({ metricId: 'purchase_value', value: 1200 }),
        },
      }),
      group({
        campaignId: 'leads-1',
        classifiedObjective: 'LEADS',
        metrics: {
          spend: metric({ metricId: 'spend', value: 200 }),
          leads: metric({ metricId: 'leads', value: 10 }),
        },
      }),
      group({
        campaignId: 'whatsapp-1',
        classifiedObjective: 'WHATSAPP',
        metrics: {
          spend: metric({ metricId: 'spend', value: 100 }),
          messaging_conversations_started_total: metric({ metricId: 'messaging_conversations_started_total', value: 5 }),
        },
      }),
    ];

    const costs = calculateObjectiveScopedCosts(groups);

    // CPA compra = spend SALES (300) / compras SALES (3) = 100, não (300+200+100)/3.
    expect(costs.costPerPurchase.available).toBe(true);
    expect(costs.costPerPurchase.value).toBe(100);

    // ROAS = valor de compra SALES / spend SALES = 1200 / 300 = 4.
    expect(costs.purchaseRoas.available).toBe(true);
    expect(costs.purchaseRoas.value).toBe(4);

    // CPL = spend LEADS (200) / leads LEADS (10) = 20, não usa o spend de SALES/MESSAGING.
    expect(costs.costPerLead.available).toBe(true);
    expect(costs.costPerLead.value).toBe(20);

    // Custo por conversa = spend MESSAGING (100) / conversas MESSAGING (5) = 20.
    expect(costs.costPerMessagingConversation.available).toBe(true);
    expect(costs.costPerMessagingConversation.value).toBe(20);
  });

  it('never uses total account spend as the numerator', () => {
    const totalSpend = 300 + 200 + 100;
    const groups: GlobalMetricGroup[] = [
      group({
        campaignId: 'sales-1',
        classifiedObjective: 'SALES',
        metrics: {
          spend: metric({ metricId: 'spend', value: 300 }),
          purchases: metric({ metricId: 'purchases', value: 3 }),
        },
      }),
      group({
        campaignId: 'leads-1',
        classifiedObjective: 'LEADS',
        metrics: {
          spend: metric({ metricId: 'spend', value: 200 }),
          leads: metric({ metricId: 'leads', value: 10 }),
        },
      }),
      group({
        campaignId: 'other-1',
        classifiedObjective: 'AWARENESS',
        metrics: {
          spend: metric({ metricId: 'spend', value: 100 }),
        },
      }),
    ];

    const costs = calculateObjectiveScopedCosts(groups);

    expect(costs.costPerPurchase.value).not.toBe(totalSpend / 3);
    expect(costs.costPerPurchase.value).toBe(100);
  });

  it('treats WHATSAPP, MESSENGER, INSTAGRAM_DIRECT and MESSAGING_OTHER as one messaging bucket', () => {
    const groups: GlobalMetricGroup[] = [
      group({
        campaignId: 'wa',
        classifiedObjective: 'WHATSAPP',
        metrics: {
          spend: metric({ metricId: 'spend', value: 60 }),
          messaging_conversations_started_total: metric({ metricId: 'messaging_conversations_started_total', value: 3 }),
        },
      }),
      group({
        campaignId: 'msgr',
        classifiedObjective: 'MESSENGER',
        metrics: {
          spend: metric({ metricId: 'spend', value: 40 }),
          messaging_conversations_started_total: metric({ metricId: 'messaging_conversations_started_total', value: 2 }),
        },
      }),
    ];

    const costs = calculateObjectiveScopedCosts(groups);
    // spend total mensageria = 100, conversas totais = 5 -> 20.
    expect(costs.costPerMessagingConversation.value).toBe(20);
  });

  it('excludes MIXED and UNCLASSIFIED campaigns from every cost bucket', () => {
    const groups: GlobalMetricGroup[] = [
      group({
        campaignId: 'mixed-1',
        classifiedObjective: 'MIXED',
        metrics: {
          spend: metric({ metricId: 'spend', value: 500 }),
          purchases: metric({ metricId: 'purchases', value: 50 }),
        },
      }),
      group({
        campaignId: 'unclassified-1',
        classifiedObjective: 'UNCLASSIFIED',
        metrics: {
          spend: metric({ metricId: 'spend', value: 500 }),
          leads: metric({ metricId: 'leads', value: 50 }),
        },
      }),
    ];

    expect(groupsForCostObjective(groups, 'SALES')).toHaveLength(0);
    expect(groupsForCostObjective(groups, 'LEADS')).toHaveLength(0);
    expect(groupsForCostObjective(groups, 'MESSAGING')).toHaveLength(0);

    const costs = calculateObjectiveScopedCosts(groups);
    expect(costs.costPerPurchase.available).toBe(false);
    expect(costs.costPerLead.available).toBe(false);
    expect(costs.costPerMessagingConversation.available).toBe(false);
  });

  it('reports unavailable instead of inventing a number when an objective has no campaigns', () => {
    const groups: GlobalMetricGroup[] = [
      group({
        campaignId: 'sales-only',
        classifiedObjective: 'SALES',
        metrics: {
          spend: metric({ metricId: 'spend', value: 300 }),
          purchases: metric({ metricId: 'purchases', value: 3 }),
        },
      }),
    ];

    const costs = calculateObjectiveScopedCosts(groups);
    expect(costs.costPerPurchase.available).toBe(true);
    expect(costs.costPerLead.available).toBe(false);
    expect(costs.costPerLead.value).toBeNull();
    expect(costs.costPerMessagingConversation.available).toBe(false);
    expect(costs.costPerMessagingConversation.value).toBeNull();
  });

  it('returns every metric as unavailable for an empty set of groups', () => {
    const costs = calculateObjectiveScopedCosts([]);
    expect(costs.costPerPurchase.available).toBe(false);
    expect(costs.costPerLead.available).toBe(false);
    expect(costs.costPerMessagingConversation.available).toBe(false);
    expect(costs.purchaseRoas.available).toBe(false);
    expect(costs).toEqual(emptyObjectiveScopedCosts());
  });
});
