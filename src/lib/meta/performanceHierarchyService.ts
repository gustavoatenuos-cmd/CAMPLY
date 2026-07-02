import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import { normalizeTraceableMetric, type TraceableMetric } from '../performance/traceableMetrics';
import { supabase } from '../supabase';
import { e2eMetric, isMetaE2EMode, metaE2EState } from './metaE2ERuntime';
import type { MetaRunSummary } from './clientMetaAssetService';

export type MetaHierarchyLevel = 'campaign' | 'adset' | 'ad' | 'creative';

export interface MetaHierarchyItem {
  id: string;
  name: string | null;
  parentId?: string | null;
  campaignId?: string | null;
  status?: string | null;
  effectiveStatus?: string | null;
  objective?: string | null;
  classifiedObjective?: string | null;
  destinationType?: string | null;
  attributionSetting?: string | null;
  dailyBudget?: number | null;
  lifetimeBudget?: number | null;
  creativeId?: string | null;
  title?: string | null;
  body?: string | null;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  objectStorySpec?: Record<string, unknown> | null;
  updatedAt?: string | null;
  metrics: Record<string, TraceableMetric>;
}

export interface MetaHierarchyPage {
  state: 'ready' | 'empty' | 'period_not_synced';
  level: MetaHierarchyLevel;
  period: DashboardPeriod;
  page: number;
  pageSize: number;
  total: number;
  items: MetaHierarchyItem[];
  clientId?: string;
  clientMetaAssetId?: string;
  metaAssetId?: string;
  integrationId?: string;
  adAccountId?: string;
  currency?: string | null;
  timezone?: string | null;
  dateStart?: string | null;
  dateStop?: string | null;
  run?: MetaRunSummary;
}

const isActiveMetaItem = (item: Pick<MetaHierarchyItem, 'effectiveStatus' | 'status'>) =>
  (item.effectiveStatus || item.status || '').toUpperCase() === 'ACTIVE';

function fixtureItems(level: MetaHierarchyLevel, parentId?: string): MetaHierarchyItem[] {
  const campaignId = 'campaign-active-e2e';
  const adsetId = 'adset-active-e2e';
  const adId = 'ad-active-e2e';
  const common = (source: 'campaign' | 'adset' | 'ad', ids: { campaignId: string; adsetId?: string; adId?: string }) => ({
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
  if (level === 'campaign') return [{
    id: campaignId, name: 'Campanha ativa mock', status: 'ACTIVE', effectiveStatus: 'ACTIVE',
    objective: 'OUTCOME_LEADS', classifiedObjective: 'LEADS', destinationType: 'WHATSAPP',
    attributionSetting: '7d_click_1d_view', metrics: common('campaign', { campaignId }),
  }];
  if (level === 'adset' && parentId === campaignId) return [{
    id: adsetId, parentId: campaignId, name: 'Conjunto ativo com leads', status: 'ACTIVE',
    effectiveStatus: 'ACTIVE', objective: 'LEAD_GENERATION', destinationType: 'WHATSAPP',
    attributionSetting: '7d_click_1d_view', dailyBudget: 50, lifetimeBudget: null,
    metrics: common('adset', { campaignId, adsetId }),
  }];
  if (level === 'ad' && parentId === adsetId) return [{
    id: adId, parentId: adsetId, campaignId, name: 'Anúncio ativo com compra', status: 'ACTIVE',
    effectiveStatus: 'ACTIVE', creativeId: 'creative-e2e', metrics: common('ad', { campaignId, adsetId, adId }),
  }];
  if (level === 'creative' && parentId === adId) return [{
    id: 'creative-e2e', parentId: adId, name: 'Criativo Mock', creativeId: 'creative-e2e',
    title: 'Agende sua avaliação', body: 'Atendimento especializado pelo WhatsApp.',
    thumbnailUrl: null, imageUrl: null, objectStorySpec: { format: 'IMAGE' },
    updatedAt: '2026-06-29T12:00:00.000Z',
    metrics: common('ad', { campaignId, adsetId, adId }),
  }];
  return [];
}

function normalizePage(value: unknown): MetaHierarchyPage {
  const page = value as MetaHierarchyPage;
  const items = Array.isArray(page.items) ? page.items.map((item) => ({
    ...item,
    metrics: Object.fromEntries(Object.entries(item.metrics || {}).map(([metricId, metric]) => (
      [metricId, normalizeTraceableMetric(metricId, metric)]
    ))),
  })) : [];
  const visibleItems = page.level === 'campaign' ? items.filter(isActiveMetaItem) : items;
  return {
    ...page,
    total: page.level === 'campaign' ? visibleItems.length : page.total,
    state: page.level === 'campaign' && page.state === 'ready' && visibleItems.length === 0 ? 'empty' : page.state,
    items: visibleItems,
  };
}

export async function loadMetaHierarchy(input: {
  clientMetaAssetId: string;
  period: DashboardPeriod;
  level: MetaHierarchyLevel;
  parentId?: string;
  page?: number;
  pageSize?: number;
}): Promise<MetaHierarchyPage> {
  if (isMetaE2EMode) {
    if (!metaE2EState.syncedPeriods.has(input.period)) {
      return { state: 'period_not_synced', level: input.level, period: input.period, page: 1, pageSize: 25, total: 0, items: [] };
    }
    const items = fixtureItems(input.level, input.parentId);
    return {
      state: items.length ? 'ready' : 'empty', level: input.level, period: input.period,
      page: 1, pageSize: 25, total: items.length, items,
      clientId: 'client-e2e', clientMetaAssetId: input.clientMetaAssetId,
      metaAssetId: '20000000-0000-0000-0000-00000000e2e0', integrationId: 'integration-e2e',
      adAccountId: 'act_e2e', currency: 'BRL', timezone: 'America/Sao_Paulo',
      dateStart: '2026-07-01', dateStop: '2026-07-01',
    };
  }
  if (!supabase) throw new Error('Backend analítico não configurado.');
  const { data, error } = await supabase.rpc('get_meta_performance_hierarchy', {
    p_client_meta_asset_id: input.clientMetaAssetId,
    p_period: input.period,
    p_level: input.level,
    p_parent_id: input.parentId || null,
    p_page: input.page || 1,
    p_page_size: input.pageSize || 25,
  });
  if (error) throw new Error('Não foi possível carregar este nível da hierarquia.');
  return normalizePage(data);
}
