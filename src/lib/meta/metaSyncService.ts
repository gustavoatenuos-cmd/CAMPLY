import type { Campaign, Client } from '../../types';
import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import { invokeFunction, InvokeError } from '../invokeFunction';
import { isMetaE2EMode, metaE2EState, persistMetaE2EState } from './metaE2ERuntime';
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

function normalizeOptions(clientOrOptions: Client | MetaSyncOptions): MetaSyncOptions {
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

async function syncOperationalMetaAsset(
  input: OperationalMetaSyncInput
): Promise<OperationalMetaSyncResult> {
  if (!input.clientMetaAssetId) {
    throw new Error('A sincronização operacional exige uma conta Meta vinculada a um cliente.');
  }

  if (isMetaE2EMode) {
    metaE2EState.syncedPeriods.add(OFFICIAL_META_SYNC_PERIOD);
    metaE2EState.syncedPeriods.add(input.period);
    persistMetaE2EState();
    return {
      success: true,
      status: 'success',
      runId: `run-e2e-${OFFICIAL_META_SYNC_PERIOD}-${input.requestedLevel || 'campaign'}`,
    };
  }

  try {
    const response = await invokeFunction<MetaSyncResponse>('meta-sync-performance', {
      clientMetaAssetId: input.clientMetaAssetId,
      periods: [OFFICIAL_META_SYNC_PERIOD],
      requestedLevel: input.requestedLevel || 'campaign',
      selectedEntityIds: {
        campaign_ids: input.campaignIds || [],
        adset_ids: input.adsetIds || [],
        ad_ids: input.adIds || [],
        creative_ids: input.creativeIds || [],
      },
    }, input.requestedLevel === 'creative' ? 120_000 : 90_000);

    return {
      success: response.success,
      status: response.status,
      runId: response.runId,
      message: response.message,
    };
  } catch (err) {
    if (err instanceof InvokeError && err.status === 409) {
      return {
        success: true, // Not a fatal error, just already running
        status: 'running',
        runId: null,
        message: 'Sincronização já em andamento',
      };
    }
    throw err;
  }
}

export async function syncClientMeta(
  clientOrOptions: Client | MetaSyncOptions,
  _existingCampaigns: Campaign[] = []
): Promise<MetaSyncResponse> {
  const options = normalizeOptions(clientOrOptions);

  if (!options.metaAssetId && !options.adAccountId) {
    throw new Error('A sincronização exige metaAssetId ou adAccountId');
  }

  try {
    const response = await invokeFunction<MetaSyncResponse>('meta-sync-performance', {
      metaAssetId: options.metaAssetId,
      adAccountId: options.adAccountId,
      periods: options.periods,
      requestedLevel: options.requestedLevel,
      selectedCampaigns: options.selectedCampaigns,
      selectedAdSets: options.selectedAdSets,
      selectedAds: options.selectedAds,
      selectedCreatives: options.selectedCreatives,
    }, options.requestedLevel === 'creative' ? 120_000 : 90_000);

    if (!response.runId || !Array.isArray(response.campaigns)) {
      throw new Error('Meta sync returned an invalid response contract');
    }
    if (!['success', 'partial', 'failed'].includes(response.status)) {
      throw new Error('Meta sync returned an unknown status');
    }

    return response;
  } catch (err) {
    if (err instanceof InvokeError && err.status === 409) {
      return {
        success: true,
        status: 'partial',
        runId: 'already-running',
        message: 'Sincronização já em andamento',
        campaigns: [],
        completenessByPeriod: {},
        failedAdsetIds: [],
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
      };
    }
    throw err;
  }
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
