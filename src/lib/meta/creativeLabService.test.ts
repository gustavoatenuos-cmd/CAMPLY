import { describe, expect, it } from 'vitest';
import type { CamplyData } from '../../types';
import {
  aggregateCreativeLabRows,
  buildCreativeLabClientRows,
  type CreativeLabRawRow,
} from './creativeLabService';

const baseData = (): CamplyData => ({
  clients: [{
    id: 'client-1',
    projectId: 'project-1',
    name: 'Donatellus',
    company: 'Donatellus',
    segment: 'Delivery',
    structure: '',
    hasProject: true,
    contact: '',
    monthlyFee: 0,
    managementFeeType: 'recurring',
    dueDay: 10,
    adInvestmentPeriod: 'monthly',
    adInvestmentMeta: 1000,
    adInvestmentGoogle: 0,
    adInvestmentYoutube: 0,
    adInvestmentTikTok: 0,
    status: 'active',
  }],
  campaigns: [{
    id: 'workspace-campaign',
    clientId: 'client-1',
    name: 'Campanha Meta ativa',
    platform: 'Meta Ads',
    status: 'live',
    objective: 'Vendas',
    budget: 0,
    spent: 0,
    nextAction: '',
    priority: 'medium',
    metaStatus: 'ACTIVE',
    metaEffectiveStatus: 'ACTIVE',
    activeAdSets: [{
      id: 'set-1',
      name: 'Conjunto',
      status: 'PAUSED',
      effective_status: 'PAUSED',
      ads: [{ id: 'ad-1', name: 'Anúncio', status: 'ACTIVE', effective_status: 'ACTIVE' }],
    }],
  }],
  receivables: [],
  projects: [],
  tasks: [],
  activityLogs: [],
  agentRules: [],
  agentAlerts: [],
  agentLogs: [],
});

const metric = (value: number) => ({ value, available: true } as any);

function raw(overrides: Partial<CreativeLabRawRow> = {}): CreativeLabRawRow {
  return {
    accountId: 'act_1',
    accountName: 'Conta',
    currency: 'BRL',
    campaignId: 'campaign-1',
    campaignName: 'Vendas',
    campaignStatus: 'ACTIVE',
    campaignEffectiveStatus: 'ACTIVE',
    classifiedObjective: 'SALES',
    adsetId: 'set-1',
    adsetName: 'Conjunto',
    adsetStatus: 'ACTIVE',
    adsetEffectiveStatus: 'ACTIVE',
    adId: 'ad-1',
    adName: 'Anúncio 1',
    adStatus: 'ACTIVE',
    adEffectiveStatus: 'ACTIVE',
    creativeId: 'creative-1',
    creativeName: 'Pizza Família',
    title: 'Pizza Família',
    body: null,
    thumbnailUrl: null,
    imageUrl: null,
    objectStorySpec: null,
    updatedAt: null,
    metrics: {
      spend: metric(100),
      impressions: metric(10000),
      link_clicks: metric(200),
      purchases: metric(5),
      purchase_value: metric(500),
      leads: metric(0),
      messaging_conversations_started_total: metric(0),
      landing_page_views: metric(0),
    },
    ...overrides,
  };
}

describe('creative lab client state', () => {
  it('does not call media active when campaign is active but the ad set is paused', () => {
    const rows = buildCreativeLabClientRows(baseData(), new Map());
    expect(rows[0]).toMatchObject({
      state: 'no_active_media',
      activeCampaigns: 1,
      activeAdSets: 0,
      activeAds: 0,
    });
  });

  it('requires an active ad set and an active ad for media to be active', () => {
    const data = baseData();
    data.campaigns[0].activeAdSets![0].status = 'ACTIVE';
    data.campaigns[0].activeAdSets![0].effective_status = 'ACTIVE';
    const rows = buildCreativeLabClientRows(data, new Map());
    expect(rows[0]).toMatchObject({
      state: 'active_media',
      activeAdSets: 1,
      activeAds: 1,
    });
  });

  it('does not include clients outside the active CAMPLY operation', () => {
    const data = baseData();
    data.clients[0].status = 'paused';
    data.campaigns[0].activeAdSets![0].status = 'ACTIVE';
    data.campaigns[0].activeAdSets![0].effective_status = 'ACTIVE';
    expect(buildCreativeLabClientRows(data, new Map())).toEqual([]);
  });

  it('does not include a client whose linked project is archived', () => {
    const data = baseData();
    data.projects = [{
      id: 'project-1',
      clientId: 'client-1',
      name: 'Projeto arquivado',
      company: 'Donatellus',
      ownerName: '',
      services: [],
      status: 'archived',
      billingType: 'recurring',
      amountCharged: 0,
      amountReceived: 0,
      paymentStatus: 'pending',
      dueDate: '',
    }];
    data.clients[0].projectId = 'project-1';
    expect(buildCreativeLabClientRows(data, new Map())).toEqual([]);
  });

  it('marks linked clients as data unavailable when the official summary failed and there is no structural fallback', () => {
    const data = baseData();
    data.campaigns = [];
    const accounts = new Map([['client-1', [{
      clientMetaAssetId: 'link-1',
      metaAssetId: 'asset-1',
      integrationId: 'integration-1',
      adAccountId: 'act_1',
      accountName: 'Conta',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      assetStatus: 'ACTIVE',
      linkedAt: '2026-09-24T18:00:00Z',
      availablePeriods: [],
      lastAttempt: null,
      lastSuccess: null,
    }]]]);

    expect(buildCreativeLabClientRows(data, accounts, new Map(), false)[0]).toMatchObject({
      state: 'data_unavailable',
      dataAvailable: false,
      activeCampaigns: null,
      activeAdSets: null,
      activeAds: null,
    });
  });

  it('prefers the official synced Meta structure over the workspace fallback', () => {
    const data = baseData();
    data.campaigns[0].activeAdSets![0].status = 'ACTIVE';
    data.campaigns[0].activeAdSets![0].effective_status = 'ACTIVE';

    const official = new Map([['client-1', [{
      clientId: 'client-1',
      clientMetaAssetId: 'link-1',
      accountId: 'act_1',
      accountName: 'Conta',
      activeCampaigns: 4,
      activeAdSets: 0,
      activeAds: 0,
      hasActiveMedia: false,
      lastSyncedAt: '2026-09-24T18:00:00Z',
    }]]]);

    expect(buildCreativeLabClientRows(data, new Map(), official)[0]).toMatchObject({
      state: 'no_active_media',
      activeCampaigns: 4,
      activeAdSets: 0,
      activeAds: 0,
    });
  });
});

describe('creative lab aggregation', () => {
  it('aggregates reused creatives across ads and ranks from verified metrics', () => {
    const creatives = aggregateCreativeLabRows([
      raw(),
      raw({
        adId: 'ad-2',
        adName: 'Anúncio 2',
        adStatus: 'PAUSED',
        adEffectiveStatus: 'PAUSED',
        metrics: {
          spend: metric(50),
          impressions: metric(5000),
          link_clicks: metric(100),
          purchases: metric(1),
          purchase_value: metric(100),
          leads: metric(0),
          messaging_conversations_started_total: metric(0),
          landing_page_views: metric(0),
        },
      }),
      raw({
        adId: 'ad-3',
        creativeId: 'creative-2',
        creativeName: 'Pizza Fraca',
        metrics: {
          spend: metric(100),
          impressions: metric(10000),
          link_clicks: metric(100),
          purchases: metric(1),
          purchase_value: metric(100),
          leads: metric(0),
          messaging_conversations_started_total: metric(0),
          landing_page_views: metric(0),
        },
      }),
    ]);

    expect(creatives[0]).toMatchObject({
      creativeId: 'creative-1',
      spend: 150,
      purchases: 6,
      purchaseValue: 600,
      resultLabel: 'Compras',
      resultValue: 6,
      costLabel: 'CPA',
      costPerResult: 25,
      roas: 4,
      active: true,
      activeAds: 1,
      adsCount: 2,
    });
    expect(creatives[0].ctr).toBeCloseTo(2);
    expect(creatives[0].cpm).toBeCloseTo(10);
    expect(creatives[1].creativeId).toBe('creative-2');
  });
});
