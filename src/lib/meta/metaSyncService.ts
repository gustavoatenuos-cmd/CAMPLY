import type { Campaign, Client } from '../../types';
import { invokeFunction } from '../invokeFunction';
import type { MetaSyncResponse } from './metaSyncTypes';

export type MetaSyncPeriod = 'today' | 'last_7d' | 'last_30d';
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
  if ('metaAdAccountId' in clientOrOptions) {
    return {
      adAccountId: clientOrOptions.metaAdAccountId || undefined,
      periods: ['last_7d'],
      requestedLevel: 'campaign',
    };
  }

  return {
    ...clientOrOptions,
    periods: clientOrOptions.periods?.length ? Array.from(new Set(clientOrOptions.periods)) : ['last_7d'],
    requestedLevel: clientOrOptions.requestedLevel ?? 'campaign',
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

export function syncMetaAsset(options: MetaSyncOptions): Promise<MetaSyncResponse> {
  return syncClientMeta(options);
}
