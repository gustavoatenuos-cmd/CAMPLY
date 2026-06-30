import type { Campaign, Client } from '../../types';
import type { AttributionGroup } from './metaSyncTypes';
import type { MetricValueMap } from './metricRegistry';

export interface MetaPerformanceSnapshot {
  spend: number;
  impressions: number;
  linkClicks: number;
  conversations: number;
  leads: number;
  purchases: number;
  purchaseValue: number;
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  costPerConversation: number | null;
  costPerLead: number | null;
  costPerPurchase: number | null;
  roas: number | null;
}

export interface PrimaryPerformance {
  label: string;
  value: number;
  costLabel: string;
  cost: number | null;
  score: number;
}

export interface CampaignPerformanceSummary {
  campaign: Campaign;
  metrics: MetricValueMap;
  snapshot: MetaPerformanceSnapshot;
  primary: PrimaryPerformance;
  completeness?: string;
}

export interface AdSetPerformanceSummary {
  campaign: Campaign;
  group: AttributionGroup;
  title: string;
  metrics: MetricValueMap;
  snapshot: MetaPerformanceSnapshot;
  primary: PrimaryPerformance;
}

export interface AdPerformanceSummary {
  campaign: Campaign;
  adSetId: string;
  adSetName: string;
  ad: NonNullable<NonNullable<Campaign['activeAdSets']>[number]['ads']>[number];
  metrics: MetricValueMap;
  snapshot: MetaPerformanceSnapshot;
  primary: PrimaryPerformance;
}

export interface CreativePerformanceSummary {
  creativeId: string;
  name: string;
  ads: AdPerformanceSummary[];
  metrics: MetricValueMap;
  snapshot: MetaPerformanceSnapshot;
  primary: PrimaryPerformance;
}

export interface ClientMetaAnalytics {
  client: Client;
  campaigns: CampaignPerformanceSummary[];
  ads: AdPerformanceSummary[];
  creatives: CreativePerformanceSummary[];
  totals: MetaPerformanceSnapshot;
  bestCampaign?: CampaignPerformanceSummary;
  bestAdSet?: AdSetPerformanceSummary;
  bestAd?: AdPerformanceSummary;
  bestCreative?: CreativePerformanceSummary;
}

const CONVERSATION_METRICS = [
  'whatsapp_conversations_started',
  'messenger_conversations_started',
  'instagram_direct_conversations_started',
  'messaging_conversations_started_generic',
];

const numberMetric = (metrics: MetricValueMap | undefined, metricId: string): number => {
  const value = metrics?.[metricId];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const nullableMetric = (metrics: MetricValueMap | undefined, metricId: string): number | null => {
  const value = metrics?.[metricId];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export function getMessagingConversations(metrics: MetricValueMap | undefined): number {
  const explicitTotal = nullableMetric(metrics, 'messaging_conversations_started_total');
  if (explicitTotal !== null) return explicitTotal;
  return CONVERSATION_METRICS.reduce((sum, metricId) => sum + numberMetric(metrics, metricId), 0);
}

export function getCampaignPeriodMetrics(campaign: Campaign, period: string): MetricValueMap {
  return (
    campaign.globalMetricsByPeriod?.[period]
    || campaign.normalizedMetricsByPeriod?.[period]
    || {}
  ) as MetricValueMap;
}

export function buildSnapshot(metrics: MetricValueMap | undefined): MetaPerformanceSnapshot {
  const spend = numberMetric(metrics, 'spend');
  const impressions = numberMetric(metrics, 'impressions');
  const linkClicks = numberMetric(metrics, 'link_clicks');
  const conversations = getMessagingConversations(metrics);
  const leads = numberMetric(metrics, 'leads');
  const purchases = numberMetric(metrics, 'purchases');
  const purchaseValue = numberMetric(metrics, 'purchase_value');

  return {
    spend,
    impressions,
    linkClicks,
    conversations,
    leads,
    purchases,
    purchaseValue,
    cpm: nullableMetric(metrics, 'cpm') ?? (impressions > 0 ? (spend / impressions) * 1000 : null),
    ctr: nullableMetric(metrics, 'link_ctr') ?? (impressions > 0 ? (linkClicks / impressions) * 100 : null),
    cpc: nullableMetric(metrics, 'link_cpc') ?? (linkClicks > 0 ? spend / linkClicks : null),
    costPerConversation: nullableMetric(metrics, 'cost_per_messaging_conversation') ?? (conversations > 0 ? spend / conversations : null),
    costPerLead: leads > 0 ? spend / leads : null,
    costPerPurchase: purchases > 0 ? spend / purchases : null,
    roas: nullableMetric(metrics, 'purchase_roas') ?? (spend > 0 && purchaseValue > 0 ? purchaseValue / spend : null),
  };
}

function resolveObjective(campaign: Campaign, group?: AttributionGroup): string {
  return String(group?.classifiedObjective || campaign.classifiedObjective || campaign.objective || '').toUpperCase();
}

export function getPrimaryPerformance(
  campaign: Campaign,
  metrics: MetricValueMap,
  group?: AttributionGroup
): PrimaryPerformance {
  const objective = resolveObjective(campaign, group);
  const snapshot = buildSnapshot(metrics);

  if (['WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER'].includes(objective)) {
    return {
      label: 'Conversas',
      value: snapshot.conversations,
      costLabel: 'Custo/conversa',
      cost: snapshot.costPerConversation,
      score: snapshot.conversations > 0 ? snapshot.conversations / Math.max(snapshot.spend, 1) : 0,
    };
  }
  if (objective === 'LEADS' || objective.includes('CADASTRO')) {
    return {
      label: 'Leads',
      value: snapshot.leads,
      costLabel: 'CPL',
      cost: snapshot.costPerLead,
      score: snapshot.leads > 0 ? snapshot.leads / Math.max(snapshot.spend, 1) : 0,
    };
  }
  if (objective === 'SALES' || objective.includes('VENDA')) {
    return {
      label: 'Compras',
      value: snapshot.purchases,
      costLabel: 'CPA',
      cost: snapshot.costPerPurchase,
      score: snapshot.roas ?? (snapshot.purchases > 0 ? snapshot.purchases / Math.max(snapshot.spend, 1) : 0),
    };
  }
  if (objective === 'TRAFFIC' || objective.includes('TRÁFEGO')) {
    const landingPageViews = numberMetric(metrics, 'landing_page_views');
    const value = landingPageViews || snapshot.linkClicks;
    return {
      label: landingPageViews ? 'Visitas' : 'Cliques',
      value,
      costLabel: landingPageViews ? 'Custo/visita' : 'CPC',
      cost: value > 0 ? snapshot.spend / value : null,
      score: value > 0 ? value / Math.max(snapshot.spend, 1) : 0,
    };
  }
  if (objective === 'PROFILE_VISITS') {
    const value = numberMetric(metrics, 'profile_visits');
    return {
      label: 'Visitas ao perfil',
      value,
      costLabel: 'Custo/visita',
      cost: value > 0 ? snapshot.spend / value : null,
      score: value > 0 ? value / Math.max(snapshot.spend, 1) : 0,
    };
  }
  if (objective === 'VIDEO') {
    const value = numberMetric(metrics, 'thru_plays') || numberMetric(metrics, 'video_views');
    return {
      label: numberMetric(metrics, 'thru_plays') ? 'ThruPlays' : 'Views',
      value,
      costLabel: 'Custo/view',
      cost: value > 0 ? snapshot.spend / value : null,
      score: value > 0 ? value / Math.max(snapshot.spend, 1) : 0,
    };
  }

  return {
    label: 'Impressões',
    value: snapshot.impressions,
    costLabel: 'CPM',
    cost: snapshot.cpm,
    score: snapshot.impressions > 0 ? snapshot.impressions / Math.max(snapshot.spend, 1) : 0,
  };
}

export function buildCampaignPerformanceSummary(campaign: Campaign, period: string): CampaignPerformanceSummary {
  const metrics = getCampaignPeriodMetrics(campaign, period);
  return {
    campaign,
    metrics,
    snapshot: buildSnapshot(metrics),
    primary: getPrimaryPerformance(campaign, metrics),
    completeness: campaign.completenessByPeriod?.[period]?.status,
  };
}

function getAdPeriodMetrics(
  ad: NonNullable<NonNullable<Campaign['activeAdSets']>[number]['ads']>[number],
  period: string
): MetricValueMap {
  return (ad.metricsByPeriod?.[period] || {}) as MetricValueMap;
}

function comparePerformance(left: { primary: PrimaryPerformance; snapshot: MetaPerformanceSnapshot }, right: { primary: PrimaryPerformance; snapshot: MetaPerformanceSnapshot }): number {
  if (right.primary.score !== left.primary.score) return right.primary.score - left.primary.score;
  if (right.primary.value !== left.primary.value) return right.primary.value - left.primary.value;
  return left.snapshot.spend - right.snapshot.spend;
}

function addSnapshotToMetricAccumulator(acc: MetricValueMap, snapshot: MetaPerformanceSnapshot): MetricValueMap {
  acc.spend = (acc.spend || 0) + snapshot.spend;
  acc.impressions = (acc.impressions || 0) + snapshot.impressions;
  acc.link_clicks = (acc.link_clicks || 0) + snapshot.linkClicks;
  acc.messaging_conversations_started_total = (acc.messaging_conversations_started_total || 0) + snapshot.conversations;
  acc.leads = (acc.leads || 0) + snapshot.leads;
  acc.purchases = (acc.purchases || 0) + snapshot.purchases;
  acc.purchase_value = (acc.purchase_value || 0) + snapshot.purchaseValue;
  return acc;
}

export function buildClientMetaAnalytics(
  client: Client,
  campaigns: Campaign[],
  period: string
): ClientMetaAnalytics {
  const clientCampaigns = campaigns
    .filter((campaign) =>
      campaign.clientId === client.id
      && campaign.platform === 'Meta Ads'
      && ['launching', 'live', 'optimize'].includes(campaign.status)
      && !campaign.subCampaignIds?.length
    )
    .map((campaign) => buildCampaignPerformanceSummary(campaign, period))
    .sort(comparePerformance);

  const totalsInput = clientCampaigns.reduce<MetricValueMap>((acc, item) => {
    acc.spend = (acc.spend || 0) + item.snapshot.spend;
    acc.impressions = (acc.impressions || 0) + item.snapshot.impressions;
    acc.link_clicks = (acc.link_clicks || 0) + item.snapshot.linkClicks;
    acc.messaging_conversations_started_total = (acc.messaging_conversations_started_total || 0) + item.snapshot.conversations;
    acc.leads = (acc.leads || 0) + item.snapshot.leads;
    acc.purchases = (acc.purchases || 0) + item.snapshot.purchases;
    acc.purchase_value = (acc.purchase_value || 0) + item.snapshot.purchaseValue;
    return acc;
  }, {});

  const adsets = clientCampaigns.flatMap((campaignSummary) =>
    (campaignSummary.campaign.attributionGroupsByPeriod?.[period] || []).map((group): AdSetPerformanceSummary => {
      const namesById = new Map((campaignSummary.campaign.activeAdSets || []).map((adset) => [adset.id, adset.name]));
      const adsetNames = group.adsetIds.map((id) => namesById.get(id) || id);
      const title = adsetNames.length > 2
        ? `${adsetNames.slice(0, 2).join(', ')} +${adsetNames.length - 2}`
        : adsetNames.join(', ');
      return {
        campaign: campaignSummary.campaign,
        group,
        title: title || 'Grupo sem nome',
        metrics: group.metrics,
        snapshot: buildSnapshot(group.metrics),
        primary: getPrimaryPerformance(campaignSummary.campaign, group.metrics, group),
      };
    })
  ).sort(comparePerformance);

  const ads = clientCampaigns.flatMap((campaignSummary) =>
    (campaignSummary.campaign.activeAdSets || []).flatMap((adset) =>
      (adset.ads || []).map((ad): AdPerformanceSummary => {
        const metrics = getAdPeriodMetrics(ad, period);
        return {
          campaign: campaignSummary.campaign,
          adSetId: adset.id,
          adSetName: adset.name,
          ad,
          metrics,
          snapshot: buildSnapshot(metrics),
          primary: getPrimaryPerformance(campaignSummary.campaign, metrics),
        };
      })
    )
  ).filter((adSummary) => adSummary.snapshot.spend > 0 || adSummary.snapshot.impressions > 0)
    .sort(comparePerformance);

  const creativesById = new Map<string, AdPerformanceSummary[]>();
  for (const ad of ads) {
    const creativeId = ad.ad.creative_id || ad.ad.creative?.id;
    if (!creativeId) continue;
    const existing = creativesById.get(creativeId) || [];
    existing.push(ad);
    creativesById.set(creativeId, existing);
  }

  const creatives = Array.from(creativesById.entries()).map(([creativeId, creativeAds]): CreativePerformanceSummary => {
    const metrics = creativeAds.reduce<MetricValueMap>((acc, ad) =>
      addSnapshotToMetricAccumulator(acc, ad.snapshot)
    , {});
    const firstAd = creativeAds[0];
    return {
      creativeId,
      name: firstAd.ad.creative?.name || firstAd.ad.creative?.title || firstAd.ad.name || creativeId,
      ads: creativeAds,
      metrics,
      snapshot: buildSnapshot(metrics),
      primary: getPrimaryPerformance(firstAd.campaign, metrics),
    };
  }).sort(comparePerformance);

  return {
    client,
    campaigns: clientCampaigns,
    ads,
    creatives,
    totals: buildSnapshot(totalsInput),
    bestCampaign: clientCampaigns[0],
    bestAdSet: adsets[0],
    bestAd: ads[0],
    bestCreative: creatives[0],
  };
}
