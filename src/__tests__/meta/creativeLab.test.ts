import { describe, expect, it } from 'vitest';
import type { CamplyData, Client } from '../../types';
import { buildCreativeLabClientSummary, buildCreativeLabCreatives } from '../../lib/meta/creativeLab';

const client = (overrides: Partial<Client> = {}): Client => ({
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
  adInvestmentMeta: 0,
  adInvestmentGoogle: 0,
  adInvestmentYoutube: 0,
  adInvestmentTikTok: 0,
  status: 'active',
  ...overrides,
});

const baseData = (): CamplyData => ({
  clients: [client()],
  campaigns: [],
  receivables: [],
  projects: [],
  tasks: [],
  activityLogs: [],
  agentRules: [],
  agentAlerts: [],
  agentLogs: [],
});

describe('creativeLab', () => {
  it('does not call media active when the campaign is active but every ad set is paused', () => {
    const data = baseData();
    data.campaigns = [{
      id: 'campaign-1',
      clientId: 'client-1',
      name: 'Campanha que ficou ligada',
      platform: 'Meta Ads',
      status: 'live',
      objective: 'Vendas',
      budget: 0,
      spent: 0,
      nextAction: '',
      priority: 'low',
      activeAdSets: [{
        id: 'adset-1',
        name: 'Conjunto pausado',
        status: 'PAUSED',
        effective_status: 'PAUSED',
        ads: [],
      }],
    }];

    const summary = buildCreativeLabClientSummary(data, data.clients[0], 'last_30d');

    expect(summary.state).toBe('no_active_media');
    expect(summary.metaCampaignCount).toBe(1);
    expect(summary.activeAdSetCount).toBe(0);
  });

  it('marks paused CAMPLY clients as inactive even if a synchronized ad set is active', () => {
    const data = baseData();
    data.clients = [client({ status: 'paused' })];
    data.campaigns = [{
      id: 'campaign-1',
      clientId: 'client-1',
      name: 'Campanha',
      platform: 'Meta Ads',
      status: 'live',
      objective: 'Vendas',
      budget: 0,
      spent: 0,
      nextAction: '',
      priority: 'low',
      activeAdSets: [{ id: 'adset-1', name: 'Conjunto', status: 'ACTIVE', effective_status: 'ACTIVE', ads: [] }],
    }];

    expect(buildCreativeLabClientSummary(data, data.clients[0], 'last_30d').state).toBe('inactive_client');
  });

  it('aggregates ads that reuse the same creative and ranks by objective-aware performance', () => {
    const data = baseData();
    data.campaigns = [{
      id: 'campaign-1',
      clientId: 'client-1',
      name: 'Vendas',
      platform: 'Meta Ads',
      status: 'live',
      objective: 'Vendas',
      classifiedObjective: 'SALES',
      budget: 0,
      spent: 0,
      nextAction: '',
      priority: 'low',
      activeAdSets: [{
        id: 'adset-1',
        name: 'Conjunto A',
        status: 'ACTIVE',
        effective_status: 'ACTIVE',
        ads: [
          {
            id: 'ad-1',
            name: 'Anúncio 1',
            status: 'ACTIVE',
            effective_status: 'ACTIVE',
            creative_id: 'creative-winner',
            creative: { id: 'creative-winner', name: 'Vídeo vencedor', thumbnail_url: 'https://example.com/a.jpg' },
            metricsByPeriod: { last_30d: { spend: 100, impressions: 10000, link_clicks: 200, purchases: 10, purchase_value: 1000 } },
          },
          {
            id: 'ad-2',
            name: 'Anúncio 2',
            status: 'ACTIVE',
            effective_status: 'ACTIVE',
            creative_id: 'creative-winner',
            creative: { id: 'creative-winner', name: 'Vídeo vencedor' },
            metricsByPeriod: { last_30d: { spend: 50, impressions: 5000, link_clicks: 100, purchases: 5, purchase_value: 500 } },
          },
          {
            id: 'ad-3',
            name: 'Anúncio fraco',
            status: 'PAUSED',
            effective_status: 'PAUSED',
            creative_id: 'creative-loser',
            creative: { id: 'creative-loser', name: 'Imagem fraca' },
            metricsByPeriod: { last_30d: { spend: 100, impressions: 5000, link_clicks: 50, purchases: 1, purchase_value: 120 } },
          },
        ],
      }],
    }];

    const creatives = buildCreativeLabCreatives(data, 'client-1', 'last_30d');

    expect(creatives.map((item) => item.creativeId)).toEqual(['creative-winner', 'creative-loser']);
    expect(creatives[0].snapshot.spend).toBe(150);
    expect(creatives[0].snapshot.purchases).toBe(15);
    expect(creatives[0].snapshot.roas).toBe(10);
    expect(creatives[0].status).toBe('active');
  });
});
