import { ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';

export type StrategyType = 'venda_site' | 'leads_whatsapp' | 'alcance' | 'loja_fisica' | 'misto';
export type PrimaryConversion = 'compras' | 'conversas_whatsapp' | 'alcance';

export interface ClientOperationalProfile {
  clientId: string;
  strategyType: StrategyType;
  primaryConversion: PrimaryConversion;
  trackedMetrics: string[];
  budgetPeriod: 'daily' | 'weekly' | 'monthly';
  plannedBudget: number | null;
  analysisEnabled: boolean;
}

export function resolvePrimaryConversion(profile: ClientAnalysisProfile): PrimaryConversion {
  const metric = profile.primaryConversionMetric || '';
  
  const purchasesMetrics = ['purchases', 'cost_per_purchase', 'purchase_roas', 'purchase_value', 'compra_site', 'compra_checkout'];
  if (purchasesMetrics.includes(metric)) {
    return 'compras';
  }

  const leadsMetrics = ['messaging_conversations_started_total', 'cost_per_messaging_conversation', 'conversa_iniciada', 'whatsapp', 'leads', 'cost_per_lead'];
  if (leadsMetrics.includes(metric)) {
    return 'conversas_whatsapp';
  }

  const reachMetrics = ['reach', 'impressions', 'cpm', 'alcance'];
  if (reachMetrics.includes(metric) || profile.operationType === 'alcance' || profile.businessModel === 'alcance') {
    return 'alcance';
  }

  // Fallback default
  return 'conversas_whatsapp';
}

export function resolveStrategyType(profile: ClientAnalysisProfile): StrategyType {
  const primary = resolvePrimaryConversion(profile);
  
  if (profile.operationType === 'loja_fisica' || profile.businessModel === 'loja_fisica') {
    return 'loja_fisica';
  }

  if (profile.operationType === 'misto' || profile.businessModel === 'misto' || (profile.secondaryMetrics && profile.secondaryMetrics.length > 2)) {
    return 'misto';
  }

  if (primary === 'compras') return 'venda_site';
  if (primary === 'alcance') return 'alcance';
  
  return 'leads_whatsapp';
}

export function toOperationalProfile(profile: ClientAnalysisProfile): ClientOperationalProfile {
  return {
    clientId: profile.clientId,
    strategyType: resolveStrategyType(profile),
    primaryConversion: resolvePrimaryConversion(profile),
    trackedMetrics: [profile.primaryConversionMetric, ...(profile.secondaryMetrics || [])].filter(Boolean) as string[],
    budgetPeriod: profile.budgetPeriod,
    plannedBudget: profile.plannedBudget,
    analysisEnabled: profile.analysisEnabled,
  };
}
