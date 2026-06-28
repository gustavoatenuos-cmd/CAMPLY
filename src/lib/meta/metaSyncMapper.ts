import type { Campaign } from '../../types';
import type { GlobalMetrics, MetaSyncResponse, MetaSyncedCampaign } from './metaSyncTypes';

export type MetaSyncPayload = MetaSyncResponse;

const numericMetric = (metrics: GlobalMetrics | undefined, metricId: string): number => {
  const value = metrics?.[metricId];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const defaultMetrics = (campaign: MetaSyncedCampaign): GlobalMetrics | undefined =>
  campaign.globalMetricsByPeriod.last_7d
  || Object.values(campaign.globalMetricsByPeriod)[0];

/**
 * Maps Meta's analytical contract into a CRM campaign without inventing an
 * optimization event or operational recommendation. New Meta campaigns enter
 * the CRM explicitly in `setup`; Meta delivery status remains separate.
 */
export function mapMetaCampaigns(payload: MetaSyncPayload, clientId: string): Campaign[] {
  const attemptedAt = new Date().toISOString();

  return payload.campaigns.map((campaign) => {
    const metrics = defaultMetrics(campaign);
    const isPartial = payload.status === 'partial';

    return {
      id: campaign.id,
      clientId,
      name: campaign.name,
      platform: 'Meta Ads',
      status: 'setup',
      objective: campaign.classifiedObjective || campaign.objective || 'UNCLASSIFIED',
      budget: Number(campaign.daily_budget || campaign.lifetime_budget || 0) / 100,
      spent: numericMetric(metrics, 'spend'),
      priority: 'medium',
      metaCampaignId: campaign.id,
      lastOptimizedAt: undefined,
      nextAction: '',
      classifiedObjective: campaign.classifiedObjective,
      activeAdSets: campaign.classifiedAdsets.map((adset) => ({
        id: adset.id,
        name: adset.name || adset.id,
        status: adset.status || adset.effective_status || 'UNKNOWN',
        effective_status: adset.effective_status,
        optimization_goal: adset.optimization_goal,
        destination_type: adset.destination_type,
        attribution_setting: adset.attribution_setting,
        classified_objective: adset.classified_objective,
      })),

      structuralMixedAttribution: campaign.structuralMixedAttribution,
      mixedAttribution: campaign.mixedAttribution,
      mixedAttributionByPeriod: campaign.mixedAttributionByPeriod,
      mixedObjective: campaign.mixedObjective,
      mixedDestination: campaign.mixedDestination,
      globalMetricsByPeriod: campaign.globalMetricsByPeriod,
      attributionGroupsByPeriod: campaign.attributionGroupsByPeriod,
      completenessByPeriod: campaign.completenessByPeriod,
      trendAvailabilityByPeriod: campaign.trendAvailabilityByPeriod,
      trendAvailable: campaign.trendAvailable,
      trendUnavailableReason: campaign.trendUnavailableReason || undefined,

      lastSyncedAt: isPartial ? undefined : attemptedAt,
      lastSyncAttemptAt: attemptedAt,
      lastSyncAttemptRunId: payload.runId,
      lastSyncStatus: payload.status,
      metaStatus: campaign.status,
      metaEffectiveStatus: campaign.effective_status,
      syncRunId: isPartial ? undefined : payload.runId,
      partialSyncRunId: isPartial ? payload.runId : undefined,
      dataIsPartial: isPartial,
      metaMissingFromLatestSync: false,
    };
  });
}
