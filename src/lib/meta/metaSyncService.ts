import { supabase } from '../supabase';
import { normalizeMetaMetrics } from './metaNormalizer';
import { classifyCampaignObjective, ClassifierEntityContext } from './campaignObjectiveClassifier';

export async function processAndSaveSyncPayload(syncPayload: any, adAccountId: string) {
  const { runId, campaigns } = syncPayload;

  const normalizedCampaigns = [];

  for (const campaign of campaigns) {
    let campaignClassifiedObjective = campaign.classifiedObjective || 'UNCLASSIFIED';

    // If backend didn't classify it, try to classify it using the first active adset
    if (campaignClassifiedObjective === 'UNCLASSIFIED' && campaign.classifiedAdsets && campaign.classifiedAdsets.length > 0) {
      campaignClassifiedObjective = campaign.classifiedAdsets[0].classified_objective;
    }

    const normalizedMetricsByPeriod: Record<string, Record<string, number>> = {};

    for (const [period, insights] of Object.entries(campaign.insightsByPeriod || {})) {
      if (!insights) continue;

      const rawInsightsArray = Array.isArray(insights) ? insights : [insights];
      
      const normalized = normalizeMetaMetrics(
        rawInsightsArray,
        campaignClassifiedObjective,
        campaign.id
      );

      normalizedMetricsByPeriod[period] = normalized;
      
      
    }

    normalizedCampaigns.push({
      ...campaign,
      classifiedObjective: campaignClassifiedObjective,
      normalizedMetricsByPeriod
    });
  }

  return normalizedCampaigns;
}
