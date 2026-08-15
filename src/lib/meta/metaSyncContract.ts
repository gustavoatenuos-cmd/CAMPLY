import type { Client } from '../../types';
import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import type { MetaSyncResponse } from './metaSyncTypes';

export type MetaSyncPeriod = DashboardPeriod;
export type MetaSyncLevel = 'campaign' | 'adset' | 'ad' | 'creative';
export const OFFICIAL_META_SYNC_PERIOD: DashboardPeriod = 'last_90d';

export interface MetaSyncOptions {
  metaAssetId?: string;
  adAccountId?: string;
  periods?: MetaSyncPeriod[];
  requestedLevel?: MetaSyncLevel;
  selectedCampaigns?: string[];
  selectedAdSets?: string[];
  selectedAds?: string[];
  selectedCreatives?: string[];
}

export interface OperationalMetaSyncResult {
  success: boolean;
  status: 'running' | 'success' | 'partial' | 'failed';
  runId: string | null;
  message?: string;
}

export interface OperationalMetaSyncInput {
  clientMetaAssetId: string;
  period: DashboardPeriod;
  requestedLevel?: MetaSyncLevel;
  campaignIds?: string[];
  adsetIds?: string[];
  adIds?: string[];
  creativeIds?: string[];
}

interface MetaSyncRequest<TPayload> {
  payload: TPayload;
  timeoutMs: number;
}

const timeoutForLevel = (level: MetaSyncLevel | undefined): number =>
  level === 'creative' ? 120_000 : 90_000;

export function normalizeMetaSyncOptions(
  clientOrOptions: Client | MetaSyncOptions
): MetaSyncOptions {
  const legacyAdAccountId = (clientOrOptions as Client).metaAdAccountId;
  if (typeof legacyAdAccountId === 'string') {
    return {
      adAccountId: legacyAdAccountId || undefined,
      periods: [OFFICIAL_META_SYNC_PERIOD],
      requestedLevel: 'campaign',
    };
  }

  const options = clientOrOptions as MetaSyncOptions;
  return {
    ...options,
    periods: [OFFICIAL_META_SYNC_PERIOD],
    requestedLevel: options.requestedLevel ?? 'campaign',
  };
}

export function buildOperationalMetaSyncRequest(input: OperationalMetaSyncInput): MetaSyncRequest<{
  clientMetaAssetId: string;
  periods: DashboardPeriod[];
  requestedLevel: MetaSyncLevel;
  selectedEntityIds: {
    campaign_ids: string[];
    adset_ids: string[];
    ad_ids: string[];
    creative_ids: string[];
  };
}> {
  const requestedLevel = input.requestedLevel ?? 'campaign';
  return {
    payload: {
      clientMetaAssetId: input.clientMetaAssetId,
      periods: [OFFICIAL_META_SYNC_PERIOD],
      requestedLevel,
      selectedEntityIds: {
        campaign_ids: input.campaignIds ?? [],
        adset_ids: input.adsetIds ?? [],
        ad_ids: input.adIds ?? [],
        creative_ids: input.creativeIds ?? [],
      },
    },
    timeoutMs: timeoutForLevel(requestedLevel),
  };
}

export function buildClientMetaSyncRequest(
  options: MetaSyncOptions
): MetaSyncRequest<MetaSyncOptions> {
  const normalized = normalizeMetaSyncOptions(options);
  return {
    payload: normalized,
    timeoutMs: timeoutForLevel(normalized.requestedLevel),
  };
}

export function assertMetaSyncResponse(response: unknown): MetaSyncResponse {
  if (!response || typeof response !== 'object') {
    throw new Error('Meta sync returned an invalid response contract');
  }

  const candidate = response as Partial<MetaSyncResponse>;
  if (!candidate.runId || !Array.isArray(candidate.campaigns)) {
    throw new Error('Meta sync returned an invalid response contract');
  }
  if (!['success', 'partial', 'failed'].includes(candidate.status ?? '')) {
    throw new Error('Meta sync returned an unknown status');
  }

  return response as MetaSyncResponse;
}
