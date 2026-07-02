import type { Campaign, Client } from '../../types';
import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import { invokeFunction } from '../invokeFunction';
import { isMetaE2EMode, metaE2EState, persistMetaE2EState } from './metaE2ERuntime';
import type { MetaSyncResponse } from './metaSyncTypes';

export type MetaSyncPeriod = DashboardPeriod;
export type MetaSyncLevel = 'campaign' | 'adset' | 'ad' | 'creative';

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

function normalizeOptions(clientOrOptions: Client | MetaSyncOptions): MetaSyncOptions {
  const legacyAdAccountId = (clientOrOptions as Client).metaAdAccountId;
  if (typeof legacyAdAccountId === 'string') {
    return {
      adAccountId: legacyAdAccountId || undefined,
      periods: ['this_month'],
      requestedLevel: 'campaign',
    };
  }

  const options = clientOrOptions as MetaSyncOptions;
  return {
    ...options,
    periods: options.periods?.length ? Array.from(new Set(options.periods)) : ['this_month'],
    requestedLevel: options.requestedLevel ?? 'campaign',
  };
}

export interface OperationalMetaSyncResult {
  success: boolean;
  status: 'running' | 'success' | 'partial' | 'failed';
  runId: string | null;
  message?: string;
}

export interface OperationalMetaSyncInput {
  metaAssetId: string;
  period: DashboardPeriod;
  requestedLevel?: MetaSyncLevel;
  campaignIds?: string[];
  adsetIds?: string[];
  adIds?: string[];
  creativeIds?: string[];
}

async function syncOperationalMetaAsset(
  input: OperationalMetaSyncInput
): Promise<OperationalMetaSyncResult> {
  if (isMetaE2EMode) {
    metaE2EState.syncedPeriods.add(input.period);
    persistMetaE2EState();
    return {
      success: true,
      status: 'success',
      runId: `run-e2e-${input.period}-${input.requestedLevel || 'campaign'}`,
    };
  }

  const response = await invokeFunction<MetaSyncResponse>('meta-sync-ads', {
    metaAssetId: input.metaAssetId,
    periods: [input.period],
    requestedLevel: input.requestedLevel || 'campaign',
    selectedEntityIds: {
      campaign_ids: input.campaignIds || [],
      adset_ids: input.adsetIds || [],
      ad_ids: input.adIds || [],
      creative_ids: input.creativeIds || [],
    },
  });

  return {
    success: response.success,
    status: response.status,
    runId: response.runId,
    message: response.message,
  };
}

export async function syncClientMeta(
  clientOrOptions: Client | MetaSyncOptions,
  _existingCampaigns: Campaign[] = []
): Promise<MetaSyncResponse> {
  const options = normalizeOptions(clientOrOptions);

  if (!options.metaAssetId && !options.adAccountId) {
    throw new Error('A sincronização exige metaAssetId ou adAccountId');
  }

  const response = await invokeFunction<MetaSyncResponse>('meta-sync-ads', {
    metaAssetId: options.metaAssetId,
    adAccountId: options.adAccountId,
    periods: options.periods,
    requestedLevel: options.requestedLevel,
    selectedCampaigns: options.selectedCampaigns,
    selectedAdSets: options.selectedAdSets,
    selectedAds: options.selectedAds,
    selectedCreatives: options.selectedCreatives,
  });

  if (!response.runId || !Array.isArray(response.campaigns)) {
    throw new Error('Meta sync returned an invalid response contract');
  }
  if (!['success', 'partial', 'failed'].includes(response.status)) {
    throw new Error('Meta sync returned an unknown status');
  }

  return response;
}

export function syncMetaAsset(input: OperationalMetaSyncInput): Promise<OperationalMetaSyncResult>;
export function syncMetaAsset(input: MetaSyncOptions): Promise<MetaSyncResponse>;
export function syncMetaAsset(
  input: OperationalMetaSyncInput | MetaSyncOptions
): Promise<OperationalMetaSyncResult> | Promise<MetaSyncResponse> {
  return 'period' in input
    ? syncOperationalMetaAsset(input)
    : syncClientMeta(input);
}
