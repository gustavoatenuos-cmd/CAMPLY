import { describe, expect, it } from 'vitest';
import { getCampaignMetricCellsByObjective } from './campaignMetricCells';
import type { MetricContract } from './globalPerformanceDashboard';

function metric(metricId: string, value: number | null, overrides: Partial<MetricContract> = {}): MetricContract {
  return {
    metricId,
    value,
    available: value !== null,
    currency: 'BRL',
    dateStart: '2026-07-01',
    dateStop: '2026-07-17',
    timezone: 'America/Sao_Paulo',
    sourceLevel: 'campaign',
    attributionSetting: null,
    classifiedObjective: null,
    destinationType: null,
    syncRunId: 'run-1',
    completenessStatus: value !== null ? 'complete' : 'unavailable',
    collectedAt: '2026-07-17T00:00:00Z',
    clientMetaAssetId: 'asset-1',
    accountId: 'act-1',
    accountName: 'Conta Teste',
    campaignId: 'camp-1',
    adsetId: null,
    adId: null,
    unavailableReason: null,
    ...overrides,
  };
}

function cellByKey(cells: ReturnType<typeof getCampaignMetricCellsByObjective>, key: string) {
  return cells.find((c) => c.key === key);
}

describe('getCampaignMetricCellsByObjective', () => {
  it('SALES shows purchases/CPA/purchase value/ROAS, never engagement fields', () => {
    const metrics = {
      spend: metric('spend', 500),
      purchases: metric('purchases', 10),
      purchase_value: metric('purchase_value', 2000),
      purchase_roas: metric('purchase_roas', 4),
      impressions: metric('impressions', 9000),
      reach: metric('reach', 4000),
    };
    const cells = getCampaignMetricCellsByObjective('SALES', metrics, 'BRL');
    const keys = cells.map((c) => c.key);
    expect(keys).toEqual(['spend', 'purchases', 'cpa', 'purchase_value', 'purchase_roas']);
    expect(cellByKey(cells, 'purchases')?.value).toBe('10');
    expect(cellByKey(cells, 'cpa')?.value).toContain('R$');
    expect(cellByKey(cells, 'purchase_roas')?.value).toBe('4.00x');
    expect(keys).not.toContain('reach');
    expect(keys).not.toContain('impressions');
  });

  it('LEADS shows leads/CPL, not purchases/CPA/ROAS', () => {
    const metrics = {
      spend: metric('spend', 300),
      leads: metric('leads', 15),
      purchases: metric('purchases', 3),
      purchase_roas: metric('purchase_roas', 2),
    };
    const cells = getCampaignMetricCellsByObjective('LEADS', metrics, 'BRL');
    const keys = cells.map((c) => c.key);
    expect(keys).toEqual(['spend', 'leads', 'cost_per_lead']);
    expect(cellByKey(cells, 'cost_per_lead')?.value).toBe('R$ 20,00');
  });

  it.each(['WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER'])(
    '%s shows conversations/cost-per-conversation, not purchases/CPA/ROAS',
    (objective) => {
      const metrics = {
        spend: metric('spend', 400),
        messaging_conversations_started_total: metric('messaging_conversations_started_total', 20),
        purchases: metric('purchases', 5),
        purchase_roas: metric('purchase_roas', 3),
      };
      const cells = getCampaignMetricCellsByObjective(objective, metrics, 'BRL');
      const keys = cells.map((c) => c.key);
      expect(keys).toEqual(['spend', 'conversations', 'cost_per_conversation']);
      expect(cellByKey(cells, 'conversations')?.value).toBe('20');
      expect(keys).not.toContain('purchases');
      expect(keys).not.toContain('purchase_roas');
    }
  );

  it('ENGAGEMENT shows spend/reach/impressions/clicks/CTR/CPC and never Compras/CPA/ROAS (the reported bug)', () => {
    const metrics = {
      spend: metric('spend', 250),
      reach: metric('reach', 12000),
      impressions: metric('impressions', 18000),
      clicks: metric('clicks', 900),
      purchases: metric('purchases', 7),
      purchase_roas: metric('purchase_roas', 5),
      purchase_value: metric('purchase_value', 900),
    };
    const cells = getCampaignMetricCellsByObjective('ENGAGEMENT', metrics, 'BRL');
    const keys = cells.map((c) => c.key);
    expect(keys).toEqual(['spend', 'reach', 'impressions', 'clicks', 'ctr', 'cpc']);
    expect(keys).not.toContain('purchases');
    expect(keys).not.toContain('cpa');
    expect(keys).not.toContain('purchase_roas');
    expect(keys).not.toContain('purchase_value');
    // ctr = clicks / impressions * 100 = 900/18000*100 = 5
    expect(cellByKey(cells, 'ctr')?.value).toBe('5%');
  });

  it('AWARENESS shows reach/impressions/CPM, not purchases', () => {
    const metrics = {
      spend: metric('spend', 100),
      reach: metric('reach', 5000),
      impressions: metric('impressions', 8000),
      purchases: metric('purchases', 1),
    };
    const cells = getCampaignMetricCellsByObjective('AWARENESS', metrics, 'BRL');
    const keys = cells.map((c) => c.key);
    expect(keys).toEqual(['spend', 'reach', 'impressions', 'cpm']);
    expect(keys).not.toContain('purchases');
  });

  it('falls back to spend/impressions for MIXED, UNCLASSIFIED, APP, null and unknown values', () => {
    const metrics = {
      spend: metric('spend', 50),
      impressions: metric('impressions', 1000),
      purchases: metric('purchases', 2),
    };
    for (const objective of ['MIXED', 'UNCLASSIFIED', 'APP', null, undefined, 'SOMETHING_NEW']) {
      const cells = getCampaignMetricCellsByObjective(objective as string | null, metrics, 'BRL');
      expect(cells.map((c) => c.key)).toEqual(['spend', 'impressions']);
    }
  });

  it('renders "—" for unavailable metrics instead of fabricating a value', () => {
    const metrics = {
      spend: metric('spend', null, { available: false }),
      purchases: metric('purchases', null, { available: false }),
      purchase_value: metric('purchase_value', null, { available: false }),
      purchase_roas: metric('purchase_roas', null, { available: false }),
    };
    const cells = getCampaignMetricCellsByObjective('SALES', metrics, 'BRL');
    expect(cellByKey(cells, 'spend')?.value).toBe('—');
    expect(cellByKey(cells, 'purchases')?.value).toBe('—');
    expect(cellByKey(cells, 'cpa')?.value).toBe('—');
    expect(cellByKey(cells, 'purchase_roas')?.value).toBe('—');
  });
});
