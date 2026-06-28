export type MetaObjective = 
  | 'WHATSAPP' 
  | 'MESSENGER' 
  | 'INSTAGRAM_DIRECT' 
  | 'MESSAGING_OTHER' 
  | 'SALES' 
  | 'LEADS' 
  | 'TRAFFIC' 
  | 'PROFILE_VISITS' 
  | 'ENGAGEMENT' 
  | 'AWARENESS' 
  | 'VIDEO' 
  | 'APP' 
  | 'OTHER' 
  | 'MIXED'
  | 'UNCLASSIFIED';

export type AggregationRule = 'sum' | 'recalculate' | 'none';
export type FormatterType = 'integer' | 'currency' | 'percentage' | 'decimal';

export interface MetaCanonicalMetric {
  id: string;
  label: string;
  description: string;
  source: 'actions' | 'insights' | 'calculated';
  acceptedActionTypes?: string[];
  aliases?: string[];
  compatibleObjectives: MetaObjective[] | 'ALL';
  aggregationRule: AggregationRule;
  denominator?: string; // e.g. for rates like CTR
  formatter: FormatterType;
  missingDataRule: 'zero' | 'null' | 'unavailable';
  deduplicationRule: 'none' | 'distinct_action_type' | 'priority_alias';
  supportedLevels: ('campaign' | 'adset' | 'ad')[];
  calculate?: (data: MetricValueMap) => number | null;
}

export type MetricValueMap = Record<string, number | undefined>;

export interface AggregateMetricOptions {
  sourceLevel: 'campaign' | 'adset' | 'ad';
  deduplicatedReach?: number;
}

function getConversionCount(data: MetricValueMap): number | undefined {
  return [
    data.purchases,
    data.leads,
    data.whatsapp_conversations_started,
    data.messenger_conversations_started,
    data.instagram_direct_conversations_started,
    data.messaging_conversations_started_generic,
  ].find((value) => value !== undefined);
}

export const METRIC_REGISTRY: Record<string, MetaCanonicalMetric> = {
  spend: {
    id: 'spend',
    label: 'Investimento',
    description: 'Valor gasto na campanha no período selecionado.',
    source: 'insights',
    compatibleObjectives: 'ALL',
    aggregationRule: 'sum',
    formatter: 'currency',
    missingDataRule: 'zero',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  reach: {
    id: 'reach',
    label: 'Alcance',
    description: 'Número estimado de contas que viram seus anúncios.',
    source: 'insights',
    compatibleObjectives: 'ALL',
    aggregationRule: 'none', // Reach should not be summed across campaigns trivially
    formatter: 'integer',
    missingDataRule: 'unavailable',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  impressions: {
    id: 'impressions',
    label: 'Impressões',
    description: 'Número de vezes que seus anúncios foram exibidos.',
    source: 'insights',
    compatibleObjectives: 'ALL',
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  frequency: {
    id: 'frequency',
    label: 'Frequência',
    description: 'Número médio de vezes que cada pessoa viu o anúncio.',
    source: 'calculated',
    compatibleObjectives: 'ALL',
    aggregationRule: 'recalculate',
    denominator: 'reach',
    formatter: 'decimal',
    missingDataRule: 'unavailable',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad'],
    calculate: (data) => (data.reach && data.reach > 0) ? ((data.impressions || 0) / data.reach) : null
  },
  cpm: {
    id: 'cpm',
    label: 'CPM',
    description: 'Custo por 1.000 impressões.',
    source: 'calculated',
    compatibleObjectives: 'ALL',
    aggregationRule: 'recalculate',
    denominator: 'impressions',
    formatter: 'currency',
    missingDataRule: 'unavailable',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad'],
    calculate: (data) => (data.impressions && data.impressions > 0) ? (((data.spend || 0) / data.impressions) * 1000) : null
  },
  link_clicks: {
    id: 'link_clicks',
    label: 'Cliques no link',
    description: 'Cliques que levaram a destinos ou experiências dentro ou fora das tecnologias da Meta.',
    source: 'insights', // can be inline_link_clicks
    compatibleObjectives: 'ALL',
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  link_ctr: {
    id: 'link_ctr',
    label: 'CTR (Taxa de cliques no link)',
    description: 'Porcentagem de vezes que as pessoas viram seu anúncio e clicaram no link.',
    source: 'calculated',
    compatibleObjectives: 'ALL',
    aggregationRule: 'recalculate',
    denominator: 'impressions',
    formatter: 'percentage',
    missingDataRule: 'unavailable',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad'],
    calculate: (data) => (data.impressions && data.impressions > 0) ? ((data.link_clicks || 0) / data.impressions) * 100 : null
  },
  link_cpc: {
    id: 'link_cpc',
    label: 'CPC (Custo por clique no link)',
    description: 'Custo médio por clique no link.',
    source: 'calculated',
    compatibleObjectives: 'ALL',
    aggregationRule: 'recalculate',
    denominator: 'link_clicks',
    formatter: 'currency',
    missingDataRule: 'unavailable',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad'],
    calculate: (data) => (data.link_clicks && data.link_clicks > 0) ? ((data.spend || 0) / data.link_clicks) : null
  },
  cpa: {
    id: 'cpa',
    label: 'CPA',
    description: 'Custo por conversão compatível com o objetivo classificado.',
    source: 'calculated',
    compatibleObjectives: 'ALL',
    aggregationRule: 'recalculate',
    denominator: 'objective_conversion',
    formatter: 'currency',
    missingDataRule: 'unavailable',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad'],
    calculate: (data) => {
      const conversions = getConversionCount(data);
      return conversions && conversions > 0 ? (data.spend || 0) / conversions : null;
    }
  },
  whatsapp_conversations_started: {
    id: 'whatsapp_conversations_started',
    label: 'Conversas no WhatsApp',
    description: 'Número de vezes que as pessoas iniciaram conversas com a sua empresa pelo WhatsApp.',
    source: 'actions',
    acceptedActionTypes: ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d'],
    compatibleObjectives: ['WHATSAPP'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'priority_alias',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  messenger_conversations_started: {
    id: 'messenger_conversations_started',
    label: 'Conversas no Messenger',
    description: 'Número de vezes que as pessoas iniciaram conversas pelo Messenger.',
    source: 'actions',
    acceptedActionTypes: ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d'],
    compatibleObjectives: ['MESSENGER'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'priority_alias',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  instagram_direct_conversations_started: {
    id: 'instagram_direct_conversations_started',
    label: 'Conversas no Instagram',
    description: 'Número de vezes que as pessoas iniciaram conversas pelo Instagram Direct.',
    source: 'actions',
    acceptedActionTypes: ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d'],
    compatibleObjectives: ['INSTAGRAM_DIRECT'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'priority_alias',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  messaging_conversations_started_generic: {
    id: 'messaging_conversations_started_generic',
    label: 'Conversas Iniciadas',
    description: 'Conversas iniciadas em destino não classificado.',
    source: 'actions',
    acceptedActionTypes: ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d'],
    compatibleObjectives: ['MESSAGING_OTHER'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'priority_alias',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  purchases: {
    id: 'purchases',
    label: 'Compras',
    description: 'O número de eventos de compras rastreados pelo pixel ou API de conversão.',
    source: 'actions',
    acceptedActionTypes: ['purchase', 'omni_purchase'],
    compatibleObjectives: ['SALES', 'TRAFFIC'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'priority_alias',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  purchase_value: {
    id: 'purchase_value',
    label: 'Valor de conversão',
    description: 'Valor total retornado pelo evento de compra.',
    source: 'actions', // Will be extracted from action_values
    acceptedActionTypes: ['purchase', 'omni_purchase'],
    compatibleObjectives: ['SALES'],
    aggregationRule: 'sum',
    formatter: 'currency',
    missingDataRule: 'zero',
    deduplicationRule: 'priority_alias',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  purchase_roas: {
    id: 'purchase_roas',
    label: 'ROAS',
    description: 'Retorno do Investimento em Anúncios (ROAS) de Compras.',
    source: 'calculated', // Calculate instead of trusting API array to avoid misattribution sums
    compatibleObjectives: ['SALES'],
    aggregationRule: 'recalculate',
    denominator: 'spend',
    formatter: 'decimal',
    missingDataRule: 'unavailable',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad'],
    calculate: (data) => (data.spend && data.spend > 0 && data.purchase_value !== undefined)
      ? (data.purchase_value / data.spend)
      : null
  },
  leads: {
    id: 'leads',
    label: 'Leads',
    description: 'O número de eventos de cadastro.',
    source: 'actions',
    acceptedActionTypes: ['lead', 'omni_lead'],
    compatibleObjectives: ['LEADS'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'priority_alias',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  landing_page_views: {
    id: 'landing_page_views',
    label: 'Visitas à Página',
    description: 'O número de visualizações da página de destino rastreadas.',
    source: 'actions',
    acceptedActionTypes: ['landing_page_view'],
    compatibleObjectives: ['TRAFFIC', 'SALES', 'LEADS'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'unavailable',
    deduplicationRule: 'priority_alias',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  page_load_rate: {
    id: 'page_load_rate',
    label: 'Taxa de Carregamento',
    description: 'Visitas à Página sobre Cliques no Link.',
    source: 'calculated',
    compatibleObjectives: ['TRAFFIC', 'SALES'],
    aggregationRule: 'recalculate',
    denominator: 'link_clicks',
    formatter: 'percentage',
    missingDataRule: 'unavailable',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad'],
    calculate: (data) => (data.link_clicks && data.link_clicks > 0) ? (data.landing_page_views || 0) / data.link_clicks * 100 : null
  },
  profile_visits: {
    id: 'profile_visits',
    label: 'Visitas ao Perfil',
    description: 'Visitas ao perfil do Instagram associadas ao anúncio.',
    source: 'actions',
    acceptedActionTypes: ['onsite_conversion.profile_visit'],
    compatibleObjectives: ['PROFILE_VISITS'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'unavailable', // Do not default to 0 if API does not return this metric
    deduplicationRule: 'priority_alias',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  video_views: {
    id: 'video_views',
    label: 'Visualizações de Vídeo (3s)',
    description: 'Número de vezes que o vídeo foi reproduzido por pelo menos 3 segundos.',
    source: 'actions',
    acceptedActionTypes: ['video_view'],
    compatibleObjectives: ['VIDEO', 'ENGAGEMENT', 'AWARENESS'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad']
  },
  thru_plays: {
    id: 'thru_plays',
    label: 'ThruPlays',
    description: 'Reproduções completas ou de pelo menos 15 segundos.',
    source: 'actions',
    acceptedActionTypes: ['video_view_thru_play'],
    compatibleObjectives: ['VIDEO', 'ENGAGEMENT'],
    aggregationRule: 'sum',
    formatter: 'integer',
    missingDataRule: 'zero',
    deduplicationRule: 'none',
    supportedLevels: ['campaign', 'adset', 'ad']
  }
};

export function aggregateCompatibleMetrics(
  metricSets: MetricValueMap[],
  options: AggregateMetricOptions
): MetricValueMap {
  const aggregate: MetricValueMap = {};

  for (const [metricId, definition] of Object.entries(METRIC_REGISTRY)) {
    if (definition.aggregationRule !== 'sum') continue;
    const values = metricSets
      .map((metrics) => metrics[metricId])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length > 0) aggregate[metricId] = values.reduce((total, value) => total + value, 0);
  }

  if (
    options.sourceLevel === 'campaign'
    && typeof options.deduplicatedReach === 'number'
    && Number.isFinite(options.deduplicatedReach)
  ) {
    aggregate.reach = options.deduplicatedReach;
  }

  for (const [metricId, definition] of Object.entries(METRIC_REGISTRY)) {
    if (definition.aggregationRule !== 'recalculate' || !definition.calculate) continue;
    if (metricId === 'frequency' && options.sourceLevel !== 'campaign') continue;
    const value = definition.calculate(aggregate);
    if (value !== null && Number.isFinite(value)) aggregate[metricId] = value;
  }

  return aggregate;
}
