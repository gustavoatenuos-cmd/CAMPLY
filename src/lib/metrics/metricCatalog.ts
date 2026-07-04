export const canonicalMetricIds = [
  'spend', 'impressions', 'reach', 'frequency', 'cpm', 'link_clicks', 'link_ctr',
  'link_cpc', 'landing_page_views', 'cost_per_landing_page_view',
  'messaging_conversations_started_total', 'cost_per_messaging_conversation',
  'leads', 'cost_per_lead', 'registrations', 'cost_per_registration', 'purchases',
  'cost_per_purchase', 'purchase_value', 'purchase_roas',
] as const;

export type CanonicalMetricId = typeof canonicalMetricIds[number];
export type MetricUnit = 'currency' | 'percentage' | 'number' | 'ratio';
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'target_range' | 'neutral';
export type PrimaryObjective = 'whatsapp_messages' | 'leads' | 'registrations' | 'sales' | 'website_sales';

export interface MetricDefinition {
  metricId: CanonicalMetricId;
  label: string;
  description: string;
  unit: MetricUnit;
  category: 'delivery' | 'traffic' | 'conversion' | 'revenue';
  direction: MetricDirection;
  supportedObjectives: readonly PrimaryObjective[] | 'all';
  availability: 'account_and_campaign' | 'account_only' | 'campaign_only';
}

const all: MetricDefinition['supportedObjectives'] = 'all';
const commerce: readonly PrimaryObjective[] = ['sales', 'website_sales'];

export const metricCatalog: Record<CanonicalMetricId, MetricDefinition> = {
  spend: { metricId: 'spend', label: 'Investimento', description: 'Valor investido no período.', unit: 'currency', category: 'delivery', direction: 'neutral', supportedObjectives: all, availability: 'account_and_campaign' },
  impressions: { metricId: 'impressions', label: 'Impressões', description: 'Exibições dos anúncios.', unit: 'number', category: 'delivery', direction: 'higher_is_better', supportedObjectives: all, availability: 'account_and_campaign' },
  reach: { metricId: 'reach', label: 'Alcance', description: 'Pessoas alcançadas.', unit: 'number', category: 'delivery', direction: 'higher_is_better', supportedObjectives: all, availability: 'account_and_campaign' },
  frequency: { metricId: 'frequency', label: 'Frequência', description: 'Média de exibições por pessoa.', unit: 'ratio', category: 'delivery', direction: 'target_range', supportedObjectives: all, availability: 'account_and_campaign' },
  cpm: { metricId: 'cpm', label: 'CPM', description: 'Custo por mil impressões.', unit: 'currency', category: 'delivery', direction: 'lower_is_better', supportedObjectives: all, availability: 'account_and_campaign' },
  link_clicks: { metricId: 'link_clicks', label: 'Cliques no link', description: 'Cliques em links do anúncio.', unit: 'number', category: 'traffic', direction: 'higher_is_better', supportedObjectives: all, availability: 'account_and_campaign' },
  link_ctr: { metricId: 'link_ctr', label: 'CTR de link', description: 'Taxa de cliques em links.', unit: 'percentage', category: 'traffic', direction: 'higher_is_better', supportedObjectives: all, availability: 'account_and_campaign' },
  link_cpc: { metricId: 'link_cpc', label: 'CPC de link', description: 'Custo por clique em link.', unit: 'currency', category: 'traffic', direction: 'lower_is_better', supportedObjectives: all, availability: 'account_and_campaign' },
  landing_page_views: { metricId: 'landing_page_views', label: 'Landing page views', description: 'Carregamentos da página de destino.', unit: 'number', category: 'traffic', direction: 'higher_is_better', supportedObjectives: all, availability: 'account_and_campaign' },
  cost_per_landing_page_view: { metricId: 'cost_per_landing_page_view', label: 'Custo por LPV', description: 'Custo por carregamento da página.', unit: 'currency', category: 'traffic', direction: 'lower_is_better', supportedObjectives: all, availability: 'account_and_campaign' },
  messaging_conversations_started_total: { metricId: 'messaging_conversations_started_total', label: 'Conversas iniciadas', description: 'Conversas atribuídas iniciadas.', unit: 'number', category: 'conversion', direction: 'higher_is_better', supportedObjectives: ['whatsapp_messages'], availability: 'account_and_campaign' },
  cost_per_messaging_conversation: { metricId: 'cost_per_messaging_conversation', label: 'Custo por conversa', description: 'Custo por conversa iniciada.', unit: 'currency', category: 'conversion', direction: 'lower_is_better', supportedObjectives: ['whatsapp_messages'], availability: 'account_and_campaign' },
  leads: { metricId: 'leads', label: 'Leads', description: 'Leads atribuídos.', unit: 'number', category: 'conversion', direction: 'higher_is_better', supportedObjectives: ['leads'], availability: 'account_and_campaign' },
  cost_per_lead: { metricId: 'cost_per_lead', label: 'Custo por lead', description: 'Custo médio por lead.', unit: 'currency', category: 'conversion', direction: 'lower_is_better', supportedObjectives: ['leads'], availability: 'account_and_campaign' },
  registrations: { metricId: 'registrations', label: 'Cadastros', description: 'Cadastros atribuídos.', unit: 'number', category: 'conversion', direction: 'higher_is_better', supportedObjectives: ['registrations'], availability: 'account_and_campaign' },
  cost_per_registration: { metricId: 'cost_per_registration', label: 'Custo por cadastro', description: 'Custo médio por cadastro.', unit: 'currency', category: 'conversion', direction: 'lower_is_better', supportedObjectives: ['registrations'], availability: 'account_and_campaign' },
  purchases: { metricId: 'purchases', label: 'Compras', description: 'Compras atribuídas.', unit: 'number', category: 'conversion', direction: 'higher_is_better', supportedObjectives: commerce, availability: 'account_and_campaign' },
  cost_per_purchase: { metricId: 'cost_per_purchase', label: 'Custo por compra', description: 'Custo médio por compra.', unit: 'currency', category: 'conversion', direction: 'lower_is_better', supportedObjectives: commerce, availability: 'account_and_campaign' },
  purchase_value: { metricId: 'purchase_value', label: 'Valor de compras', description: 'Receita atribuída.', unit: 'currency', category: 'revenue', direction: 'higher_is_better', supportedObjectives: commerce, availability: 'account_and_campaign' },
  purchase_roas: { metricId: 'purchase_roas', label: 'ROAS', description: 'Retorno sobre investimento.', unit: 'ratio', category: 'revenue', direction: 'higher_is_better', supportedObjectives: commerce, availability: 'account_and_campaign' },
};

const safeAliases: Record<string, CanonicalMetricId> = {
  spent: 'spend', ctr: 'link_ctr', cpc: 'link_cpc', roas: 'purchase_roas', pageViews: 'landing_page_views',
};
const ambiguousAliases = new Set(['cpa', 'cpr', 'results']);

export type MetricResolution =
  | { status: 'resolved'; metricId: CanonicalMetricId; source: 'canonical' | 'safe_alias' }
  | { status: 'insufficient_context'; metricId: null; source: 'ambiguous_alias' }
  | { status: 'unavailable'; metricId: null; source: 'unknown' };

export function resolveMetricId(value: string): MetricResolution {
  if (canonicalMetricIds.includes(value as CanonicalMetricId)) return { status: 'resolved', metricId: value as CanonicalMetricId, source: 'canonical' };
  if (safeAliases[value]) return { status: 'resolved', metricId: safeAliases[value], source: 'safe_alias' };
  if (ambiguousAliases.has(value)) return { status: 'insufficient_context', metricId: null, source: 'ambiguous_alias' };
  return { status: 'unavailable', metricId: null, source: 'unknown' };
}

export function isCanonicalMetricId(value: string): value is CanonicalMetricId {
  return canonicalMetricIds.includes(value as CanonicalMetricId);
}

