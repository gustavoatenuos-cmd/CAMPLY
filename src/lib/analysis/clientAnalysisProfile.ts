import { supabaseData } from '../supabase';
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

export const primaryObjectives = [
  { id: 'whatsapp_messages', label: 'Mensagens no WhatsApp', primaryMetric: 'messaging_conversations_started_total', channel: 'WhatsApp' },
  { id: 'leads', label: 'Geração de leads', primaryMetric: 'leads', channel: 'Misto' },
  { id: 'registrations', label: 'Geração de cadastros', primaryMetric: 'registrations', channel: 'Site' },
  { id: 'sales', label: 'Geração de vendas', primaryMetric: 'purchases', channel: 'Misto' },
  { id: 'website_sales', label: 'Vendas no site', primaryMetric: 'purchases', channel: 'Site' },
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
  'registrations',
  'purchases',
  'landing_page_views',
  'link_clicks',
] as const;

export const profileMetricOptions = [
  'cost_per_messaging_conversation',
  'messaging_conversations_started_total',
  'leads',
  'cost_per_lead',
  'registrations',
  'cost_per_registration',
  'purchases',
  'cost_per_purchase',
  'purchase_roas',
  'purchase_value',
  'cpm',
  'link_ctr',
  'link_cpc',
  'frequency',
  'landing_page_views',
  'cost_per_landing_page_view',
  'link_clicks',
  'reach',
  'impressions',
] as const;

export type AnalysisVertical = typeof analysisVerticals[number] | string;
export type BusinessModel = typeof businessModels[number] | string;
export type PrimaryObjective = typeof primaryObjectives[number]['id'];
export type PrimaryChannel = typeof primaryChannels[number] | string;
export type PrimaryConversionMetric = typeof primaryConversionMetrics[number] | string;
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';
export type BudgetPlatform = 'meta' | 'google' | 'youtube' | 'tiktok';
export type GoalExpectationType = 'maximum' | 'minimum' | 'range' | 'quantity_minimum';

export interface PerformanceGoal {
  id: string;
  metricId: string;
  expectationType: GoalExpectationType;
  value: number | null;
  minValue: number | null;
  maxValue: number | null;
  warningTolerancePercent: number;
  criticalTolerancePercent: number;
  weight: number;
  evaluationPeriod?: BudgetPeriod | 'inherit';
}

export interface ClientAnalysisProfile {
  userId?: string;
  clientId: string;
  vertical: AnalysisVertical;
  subsegment: string;
  customVertical: string | null;
  customSubsegment: string | null;
  businessModel: BusinessModel;
  primaryObjective?: PrimaryObjective | null;
  primaryConversionMetric: PrimaryConversionMetric;
  secondaryMetrics: string[];
  primaryChannel: PrimaryChannel;
  budgetPeriod: BudgetPeriod;
  plannedBudget: number | null;
  budgetPlatform?: BudgetPlatform;
  performanceGoals?: PerformanceGoal[];
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
  primaryObjective: PrimaryObjective;
  primaryConversionMetric: PrimaryConversionMetric;
  secondaryMetrics: string[];
  primaryChannel: PrimaryChannel;
  budgetPeriod: BudgetPeriod;
  budgetPlatform: BudgetPlatform;
  performanceGoals: PerformanceGoal[];
  custom?: boolean;
}

export interface SavedAnalysisTemplate extends AnalysisTemplate {
  id: string;
  label: string;
  custom: true;
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
    primaryObjective: 'whatsapp_messages',
    primaryConversionMetric: 'messaging_conversations_started_total',
    secondaryMetrics: ['cost_per_messaging_conversation', 'cpm', 'link_ctr', 'frequency', 'spend'],
    primaryChannel: 'WhatsApp',
    budgetPeriod: 'monthly',
    budgetPlatform: 'meta',
    performanceGoals: [],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    vertical: 'Alimentação',
    subsegment: 'Delivery',
    primaryObjective: 'sales',
    primaryConversionMetric: 'purchases',
    secondaryMetrics: ['cost_per_purchase', 'purchase_roas', 'purchase_value', 'cpm', 'frequency', 'spend'],
    primaryChannel: 'Site',
    budgetPeriod: 'weekly',
    budgetPlatform: 'meta',
    performanceGoals: [],
  },
  {
    id: 'loja-calcados',
    label: 'Loja local de calçados',
    vertical: 'Varejo local',
    subsegment: 'Calçados',
    primaryObjective: 'whatsapp_messages',
    primaryConversionMetric: 'messaging_conversations_started_total',
    secondaryMetrics: ['cost_per_messaging_conversation', 'purchases', 'purchase_roas', 'landing_page_views', 'link_ctr', 'frequency'],
    primaryChannel: 'WhatsApp',
    budgetPeriod: 'weekly',
    budgetPlatform: 'meta',
    performanceGoals: [],
  },
  {
    id: 'produtos-fisicos',
    label: 'Loja de produtos físicos',
    vertical: 'Varejo local',
    subsegment: 'Produtos físicos',
    primaryObjective: 'website_sales',
    primaryConversionMetric: 'purchases',
    secondaryMetrics: ['cost_per_purchase', 'cpm', 'link_ctr', 'landing_page_views', 'spend'],
    primaryChannel: 'Misto',
    budgetPeriod: 'monthly',
    budgetPlatform: 'meta',
    performanceGoals: [],
  },
  {
    id: 'geracao-cadastros',
    label: 'Geração de cadastros',
    vertical: 'Serviços locais',
    subsegment: 'Outros',
    primaryObjective: 'registrations',
    primaryConversionMetric: 'registrations',
    secondaryMetrics: ['cost_per_registration', 'cpm', 'link_ctr', 'link_cpc'],
    primaryChannel: 'Site',
    budgetPeriod: 'monthly',
    budgetPlatform: 'meta',
    performanceGoals: [],
  },
];

export const metricLabels: Record<string, string> = {
  messaging_conversations_started_total: 'Conversas iniciadas',
  cost_per_messaging_conversation: 'Custo por conversa no WhatsApp',
  leads: 'Leads',
  cost_per_lead: 'Custo por lead',
  registrations: 'Cadastros',
  cost_per_registration: 'Custo por cadastro',
  purchases: 'Compras',
  cost_per_purchase: 'Custo por compra',
  purchase_roas: 'ROAS',
  purchase_value: 'Valor de compras',
  cpm: 'CPM',
  link_ctr: 'CTR de link',
  link_cpc: 'CPC de link',
  frequency: 'Frequência',
  landing_page_views: 'Landing page views',
  cost_per_landing_page_view: 'Custo por landing page view',
  link_clicks: 'Cliques no link',
  reach: 'Alcance',
  impressions: 'Impressões',
  spend: 'Investimento',
};

const goal = (
  metricId: string,
  expectationType: GoalExpectationType,
  value: number | null,
  weight = 1,
  minValue: number | null = null,
  maxValue: number | null = null,
): PerformanceGoal => ({
  id: `${metricId}-${expectationType}`,
  metricId,
  expectationType,
  value,
  minValue,
  maxValue,
  warningTolerancePercent: 10,
  criticalTolerancePercent: 25,
  weight,
  evaluationPeriod: 'inherit',
});

export const objectiveGoalSuggestions: Record<PrimaryObjective, PerformanceGoal[]> = {
  whatsapp_messages: [
    goal('cost_per_messaging_conversation', 'maximum', 15, 3),
    goal('messaging_conversations_started_total', 'quantity_minimum', 10, 3),
    goal('cpm', 'maximum', 25), goal('link_ctr', 'minimum', 1.2),
    goal('link_cpc', 'maximum', 3), goal('frequency', 'range', null, 1, 1.5, 3),
  ],
  leads: [
    goal('cost_per_lead', 'maximum', 20, 3), goal('leads', 'quantity_minimum', 10, 3),
    goal('cpm', 'maximum', 25), goal('link_ctr', 'minimum', 1.2), goal('link_cpc', 'maximum', 3),
  ],
  registrations: [
    goal('cost_per_registration', 'maximum', 8, 3), goal('registrations', 'quantity_minimum', 20, 3),
    goal('cpm', 'maximum', 25), goal('link_ctr', 'minimum', 1.2), goal('link_cpc', 'maximum', 3),
  ],
  sales: [
    goal('cost_per_purchase', 'maximum', 40, 3), goal('purchases', 'quantity_minimum', 5, 3),
    goal('purchase_roas', 'minimum', 3, 2), goal('purchase_value', 'minimum', 1000, 2),
    goal('cpm', 'maximum', 25), goal('link_ctr', 'minimum', 1.2),
  ],
  website_sales: [
    goal('cost_per_purchase', 'maximum', 40, 3), goal('purchase_roas', 'minimum', 3, 3),
    goal('purchase_value', 'minimum', 1000, 2), goal('landing_page_views', 'quantity_minimum', 100),
    goal('cost_per_landing_page_view', 'maximum', 3), goal('link_ctr', 'minimum', 1.2),
    goal('link_cpc', 'maximum', 3), goal('cpm', 'maximum', 25),
  ],
};

export function suggestedGoalsForObjective(objective: PrimaryObjective): PerformanceGoal[] {
  return objectiveGoalSuggestions[objective].map((item) => ({ ...item, id: `${item.metricId}-${crypto.randomUUID()}` }));
}

export function primaryObjectiveConfig(objective: PrimaryObjective) {
  return primaryObjectives.find((item) => item.id === objective)!;
}

export function primaryObjectiveLabel(objective: PrimaryObjective | null | undefined): string {
  return objective ? primaryObjectives.find((item) => item.id === objective)?.label || 'Configuração pendente' : 'Configuração pendente';
}

function mapLegacyObjective(value: unknown): PrimaryObjective | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'geração de leads') return 'leads';
  if (normalized === 'venda pelo whatsapp') return 'whatsapp_messages';
  if (normalized === 'venda pelo site' || normalized === 'e-commerce') return 'website_sales';
  return null;
}

function parseGoal(item: unknown, index: number): PerformanceGoal | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const metricId = typeof row.metricId === 'string' ? row.metricId : '';
  const expectationType = row.expectationType as GoalExpectationType;
  if (!metricId || !['maximum', 'minimum', 'range', 'quantity_minimum'].includes(expectationType)) return null;
  const numberOrNull = (value: unknown) => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    id: typeof row.id === 'string' && row.id ? row.id : `${metricId}-${index}`,
    metricId,
    expectationType,
    value: numberOrNull(row.value),
    minValue: numberOrNull(row.minValue),
    maxValue: numberOrNull(row.maxValue),
    warningTolerancePercent: numberOrNull(row.warningTolerancePercent) ?? 10,
    criticalTolerancePercent: numberOrNull(row.criticalTolerancePercent) ?? 25,
    weight: numberOrNull(row.weight) ?? 1,
    evaluationPeriod: row.evaluationPeriod === 'daily' || row.evaluationPeriod === 'weekly' || row.evaluationPeriod === 'monthly'
      ? row.evaluationPeriod
      : 'inherit',
  };
}

export function defaultAnalysisProfile(clientId: string, seed?: Partial<ClientAnalysisProfile>): ClientAnalysisProfile {
  const vertical = seed?.vertical || 'Outros';
  const subsegment = seed?.subsegment || subsegmentsByVertical[vertical]?.[0] || 'Outros';
  return {
    clientId,
    vertical,
    subsegment,
    customVertical: seed?.customVertical ?? null,
    customSubsegment: seed?.customSubsegment ?? null,
    businessModel: seed?.businessModel || 'modelo misto',
    primaryObjective: seed?.primaryObjective ?? null,
    primaryConversionMetric: seed?.primaryConversionMetric || 'messaging_conversations_started_total',
    secondaryMetrics: seed?.secondaryMetrics || [],
    primaryChannel: seed?.primaryChannel || 'Misto',
    budgetPeriod: seed?.budgetPeriod || 'monthly',
    plannedBudget: seed?.plannedBudget ?? null,
    budgetPlatform: seed?.budgetPlatform || 'meta',
    performanceGoals: seed?.performanceGoals || [],
    minimumEvaluationSpend: seed?.minimumEvaluationSpend ?? 0,
    minimumImpressions: seed?.minimumImpressions ?? 0,
    minimumResults: seed?.minimumResults ?? 0,
    attributionDelayHours: seed?.attributionDelayHours ?? 24,
    analysisEnabled: seed?.analysisEnabled ?? true,
  };
}

export function mapClientProfileRow(row: Record<string, unknown>): ClientAnalysisProfile {
  const performanceGoals = Array.isArray(row.performance_goals)
    ? row.performance_goals.map(parseGoal).filter((item): item is PerformanceGoal => item !== null)
    : [];
  return {
    userId: typeof row.user_id === 'string' ? row.user_id : undefined,
    clientId: String(row.client_id ?? ''),
    vertical: String(row.vertical ?? 'Outros'),
    subsegment: String(row.subsegment ?? 'Outros'),
    customVertical: typeof row.custom_vertical === 'string' && row.custom_vertical.trim() ? row.custom_vertical : null,
    customSubsegment: typeof row.custom_subsegment === 'string' && row.custom_subsegment.trim() ? row.custom_subsegment : null,
    businessModel: String(row.business_model ?? 'modelo misto'),
    primaryObjective: (typeof row.primary_objective === 'string' ? row.primary_objective : null) as PrimaryObjective | null
      ?? mapLegacyObjective(row.business_model),
    primaryConversionMetric: String(row.primary_conversion_metric ?? 'messaging_conversations_started_total'),
    secondaryMetrics: Array.isArray(row.secondary_metrics) ? row.secondary_metrics.filter((item): item is string => typeof item === 'string') : [],
    primaryChannel: String(row.primary_channel ?? 'Misto'),
    budgetPeriod: (row.budget_period === 'daily' || row.budget_period === 'weekly' || row.budget_period === 'monthly') ? row.budget_period : 'monthly',
    plannedBudget: typeof row.planned_budget === 'number' ? row.planned_budget : row.planned_budget == null ? null : Number(row.planned_budget),
    budgetPlatform: (['meta', 'google', 'youtube', 'tiktok'].includes(String(row.budget_platform)) ? row.budget_platform : 'meta') as BudgetPlatform,
    performanceGoals,
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
  if (!supabaseData) return null;
  const { data, error } = await supabaseData
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
  if (!supabaseData) return profile;
  const { data, error } = await supabaseData.rpc('upsert_client_analysis_profile_v2', {
    p_client_id: profile.clientId,
    p_vertical: profile.vertical,
    p_subsegment: profile.subsegment,
    p_primary_objective: profile.primaryObjective,
    p_primary_conversion_metric: profile.primaryConversionMetric,
    p_secondary_metrics: profile.secondaryMetrics,
    p_performance_goals: profile.performanceGoals || [],
    p_primary_channel: profile.primaryChannel,
    p_budget_period: profile.budgetPeriod,
    p_planned_budget: profile.plannedBudget,
    p_budget_platform: profile.budgetPlatform || 'meta',
    p_analysis_enabled: profile.analysisEnabled,
    p_custom_vertical: profile.customVertical,
    p_custom_subsegment: profile.customSubsegment,
    p_legacy_business_model: profile.businessModel,
  });
  if (error) throw new Error('Não foi possível salvar o perfil de análise no banco.');
  return mapClientProfileRow(data as Record<string, unknown>);
}

export async function loadSavedAnalysisTemplates(): Promise<SavedAnalysisTemplate[]> {
  if (!supabaseData) return [];
  const { data, error } = await supabaseData
    .from('analysis_profile_templates')
    .select('*')
    .is('archived_at', null)
    .order('name');
  if (error) return [];
  const rows = (data || []) as Array<Record<string, unknown>>;
  return rows.map(mapSavedAnalysisTemplateRow);
}

export function mapSavedAnalysisTemplateRow(row: Record<string, unknown>): SavedAnalysisTemplate {
  const objective = row.primary_objective as PrimaryObjective;
  const config = primaryObjectiveConfig(objective);
  return {
    id: String(row.id), label: String(row.name), vertical: String(row.vertical),
    subsegment: String(row.subsegment), primaryObjective: objective,
    primaryConversionMetric: config.primaryMetric,
    secondaryMetrics: Array.isArray(row.selected_metrics) ? row.selected_metrics.filter((item): item is string => typeof item === 'string') : [],
    primaryChannel: config.channel,
    budgetPeriod: row.budget_period_default as BudgetPeriod,
    budgetPlatform: row.budget_platform_default as BudgetPlatform,
    performanceGoals: Array.isArray(row.target_defaults)
      ? row.target_defaults.map(parseGoal).filter((item: PerformanceGoal | null): item is PerformanceGoal => item !== null)
      : [],
    custom: true,
  };
}

export async function saveAnalysisTemplate(name: string, profile: ClientAnalysisProfile, templateId?: string): Promise<SavedAnalysisTemplate> {
  if (!profile.primaryObjective) throw new Error('Selecione o objetivo principal antes de salvar o modelo.');
  if (!supabaseData) throw new Error('Backend analítico não configurado.');
  const { data, error } = await supabaseData.rpc('save_analysis_profile_template', {
    p_template_id: templateId || null,
    p_name: name,
    p_vertical: profile.vertical,
    p_subsegment: profile.subsegment,
    p_primary_objective: profile.primaryObjective,
    p_selected_metrics: profile.secondaryMetrics,
    p_target_defaults: profile.performanceGoals || [],
    p_budget_period_default: profile.budgetPeriod,
    p_budget_platform_default: profile.budgetPlatform || 'meta',
  });
  if (error) throw new Error('Não foi possível salvar o modelo personalizado.');
  return mapSavedAnalysisTemplateRow(data as Record<string, unknown>);
}

export function applyAnalysisTemplate(profile: ClientAnalysisProfile, template: AnalysisTemplate): ClientAnalysisProfile {
  const config = primaryObjectiveConfig(template.primaryObjective);
  const goals = template.performanceGoals.length ? template.performanceGoals : suggestedGoalsForObjective(template.primaryObjective);
  return {
    ...profile,
    vertical: template.vertical,
    subsegment: template.subsegment,
    customVertical: null,
    customSubsegment: null,
    primaryObjective: template.primaryObjective,
    primaryConversionMetric: config.primaryMetric,
    secondaryMetrics: Array.from(new Set(goals.map((item) => item.metricId))),
    performanceGoals: goals.map((item) => ({ ...item, id: `${item.metricId}-${crypto.randomUUID()}` })),
    primaryChannel: config.channel,
    budgetPeriod: template.budgetPeriod,
    budgetPlatform: template.budgetPlatform,
  };
}

export function resetE2EAnalysisProfiles(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem('camply:meta-e2e:analysis-profiles');
}
