import { ClientOperationalProfile } from './clientOperationalProfile';

export interface SuggestedTarget {
  metricId: string;
  suggestedValue: number;
  condition: 'less_than' | 'greater_than';
  confidence: 'low' | 'medium' | 'high';
}

export function buildDefaultTargetsForProfile(profile: ClientOperationalProfile): SuggestedTarget[] {
  const targets: SuggestedTarget[] = [];

  switch (profile.strategyType) {
    case 'venda_site':
      targets.push({
        metricId: 'cost_per_purchase',
        suggestedValue: 50, // valor alto sugerido fallback
        condition: 'less_than',
        confidence: 'low'
      });
      targets.push({
        metricId: 'purchase_roas',
        suggestedValue: 1, // break even fallback
        condition: 'greater_than',
        confidence: 'low'
      });
      break;
    case 'leads_whatsapp':
      targets.push({
        metricId: 'cost_per_messaging_conversation',
        suggestedValue: 15,
        condition: 'less_than',
        confidence: 'low'
      });
      break;
    case 'alcance':
      targets.push({
        metricId: 'frequency',
        suggestedValue: 4, // saturação base
        condition: 'less_than',
        confidence: 'low'
      });
      break;
  }

  return targets;
}
