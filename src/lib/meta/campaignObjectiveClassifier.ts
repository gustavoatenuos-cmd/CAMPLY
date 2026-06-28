import { MetaObjective } from './metricRegistry';

export interface ClassifierEntityContext {
  campaignObjective: string;
  adsetOptimizationGoal?: string;
  adsetDestinationType?: string;
  adsetPromotedObject?: Record<string, unknown> | null;
  availableActionTypes?: string[];
}

export function classifyCampaignObjective(context: ClassifierEntityContext): MetaObjective {
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
  if (obj === 'OUTCOME_SALES' || obj === 'CONVERSIONS' || obj === 'PRODUCT_CATALOG_SALES') {
    return 'SALES';
  }

  // 3. LEADS (Web/Forms)
  if (obj === 'OUTCOME_LEADS' || obj === 'LEAD_GENERATION') {
    // If it wasn't caught by the messaging check above
    return 'LEADS';
  }

  // 4. TRAFFIC
  if (destType === 'INSTAGRAM_PROFILE' || optGoal === 'PROFILE_VISITS') {
    return 'PROFILE_VISITS';
  }

  if (obj === 'OUTCOME_TRAFFIC' || obj === 'LINK_CLICKS') {
    return 'TRAFFIC';
  }

  

  // 6. ENGAGEMENT
  if (obj === 'OUTCOME_ENGAGEMENT' || obj === 'POST_ENGAGEMENT' || obj === 'PAGE_LIKES' || obj === 'EVENT_RESPONSES') {
    return 'ENGAGEMENT';
  }

  // 7. AWARENESS
  if (obj === 'OUTCOME_AWARENESS' || obj === 'BRAND_AWARENESS' || obj === 'REACH') {
    return 'AWARENESS';
  }

  // 8. VIDEO
  if (obj === 'VIDEO_VIEWS') {
    return 'VIDEO';
  }

  // 9. APP
  if (obj === 'OUTCOME_APP_PROMOTION' || obj === 'APP_INSTALLS') {
    return 'APP';
  }

  return 'UNCLASSIFIED';
}
