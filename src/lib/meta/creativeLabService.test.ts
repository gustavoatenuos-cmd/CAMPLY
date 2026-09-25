import { describe, expect, it } from 'vitest';
import type { CamplyData } from '../../types';
import {
  accountHasCreativeDepth,
  aggregateCreativeLabRows,
  classifyCreativePerformance,
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
      projectType: 'traffic',
      clientId: 'client-1',
      ownerName: '',
      company: 'Donatellus',
      billingType: 'recurring',
      name: 'Projeto arquivado',
      role: '',
      status: 'archived',
      progress: 0,
      dueDate: '',
      amountCharged: 0,
      amountReceived: 0,
      paymentStatus: 'pending',
      deliveredUrl: '',
      visibility: 'private',
      nextAction: '',
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

  it('keeps active ad sets as active structure until ad depth has been synchronized', () => {
    const data = baseData();
    data.campaigns = [];
    const official = new Map([['client-1', [{
      clientId: 'client-1',
      clientMetaAssetId: 'link-1',
      accountId: 'act_1',
      accountName: 'Conta',
      activeCampaigns: 3,
      activeAdSets: 4,
      activeAds: 0,
      hasActiveMedia: false,
      lastSyncedAt: '2026-09-24T18:00:00Z',
      dataAvailable: true,
      adDataAvailable: false,
    }]]]);

    expect(buildCreativeLabClientRows(data, new Map(), official)[0]).toMatchObject({
      state: 'active_structure',
      activeCampaigns: 3,
      activeAdSets: 4,
      activeAds: null,
      creativeDepthAvailable: false,
    });
  });

  it('keeps a shallow active campaign as active structure until ad depth is verified', () => {
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
      availablePeriods: ['last_90d'],
      lastAttempt: {
        id: 'run-campaign',
        status: 'success' as const,
        period: 'last_90d',
        level: 'campaign',
        scope: 'full_account',
        startedAt: '2026-09-24T18:00:00Z',
        finishedAt: '2026-09-24T18:01:00Z',
      },
      lastSuccess: {
        id: 'run-campaign',
        status: 'success' as const,
        period: 'last_90d',
        level: 'campaign',
        scope: 'full_account',
        startedAt: '2026-09-24T18:00:00Z',
        finishedAt: '2026-09-24T18:01:00Z',
      },
    }]]]);
    const official = new Map([['client-1', [{
      clientId: 'client-1',
      clientMetaAssetId: 'link-1',
      accountId: 'act_1',
      accountName: 'Conta',
      activeCampaigns: 2,
      activeAdSets: 0,
      activeAds: 0,
      hasActiveMedia: false,
      lastSyncedAt: '2026-09-24T18:01:00Z',
      dataAvailable: true,
      adDataAvailable: false,
    }]]]);

    expect(buildCreativeLabClientRows(data, accounts, official)[0]).toMatchObject({
      state: 'active_structure',
      activeCampaigns: 2,
      activeAdSets: 0,
      activeAds: null,
      creativeDepthAvailable: false,
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
      dataAvailable: true,
      adDataAvailable: true,
    }]]]);

    expect(buildCreativeLabClientRows(data, new Map(), official)[0]).toMatchObject({
      state: 'no_active_media',
      activeCampaigns: 4,
      activeAdSets: 0,
      activeAds: 0,
    });
  });
});

describe('creative lab sync depth', () => {
  const account = {
    clientMetaAssetId: 'link-1',
    metaAssetId: 'asset-1',
    integrationId: 'integration-1',
    adAccountId: 'act_1',
    accountName: 'Conta',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    assetStatus: 'ACTIVE',
    linkedAt: '2026-09-24T18:00:00Z',
    availablePeriods: ['last_90d'],
    lastAttempt: null,
    lastSuccess: null,
  };

  it('requires a deep sync after a campaign-level run', () => {
    expect(accountHasCreativeDepth({
      ...account,
      lastSuccess: {
        id: 'run-1',
        period: 'last_90d',
        level: 'campaign',
        scope: 'full_account',
        startedAt: '2026-09-24T18:00:00Z',
        finishedAt: '2026-09-24T18:01:00Z',
      },
    })).toBe(false);
  });

  it('accepts successful ad or creative level as enough depth for the lab', () => {
    for (const level of ['ad', 'creative']) {
      expect(accountHasCreativeDepth({
        ...account,
        lastSuccess: {
          id: 'run-1',
          status: 'success',
          period: 'last_90d',
          level,
          scope: 'full_account',
          startedAt: '2026-09-24T18:00:00Z',
          finishedAt: '2026-09-24T18:01:00Z',
        },
      })).toBe(true);
    }
  });

  it('does not infer persisted depth from partial run metadata alone', () => {
    expect(accountHasCreativeDepth({
      ...account,
      lastAttempt: {
        id: 'run-partial',
        status: 'partial',
        period: 'last_90d',
        level: 'creative',
        scope: 'full_account',
        startedAt: '2026-09-24T19:00:00Z',
        finishedAt: '2026-09-24T19:01:00Z',
      },
      lastSuccess: {
        id: 'run-deep-older',
        status: 'success',
        period: 'last_90d',
        level: 'creative',
        scope: 'full_account',
        startedAt: '2026-09-24T18:00:00Z',
        finishedAt: '2026-09-24T18:01:00Z',
      },
    })).toBe(false);
  });

  it('rejects failed or running creative attempts as usable depth', () => {
    for (const status of ['failed', 'running'] as const) {
      expect(accountHasCreativeDepth({
        ...account,
        lastAttempt: {
          id: 'run-bad',
          status,
          period: 'last_90d',
          level: 'creative',
          scope: 'full_account',
          startedAt: '2026-09-24T19:00:00Z',
          finishedAt: status === 'running' ? null : '2026-09-24T19:01:00Z',
        },
      })).toBe(false);
    }
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

  it('classifies best, median/watch, no-result, insufficient and worst without punishing tiny spend', () => {
    const messagingMetricSet = (
      spend: number,
      impressions: number,
      clicks: number,
      conversations: number,
      reach: number
    ) => ({
      spend: metric(spend),
      impressions: metric(impressions),
      reach: metric(reach),
      link_clicks: metric(clicks),
      purchases: metric(0),
      purchase_value: metric(0),
      leads: metric(0),
      messaging_conversations_started_total: metric(conversations),
      landing_page_views: metric(0),
    });

    const creatives = aggregateCreativeLabRows([
      raw({
        creativeId: 'creative-best',
        creativeName: 'Melhor',
        classifiedObjective: 'MESSAGING_OTHER',
        metrics: messagingMetricSet(2.5, 100, 2, 1, 80),
      }),
      raw({
        creativeId: 'creative-middle',
        creativeName: 'Mediano',
        classifiedObjective: 'MESSAGING_OTHER',
        metrics: messagingMetricSet(6, 220, 3, 1, 170),
      }),
      raw({
        creativeId: 'creative-expensive',
        creativeName: 'Caro com resultado',
        classifiedObjective: 'MESSAGING_OTHER',
        metrics: messagingMetricSet(21, 1300, 6, 1, 900),
      }),
      raw({
        creativeId: 'creative-no-result',
        creativeName: 'Sem resultado',
        classifiedObjective: 'MESSAGING_OTHER',
        metrics: messagingMetricSet(10.83, 680, 1, 0, 510),
      }),
      raw({
        creativeId: 'creative-watch',
        creativeName: 'Observação',
        classifiedObjective: 'MESSAGING_OTHER',
        metrics: messagingMetricSet(3.31, 210, 1, 0, 155),
      }),
      raw({
        creativeId: 'creative-insufficient',
        creativeName: 'Sem base',
        classifiedObjective: 'MESSAGING_OTHER',
        metrics: messagingMetricSet(0.08, 7, 0, 0, 6),
      }),
    ]);

    const byId = new Map(creatives.map((creative) => [creative.creativeId, creative]));

    expect(byId.get('creative-best')).toMatchObject({
      performanceFlag: 'best',
      resultLabel: 'Conversas',
      costPerResult: 2.5,
    });
    expect(byId.get('creative-no-result')).toMatchObject({
      performanceBand: 'no_result',
      performanceFlag: 'worst',
      resultValue: 0,
    });
    expect(byId.get('creative-watch')).toMatchObject({
      performanceBand: 'watch',
      performanceFlag: null,
    });
    expect(byId.get('creative-insufficient')).toMatchObject({
      performanceBand: 'insufficient',
      performanceFlag: null,
      performanceScore: null,
    });
    expect(byId.get('creative-middle')?.performanceScore).not.toBeNull();
    expect(byId.get('creative-best')?.performanceScore).toBeGreaterThan(
      byId.get('creative-middle')?.performanceScore || 0
    );
  });

  it('keeps classification deterministic when passed through the exported classifier again', () => {
    const creatives = aggregateCreativeLabRows([
      raw({ creativeId: 'creative-a' }),
      raw({
        creativeId: 'creative-b',
        creativeName: 'Segundo',
        metrics: {
          spend: metric(120),
          impressions: metric(9000),
          reach: metric(7000),
          link_clicks: metric(90),
          purchases: metric(2),
          purchase_value: metric(180),
          leads: metric(0),
          messaging_conversations_started_total: metric(0),
          landing_page_views: metric(0),
        },
      }),
    ]);

    const classified = classifyCreativePerformance(creatives);
    expect(classified.map((creative) => creative.creativeId)).toEqual(
      creatives.map((creative) => creative.creativeId)
    );
    expect(classified.find((creative) => creative.performanceFlag === 'best')).toBeTruthy();
  });

});
