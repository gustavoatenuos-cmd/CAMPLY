import { StrategyType } from './clientOperationalProfile';

export interface MetricStrategy {
  strategyType: StrategyType;
  mainMetrics: string[];
  secondaryMetrics: string[];
}

export const metricStrategies: Record<StrategyType, MetricStrategy> = {
  venda_site: {
    strategyType: 'venda_site',
    mainMetrics: ['purchases'],
    secondaryMetrics: [
      'cost_per_purchase',
      'purchase_roas',
      'purchase_value',
      'spend',
      'link_clicks',
      'cpm',
      'link_ctr'
    ]
  },
  leads_whatsapp: {
    strategyType: 'leads_whatsapp',
    mainMetrics: ['messaging_conversations_started_total'],
    secondaryMetrics: [
      'cost_per_messaging_conversation',
      'spend',
      'cpm',
      'link_ctr',
      'frequency'
    ]
  },
  alcance: {
    strategyType: 'alcance',
    mainMetrics: ['reach'],
    secondaryMetrics: [
      'impressions',
      'frequency',
      'cpm',
      'spend'
    ]
  },
  loja_fisica: {
    strategyType: 'loja_fisica',
    // Pode variar no adapter principal, mas por default usamos conversas
    mainMetrics: ['messaging_conversations_started_total'],
    secondaryMetrics: [
      'cost_per_messaging_conversation',
      'reach',
      'impressions',
      'cpm',
      'frequency',
      'spend'
    ]
  },
  misto: {
    strategyType: 'misto',
    // Misto usará as métricas tracking do perfil
    mainMetrics: [],
    secondaryMetrics: []
  }
};

export function getStrategyMetrics(strategyType: StrategyType): MetricStrategy {
  return metricStrategies[strategyType] || metricStrategies.misto;
}
