import type { Campaign, Client } from '../../types';
import { invokeFunction, InvokeError } from '../invokeFunction';
import { isMetaE2EMode, metaE2EState, persistMetaE2EState } from './metaE2ERuntime';
import type { MetaSyncResponse } from './metaSyncTypes';
import {
  OFFICIAL_META_SYNC_PERIOD,
  assertMetaSyncResponse,
  buildClientMetaSyncRequest,
  buildOperationalMetaSyncRequest,
  normalizeMetaSyncOptions,
  type MetaSyncOptions,
  type OperationalMetaSyncInput,
  type OperationalMetaSyncResult,
} from './metaSyncContract';

export {
  OFFICIAL_META_SYNC_PERIOD,
  type MetaSyncLevel,
  type MetaSyncOptions,
  type MetaSyncPeriod,
  type OperationalMetaSyncInput,
  type OperationalMetaSyncResult,
} from './metaSyncContract';

async function syncOperationalMetaAsset(
  input: OperationalMetaSyncInput
): Promise<OperationalMetaSyncResult> {
  if (!input.clientMetaAssetId) {
    throw new Error('A sincronização operacional exige uma conta Meta vinculada a um cliente.');
  }

  const request = buildOperationalMetaSyncRequest(input);

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
      ...request.payload,
    }, request.timeoutMs);

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
  const options = normalizeMetaSyncOptions(clientOrOptions);

  if (!options.metaAssetId && !options.adAccountId) {
    throw new Error('A sincronização exige metaAssetId ou adAccountId');
  }

  const request = buildClientMetaSyncRequest(options);

  try {
    const response = await invokeFunction<MetaSyncResponse>(
      'meta-sync-performance',
      { ...request.payload },
      request.timeoutMs
    );

    return assertMetaSyncResponse(response);
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
