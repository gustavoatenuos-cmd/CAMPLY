import { Campaign, CamplyData } from '../../types';

export interface MetaSyncPayload {
  runId: string;
  status: string;
  completenessByPeriod: Record<string, any>;
  failedAdsetIds: string[];
  campaigns: any[]; // raw campaigns from edge
}

export function mapMetaCampaigns(payload: MetaSyncPayload, clientId: string): Campaign[] {
  return payload.campaigns.map(camp => ({
    id: camp.id,
    clientId,
    name: camp.name,
    platform: 'Meta Ads',
    status: mapMetaStatusToCamply(camp.effective_status || camp.status),
    objective: camp.classifiedObjective || camp.objective || 'UNCLASSIFIED',
    budget: camp.budget !== undefined ? camp.budget : (Number(camp.daily_budget || camp.lifetime_budget || 0) / 100),
    spent: camp.spent || 0,
    priority: camp.priority || 'low',
    metaCampaignId: camp.metaCampaignId || camp.id,
    lastOptimizedAt: camp.lastOptimizedAt || new Date().toISOString(),
    nextAction: camp.nextAction || 'Monitoramento contínuo',
    
    mixedAttribution: camp.mixedAttribution,
    mixedObjective: camp.mixedObjective,
    globalMetricsByPeriod: camp.globalMetricsByPeriod,
    attributionGroupsByPeriod: camp.attributionGroupsByPeriod,
    completenessByPeriod: payload.completenessByPeriod,
    trendAvailable: camp.trendAvailable,
    trendUnavailableReason: camp.trendUnavailableReason,

    lastSyncedAt: new Date().toISOString(),
    metaStatus: camp.status,
    metaEffectiveStatus: camp.effective_status,
    syncRunId: payload.runId,
    metaMissingFromLatestSync: false
  }));
}

function mapMetaStatusToCamply(metaStatus: string): Campaign['status'] {
  if (['live', 'paused', 'setup', 'launching', 'optimize', 'completed'].includes(metaStatus)) {
    return metaStatus as Campaign['status'];
  }
  if (metaStatus === 'ACTIVE') return 'live';
  if (metaStatus === 'PAUSED') return 'paused';
  if (metaStatus === 'ARCHIVED') return 'paused';
  if (metaStatus === 'IN_PROCESS') return 'launching';
  if (metaStatus === 'WITH_ISSUES') return 'optimize';
  return 'paused';
}
