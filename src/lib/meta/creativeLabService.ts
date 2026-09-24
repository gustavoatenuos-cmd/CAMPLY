import type { Campaign, CamplyData, Client } from '../../types';
import type { DashboardPeriod, MetricContract } from '../performance/globalPerformanceDashboard';
import { supabase } from '../supabase';
import type { ClientMetaAccount } from './clientMetaAssetService';

export type CreativeLabPeriod = Extract<DashboardPeriod, 'last_7d' | 'last_30d' | 'last_90d'>;
export type CreativeLabClientState = 'active_media' | 'no_active_media' | 'inactive';

export interface CreativeLabClientRow {
  client: Client;
  accounts: ClientMetaAccount[];
  state: CreativeLabClientState;
  activeCampaigns: number;
  activeAdSets: number;
  activeAds: number;
}

export interface CreativeLabRawRow {
  accountId: string;
  accountName: string;
  currency: string | null;
  campaignId: string;
  campaignName: string;
  campaignStatus: string | null;
  campaignEffectiveStatus: string | null;
  classifiedObjective: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adsetStatus: string | null;
  adsetEffectiveStatus: string | null;
  adId: string;
  adName: string;
  adStatus: string | null;
  adEffectiveStatus: string | null;
  creativeId: string;
  creativeName: string;
  title: string | null;
  body: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  objectStorySpec: Record<string, unknown> | null;
  updatedAt: string | null;
  metrics: Record<string, MetricContract>;
}

interface CreativeLabRpcResponse {
  state: 'ready' | 'empty' | 'period_not_synced' | 'unauthorized';
  items: Omit<CreativeLabRawRow, 'accountId' | 'accountName' | 'currency'>[];
  total: number;
  page: number;
  pageSize: number;
  accountId?: string;
  accountName?: string;
  currency?: string | null;
  dateStart?: string | null;
  dateStop?: string | null;
}

export interface CreativeLabAdDetail {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  adsetId: string | null;
  adsetName: string | null;
  accountName: string;
  activeStructure: boolean;
  spend: number;
  result: number;
}

export interface CreativeLabCreative {
  key: string;
  creativeId: string;
  name: string;
  title: string | null;
  body: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  objective: string | null;
  currency: string | null;
  active: boolean;
  adsCount: number;
  activeAds: number;
  campaigns: string[];
  adsets: string[];
  spend: number;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  conversations: number;
  leads: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  roas: number | null;
  resultLabel: string;
  resultValue: number;
  costLabel: string;
  costPerResult: number | null;
  rankScore: number;
  ads: CreativeLabAdDetail[];
}

export interface CreativeLabClientResult {
  state: 'ready' | 'empty' | 'period_not_synced' | 'unauthorized' | 'error';
  creatives: CreativeLabCreative[];
  rawRows: CreativeLabRawRow[];
  message?: string;
}

function isMetaActive(status?: string | null): boolean {
  return String(status || '').toUpperCase() === 'ACTIVE';
}

function campaignStructureIsActive(campaign: Campaign): boolean {
  const knownCampaignStatus = campaign.metaEffectiveStatus || campaign.metaStatus;
  if (knownCampaignStatus && !isMetaActive(knownCampaignStatus)) return false;
  return (campaign.activeAdSets || []).some((adset) => (
    isMetaActive(adset.effective_status || adset.status)
    && (adset.ads || []).some((ad) => isMetaActive(ad.effective_status || ad.status))
  ));
}

export function buildCreativeLabClientRows(
  data: CamplyData,
  accountMap: Map<string, ClientMetaAccount[]>
): CreativeLabClientRow[] {
  return data.clients.map((client) => {
    const campaigns = data.campaigns.filter((campaign) => campaign.clientId === client.id && campaign.platform === 'Meta Ads');
    const activeCampaigns = campaigns.filter((campaign) => {
      const status = campaign.metaEffectiveStatus || campaign.metaStatus;
      return status ? isMetaActive(status) : campaign.status !== 'paused' && campaign.status !== 'setup';
    }).length;
    let activeAdSets = 0;
    let activeAds = 0;
    for (const campaign of campaigns) {
      const campaignStatus = campaign.metaEffectiveStatus || campaign.metaStatus;
      if (campaignStatus && !isMetaActive(campaignStatus)) continue;
      for (const adset of campaign.activeAdSets || []) {
        if (!isMetaActive(adset.effective_status || adset.status)) continue;
        activeAdSets += 1;
        activeAds += (adset.ads || []).filter((ad) => isMetaActive(ad.effective_status || ad.status)).length;
      }
    }

    const hasActiveMedia = campaigns.some(campaignStructureIsActive);
    const state: CreativeLabClientState = client.status !== 'active'
      ? 'inactive'
      : hasActiveMedia ? 'active_media' : 'no_active_media';

    return {
      client,
      accounts: accountMap.get(client.id) || [],
      state,
      activeCampaigns,
      activeAdSets,
      activeAds,
    };
  });
}

function metricValue(metrics: Record<string, MetricContract>, id: string): number {
  const metric = metrics?.[id];
  if (!metric || metric.available === false || typeof metric.value !== 'number' || !Number.isFinite(metric.value)) return 0;
  return metric.value;
}

function rowIsActive(row: CreativeLabRawRow): boolean {
  return isMetaActive(row.campaignEffectiveStatus || row.campaignStatus)
    && isMetaActive(row.adsetEffectiveStatus || row.adsetStatus)
    && isMetaActive(row.adEffectiveStatus || row.adStatus);
}

function objectiveFor(rows: CreativeLabRawRow[]): string | null {
  const spendByObjective = new Map<string, number>();
  for (const row of rows) {
    const key = String(row.classifiedObjective || 'UNCLASSIFIED').toUpperCase();
    spendByObjective.set(key, (spendByObjective.get(key) || 0) + metricValue(row.metrics, 'spend'));
  }
  return [...spendByObjective.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function resultContract(objective: string | null, values: {
  spend: number;
  linkClicks: number;
  landingPageViews: number;
  conversations: number;
  leads: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
}) {
  const normalized = String(objective || '').toUpperCase();
  if (normalized === 'SALES' || normalized.includes('VENDA')) {
    const roas = values.spend > 0 && values.purchaseValue > 0 ? values.purchaseValue / values.spend : null;
    return {
      label: 'Compras',
      value: values.purchases,
      costLabel: 'CPA',
      cost: values.purchases > 0 ? values.spend / values.purchases : null,
      score: roas ?? (values.purchases > 0 ? values.purchases / Math.max(values.spend, 1) : 0),
    };
  }
  if (normalized === 'LEADS' || normalized.includes('CADASTRO')) {
    return {
      label: 'Leads',
      value: values.leads,
      costLabel: 'CPL',
      cost: values.leads > 0 ? values.spend / values.leads : null,
      score: values.leads > 0 ? values.leads / Math.max(values.spend, 1) : 0,
    };
  }
  if (['WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER'].includes(normalized) || normalized.includes('MESSAGE')) {
    return {
      label: 'Conversas',
      value: values.conversations,
      costLabel: 'Custo/conversa',
      cost: values.conversations > 0 ? values.spend / values.conversations : null,
      score: values.conversations > 0 ? values.conversations / Math.max(values.spend, 1) : 0,
    };
  }
  if (normalized === 'TRAFFIC' || normalized.includes('TRÁFEGO') || normalized.includes('TRAFEGO')) {
    const visits = values.landingPageViews || values.linkClicks;
    return {
      label: values.landingPageViews > 0 ? 'Visitas' : 'Cliques',
      value: visits,
      costLabel: values.landingPageViews > 0 ? 'Custo/visita' : 'CPC',
      cost: visits > 0 ? values.spend / visits : null,
      score: visits > 0 ? visits / Math.max(values.spend, 1) : 0,
    };
  }
  return {
    label: 'Cliques',
    value: values.linkClicks,
    costLabel: 'CPC',
    cost: values.linkClicks > 0 ? values.spend / values.linkClicks : null,
    score: values.ctr ?? 0,
  };
}

export function aggregateCreativeLabRows(rows: CreativeLabRawRow[]): CreativeLabCreative[] {
  const groups = new Map<string, CreativeLabRawRow[]>();
  for (const row of rows) {
    const key = `${row.accountId}:${row.creativeId}`;
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const creatives: CreativeLabCreative[] = [];
  for (const [key, creativeRows] of groups.entries()) {
    const first = creativeRows[0];
    const spend = creativeRows.reduce((sum, row) => sum + metricValue(row.metrics, 'spend'), 0);
    const impressions = creativeRows.reduce((sum, row) => sum + metricValue(row.metrics, 'impressions'), 0);
    const linkClicks = creativeRows.reduce((sum, row) => sum + metricValue(row.metrics, 'link_clicks'), 0);
    const landingPageViews = creativeRows.reduce((sum, row) => sum + metricValue(row.metrics, 'landing_page_views'), 0);
    const conversations = creativeRows.reduce((sum, row) => sum + metricValue(row.metrics, 'messaging_conversations_started_total'), 0);
    const leads = creativeRows.reduce((sum, row) => sum + metricValue(row.metrics, 'leads'), 0);
    const purchases = creativeRows.reduce((sum, row) => sum + metricValue(row.metrics, 'purchases'), 0);
    const purchaseValue = creativeRows.reduce((sum, row) => sum + metricValue(row.metrics, 'purchase_value'), 0);
    const ctr = impressions > 0 ? (linkClicks / impressions) * 100 : null;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
    const cpc = linkClicks > 0 ? spend / linkClicks : null;
    const roas = spend > 0 && purchaseValue > 0 ? purchaseValue / spend : null;
    const objective = objectiveFor(creativeRows);
    const contract = resultContract(objective, {
      spend, linkClicks, landingPageViews, conversations, leads, purchases, purchaseValue, ctr,
    });

    creatives.push({
      key,
      creativeId: first.creativeId,
      name: first.creativeName || first.title || first.adName || first.creativeId,
      title: first.title,
      body: first.body,
      thumbnailUrl: first.thumbnailUrl,
      imageUrl: first.imageUrl,
      objective,
      currency: first.currency,
      active: creativeRows.some(rowIsActive),
      adsCount: creativeRows.length,
      activeAds: creativeRows.filter(rowIsActive).length,
      campaigns: [...new Set(creativeRows.map((row) => row.campaignName).filter(Boolean))],
      adsets: [...new Set(creativeRows.map((row) => row.adsetName).filter((value): value is string => Boolean(value)))],
      spend,
      impressions,
      linkClicks,
      landingPageViews,
      conversations,
      leads,
      purchases,
      purchaseValue,
      ctr,
      cpm,
      cpc,
      roas,
      resultLabel: contract.label,
      resultValue: contract.value,
      costLabel: contract.costLabel,
      costPerResult: contract.cost,
      rankScore: contract.score,
      ads: creativeRows.map((row) => ({
        adId: row.adId,
        adName: row.adName,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        adsetId: row.adsetId,
        adsetName: row.adsetName,
        accountName: row.accountName,
        activeStructure: rowIsActive(row),
        spend: metricValue(row.metrics, 'spend'),
        result: resultContract(row.classifiedObjective, {
          spend: metricValue(row.metrics, 'spend'),
          linkClicks: metricValue(row.metrics, 'link_clicks'),
          landingPageViews: metricValue(row.metrics, 'landing_page_views'),
          conversations: metricValue(row.metrics, 'messaging_conversations_started_total'),
          leads: metricValue(row.metrics, 'leads'),
          purchases: metricValue(row.metrics, 'purchases'),
          purchaseValue: metricValue(row.metrics, 'purchase_value'),
          ctr: metricValue(row.metrics, 'impressions') > 0
            ? (metricValue(row.metrics, 'link_clicks') / metricValue(row.metrics, 'impressions')) * 100
            : null,
        }).value,
      })),
    });
  }

  return creatives.sort((a, b) => {
    if (a.spend === 0 && b.spend > 0) return 1;
    if (b.spend === 0 && a.spend > 0) return -1;
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return b.spend - a.spend;
  });
}

async function loadAccountRows(account: ClientMetaAccount, period: CreativeLabPeriod): Promise<{
  state: CreativeLabRpcResponse['state'];
  rows: CreativeLabRawRow[];
}> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const pageSize = 100;
  let page = 1;
  let total = 0;
  let state: CreativeLabRpcResponse['state'] = 'empty';
  const rows: CreativeLabRawRow[] = [];

  do {
    const { data, error } = await supabase.rpc('get_meta_creative_lab', {
      p_client_meta_asset_id: account.clientMetaAssetId,
      p_period: period,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throw new Error(`Não foi possível carregar o laboratório de ${account.accountName}: ${error.message}`);
    const response = data as unknown as CreativeLabRpcResponse;
    state = response?.state || 'empty';
    total = Number(response?.total || 0);
    const accountRows = Array.isArray(response?.items) ? response.items : [];
    rows.push(...accountRows.map((row) => ({
      ...row,
      accountId: response.accountId || account.adAccountId,
      accountName: response.accountName || account.accountName,
      currency: response.currency ?? account.currency,
    })));
    if (state !== 'ready' || accountRows.length === 0) break;
    page += 1;
  } while (rows.length < total && page <= 25);

  return { state, rows };
}

export async function loadCreativeLabForClient(
  accounts: ClientMetaAccount[],
  period: CreativeLabPeriod
): Promise<CreativeLabClientResult> {
  if (accounts.length === 0) return { state: 'empty', creatives: [], rawRows: [], message: 'Nenhuma conta Meta vinculada.' };

  try {
    const accountResults = await Promise.all(accounts.map((account) => loadAccountRows(account, period)));
    const rawRows = accountResults.flatMap((result) => result.rows);
    if (rawRows.length > 0) {
      return { state: 'ready', rawRows, creatives: aggregateCreativeLabRows(rawRows) };
    }
    if (accountResults.some((result) => result.state === 'period_not_synced')) {
      return { state: 'period_not_synced', rawRows: [], creatives: [], message: 'Esse período ainda não está disponível na sincronização Meta.' };
    }
    if (accountResults.some((result) => result.state === 'unauthorized')) {
      return { state: 'unauthorized', rawRows: [], creatives: [], message: 'Sem permissão para acessar uma das contas Meta vinculadas.' };
    }
    return { state: 'empty', rawRows: [], creatives: [], message: 'Nenhum criativo sincronizado para este cliente no período.' };
  } catch (error) {
    return {
      state: 'error',
      rawRows: [],
      creatives: [],
      message: error instanceof Error ? error.message : 'Não foi possível carregar o laboratório de criativos.',
    };
  }
}
