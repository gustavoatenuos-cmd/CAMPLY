import { Campaign, CamplyData } from '../../types';
import { makeId } from '../../data/camplyStore';

export function applyMetaSyncToWorkspace(
  client: any,
  fetchedCampaigns: Campaign[],
  currentData: CamplyData
): CamplyData {
  const updatedCampaigns = currentData.campaigns.map((c) => {
    if (c.clientId === client.id && c.platform === 'Meta Ads') {
      const fc = fetchedCampaigns.find((f) => f.metaCampaignId === c.metaCampaignId);
      if (fc) {
        return {
          ...c,
          ...fc,
          id: c.id, // Preserve internal ID
          clientId: client.id,
          status: c.status !== 'launching' ? c.status : fc.status,
          lastOptimizedAt: c.lastOptimizedAt, // Preserve operational status
          priority: c.priority,
          nextAction: c.nextAction,
          createdAt: c.createdAt,
          updatedAt: new Date().toISOString(),
          lastActivityAt: c.lastActivityAt,
        };
      } else {
        return { ...c, status: 'paused' as const };
      }
    }
    return c;
  });

  const newCampaignsToInsert = fetchedCampaigns
    .filter((fc) => !currentData.campaigns.some((c) => c.metaCampaignId === fc.metaCampaignId))
    .map((fc) => ({ ...fc, id: makeId('campaign'), clientId: client.id }));

  return {
    ...currentData,
    campaigns: [...newCampaignsToInsert, ...updatedCampaigns],
  };
}
