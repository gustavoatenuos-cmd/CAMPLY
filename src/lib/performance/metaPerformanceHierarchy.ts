import { supabase } from '../supabase';
import type { DashboardPeriod } from './analyticsCapabilities';
import type { MetricContract } from './globalPerformanceDashboard';
import type { CampaignEligibilityVerdict, CampaignScopeStatus } from './campaignDecisionEligibility';
import { e2eMetric, isMetaE2EMode, metaE2EState } from '../meta/metaE2ERuntime';

export type HierarchyLevel = 'campaign' | 'adset' | 'ad' | 'creative';
export type HierarchyScopeFilter = 'operational' | 'out_of_scope';

export interface HierarchyRunSummary {
  id: string;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface HierarchicalMetricNode {
  id: string;
  name: string;
  parentId?: string | null;
  campaignId?: string | null;
  status: string;
  effectiveStatus: string;
  objective: string | null;
  classifiedObjective: string | null;
  destinationType: string | null;
  attributionSetting: string | null;
  creativeId: string | null;
  dailyBudget?: number | null;
  lifetimeBudget?: number | null;
  title?: string | null;
  body?: string | null;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  objectStorySpec?: Record<string, unknown> | null;
  updatedAt?: string | null;
  verdict?: CampaignEligibilityVerdict | null;
  scopeStatus?: CampaignScopeStatus | null;
  hasActiveAdset?: boolean | null;
  adLevelCollected?: boolean | null;
  hasActiveAd?: boolean | null;
  metrics: Record<string, MetricContract>;
}

export interface HierarchyResponse {
  state: 'empty' | 'ready' | 'period_not_synced' | 'unauthorized';
  level: HierarchyLevel;
  page: number;
  pageSize: number;
  items: HierarchicalMetricNode[];
  total: number;
  activeNoDeliveryItems: HierarchicalMetricNode[];
  activeNoDeliveryTotal: number;
  activeWithoutActiveStructureItems: HierarchicalMetricNode[];
  activeWithoutActiveStructureTotal: number;
  pausedWithSpendItems: HierarchicalMetricNode[];
  pausedWithSpendTotal: number;
  unclassifiedDestinationItems: HierarchicalMetricNode[];
  unclassifiedDestinationTotal: number;
  clientId?: string;
  clientMetaAssetId?: string;
  metaAssetId?: string;
  integrationId?: string;
  adAccountId?: string;
  currency?: string | null;
  timezone?: string | null;
  dateStart?: string | null;
  dateStop?: string | null;
  run?: HierarchyRunSummary;
}

const EMPTY_RESPONSE: HierarchyResponse = {
  state: 'empty',
  level: 'campaign',
  page: 1,
  pageSize: 50,
  items: [],
  total: 0,
  activeNoDeliveryItems: [],
  activeNoDeliveryTotal: 0,
  activeWithoutActiveStructureItems: [],
  activeWithoutActiveStructureTotal: 0,
  pausedWithSpendItems: [],
  pausedWithSpendTotal: 0,
  unclassifiedDestinationItems: [],
  unclassifiedDestinationTotal: 0,
};

function fixtureItems(level: HierarchyLevel, parentId?: string | null): HierarchicalMetricNode[] {
  const campaignId = 'campaign-active-e2e';
  const adsetId = 'adset-active-e2e';
  const adId = 'ad-active-e2e';
  const common = (source: 'campaign' | 'adset' | 'ad', ids: { campaignId?: string; adsetId?: string; adId?: string }) => ({
    spend: e2eMetric('spend', source === 'campaign' ? 350 : source === 'adset' ? 220 : 120, source, ids),
    impressions: e2eMetric('impressions', source === 'campaign' ? 12000 : 5000, source, ids),
    reach: e2eMetric('reach', source === 'campaign' ? 8300 : 3600, source, ids),
    clicks: e2eMetric('clicks', source === 'campaign' ? 510 : 205, source, ids),
    link_clicks: e2eMetric('link_clicks', source === 'campaign' ? 420 : 180, source, ids),
    landing_page_views: e2eMetric('landing_page_views', source === 'campaign' ? 310 : 130, source, ids),
    whatsapp_conversations_started: e2eMetric('whatsapp_conversations_started', source === 'campaign' ? 20 : 8, source, ids),
    messenger_conversations_started: e2eMetric('messenger_conversations_started', source === 'campaign' ? 5 : 2, source, ids),
    instagram_direct_conversations_started: e2eMetric('instagram_direct_conversations_started', source === 'campaign' ? 3 : 2, source, ids),
    messaging_conversations_started_total: e2eMetric('messaging_conversations_started_total', source === 'campaign' ? 28 : 12, source, ids),
    leads: e2eMetric('leads', source === 'campaign' ? 16 : 12, source, ids),
    purchases: e2eMetric('purchases', source === 'ad' ? 2 : 3, source, ids),
    purchase_value: e2eMetric('purchase_value', source === 'ad' ? 480 : 720, source, ids),
  });

  if (level === 'campaign') {
    return [{
      id: campaignId, name: 'Campanha ativa mock', status: 'ACTIVE', effectiveStatus: 'ACTIVE',
      objective: 'OUTCOME_LEADS', classifiedObjective: 'LEADS', destinationType: 'WHATSAPP',
      attributionSetting: '7d_click_1d_view', creativeId: null,
      verdict: 'ANALYZABLE', scopeStatus: 'included',
      hasActiveAdset: true, adLevelCollected: true, hasActiveAd: true,
      metrics: common('campaign', { campaignId }),
    }];
  }
  if (level === 'adset' && parentId === campaignId) {
    return [{
      id: adsetId, parentId: campaignId, name: 'Conjunto ativo com leads', status: 'ACTIVE',
      effectiveStatus: 'ACTIVE', objective: 'LEAD_GENERATION', classifiedObjective: null,
      destinationType: 'WHATSAPP', attributionSetting: '7d_click_1d_view',
      dailyBudget: 50, lifetimeBudget: null, creativeId: null,
      metrics: common('adset', { campaignId, adsetId }),
    }];
  }
  if (level === 'ad' && parentId === adsetId) {
    return [{
      id: adId, parentId: adsetId, campaignId, name: 'Anúncio ativo com compra', status: 'ACTIVE',
      effectiveStatus: 'ACTIVE', objective: null, classifiedObjective: null,
      destinationType: null, attributionSetting: null, creativeId: 'creative-e2e',
      metrics: common('ad', { campaignId, adsetId, adId }),
    }];
  }
  if (level === 'creative' && parentId === adId) {
    return [{
      id: 'creative-e2e', parentId: adId, name: 'Criativo Mock', creativeId: 'creative-e2e',
      status: '', effectiveStatus: '', objective: null, classifiedObjective: null,
      destinationType: null, attributionSetting: null,
      title: 'Agende sua avaliação', body: 'Atendimento especializado pelo WhatsApp.',
      thumbnailUrl: null, imageUrl: null, objectStorySpec: { format: 'IMAGE' },
      updatedAt: '2026-06-29T12:00:00.000Z',
      metrics: common('ad', { campaignId, adsetId, adId }),
    }];
  }
  return [];
}

function fixtureResponse(input: {
  clientMetaAssetId: string;
  period: DashboardPeriod;
  level: HierarchyLevel;
  parentId?: string | null;
}): HierarchyResponse {
  if (!metaE2EState.syncedPeriods.has(input.period)) {
    return { ...EMPTY_RESPONSE, state: 'period_not_synced', level: input.level };
  }
  const items = fixtureItems(input.level, input.parentId);
  return {
    ...EMPTY_RESPONSE,
    state: items.length ? 'ready' : 'empty',
    level: input.level,
    total: items.length,
    items,
    clientId: 'client-e2e',
    clientMetaAssetId: input.clientMetaAssetId,
    metaAssetId: '20000000-0000-0000-0000-00000000e2e0',
    integrationId: 'integration-e2e',
    adAccountId: 'act_e2e',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    dateStart: '2026-07-01',
    dateStop: '2026-07-01',
    run: { id: '30000000-0000-0000-0000-00000000e2e0', status: 'success', startedAt: '2026-07-01T17:00:00.000Z', finishedAt: '2026-07-01T18:00:00.000Z' },
  };
}

export async function fetchMetaPerformanceHierarchy(
  clientMetaAssetId: string,
  period: DashboardPeriod,
  level: HierarchyLevel,
  parentId: string | null = null,
  page: number = 1,
  pageSize: number = 50,
  scopeFilter: HierarchyScopeFilter = 'operational'
): Promise<HierarchyResponse> {
  if (isMetaE2EMode) {
    return fixtureResponse({ clientMetaAssetId, period, level, parentId });
  }

  if (!supabase) {
    throw new Error('Supabase client not initialized');
  }

  const { data, error } = await supabase.rpc('get_meta_performance_hierarchy', {
    p_client_meta_asset_id: clientMetaAssetId,
    p_period: period,
    p_level: level,
    p_parent_id: parentId,
    p_page: page,
    p_page_size: pageSize,
    p_scope_filter: scopeFilter,
  });

  if (error) {
    console.error('Error fetching meta performance hierarchy:', error);
    throw new Error(`Falha ao buscar a hierarquia de métricas (${level}): ${error.message}`);
  }

  const response = data as unknown as (Partial<HierarchyResponse> & { error?: string }) | null;
  if (!response) return { ...EMPTY_RESPONSE, level, page, pageSize };
  if (response.error) return { ...EMPTY_RESPONSE, state: 'unauthorized', level, page, pageSize };

  return { ...EMPTY_RESPONSE, level, page, pageSize, ...response };
}
