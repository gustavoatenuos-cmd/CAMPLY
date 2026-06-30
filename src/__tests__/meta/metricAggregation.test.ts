// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { aggregateCompatibleMetrics } from '../../lib/meta/metricRegistry';

describe('aggregateCompatibleMetrics', () => {
  it('does not sum reach or calculate frequency for Ad Set groups', () => {
    const result = aggregateCompatibleMetrics([
      { spend: 40, impressions: 400, reach: 300 },
      { spend: 60, impressions: 600, reach: 500 },
    ], { sourceLevel: 'adset' });

    expect(result.spend).toBe(100);
    expect(result.impressions).toBe(1000);
    expect(result.reach).toBeUndefined();
    expect(result.frequency).toBeUndefined();
  });

  it('recalculates CTR, CPC, CPM, CPA and ROAS from additive totals', () => {
    const result = aggregateCompatibleMetrics([
      { spend: 40, impressions: 400, link_clicks: 20, purchases: 1, purchase_value: 100 },
      { spend: 60, impressions: 600, link_clicks: 30, purchases: 3, purchase_value: 200 },
    ], { sourceLevel: 'adset' });

    expect(result.link_ctr).toBe(5);
    expect(result.link_cpc).toBe(2);
    expect(result.cpm).toBe(100);
    expect(result.cpa).toBe(25);
    expect(result.purchase_roas).toBe(3);
  });

  it('uses only a supplied deduplicated campaign reach', () => {
    const result = aggregateCompatibleMetrics([
      { spend: 100, impressions: 1000, reach: 999 },
    ], { sourceLevel: 'campaign', deduplicatedReach: 800 });

    expect(result.reach).toBe(800);
    expect(result.frequency).toBe(1.25);
  });

  it('consolidates messaging conversations and recalculates cost per conversation', () => {
    const result = aggregateCompatibleMetrics([
      { spend: 40, whatsapp_conversations_started: 2, messenger_conversations_started: 1 },
      { spend: 60, instagram_direct_conversations_started: 3, messaging_conversations_started_generic: 4 },
    ], { sourceLevel: 'adset' });

    expect(result.messaging_conversations_started_total).toBe(10);
    expect(result.cost_per_messaging_conversation).toBe(10);
    expect(result.cpa).toBe(10);
  });
});
