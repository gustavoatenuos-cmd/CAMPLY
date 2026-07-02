import { supabase } from '../supabase';
import { isMetaE2EMode } from '../meta/metaE2ERuntime';

export const analysisVerticals = [
  'Saúde',
  'Alimentação',
  'Varejo local',
  'Serviços locais',
  'E-commerce',
  'Imobiliário',
  'Educação',
  'Outros',
] as const;

export const businessModels = [
  'negócio local',
  'delivery',
  'geração de leads',
  'venda pelo WhatsApp',
  'venda pelo site',
  'e-commerce',
  'modelo misto',
] as const;

export const primaryChannels = [
  'WhatsApp',
  'Site',
  'Loja física',
  'Messenger',
  'Instagram Direct',
  'Telefone',
  'Misto',
] as const;

export const primaryConversionMetrics = [
  'messaging_conversations_started_total',
  'leads',
  'purchases',
  'landing_page_views',
  'link_clicks',
] as const;

export const profileMetricOptions = [
  'cost_per_messaging_conversation',
  'messaging_conversations_started_total',
  'leads',
  'cost_per_lead',
  'purchases',
  'cost_per_purchase',
  'purchase_roas',
  'purchase_value',
  'cpm',
  'link_ctr',
  'link_cpc',
  'frequency',
  'landing_page_views',
  'link_clicks',
  'spend',
] as const;

export type AnalysisVertical = typeof analysisVerticals[number] | string;
export type BusinessModel = typeof businessModels[number] | string;
export type PrimaryChannel = typeof primaryChannels[number] | string;
export type PrimaryConversionMetric = typeof primaryConversionMetrics[number] | string;
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

export interface ClientAnalysisProfile {
  userId?: string;
  clientId: string;
  vertical: AnalysisVertical;
  subsegment: string;
  customVertical: string | null;
  customSubsegment: string | null;
  businessModel: BusinessModel;
  primaryConversionMetric: PrimaryConversionMetric;
  secondaryMetrics: string[];
  primaryChannel: PrimaryChannel;
  budgetPeriod: BudgetPeriod;
  plannedBudget: number | null;
  minimumEvaluationSpend: number;
  minimumImpressions: number;
  minimumResults: number;
  attributionDelayHours: number;
  analysisEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AnalysisTemplate {
  id: string;
  label: string;
  vertical: AnalysisVertical;
  subsegment: string;
  businessModel: BusinessModel;
  primaryConversionMetric: PrimaryConversionMetric;
  secondaryMetrics: string[];
  primaryChannel: PrimaryChannel;
  budgetPeriod: BudgetPeriod;
}

export const subsegmentsByVertical: Record<string, string[]> = {
  Saúde: ['Odontologia', 'Estética', 'Clínica médica', 'Outros'],
  Alimentação: ['Delivery', 'Restaurante', 'Produto alimentício', 'Outros'],
  'Varejo local': ['Calçados', 'Vestuário', 'Produtos físicos', 'Loja especializada', 'Outros'],
  'Serviços locais': ['Beleza', 'Manutenção', 'Consultoria local', 'Outros'],
  'E-commerce': ['Produtos físicos', 'Infoproduto', 'Assinatura', 'Outros'],
  Imobiliário: ['Captação de leads', 'Venda direta', 'Lançamento', 'Outros'],
  Educação: ['Curso presencial', 'Curso online', 'Escola local', 'Outros'],
  Outros: ['Outros'],
};

export const analysisTemplates: AnalysisTemplate[] = [
  {
    id: 'clinica-odontologica',
    label: 'Clínica odontológica',
    vertical: 'Saúde',
    subsegment: 'Odontologia',
    businessModel: 'negócio local',
    primaryConversionMetric: 'messaging_conversations_started_total',
    secondaryMetrics: ['cost_per_messaging_conversation', 'cpm', 'link_ctr', 'frequency', 'spend'],
    primaryChannel: 'WhatsApp',
    budgetPeriod: 'monthly',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    vertical: 'Alimentação',
    subsegment: 'Delivery',
    businessModel: 'delivery',
    primaryConversionMetric: 'purchases',
    secondaryMetrics: ['cost_per_purchase', 'purchase_roas', 'purchase_value', 'cpm', 'frequency', 'spend'],
    primaryChannel: 'Site',
    budgetPeriod: 'weekly',
  },
  {
    id: 'loja-calcados',
    label: 'Loja local de calçados',
    vertical: 'Varejo local',
    subsegment: 'Calçados',
    businessModel: 'venda pelo WhatsApp',
    primaryConversionMetric: 'messaging_conversations_started_total',
    secondaryMetrics: ['cost_per_messaging_conversation', 'purchases', 'purchase_roas', 'landing_page_views', 'link_ctr', 'frequency'],
    primaryChannel: 'WhatsApp',
    budgetPeriod: 'weekly',
  },
  {
    id: 'produtos-fisicos',
    label: 'Loja de produtos físicos',
    vertical: 'Varejo local',
    subsegment: 'Produtos físicos',
    businessModel: 'modelo misto',
    primaryConversionMetric: 'purchases',
    secondaryMetrics: ['cost_per_purchase', 'cpm', 'link_ctr', 'landing_page_views', 'spend'],
    primaryChannel: 'Misto',
    budgetPeriod: 'monthly',
  },
];

export const metricLabels: Record<string, string> = {
  messaging_conversations_started_total: 'Conversas iniciadas',
  cost_per_messaging_conversation: 'Custo por conversa',
  leads: 'Leads',
  cost_per_lead: 'CPL',
  purchases: 'Compras',
  cost_per_purchase: 'CPA',
  purchase_roas: 'ROAS',
  purchase_value: 'Valor de compras',
  cpm: 'CPM',
  link_ctr: 'CTR de link',
  link_cpc: 'CPC',
  frequency: 'Frequência',
  landing_page_views: 'Landing page views',
  link_clicks: 'Cliques no link',
  spend: 'Investimento',
};

export function defaultAnalysisProfile(clientId: string, seed?: Partial<ClientAnalysisProfile>): ClientAnalysisProfile {
  const template = analysisTemplates.find((item) => (
    item.vertical === seed?.vertical
    || item.subsegment === seed?.subsegment
  )) ?? analysisTemplates[0];

  return {
    clientId,
    vertical: seed?.vertical || template.vertical,
    subsegment: seed?.subsegment || template.subsegment,
    customVertical: seed?.customVertical ?? null,
    customSubsegment: seed?.customSubsegment ?? null,
    businessModel: seed?.businessModel || template.businessModel,
    primaryConversionMetric: seed?.primaryConversionMetric || template.primaryConversionMetric,
    secondaryMetrics: seed?.secondaryMetrics?.length ? seed.secondaryMetrics : template.secondaryMetrics,
    primaryChannel: seed?.primaryChannel || template.primaryChannel,
    budgetPeriod: seed?.budgetPeriod || template.budgetPeriod,
    plannedBudget: seed?.plannedBudget ?? null,
    minimumEvaluationSpend: seed?.minimumEvaluationSpend ?? 0,
    minimumImpressions: seed?.minimumImpressions ?? 0,
    minimumResults: seed?.minimumResults ?? 0,
    attributionDelayHours: seed?.attributionDelayHours ?? 24,
    analysisEnabled: seed?.analysisEnabled ?? true,
  };
}

export function mapClientProfileRow(row: Record<string, unknown>): ClientAnalysisProfile {
  return {
    userId: typeof row.user_id === 'string' ? row.user_id : undefined,
    clientId: String(row.client_id ?? ''),
    vertical: String(row.vertical ?? 'Outros'),
    subsegment: String(row.subsegment ?? 'Outros'),
    customVertical: typeof row.custom_vertical === 'string' && row.custom_vertical.trim() ? row.custom_vertical : null,
    customSubsegment: typeof row.custom_subsegment === 'string' && row.custom_subsegment.trim() ? row.custom_subsegment : null,
    businessModel: String(row.business_model ?? 'modelo misto'),
    primaryConversionMetric: String(row.primary_conversion_metric ?? 'messaging_conversations_started_total'),
    secondaryMetrics: Array.isArray(row.secondary_metrics) ? row.secondary_metrics.filter((item): item is string => typeof item === 'string') : [],
    primaryChannel: String(row.primary_channel ?? 'Misto'),
    budgetPeriod: (row.budget_period === 'daily' || row.budget_period === 'weekly' || row.budget_period === 'monthly') ? row.budget_period : 'monthly',
    plannedBudget: typeof row.planned_budget === 'number' ? row.planned_budget : row.planned_budget == null ? null : Number(row.planned_budget),
    minimumEvaluationSpend: Number(row.minimum_evaluation_spend ?? 0),
    minimumImpressions: Number(row.minimum_impressions ?? 0),
    minimumResults: Number(row.minimum_results ?? 0),
    attributionDelayHours: Number(row.attribution_delay_hours ?? 24),
    analysisEnabled: row.analysis_enabled !== false,
    createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

export async function loadClientAnalysisProfile(clientId: string): Promise<ClientAnalysisProfile | null> {
  if (isMetaE2EMode && typeof window !== 'undefined') {
    try {
      const profiles = JSON.parse(window.sessionStorage.getItem('camply:meta-e2e:analysis-profiles') || '{}') as Record<string, ClientAnalysisProfile>;
      return profiles[clientId] ?? null;
    } catch {
      return null;
    }
  }
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('client_analysis_profiles')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error('Não foi possível carregar o perfil de análise do cliente.');
  return data ? mapClientProfileRow(data as Record<string, unknown>) : null;
}

export async function upsertClientAnalysisProfile(profile: ClientAnalysisProfile): Promise<ClientAnalysisProfile> {
  if (isMetaE2EMode && typeof window !== 'undefined') {
    let profiles: Record<string, ClientAnalysisProfile> = {};
    try {
      profiles = JSON.parse(window.sessionStorage.getItem('camply:meta-e2e:analysis-profiles') || '{}') as Record<string, ClientAnalysisProfile>;
    } catch {
      profiles = {};
    }
    const persisted = { ...profile, updatedAt: new Date().toISOString() };
    window.sessionStorage.setItem('camply:meta-e2e:analysis-profiles', JSON.stringify({ ...profiles, [profile.clientId]: persisted }));
    return persisted;
  }
  if (!supabase) return profile;
  const { data, error } = await supabase.rpc('upsert_client_analysis_profile', {
    p_client_id: profile.clientId,
    p_vertical: profile.vertical,
    p_subsegment: profile.subsegment,
    p_business_model: profile.businessModel,
    p_primary_conversion_metric: profile.primaryConversionMetric,
    p_secondary_metrics: profile.secondaryMetrics,
    p_primary_channel: profile.primaryChannel,
    p_budget_period: profile.budgetPeriod,
    p_planned_budget: profile.plannedBudget,
    p_analysis_enabled: profile.analysisEnabled,
    p_custom_vertical: profile.customVertical,
    p_custom_subsegment: profile.customSubsegment,
    p_minimum_evaluation_spend: profile.minimumEvaluationSpend,
    p_minimum_impressions: profile.minimumImpressions,
    p_minimum_results: profile.minimumResults,
    p_attribution_delay_hours: profile.attributionDelayHours,
  });
  if (error) throw new Error('Não foi possível salvar o perfil de análise no banco.');
  return mapClientProfileRow(data as Record<string, unknown>);
}

export function resetE2EAnalysisProfiles(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem('camply:meta-e2e:analysis-profiles');
}
