import { supabaseData } from '../supabase';
import { isMetaE2EMode } from '../meta/metaE2ERuntime';

export interface ValueLabel {
  value: string;
  label: string;
}

export const analysisVerticals: ValueLabel[] = [
  { value: 'saude', label: 'Saúde' },
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'varejo', label: 'Varejo' },
  { value: 'educacao_infoproduto', label: 'Educação / Infoproduto' },
  { value: 'servicos_locais', label: 'Serviços locais' },
  { value: 'imobiliario', label: 'Imobiliário' },
  { value: 'automotivo', label: 'Automotivo' },
  { value: 'b2b_atacado', label: 'B2B / Atacado' },
  { value: 'outros', label: 'Outros' },
];

export const operationTypes: ValueLabel[] = [
  { value: 'local', label: 'Local' },
  { value: 'online', label: 'Online' },
  { value: 'hibrida', label: 'Híbrida' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'atacado', label: 'Atacado' },
  { value: 'lancamento', label: 'Lançamento' },
  { value: 'recorrencia', label: 'Recorrência' },
];

export const salesModels: ValueLabel[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'loja_fisica', label: 'Loja física' },
  { value: 'ecommerce_proprio', label: 'E-commerce próprio' },
  { value: 'checkout_digital', label: 'Checkout digital' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'instagram_direct', label: 'Instagram Direct' },
  { value: 'ligacao', label: 'Ligação' },
  { value: 'formulario', label: 'Formulário' },
  { value: 'delivery_app', label: 'Delivery app' },
  { value: 'atacado', label: 'Atacado' },
];

export const primaryChannels: ValueLabel[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'site_ecommerce', label: 'Site / E-commerce' },
  { value: 'pagina_vendas', label: 'Página de vendas' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'instagram_direct', label: 'Instagram Direct' },
  { value: 'ligacao', label: 'Ligação' },
  { value: 'formulario', label: 'Formulário' },
  { value: 'loja_fisica', label: 'Loja física' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'app_delivery', label: 'App delivery' },
];

export const primaryConversionMetrics: ValueLabel[] = [
  { value: 'conversa_iniciada', label: 'Conversa iniciada' },
  { value: 'lead_gerado', label: 'Lead gerado' },
  { value: 'agendamento_realizado', label: 'Agendamento realizado' },
  { value: 'compra_site', label: 'Compra no site' },
  { value: 'compra_checkout', label: 'Compra no checkout' },
  { value: 'pedido_realizado', label: 'Pedido realizado' },
  { value: 'orcamento_solicitado', label: 'Orçamento solicitado' },
  { value: 'ligacao_recebida', label: 'Ligação recebida' },
  { value: 'rota_solicitada', label: 'Rota solicitada' },
  { value: 'cadastro_preenchido', label: 'Cadastro preenchido' },
  { value: 'mensagem_direct', label: 'Mensagem no direct' },
  { value: 'adicionar_carrinho', label: 'Adicionar ao carrinho' },
  { value: 'iniciar_checkout', label: 'Iniciar checkout' },
  { value: 'visualizacao_produto', label: 'Visualização de produto' },
];

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

export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

export interface ClientAnalysisProfile {
  userId?: string;
  clientId: string;
  vertical: string;
  subsegment: string;
  customVertical: string | null;
  customSubsegment: string | null;
  operationType: string | null;
  salesModels: string[];
  secondaryChannel: string | null;
  secondaryConversionMetric: string | null;
  businessModel: string; // kept for backwards compatibility if needed, but we rely on operationType & salesModels now
  primaryConversionMetric: string;
  secondaryMetrics: string[];
  primaryChannel: string;
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

export const subsegmentsByVertical: Record<string, ValueLabel[]> = {
  'saude': [
    { value: 'clinica_odontologica', label: 'Clínica odontológica' },
    { value: 'clinica_estetica', label: 'Clínica estética' },
    { value: 'terapia', label: 'Terapia / atendimento individual' },
    { value: 'fisioterapia', label: 'Fisioterapia' },
    { value: 'nutricao', label: 'Nutrição' },
    { value: 'psicologia', label: 'Psicologia' },
    { value: 'outros', label: 'Outros' },
  ],
  'alimentacao': [
    { value: 'pizzaria', label: 'Pizzaria' },
    { value: 'hamburgueria', label: 'Hamburgueria' },
    { value: 'restaurante', label: 'Restaurante' },
    { value: 'delivery', label: 'Delivery' },
    { value: 'acai_sorveteria', label: 'Açaí / Sorveteria' },
    { value: 'padaria', label: 'Padaria' },
    { value: 'outros', label: 'Outros' },
  ],
  'varejo': [
    { value: 'loja_geek', label: 'Loja geek' },
    { value: 'moda_feminina', label: 'Moda feminina' },
    { value: 'calcados', label: 'Calçados' },
    { value: 'cosmeticos', label: 'Cosméticos' },
    { value: 'moda_infantil', label: 'Moda infantil' },
    { value: 'otica', label: 'Ótica' },
    { value: 'loja_presentes', label: 'Loja de presentes' },
    { value: 'outros', label: 'Outros' },
  ],
  'educacao_infoproduto': [
    { value: 'curso_online', label: 'Curso online' },
    { value: 'mentoria', label: 'Mentoria' },
    { value: 'comunidade', label: 'Comunidade' },
    { value: 'produto_digital', label: 'Produto digital' },
    { value: 'treinamento_presencial', label: 'Treinamento presencial' },
    { value: 'outros', label: 'Outros' },
  ],
  'servicos_locais': [
    { value: 'prestador_servico', label: 'Prestador de serviço' },
    { value: 'manutencao', label: 'Manutenção' },
    { value: 'limpeza', label: 'Limpeza' },
    { value: 'beleza', label: 'Beleza' },
    { value: 'consultoria_local', label: 'Consultoria local' },
    { value: 'outros', label: 'Outros' },
  ],
  'b2b_atacado': [
    { value: 'distribuidora', label: 'Distribuidora' },
    { value: 'atacado_produtos', label: 'Atacado de produtos' },
    { value: 'fornecedor_local', label: 'Fornecedor local' },
    { value: 'industria', label: 'Indústria' },
    { value: 'servico_empresarial', label: 'Serviço empresarial' },
    { value: 'outros', label: 'Outros' },
  ],
  'outros': [
    { value: 'outros', label: 'Outros' },
  ],
};

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
  return {
    clientId,
    vertical: seed?.vertical || 'servicos_locais',
    subsegment: seed?.subsegment || 'outros',
    customVertical: seed?.customVertical ?? null,
    customSubsegment: seed?.customSubsegment ?? null,
    operationType: seed?.operationType ?? null,
    salesModels: seed?.salesModels ?? [],
    secondaryChannel: seed?.secondaryChannel ?? null,
    secondaryConversionMetric: seed?.secondaryConversionMetric ?? null,
    businessModel: seed?.businessModel || '',
    primaryConversionMetric: seed?.primaryConversionMetric || 'conversa_iniciada',
    secondaryMetrics: seed?.secondaryMetrics?.length ? seed.secondaryMetrics : [],
    primaryChannel: seed?.primaryChannel || 'whatsapp',
    budgetPeriod: seed?.budgetPeriod || 'monthly',
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
    vertical: typeof row.vertical === 'string' && row.vertical.trim() ? row.vertical : 'outros',
    subsegment: typeof row.subsegment === 'string' && row.subsegment.trim() ? row.subsegment : 'outros',
    customVertical: typeof row.custom_vertical === 'string' && row.custom_vertical.trim() ? row.custom_vertical : null,
    customSubsegment: typeof row.custom_subsegment === 'string' && row.custom_subsegment.trim() ? row.custom_subsegment : null,
    operationType: typeof row.operation_type === 'string' && row.operation_type.trim() ? row.operation_type : null,
    salesModels: Array.isArray(row.sales_models) ? row.sales_models.filter((item): item is string => typeof item === 'string') : [],
    secondaryChannel: typeof row.secondary_channel === 'string' && row.secondary_channel.trim() ? row.secondary_channel : null,
    secondaryConversionMetric: typeof row.secondary_conversion_metric === 'string' && row.secondary_conversion_metric.trim() ? row.secondary_conversion_metric : null,
    businessModel: typeof row.business_model === 'string' && row.business_model.trim() ? row.business_model : '',
    primaryConversionMetric: typeof row.primary_conversion_metric === 'string' && row.primary_conversion_metric.trim() ? row.primary_conversion_metric : 'conversa_iniciada',
    secondaryMetrics: Array.isArray(row.secondary_metrics) ? row.secondary_metrics.filter((item): item is string => typeof item === 'string') : [],
    primaryChannel: typeof row.primary_channel === 'string' && row.primary_channel.trim() ? row.primary_channel : 'whatsapp',
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
  const { data, error } = await supabaseData.rpc('upsert_client_analysis_profile', {
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
    p_operation_type: profile.operationType,
    p_sales_models: profile.salesModels,
    p_secondary_channel: profile.secondaryChannel,
    p_secondary_conversion_metric: profile.secondaryConversionMetric,
  });
  if (error) {
    console.error('RPC upsert_client_analysis_profile error:', error);
    throw new Error('Não foi possível salvar o perfil de análise no banco.');
  }
  return mapClientProfileRow(data as Record<string, unknown>);
}

export function resetE2EAnalysisProfiles(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem('camply:meta-e2e:analysis-profiles');
}
