// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { buildClientMetaAnalytics, getCampaignPeriodMetrics, getMessagingConversations } from '../../lib/meta/clientAnalytics';

const client = {
  id: 'client_1',
  name: 'Gustavo',
  company: 'Cliente Meta',
  segment: '',
};

const campaign = (overrides = {}) => ({
  id: 'campaign_1',
  clientId: 'client_1',
  name: 'Campanha WhatsApp',
  platform: 'Meta Ads',
  status: 'live',
  objective: 'WHATSAPP',
  classifiedObjective: 'WHATSAPP',
  budget: 0,
  spent: 0,
  nextAction: '',
  priority: 'medium',
  globalMetricsByPeriod: {
    last_7d: {
      spend: 100,
      impressions: 10000,
      link_clicks: 200,
      whatsapp_conversations_started: 10,
      cpm: 10,
      link_ctr: 2,
      link_cpc: 0.5,
      messaging_conversations_started_total: 10,
      cost_per_messaging_conversation: 10,
    },
  },
  attributionGroupsByPeriod: {
    last_7d: [
      {
        attributionSetting: '7d_click',
        classifiedObjective: 'WHATSAPP',
        adsetIds: ['adset_1'],
        metrics: {
          spend: 40,
          impressions: 4000,
          whatsapp_conversations_started: 8,
          messaging_conversations_started_total: 8,
          cost_per_messaging_conversation: 5,
        },
        sourceLevel: 'adset',
        dateStart: '2026-06-01',
        dateStop: '2026-06-07',
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
        completeness: 'complete',
      },
      {
        attributionSetting: '7d_click',
        classifiedObjective: 'WHATSAPP',
        adsetIds: ['adset_2'],
        metrics: {
          spend: 60,
          impressions: 6000,
          whatsapp_conversations_started: 2,
          messaging_conversations_started_total: 2,
          cost_per_messaging_conversation: 30,
        },
        sourceLevel: 'adset',
        dateStart: '2026-06-01',
        dateStop: '2026-06-07',
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
        completeness: 'complete',
      },
    ],
  },
  activeAdSets: [
    { id: 'adset_1', name: 'Grupo campeão', status: 'ACTIVE' },
    { id: 'adset_2', name: 'Grupo caro', status: 'ACTIVE' },
  ],
  ...overrides,
});

describe('client meta analytics', () => {
  it('sums messaging destinations when explicit total is unavailable', () => {
    expect(getMessagingConversations({
      whatsapp_conversations_started: 3,
      messenger_conversations_started: 2,
      instagram_direct_conversations_started: 1,
    })).toBe(6);
  });

  it('does not fallback to another Meta period when the selected period is missing', () => {
    expect(getCampaignPeriodMetrics(campaign(), 'last_30d')).toEqual({});
  });

  it('builds client totals and ranks best campaign and ad set by primary objective performance', () => {
    const worseCampaign = campaign({
      id: 'campaign_2',
      name: 'Campanha cara',
      globalMetricsByPeriod: {
        last_7d: {
          spend: 200,
          impressions: 12000,
          messaging_conversations_started_total: 5,
          cost_per_messaging_conversation: 40,
        },
      },
      attributionGroupsByPeriod: { last_7d: [] },
    });

    const analytics = buildClientMetaAnalytics(client, [worseCampaign, campaign()], 'last_7d');

    expect(analytics.totals.spend).toBe(300);
    expect(analytics.totals.conversations).toBe(15);
    expect(analytics.totals.costPerConversation).toBe(20);
    expect(analytics.bestCampaign?.campaign.name).toBe('Campanha WhatsApp');
    expect(analytics.bestAdSet?.title).toBe('Grupo campeão');
    expect(analytics.bestAdSet?.primary.cost).toBe(5);
  });
});
