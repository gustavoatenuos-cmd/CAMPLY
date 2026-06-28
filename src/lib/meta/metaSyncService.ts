import type { Campaign, Client } from '../../types';
import { invokeFunction } from '../invokeFunction';
import type { MetaSyncResponse } from './metaSyncTypes';

export async function syncClientMeta(
  client: Client,
  _existingCampaigns: Campaign[]
): Promise<MetaSyncResponse> {
  if (!client.metaAdAccountId) {
    throw new Error('Client has no metaAdAccountId');
  }

  const response = await invokeFunction<MetaSyncResponse>('meta-sync-ads', {
    adAccountId: client.metaAdAccountId,
  });

  if (!response.runId || !Array.isArray(response.campaigns)) {
    throw new Error('Meta sync returned an invalid response contract');
  }
  if (!['success', 'partial', 'failed'].includes(response.status)) {
    throw new Error('Meta sync returned an unknown status');
  }

  return response;
}
