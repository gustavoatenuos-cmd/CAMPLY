import { MetaObjective } from "./objectives.ts";

export interface ClassifierEntityContext {
  campaignObjective: string;
  adsetOptimizationGoal?: string;
  adsetDestinationType?: string;
  adsetPromotedObject?: Record<string, unknown> | null;
  availableActionTypes?: string[];
}

export function classifyAdSetObjective(context: ClassifierEntityContext): MetaObjective {
  const obj = context.campaignObjective?.toUpperCase() || '';
  const optGoal = context.adsetOptimizationGoal?.toUpperCase() || '';
  const destType = context.adsetDestinationType?.toUpperCase() || '';

  // 1. MESSAGING
  if (obj === 'OUTCOME_LEADS' || obj === 'OUTCOME_ENGAGEMENT' || obj === 'MESSAGES') {
    if (
      optGoal === 'CONVERSATIONS' || 
      destType.includes('MESSENGER') || 
      destType.includes('WHATSAPP') || 
      destType.includes('INSTAGRAM_DIRECT') ||
      (context.availableActionTypes && context.availableActionTypes.some(t => t.includes('messaging_conversation_started_7d')))
    ) {
      if (destType === 'WHATSAPP' || (context.adsetPromotedObject?.whatsapp_number)) {
        return 'WHATSAPP';
      }
      if (destType === 'INSTAGRAM_DIRECT') {
        return 'INSTAGRAM_DIRECT';
      }
      if (destType === 'MESSENGER') {
        return 'MESSENGER';
      }
      return 'MESSAGING_OTHER';
    }
  }

  // 2. SALES
  if (optGoal === 'OFFSITE_CONVERSIONS' || obj === 'OUTCOME_SALES' || obj === 'CONVERSIONS' || obj === 'PRODUCT_CATALOG_SALES') {
    // If adset explicitly overrides to leads, respect it
    if (optGoal === 'LEAD_GENERATION') {
        return 'LEADS';
    }
    return 'SALES';
  }

  // 3. LEADS (Web/Forms)
  if (optGoal === 'LEAD_GENERATION' || obj === 'OUTCOME_LEADS') {
    return 'LEADS';
  }

  // 4. TRAFFIC
  if (destType === 'INSTAGRAM_PROFILE' || optGoal === 'PROFILE_VISITS') {
    return 'PROFILE_VISITS';
  }

  if (optGoal === 'LINK_CLICKS' || obj === 'OUTCOME_TRAFFIC') {
    return 'TRAFFIC';
  }

  // 6. ENGAGEMENT
  if (optGoal === 'POST_ENGAGEMENT' || optGoal === 'PAGE_LIKES' || optGoal === 'EVENT_RESPONSES' || obj === 'OUTCOME_ENGAGEMENT' || obj === 'POST_ENGAGEMENT' || obj === 'PAGE_LIKES' || obj === 'EVENT_RESPONSES') {
    return 'ENGAGEMENT';
  }

  // 7. AWARENESS
  if (optGoal === 'REACH' || optGoal === 'BRAND_AWARENESS' || obj === 'OUTCOME_AWARENESS' || obj === 'BRAND_AWARENESS' || obj === 'REACH') {
    return 'AWARENESS';
  }

  // 8. VIDEO
  if (optGoal === 'VIDEO_VIEWS' || obj === 'VIDEO_VIEWS') {
    return 'VIDEO';
  }

  // 9. APP
  if (optGoal === 'APP_INSTALLS' || obj === 'OUTCOME_APP_PROMOTION' || obj === 'APP_INSTALLS') {
    return 'APP';
  }

  return 'UNCLASSIFIED';
}

export function classifyCampaignObjective(contexts: ClassifierEntityContext[]): MetaObjective {
  if (!contexts || contexts.length === 0) {
    return 'UNCLASSIFIED';
  }

  const validClassifications = new Set<MetaObjective>();

  for (const ctx of contexts) {
    const classification = classifyAdSetObjective(ctx);
    if (classification !== 'UNCLASSIFIED') {
      validClassifications.add(classification);
    }
  }

  if (validClassifications.size === 0) {
    return 'UNCLASSIFIED';
  }

  if (validClassifications.size === 1) {
    return Array.from(validClassifications)[0];
  }

  return 'MIXED';
}
