import { MetaObjective } from "./objectives.ts";
import { classifyAdSetObjective } from './classifier.ts';

export interface MetaAdSetForMixAnalysis {
  id: string;
  attribution_setting?: string | null;
  destination_type?: string | null;
  optimization_goal?: string | null;
  promoted_object?: Record<string, unknown> | null;
  classified_objective?: MetaObjective;
}

export interface MetaAdSetInsightForDelivery {
  adset_id: string;
  spend?: string | number | null;
  impressions?: string | number | null;
  actions?: Array<{ action_type?: string; value?: string | number | null }> | null;
}

export interface CampaignMixAnalysis {
  structuralMixedAttribution: boolean;
  effectiveMixedAttribution: boolean;
  mixedObjective: boolean;
  mixedDestination: boolean;
  attributionSettings: string[];
  effectiveAttributionSettings: string[];
  classifiedObjectives: MetaObjective[];
  effectiveClassifiedObjectives: MetaObjective[];
  destinationTypes: string[];
  deliveringAdsetIds: string[];
}

const uniqueSorted = (values: string[]) => Array.from(new Set(values)).sort();

export function insightHasDelivery(row: MetaAdSetInsightForDelivery): boolean {
  const spend = Number(row.spend || 0);
  const impressions = Number(row.impressions || 0);
  const hasPositiveAction = Array.isArray(row.actions)
    && row.actions.some((action) => Number(action.value || 0) > 0);

  return spend > 0 || impressions > 0 || hasPositiveAction;
}

export function analyzeCampaignMix(
  adSets: MetaAdSetForMixAnalysis[],
  campaignObjective: string,
  adsetInsights: MetaAdSetInsightForDelivery[] = []
): CampaignMixAnalysis {
  const objectivesByAdset = new Map<string, MetaObjective>();
  for (const adset of adSets) {
    objectivesByAdset.set(
      adset.id,
      adset.classified_objective || classifyAdSetObjective({
        campaignObjective,
        adsetOptimizationGoal: adset.optimization_goal || undefined,
        adsetDestinationType: adset.destination_type || undefined,
        adsetPromotedObject: adset.promoted_object,
      })
    );
  }

  const attributionSettings = uniqueSorted(
    adSets.map((adset) => adset.attribution_setting || 'UNKNOWN')
  );
  const classifiedObjectives = uniqueSorted(
    Array.from(objectivesByAdset.values())
  ) as MetaObjective[];
  const destinationTypes = uniqueSorted(
    adSets.map((adset) => adset.destination_type || 'UNKNOWN')
  );

  const deliveringAdsetIds = uniqueSorted(
    adsetInsights.filter(insightHasDelivery).map((row) => row.adset_id)
  );
  const deliveringIds = new Set(deliveringAdsetIds);
  const deliveringAdsets = adSets.filter((adset) => deliveringIds.has(adset.id));
  const effectiveAttributionSettings = uniqueSorted(
    deliveringAdsets.map((adset) => adset.attribution_setting || 'UNKNOWN')
  );
  const effectiveClassifiedObjectives = uniqueSorted(
    deliveringAdsets.map((adset) => objectivesByAdset.get(adset.id) || 'UNCLASSIFIED')
  ) as MetaObjective[];

  return {
    structuralMixedAttribution: attributionSettings.length > 1,
    effectiveMixedAttribution: effectiveAttributionSettings.length > 1,
    mixedObjective: classifiedObjectives.length > 1,
    mixedDestination: destinationTypes.length > 1,
    attributionSettings,
    effectiveAttributionSettings,
    classifiedObjectives,
    effectiveClassifiedObjectives,
    destinationTypes,
    deliveringAdsetIds,
  };
}

// Compatibility wrappers retained for callers while keeping each signal independent.
export function getStructuralMixedAttribution(
  adSets: MetaAdSetForMixAnalysis[],
  campaignObjective: string
): boolean {
  return analyzeCampaignMix(adSets, campaignObjective).structuralMixedAttribution;
}

export function getEffectiveMixedAttribution(
  adSets: MetaAdSetForMixAnalysis[],
  adsetInsights: MetaAdSetInsightForDelivery[],
  campaignObjective = ''
): boolean {
  return analyzeCampaignMix(adSets, campaignObjective, adsetInsights).effectiveMixedAttribution;
}
