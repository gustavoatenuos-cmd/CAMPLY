import { classifyAdSetObjective } from './campaignObjectiveClassifier.ts';

export function getStructuralMixedAttribution(adSets: any[], campaignObjective: string): boolean {
  if (adSets.length <= 1) return false;
  
  const attributions = new Set<string>();
  const validAttributions = new Set<string>();
  const objectives = new Set<string>();
  const destinations = new Set<string>();
  
  for (const a of adSets) {
    const attr = a.attribution_setting || 'UNKNOWN';
    attributions.add(attr);
    if (attr !== 'UNKNOWN') validAttributions.add(attr);
    
    if (a.destination_type) destinations.add(a.destination_type);

    const obj = classifyAdSetObjective({
      campaignObjective,
      adsetOptimizationGoal: a.optimization_goal,
      adsetDestinationType: a.destination_type,
      adsetPromotedObject: a.promoted_object
    });
    objectives.add(obj);
  }
  
  if (validAttributions.size > 1) return true;
  if (validAttributions.size === 1 && attributions.has('UNKNOWN')) return true;
  if (objectives.size > 1) return true;
  if (destinations.size > 1) return true;
  
  return false;
}

export function getEffectiveMixedAttribution(adSets: any[], adsetInsights: any[]): boolean {
  // Check delivery
  const deliveringAdSetIds = new Set<string>();
  
  for (const row of adsetInsights) {
    const spend = Number(row.spend || 0);
    const imp = Number(row.impressions || 0);
    const actionsCount = Array.isArray(row.actions) ? row.actions.length : 0;
    
    if (spend > 0 || imp > 0 || actionsCount > 0) {
      deliveringAdSetIds.add(row.adset_id);
    }
  }
  
  const deliveringAdSets = adSets.filter(a => deliveringAdSetIds.has(a.id));
  
  // If only one (or zero) adset delivered, it's not effectively mixed
  if (deliveringAdSets.length <= 1) {
    return false;
  }
  
  // Re-run structural logic on delivering adsets only
  const attributions = new Set<string>();
  const validAttributions = new Set<string>();
  
  for (const a of deliveringAdSets) {
    const attr = a.attribution_setting || 'UNKNOWN';
    attributions.add(attr);
    if (attr !== 'UNKNOWN') validAttributions.add(attr);
  }
  
  if (validAttributions.size > 1) return true;
  if (validAttributions.size === 1 && attributions.has('UNKNOWN')) return true;
  
  // NOTE: If objectives or destination_types differ among delivering adsets, it's mixed
  const objectives = new Set<string>();
  for (const a of deliveringAdSets) {
    objectives.add(a.classified_objective);
  }
  if (objectives.size > 1) return true;
  
  return false;
}
