import type { CamplyData, Campaign, Client } from '../../types';
import type { MetricValueMap } from './metricRegistry';
import {
  buildSnapshot,
  getPrimaryPerformance,
  type MetaPerformanceSnapshot,
  type PrimaryPerformance,
} from './clientAnalytics';

export type CreativeLabClientState = 'media_active' | 'no_active_media' | 'inactive_client';

export interface CreativeLabClientSummary {
  client: Client;
  state: CreativeLabClientState;
  metaCampaignCount: number;
  campaignsWithActiveAdSets: number;
  activeAdSetCount: number;
  activeAdCount: number;
  creativeCount: number;
}

export interface CreativeLabCreative {
  creativeId: string;
  name: string;
  thumbnailUrl: string | null;
  body: string | null;
  title: string | null;
  status: 'active' | 'paused';
  campaignNames: string[];
  adSetNames: string[];
  adNames: string[];
  metrics: MetricValueMap;
  snapshot: MetaPerformanceSnapshot;
  primary: PrimaryPerformance;
}

const isActive = (value: unknown): boolean => String(value || '').toUpperCase() === 'ACTIVE';

function clientCampaigns(data: CamplyData, clientId: string): Campaign[] {
  return data.campaigns.filter((campaign) =>
    campaign.clientId === clientId
    && campaign.platform === 'Meta Ads'
    && !campaign.subCampaignIds?.length
  );
}

export function buildCreativeLabClientSummary(data: CamplyData, client: Client, period: string): CreativeLabClientSummary {
  const campaigns = clientCampaigns(data, client.id);
  let campaignsWithActiveAdSets = 0;
  let activeAdSetCount = 0;
  let activeAdCount = 0;
  const creativeIds = new Set<string>();

  for (const campaign of campaigns) {
    let campaignHasActiveAdSet = false;
    for (const adset of campaign.activeAdSets || []) {
      const adsetActive = isActive(adset.effective_status || adset.status);
      if (adsetActive) {
        campaignHasActiveAdSet = true;
        activeAdSetCount += 1;
      }
      for (const ad of adset.ads || []) {
        if (adsetActive && isActive(ad.effective_status || ad.status)) activeAdCount += 1;
        const metrics = (ad.metricsByPeriod?.[period] || {}) as MetricValueMap;
        const snapshot = buildSnapshot(metrics);
        const creativeId = ad.creative_id || ad.creative?.id;
        if (creativeId && (snapshot.spend > 0 || snapshot.impressions > 0)) creativeIds.add(creativeId);
      }
    }
    if (campaignHasActiveAdSet) campaignsWithActiveAdSets += 1;
  }

  const state: CreativeLabClientState = client.status !== 'active'
    ? 'inactive_client'
    : activeAdSetCount > 0
      ? 'media_active'
      : 'no_active_media';

  return {
    client,
    state,
    metaCampaignCount: campaigns.length,
    campaignsWithActiveAdSets,
    activeAdSetCount,
    activeAdCount,
    creativeCount: creativeIds.size,
  };
}

function addSnapshot(acc: MetricValueMap, snapshot: MetaPerformanceSnapshot): MetricValueMap {
  acc.spend = (Number(acc.spend) || 0) + snapshot.spend;
  acc.impressions = (Number(acc.impressions) || 0) + snapshot.impressions;
  acc.link_clicks = (Number(acc.link_clicks) || 0) + snapshot.linkClicks;
  acc.messaging_conversations_started_total = (Number(acc.messaging_conversations_started_total) || 0) + snapshot.conversations;
  acc.leads = (Number(acc.leads) || 0) + snapshot.leads;
  acc.purchases = (Number(acc.purchases) || 0) + snapshot.purchases;
  acc.purchase_value = (Number(acc.purchase_value) || 0) + snapshot.purchaseValue;
  return acc;
}

export function buildCreativeLabCreatives(data: CamplyData, clientId: string, period: string): CreativeLabCreative[] {
  const grouped = new Map<string, Array<{
    campaign: Campaign;
    adsetName: string;
    adsetActive: boolean;
    ad: NonNullable<NonNullable<Campaign['activeAdSets']>[number]['ads']>[number];
    metrics: MetricValueMap;
    snapshot: MetaPerformanceSnapshot;
  }>>();

  for (const campaign of clientCampaigns(data, clientId)) {
    for (const adset of campaign.activeAdSets || []) {
      const adsetActive = isActive(adset.effective_status || adset.status);
      for (const ad of adset.ads || []) {
        const creativeId = ad.creative_id || ad.creative?.id;
        if (!creativeId) continue;
        const metrics = (ad.metricsByPeriod?.[period] || {}) as MetricValueMap;
        const snapshot = buildSnapshot(metrics);
        if (snapshot.spend <= 0 && snapshot.impressions <= 0) continue;
        const list = grouped.get(creativeId) || [];
        list.push({ campaign, adsetName: adset.name, adsetActive, ad, metrics, snapshot });
        grouped.set(creativeId, list);
      }
    }
  }

  const creatives = Array.from(grouped.entries()).map(([creativeId, rows]): CreativeLabCreative => {
    const metrics = rows.reduce<MetricValueMap>((acc, row) => addSnapshot(acc, row.snapshot), {});
    const snapshot = buildSnapshot(metrics);
    const leadRow = [...rows].sort((a, b) => b.snapshot.spend - a.snapshot.spend)[0];
    const creative = leadRow.ad.creative;
    const currentlyActive = rows.some((row) =>
      row.adsetActive && isActive(row.ad.effective_status || row.ad.status)
    );

    return {
      creativeId,
      name: creative?.name || creative?.title || leadRow.ad.name || creativeId,
      thumbnailUrl: creative?.thumbnail_url || creative?.image_url || null,
      body: creative?.body || null,
      title: creative?.title || null,
      status: currentlyActive ? 'active' : 'paused',
      campaignNames: Array.from(new Set(rows.map((row) => row.campaign.name))),
      adSetNames: Array.from(new Set(rows.map((row) => row.adsetName))),
      adNames: Array.from(new Set(rows.map((row) => row.ad.name))),
      metrics,
      snapshot,
      primary: getPrimaryPerformance(leadRow.campaign, metrics),
    };
  });

  return creatives.sort((left, right) => {
    if (right.primary.score !== left.primary.score) return right.primary.score - left.primary.score;
    if (right.primary.value !== left.primary.value) return right.primary.value - left.primary.value;
    return right.snapshot.spend - left.snapshot.spend;
  });
}
