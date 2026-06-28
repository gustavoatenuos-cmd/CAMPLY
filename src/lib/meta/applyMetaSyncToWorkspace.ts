import { Campaign, CamplyData } from '../../types';
import { makeId } from '../../data/camplyStore';
import { MetaSyncPayload, mapMetaCampaigns } from './metaSyncMapper';

export function applyMetaSyncToWorkspace(
  client: any,
  payload: MetaSyncPayload,
  currentData: CamplyData
): CamplyData {
  const isPartial = payload.status === 'partial';
  const mappedCampaigns = mapMetaCampaigns(payload, client.id);

  const updatedCampaigns = currentData.campaigns.map((c) => {
    if (c.clientId === client.id && c.platform === 'Meta Ads') {
      const fc = mappedCampaigns.find((f) => f.metaCampaignId === c.metaCampaignId);
      if (fc) {
        if (isPartial) {
           // Preserve the full metrics from previous sync if this was partial
           return {
             ...c,
             ...fc,
             id: c.id,
             clientId: client.id,
             status: c.status !== 'launching' ? c.status : fc.status,
             lastOptimizedAt: c.lastOptimizedAt,
             priority: c.priority,
             nextAction: c.nextAction,
             createdAt: c.createdAt,
             updatedAt: new Date().toISOString(),
             lastActivityAt: c.lastActivityAt,
             syncRunId: fc.syncRunId, // update to current for diagnostics
             metaMissingFromLatestSync: false,
             // Preserve metrics explicitly
             globalMetricsByPeriod: c.globalMetricsByPeriod || fc.globalMetricsByPeriod,
             attributionGroupsByPeriod: c.attributionGroupsByPeriod || fc.attributionGroupsByPeriod,
           };
        } else {
           return {
             ...c,
             ...fc,
             id: c.id, 
             clientId: client.id,
             status: c.status !== 'launching' ? c.status : fc.status,
             lastOptimizedAt: c.lastOptimizedAt, 
             priority: c.priority,
             nextAction: c.nextAction,
             createdAt: c.createdAt,
             updatedAt: new Date().toISOString(),
             lastActivityAt: c.lastActivityAt,
             syncRunId: fc.syncRunId,
             metaMissingFromLatestSync: false,
           };
        }
      } else {
        return { ...c, metaMissingFromLatestSync: true };
      }
    }
    return c;
  });

  const newCampaignsToInsert = mappedCampaigns
    .filter((fc) => !currentData.campaigns.some((c) => c.metaCampaignId === fc.metaCampaignId))
    .map((fc) => ({ ...fc, id: makeId('campaign'), clientId: client.id }));

  return {
    ...currentData,
    campaigns: [...newCampaignsToInsert, ...updatedCampaigns],
  };
}
