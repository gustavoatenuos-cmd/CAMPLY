import type { Campaign, CamplyData, Client } from '../../types';
import { makeId } from '../../data/camplyStore';
import { mapMetaCampaigns } from './metaSyncMapper';
import type { MetaSyncResponse } from './metaSyncTypes';

const preserveOperationalFields = (existing: Campaign, incoming: Campaign): Campaign => ({
  ...incoming,
  id: existing.id,
  clientId: existing.clientId,
  status: existing.status,
  lastOptimizedAt: existing.lastOptimizedAt,
  priority: existing.priority,
  nextAction: existing.nextAction,
  createdAt: existing.createdAt,
  updatedAt: new Date().toISOString(),
  lastActivityAt: existing.lastActivityAt,
});

const applyPartialAttempt = (existing: Campaign, incoming: Campaign): Campaign => ({
  ...existing,
  name: incoming.name,
  budget: incoming.budget,
  metaStatus: incoming.metaStatus,
  metaEffectiveStatus: incoming.metaEffectiveStatus,
  activeAdSets: incoming.activeAdSets,
  updatedAt: new Date().toISOString(),
  lastSyncAttemptAt: incoming.lastSyncAttemptAt,
  lastSyncAttemptRunId: incoming.lastSyncAttemptRunId,
  lastSyncStatus: 'partial',
  partialSyncRunId: incoming.lastSyncAttemptRunId,
  metaMissingFromLatestSync: false,
  // The displayed metrics and their complete source run remain untouched.
  syncRunId: existing.syncRunId,
  lastSyncedAt: existing.lastSyncedAt,
  globalMetricsByPeriod: existing.globalMetricsByPeriod,
  attributionGroupsByPeriod: existing.attributionGroupsByPeriod,
  completenessByPeriod: existing.completenessByPeriod,
  mixedAttributionByPeriod: existing.mixedAttributionByPeriod,
  trendAvailabilityByPeriod: existing.trendAvailabilityByPeriod,
  trendAvailable: existing.trendAvailable,
  trendUnavailableReason: existing.trendUnavailableReason,
  dataIsPartial: existing.dataIsPartial || false,
});

const markNewPartialCampaign = (campaign: Campaign, runId: string): Campaign => ({
  ...campaign,
  id: makeId('campaign'),
  syncRunId: undefined,
  lastSyncedAt: undefined,
  partialSyncRunId: runId,
  lastSyncAttemptRunId: runId,
  lastSyncStatus: 'partial',
  dataIsPartial: true,
  trendAvailable: false,
  trendUnavailableReason: 'Campaign was discovered in a partial synchronization',
  trendAvailabilityByPeriod: Object.fromEntries(
    Object.keys(campaign.completenessByPeriod || {}).map((period) => [period, {
      available: false,
      reason: 'Campaign was discovered in a partial synchronization',
    }])
  ),
});

export function applyMetaSyncToWorkspace(
  client: Client,
  payload: MetaSyncResponse,
  currentData: CamplyData
): CamplyData {
  const isPartial = payload.status === 'partial';
  const mappedCampaigns = mapMetaCampaigns(payload, client.id);

  const updatedCampaigns: Campaign[] = currentData.campaigns.map((campaign): Campaign => {
    if (campaign.clientId !== client.id || campaign.platform !== 'Meta Ads') return campaign;

    const incoming = mappedCampaigns.find((candidate) =>
      candidate.metaCampaignId === campaign.metaCampaignId
    );
    if (!incoming) {
      return isPartial
        ? {
          ...campaign,
          lastSyncAttemptAt: new Date().toISOString(),
          lastSyncAttemptRunId: payload.runId,
          lastSyncStatus: 'partial' as const,
          partialSyncRunId: payload.runId,
        }
        : { ...campaign, metaMissingFromLatestSync: true, lastSyncStatus: payload.status };
    }

    return isPartial
      ? applyPartialAttempt(campaign, incoming)
      : {
        ...preserveOperationalFields(campaign, incoming),
        syncRunId: payload.runId,
        lastSyncAttemptRunId: payload.runId,
        lastSyncStatus: 'success' as const,
        partialSyncRunId: undefined,
        dataIsPartial: false,
        metaMissingFromLatestSync: false,
      };
  });

  const newCampaigns = mappedCampaigns
    .filter((incoming) => !currentData.campaigns.some((campaign) =>
      campaign.clientId === client.id
      && campaign.metaCampaignId === incoming.metaCampaignId
    ))
    .map((incoming) => isPartial
      ? { ...markNewPartialCampaign(incoming, payload.runId), clientId: client.id }
      : { ...incoming, id: makeId('campaign'), clientId: client.id, dataIsPartial: false }
    );

  return {
    ...currentData,
    campaigns: [...newCampaigns, ...updatedCampaigns],
  };
}
