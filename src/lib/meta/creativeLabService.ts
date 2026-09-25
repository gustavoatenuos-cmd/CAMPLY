import type { Campaign, CamplyData, Client } from '../../types';
import { isClientOperationallyActive } from '../../data/receivablesForecast';
import type { DashboardPeriod, MetricContract } from '../performance/globalPerformanceDashboard';
import { supabase } from '../supabase';
import type { ClientMetaAccount } from './clientMetaAssetService';
import { e2eMetric, isMetaE2EMode } from './metaE2ERuntime';
import { loadMetaHierarchy, type MetaHierarchyItem, type MetaHierarchyPage } from './performanceHierarchyService';

export type CreativeLabPeriod = Extract<DashboardPeriod, 'last_7d' | 'last_30d' | 'last_90d'>;
export type CreativeLabClientState = 'active_media' | 'active_structure' | 'no_active_media' | 'data_unavailable';
export type CreativePerformanceBand = 'strong' | 'average' | 'watch' | 'no_result' | 'insufficient';
export type CreativePerformanceFlag = 'best' | 'worst' | null;

export interface CreativeLabClientMediaSummary {
  clientId: string;
  clientMetaAssetId: string;
  accountId: string;
  accountName: string;
  activeCampaigns: number;
  activeAdSets: number;
  activeAds: number;
  hasActiveMedia: boolean;
  lastSyncedAt: string | null;
  dataAvailable?: boolean;
  adDataAvailable?: boolean;
}

export interface CreativeLabClientRow {
  client: Client;
  accounts: ClientMetaAccount[];
  state: CreativeLabClientState;
  activeCampaigns: number | null;
  activeAdSets: number | null;
  activeAds: number | null;
  dataAvailable: boolean;
  creativeDepthAvailable: boolean;
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
  reach: number;
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
  performanceScore: number | null;
  performanceBand: CreativePerformanceBand;
  performanceFlag: CreativePerformanceFlag;
  performanceReason: string;
  evaluationThresholdSpend: number | null;
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

function hierarchyItemIsActive(item: Pick<MetaHierarchyItem, 'effectiveStatus' | 'status'>): boolean {
  return isMetaActive(item.effectiveStatus || item.status);
}

function runMatchesOfficialDepthContract(run: ClientMetaAccount['lastAttempt']): boolean {
  if (!run) return false;
  const level = String(run.level || '').toLowerCase();
  return run.scope === 'full_account'
    && run.period === 'last_90d'
    && (level === 'ad' || level === 'creative');
}

export function accountHasCreativeDepth(account: ClientMetaAccount): boolean {
  const attempt = account.lastAttempt;

  // A partial deep request is only a request contract, not proof that ad rows
  // were persisted. The official Lab summary can promote it after verifying
  // meta_ad_snapshots. Until then, keep the account eligible for a deep sync.
  if (attempt
    && attempt.scope === 'full_account'
    && attempt.period === 'last_90d'
    && (attempt.status === 'success' || attempt.status === 'partial' || attempt.status === undefined)
  ) {
    return attempt.status !== 'partial' && runMatchesOfficialDepthContract(attempt);
  }

  const success = account.lastSuccess;
  return runMatchesOfficialDepthContract(success)
    && (success?.status === undefined || success.status === 'success');
}

async function loadAllHierarchyItems(input: {
  clientMetaAssetId: string;
  period: CreativeLabPeriod;
  level: 'campaign' | 'adset' | 'ad' | 'creative';
  parentId?: string;
}): Promise<{ state: MetaHierarchyPage['state']; items: MetaHierarchyItem[] }> {
  const pageSize = 100;
  const items: MetaHierarchyItem[] = [];
  let state: MetaHierarchyPage['state'] = 'empty';

  for (let page = 1; page <= 10; page += 1) {
    const response = await loadMetaHierarchy({
      ...input,
      page,
      pageSize,
    });
    state = response.state;
    if (state !== 'ready') break;
    items.push(...response.items);
    if (response.items.length < pageSize) break;
  }

  return { state, items };
}

async function loadAccountMediaSummaryFromHierarchy(
  clientId: string,
  account: ClientMetaAccount
): Promise<CreativeLabClientMediaSummary> {
  try {
    const campaignPage = await loadAllHierarchyItems({
      clientMetaAssetId: account.clientMetaAssetId,
      period: 'last_90d',
      level: 'campaign',
    });

    if (campaignPage.state === 'period_not_synced') {
      return {
        clientId,
        clientMetaAssetId: account.clientMetaAssetId,
        accountId: account.adAccountId,
        accountName: account.accountName,
        activeCampaigns: 0,
        activeAdSets: 0,
        activeAds: 0,
        hasActiveMedia: false,
        lastSyncedAt: account.lastSuccess?.finishedAt || null,
        dataAvailable: false,
      };
    }

    const activeCampaigns = campaignPage.items.filter(hierarchyItemIsActive);
    const activeAdSets: MetaHierarchyItem[] = [];
    for (const campaign of activeCampaigns) {
      const adsetPage = await loadAllHierarchyItems({
        clientMetaAssetId: account.clientMetaAssetId,
        period: 'last_90d',
        level: 'adset',
        parentId: campaign.id,
      });
      activeAdSets.push(...adsetPage.items.filter(hierarchyItemIsActive));
    }

    const adDataAvailable = accountHasCreativeDepth(account);
    const activeAds: MetaHierarchyItem[] = [];
    if (adDataAvailable) {
      for (const adset of activeAdSets) {
        const adPage = await loadAllHierarchyItems({
          clientMetaAssetId: account.clientMetaAssetId,
          period: 'last_90d',
          level: 'ad',
          parentId: adset.id,
        });
        activeAds.push(...adPage.items.filter(hierarchyItemIsActive));
      }
    }

    return {
      clientId,
      clientMetaAssetId: account.clientMetaAssetId,
      accountId: account.adAccountId,
      accountName: account.accountName,
      activeCampaigns: activeCampaigns.length,
      activeAdSets: activeAdSets.length,
      activeAds: activeAds.length,
      hasActiveMedia: adDataAvailable && activeAds.length > 0,
      lastSyncedAt: account.lastSuccess?.finishedAt || null,
      dataAvailable: true,
      adDataAvailable,
    };
  } catch (error) {
    console.warn('[CreativeLab] Fallback de estrutura Meta falhou.', account.accountName, error);
    return {
      clientId,
      clientMetaAssetId: account.clientMetaAssetId,
      accountId: account.adAccountId,
      accountName: account.accountName,
      activeCampaigns: 0,
      activeAdSets: 0,
      activeAds: 0,
      hasActiveMedia: false,
      lastSyncedAt: account.lastSuccess?.finishedAt || null,
      dataAvailable: false,
      adDataAvailable: false,
    };
  }
}

export async function loadCreativeLabClientMediaSummariesFromHierarchy(
  data: CamplyData,
  accountMap: Map<string, ClientMetaAccount[]>
): Promise<CreativeLabClientMediaSummary[]> {
  const jobs = data.clients
    .filter((client) => {
      const project = data.projects.find((item) => item.id === client.projectId);
      return isClientOperationallyActive(client, project);
    })
    .flatMap((client) => (accountMap.get(client.id) || []).map((account) => ({ clientId: client.id, account })));

  return Promise.all(jobs.map(({ clientId, account }) => loadAccountMediaSummaryFromHierarchy(clientId, account)));
}

export function buildCreativeLabClientRows(
  data: CamplyData,
  accountMap: Map<string, ClientMetaAccount[]>,
  mediaSummaryMap: Map<string, CreativeLabClientMediaSummary[]> = new Map(),
  officialSummaryLoaded: boolean = true
): CreativeLabClientRow[] {
  return data.clients
    .filter((client) => {
      const project = data.projects.find((item) => item.id === client.projectId);
      return isClientOperationallyActive(client, project);
    })
    .map((client) => {
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

    const official = mediaSummaryMap.get(client.id) || [];
    const officialAvailable = official.some((item) => item.dataAvailable !== false);
    const officialUnavailable = official.length > 0 && !officialAvailable;
    const accounts = accountMap.get(client.id) || [];
    const fallbackAvailable = campaigns.some((campaign) => (
      Boolean(campaign.metaEffectiveStatus || campaign.metaStatus)
      || (campaign.activeAdSets?.length || 0) > 0
    ));
    const dataAvailable = officialAvailable || fallbackAvailable;
    const officialActiveCampaigns = official.reduce((sum, item) => sum + item.activeCampaigns, 0);
    const officialActiveAdSets = official.reduce((sum, item) => sum + item.activeAdSets, 0);
    const officialActiveAds = official.reduce((sum, item) => sum + item.activeAds, 0);
    const fallbackCreativeDepthAvailable = campaigns.some((campaign) =>
      (campaign.activeAdSets || []).some((adset) => Array.isArray(adset.ads) && adset.ads.length > 0)
    );
    const explicitAdAvailability = official.filter((item) => typeof item.adDataAvailable === 'boolean');
    const catalogCreativeDepthAvailable = accounts.some(accountHasCreativeDepth);
    const creativeDepthAvailable = officialAvailable
      ? explicitAdAvailability.length > 0
        ? explicitAdAvailability.some((item) => item.adDataAvailable === true)
        : catalogCreativeDepthAvailable
      : fallbackCreativeDepthAvailable;
    const hasActiveMedia = officialAvailable
      ? creativeDepthAvailable && official.some((item) => item.hasActiveMedia)
      : fallbackCreativeDepthAvailable && campaigns.some(campaignStructureIsActive);
    const activeStructureExists = officialAvailable
      ? officialActiveAdSets > 0 || (!creativeDepthAvailable && officialActiveCampaigns > 0)
      : activeAdSets > 0;

    const state: CreativeLabClientState = accounts.length > 0 && !dataAvailable && (!officialSummaryLoaded || officialUnavailable)
      ? 'data_unavailable'
      : !creativeDepthAvailable && activeStructureExists
        ? 'active_structure'
        : hasActiveMedia ? 'active_media' : 'no_active_media';

    return {
      client,
      accounts,
      state,
      dataAvailable,
      creativeDepthAvailable,
      activeCampaigns: dataAvailable ? (officialAvailable ? officialActiveCampaigns : activeCampaigns) : null,
      activeAdSets: dataAvailable ? (officialAvailable ? officialActiveAdSets : activeAdSets) : null,
      activeAds: dataAvailable && creativeDepthAvailable ? (officialAvailable ? officialActiveAds : activeAds) : null,
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


function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentileScore(value: number | null, values: number[], higherIsBetter: boolean): number {
  if (value === null || !Number.isFinite(value)) return 0;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return 50;

  const matchingIndexes = sorted
    .map((item, index) => item === value ? index : -1)
    .filter((index) => index >= 0);
  const nearestIndex = matchingIndexes.length > 0
    ? matchingIndexes.reduce((sum, index) => sum + index, 0) / matchingIndexes.length
    : sorted.findIndex((item) => item >= value);
  const normalizedIndex = nearestIndex < 0 ? sorted.length - 1 : nearestIndex;
  const percentile = (normalizedIndex / (sorted.length - 1)) * 100;
  return higherIsBetter ? percentile : 100 - percentile;
}

function performanceGroupKey(creative: CreativeLabCreative): string {
  return [
    creative.currency || 'BRL',
    creative.resultLabel,
    creative.costLabel,
  ].join('|');
}

function deliveryEfficiency(creative: CreativeLabCreative): number | null {
  if (creative.spend <= 0) return null;
  const delivery = creative.reach > 0 ? creative.reach : creative.impressions;
  return delivery > 0 ? delivery / creative.spend : null;
}

function performanceMoney(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
}

export function classifyCreativePerformance(creatives: CreativeLabCreative[]): CreativeLabCreative[] {
  const byKey = new Map<string, CreativeLabCreative>(creatives.map((creative) => [creative.key, {
    ...creative,
    performanceScore: null,
    performanceBand: 'insufficient' as CreativePerformanceBand,
    performanceFlag: null as CreativePerformanceFlag,
    performanceReason: 'Ainda não há entrega suficiente para classificar este criativo.',
    evaluationThresholdSpend: null,
  }]));

  const groups = new Map<string, CreativeLabCreative[]>();
  for (const creative of creatives) {
    const key = performanceGroupKey(creative);
    const group = groups.get(key) || [];
    group.push(creative);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const delivered = group.filter((creative) => creative.spend > 0 && creative.impressions > 0);
    const resultCosts = delivered
      .filter((creative) => creative.resultValue > 0 && creative.costPerResult !== null && creative.costPerResult > 0)
      .map((creative) => creative.costPerResult as number);
    const spendValues = delivered.map((creative) => creative.spend).filter((value) => value > 0);
    const threshold = Math.max(
      resultCosts.length > 0 ? median(resultCosts) || 0 : median(spendValues) || 0,
      0.01
    );

    const cpmValues = delivered.map((creative) => creative.cpm).filter((value): value is number => value !== null && value > 0);
    const ctrValues = delivered.map((creative) => creative.ctr).filter((value): value is number => value !== null && value >= 0);
    const deliveryValues = delivered
      .map(deliveryEfficiency)
      .filter((value): value is number => value !== null && value > 0);

    for (const creative of group) {
      const current = byKey.get(creative.key);
      if (!current) continue;

      current.evaluationThresholdSpend = threshold;

      if (creative.spend <= 0 || (creative.resultValue === 0 && creative.impressions < 100)) {
        current.performanceBand = 'insufficient';
        current.performanceReason = creative.spend <= 0
          ? 'Sem investimento no período; o CAMPLY não classifica sem entrega.'
          : 'Volume de entrega ainda muito baixo para validar ou invalidar este criativo.';
        continue;
      }

      if (creative.resultValue === 0 && creative.spend < threshold) {
        current.performanceBand = 'watch';
        current.performanceReason = `Sem resultado até agora, mas ainda abaixo da faixa mínima de avaliação (${performanceMoney(threshold, creative.currency)}).`;
        continue;
      }

      const primaryScore = creative.resultValue > 0
        ? percentileScore(creative.costPerResult, resultCosts, false)
        : 0;
      const cpmScore = percentileScore(creative.cpm, cpmValues, false);
      const deliveryScore = percentileScore(deliveryEfficiency(creative), deliveryValues, true);
      const ctrScore = percentileScore(creative.ctr, ctrValues, true);
      const score = Math.round(
        (primaryScore * 0.55)
        + (cpmScore * 0.20)
        + (deliveryScore * 0.15)
        + (ctrScore * 0.10)
      );

      current.performanceScore = Math.max(0, Math.min(100, score));

      if (creative.resultValue === 0) {
        current.performanceBand = 'no_result';
        current.performanceReason = 'Atingiu a faixa mínima de avaliação sem gerar o resultado principal do objetivo.';
      } else if (score >= 70) {
        current.performanceBand = 'strong';
        current.performanceReason = 'Custo por resultado e eficiência de entrega acima da faixa central dos criativos comparáveis.';
      } else if (score >= 45) {
        current.performanceBand = 'average';
        current.performanceReason = 'Desempenho próximo da faixa central dos criativos comparáveis no período.';
      } else {
        current.performanceBand = 'watch';
        current.performanceReason = 'Tem resultado, mas custo e eficiência de entrega estão abaixo dos pares do período.';
      }
    }
  }

  const assessed = [...byKey.values()];
  const best = assessed
    .filter((creative) => creative.resultValue > 0 && creative.performanceScore !== null)
    .sort((a, b) =>
      (b.performanceScore || 0) - (a.performanceScore || 0)
      || (a.costPerResult ?? Number.POSITIVE_INFINITY) - (b.costPerResult ?? Number.POSITIVE_INFINITY)
      || b.resultValue - a.resultValue
    )[0];

  if (best) {
    best.performanceFlag = 'best';
    const peers = assessed.filter((creative) =>
      performanceGroupKey(creative) === performanceGroupKey(best)
      && creative.resultValue > 0
      && creative.costPerResult !== null
      && creative.costPerResult > 0
    );
    const peerMedian = median(peers.map((creative) => creative.costPerResult as number));
    if (peerMedian && best.costPerResult && best.costPerResult < peerMedian) {
      const improvement = Math.round(((peerMedian - best.costPerResult) / peerMedian) * 100);
      best.performanceReason = `Melhor combinação do período: ${best.costLabel.toLowerCase()} ${improvement}% menor que a mediana, com CPM e entrega considerados no score.`;
    } else {
      best.performanceReason = 'Melhor combinação de custo por resultado, CPM, eficiência de alcance/entrega e CTR no período.';
    }
  }

  const noResultCandidates = assessed
    .filter((creative) => creative.performanceBand === 'no_result' && creative.spend > 0)
    .sort((a, b) => {
      const aThreshold = Math.max(a.evaluationThresholdSpend || 0.01, 0.01);
      const bThreshold = Math.max(b.evaluationThresholdSpend || 0.01, 0.01);
      const aRatio = a.spend / aThreshold;
      const bRatio = b.spend / bThreshold;
      return bRatio - aRatio || b.spend - a.spend;
    });

  let worst = noResultCandidates[0];
  if (!worst) {
    const scoredResults = assessed
      .filter((creative) => creative.resultValue > 0 && creative.performanceScore !== null)
      .sort((a, b) => (a.performanceScore || 0) - (b.performanceScore || 0));
    if (scoredResults.length >= 2) worst = scoredResults[0];
  }

  if (worst && worst.key !== best?.key) {
    worst.performanceFlag = 'worst';
    if (worst.resultValue === 0) {
      const threshold = Math.max(worst.evaluationThresholdSpend || 0.01, 0.01);
      const ratio = worst.spend / threshold;
      worst.performanceReason = `Sem ${worst.resultLabel.toLowerCase()} após investir ${ratio.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x a faixa mínima de avaliação.`;
    } else {
      worst.performanceReason = 'Menor score entre os criativos com resultado, considerando custo, CPM, eficiência de entrega e CTR.';
    }
  }

  const bandOrder: Record<CreativePerformanceBand, number> = {
    strong: 0,
    average: 1,
    watch: 2,
    no_result: 3,
    insufficient: 4,
  };

  return assessed.sort((a, b) => {
    if (a.performanceFlag === 'best' && b.performanceFlag !== 'best') return -1;
    if (b.performanceFlag === 'best' && a.performanceFlag !== 'best') return 1;
    if (a.performanceFlag === 'worst' && b.performanceFlag !== 'worst') return 1;
    if (b.performanceFlag === 'worst' && a.performanceFlag !== 'worst') return -1;
    if (bandOrder[a.performanceBand] !== bandOrder[b.performanceBand]) {
      return bandOrder[a.performanceBand] - bandOrder[b.performanceBand];
    }
    if (a.performanceScore !== null || b.performanceScore !== null) {
      return (b.performanceScore ?? -1) - (a.performanceScore ?? -1);
    }
    return b.spend - a.spend;
  });
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
    const reach = creativeRows.reduce((sum, row) => sum + metricValue(row.metrics, 'reach'), 0);
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
      reach,
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
      performanceScore: null,
      performanceBand: 'insufficient',
      performanceFlag: null,
      performanceReason: 'Ainda não há entrega suficiente para classificar este criativo.',
      evaluationThresholdSpend: null,
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

  return classifyCreativePerformance(creatives);
}


export async function loadCreativeLabClientMediaSummaries(): Promise<CreativeLabClientMediaSummary[]> {
  if (isMetaE2EMode) {
    return [{
      clientId: 'client-e2e',
      clientMetaAssetId: 'link-e2e',
      accountId: 'act_e2e',
      accountName: 'Conta Meta Mock',
      activeCampaigns: 1,
      activeAdSets: 1,
      activeAds: 1,
      hasActiveMedia: true,
      lastSyncedAt: '2026-06-30T18:00:00.000Z',
      dataAvailable: true,
      adDataAvailable: true,
    }];
  }
  if (!supabase) throw new Error('Supabase não configurado para o Laboratório de Criativos.');
  const { data, error } = await supabase.rpc('get_meta_creative_lab_account_summary');
  if (error) {
    console.error('[CreativeLab] Falha no resumo oficial de mídia ativa.', error);
    throw new Error(`Resumo Meta indisponível: ${error.message}`);
  }
  const payload = data as unknown as { state?: string; items?: CreativeLabClientMediaSummary[] };
  if (payload?.state && payload.state !== 'ready') {
    throw new Error(`Resumo Meta indisponível: estado ${payload.state}.`);
  }
  return Array.isArray(payload?.items)
    ? payload.items.map((item) => ({
        ...item,
        // Newer RPCs expose both flags explicitly. For older deployments,
        // lastSyncedAt is the safest evidence that structural data exists.
        dataAvailable: item.dataAvailable ?? Boolean(item.lastSyncedAt),
        adDataAvailable: item.adDataAvailable,
      }))
    : [];
}

async function loadAccountRowsFromHierarchy(
  account: ClientMetaAccount,
  period: CreativeLabPeriod
): Promise<{ state: CreativeLabRpcResponse['state']; rows: CreativeLabRawRow[] }> {
  const campaignPage = await loadAllHierarchyItems({
    clientMetaAssetId: account.clientMetaAssetId,
    period,
    level: 'campaign',
  });
  if (campaignPage.state !== 'ready') return { state: campaignPage.state, rows: [] };

  const rows: CreativeLabRawRow[] = [];
  for (const campaign of campaignPage.items) {
    const adsetPage = await loadAllHierarchyItems({
      clientMetaAssetId: account.clientMetaAssetId,
      period,
      level: 'adset',
      parentId: campaign.id,
    });
    for (const adset of adsetPage.items) {
      const adPage = await loadAllHierarchyItems({
        clientMetaAssetId: account.clientMetaAssetId,
        period,
        level: 'ad',
        parentId: adset.id,
      });
      for (const ad of adPage.items) {
        const creativePage = await loadAllHierarchyItems({
          clientMetaAssetId: account.clientMetaAssetId,
          period,
          level: 'creative',
          parentId: ad.id,
        });
        const creatives = creativePage.items.length > 0
          ? creativePage.items
          : ad.creativeId
            ? [{ ...ad, id: ad.creativeId, creativeId: ad.creativeId }]
            : [];

        for (const creative of creatives) {
          const creativeId = creative.creativeId || creative.id;
          if (!creativeId) continue;
          rows.push({
            accountId: account.adAccountId,
            accountName: account.accountName,
            currency: account.currency,
            campaignId: campaign.id,
            campaignName: campaign.name || campaign.id,
            campaignStatus: campaign.status || null,
            campaignEffectiveStatus: campaign.effectiveStatus || null,
            classifiedObjective: campaign.classifiedObjective || null,
            adsetId: adset.id || null,
            adsetName: adset.name || null,
            adsetStatus: adset.status || null,
            adsetEffectiveStatus: adset.effectiveStatus || null,
            adId: ad.id,
            adName: ad.name || ad.id,
            adStatus: ad.status || null,
            adEffectiveStatus: ad.effectiveStatus || null,
            creativeId,
            creativeName: creative.name || ad.name || creativeId,
            title: creative.title || null,
            body: creative.body || null,
            thumbnailUrl: creative.thumbnailUrl || null,
            imageUrl: creative.imageUrl || null,
            objectStorySpec: creative.objectStorySpec || null,
            updatedAt: creative.updatedAt || null,
            metrics: ad.metrics as unknown as Record<string, MetricContract>,
          });
        }
      }
    }
  }

  return { state: rows.length > 0 ? 'ready' : 'empty', rows };
}

async function loadAccountRows(account: ClientMetaAccount, period: CreativeLabPeriod): Promise<{
  state: CreativeLabRpcResponse['state'];
  rows: CreativeLabRawRow[];
}> {
  if (isMetaE2EMode) {
    const ids = { campaignId: 'campaign-active-e2e', adsetId: 'adset-active-e2e', adId: 'ad-active-e2e' };
    return {
      state: 'ready',
      rows: [{
        accountId: account.adAccountId,
        accountName: account.accountName,
        currency: account.currency,
        campaignId: ids.campaignId,
        campaignName: 'Campanha ativa mock',
        campaignStatus: 'ACTIVE',
        campaignEffectiveStatus: 'ACTIVE',
        classifiedObjective: 'LEADS',
        adsetId: ids.adsetId,
        adsetName: 'Conjunto ativo com leads',
        adsetStatus: 'ACTIVE',
        adsetEffectiveStatus: 'ACTIVE',
        adId: ids.adId,
        adName: 'Anúncio ativo com compra',
        adStatus: 'ACTIVE',
        adEffectiveStatus: 'ACTIVE',
        creativeId: 'creative-e2e',
        creativeName: 'Criativo Mock',
        title: 'Agende sua avaliação',
        body: 'Atendimento especializado pelo WhatsApp.',
        thumbnailUrl: null,
        imageUrl: null,
        objectStorySpec: { format: 'IMAGE' },
        updatedAt: '2026-06-29T12:00:00.000Z',
        metrics: {
          spend: e2eMetric('spend', 120, 'ad', ids),
          impressions: e2eMetric('impressions', 5000, 'ad', ids),
          link_clicks: e2eMetric('link_clicks', 180, 'ad', ids),
          landing_page_views: e2eMetric('landing_page_views', 130, 'ad', ids),
          messaging_conversations_started_total: e2eMetric('messaging_conversations_started_total', 12, 'ad', ids),
          leads: e2eMetric('leads', 12, 'ad', ids),
          purchases: e2eMetric('purchases', 2, 'ad', ids),
          purchase_value: e2eMetric('purchase_value', 480, 'ad', ids),
        },
      }],
    };
  }
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
    if (error) {
      console.warn('[CreativeLab] RPC dedicado indisponível; usando hierarquia oficial.', account.accountName, error);
      return loadAccountRowsFromHierarchy(account, period);
    }
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
