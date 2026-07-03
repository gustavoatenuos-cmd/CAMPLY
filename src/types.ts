import type {
  AttributionGroup,
  GlobalMetrics,
  MetaSyncStatus,
  PeriodCompleteness,
  TrendAvailability,
} from './lib/meta/metaSyncTypes';

export type ViewId =
  | 'today'
  | 'campaigns'
  | 'clients'
  | 'mediaFinance'
  | 'projects'
  | 'personalFinance'
  | 'activity'
  | 'intelligence'
  | 'agentSettings'
  | 'agentChat'
  | 'metaIntegration'
  | 'creativeCritic'
  // Analytical views (Phase 1+)
  | 'clientAnalytics'
  | 'budgetTracker'
  | 'alertCenter'
  | 'campaignDrilldown';

// ===================== CLIENT CATEGORY =====================

export type ClientCategory =
  | 'ecommerce'        // E-commerce: foco em ROAS, compras, CPP
  | 'lead_generation'  // Captação: foco em CPL, formulários
  | 'local_business'   // Negócio local: alcance, mensagens, CPM
  | 'saas'             // Software: cadastros, trials
  | 'content'          // Criadores: engajamento, alcance
  | 'other';           // Personalizado

export const CLIENT_CATEGORY_LABELS: Record<ClientCategory, string> = {
  ecommerce: 'E-commerce',
  lead_generation: 'Geração de Leads',
  local_business: 'Negócio Local',
  saas: 'SaaS / App',
  content: 'Conteúdo',
  other: 'Outro',
};

// Primary metrics displayed per category
export const CATEGORY_PRIMARY_METRICS: Record<ClientCategory, string[]> = {
  ecommerce:       ['spent', 'roas', 'cpa', 'purchases', 'ctr', 'cpm'],
  lead_generation: ['spent', 'cpl', 'leads', 'ctr', 'cpc', 'cpm'],
  local_business:  ['spent', 'reach', 'cpm', 'cpm_msg', 'frequency', 'ctr'],
  saas:            ['spent', 'cpl', 'signups', 'ctr', 'cpc', 'cpm'],
  content:         ['spent', 'reach', 'impressions', 'ctr', 'cpm', 'frequency'],
  other:           ['spent', 'results', 'cpr', 'ctr', 'cpc', 'cpm'],
};

export interface ClientBenchmarks {
  cpm?: number;   // CPM de referência do segmento
  cpc?: number;   // CPC de referência
  cpl?: number;   // Custo por lead de referência
  cpr?: number;   // Custo por resultado de referência
  roas?: number;  // ROAS mínimo aceitável
  ctr?: number;   // CTR mínimo esperado (%)
  cpa?: number;   // Custo por aquisição alvo
}

export type CampaignStatus = 'setup' | 'launching' | 'live' | 'optimize' | 'waiting' | 'paused';
export type ClientStatus = 'active' | 'lead' | 'paused';
export type PaymentStatus = 'pending' | 'paid' | 'overdue';
export type ProjectStatus = 'planning' | 'active' | 'waiting' | 'done';
export type Priority = 'low' | 'medium' | 'high';
export type BillingType = 'recurring' | 'one_time';
export type InvestmentPeriod = 'daily' | 'weekly' | 'monthly';
export type ProjectType = 'traffic' | 'site';

export interface Client {
  id: string;
  projectId: string;
  name: string;
  company: string;
  segment: string;
  structure: string;
  hasProject: boolean;
  contact: string;
  monthlyFee: number;
  managementFeeType: BillingType;
  dueDay: number;
  adInvestmentPeriod: InvestmentPeriod;
  adInvestmentMeta: number;
  adInvestmentGoogle: number;
  adInvestmentYoutube: number;
  adInvestmentTikTok: number;
  status: ClientStatus;
  notes?: string;
  metaAdAccountId?: string;
  metaAdAccountName?: string;
  // Analytics & categorization (Phase 1)
  category?: ClientCategory;
  benchmarks?: ClientBenchmarks;
  monthlyBudgetLimit?: number;   // Limite mensal de gasto de mídia (R$)
  alertBudgetAt?: number;        // Alertar ao atingir X% do limite (0-100)
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
}

export interface CampaignMetrics {
  spent: number;
  results: number;
  ctr: number;
  cpc: number;
  cpr: number;
  pageViews: number;
  checkouts: number;
  purchases: number;
  impressions?: number;
  reach?: number;
  frequency?: number;
  cpm?: number;
  roas?: number;
  leads?: number;
  cpl?: number;
}

export interface Campaign {
  id: string;
  clientId: string;
  name: string;
  platform: 'Meta Ads' | 'Google Ads' | 'TikTok Ads' | 'Outro';
  status: CampaignStatus;
  objective: MetaCampaignObjective | string;
  budget: number;
  spent: number;
  lastOptimizedAt?: string;
  nextAction: string;
  priority: Priority;
  metaCampaignId?: string;
  isMatrix?: boolean;
  subCampaignIds?: string[];
  activeCreatives?: number;
  activeAdSets?: Array<{
    id: string;
    name: string;
    status: string;
    classified_objective?: string;
    optimization_goal?: string;
    destination_type?: string;
    attribution_setting?: string;
    effective_status?: string;
    ads?: Array<{
      id: string;
      name: string;
      status: string;
      effective_status?: string;
      creative_id?: string | null;
      creative?: {
        id?: string;
        name?: string;
        title?: string;
        body?: string;
        thumbnail_url?: string;
        image_url?: string;
        object_story_spec?: Record<string, unknown> | null;
      } | null;
      metricsByPeriod?: Record<string, Record<string, number | string | null | undefined>>;
    }>;
  }>;
  targetResults?: number;
  targetCPA?: number;
  results?: number; // @deprecated
  ctr?: number;
  cpc?: number;
  cpr?: number; // @deprecated
  pageViews?: number;
  checkouts?: number;
  purchases?: number;
  impressions?: number;
  conversations?: number; // @deprecated
  metricsByPeriod?: Record<string, CampaignMetrics>; // @deprecated legacy field
  classifiedObjective?: string;
  normalizedMetricsByPeriod?: Record<string, Record<string, number>>; // @deprecated

  // New Contract
  structuralMixedAttribution?: boolean;
  mixedAttribution?: boolean;
  mixedAttributionByPeriod?: Record<string, boolean>;
  mixedObjective?: boolean;
  mixedDestination?: boolean;
  globalMetricsByPeriod?: Record<string, GlobalMetrics>;
  attributionGroupsByPeriod?: Record<string, AttributionGroup[]>;
  completenessByPeriod?: Record<string, PeriodCompleteness>;
  trendAvailabilityByPeriod?: Record<string, TrendAvailability>;
  trendAvailable?: boolean;
  trendUnavailableReason?: string;

  lastSyncedAt?: string;
  metaStatus?: string;
  metaEffectiveStatus?: string;
  syncRunId?: string;
  lastSyncAttemptAt?: string;
  lastSyncAttemptRunId?: string;
  lastSyncStatus?: MetaSyncStatus;
  partialSyncRunId?: string;
  dataIsPartial?: boolean;
  metaMissingFromLatestSync?: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
}

export type MetaCampaignObjective =
  | 'Reconhecimento'
  | 'Tráfego'
  | 'Engajamento'
  | 'Cadastros'
  | 'Promoção do app'
  | 'Vendas'
  | 'MIXED'
  | 'UNCLASSIFIED';

export interface Receivable {
  id: string;
  clientId: string;
  description: string;
  amount: number;
  dueDate: string;
  status: PaymentStatus;
  paidAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  id: string;
  projectType: ProjectType;
  clientId: string;
  ownerName: string;
  company: string;
  billingType: BillingType;
  name: string;
  role: string;
  status: ProjectStatus;
  progress: number;
  dueDate: string;
  amountCharged: number;
  amountReceived: number;
  paymentStatus: PaymentStatus;
  paidAt?: string;
  deliveredUrl: string;
  visibility: 'private' | 'portfolio' | 'public';
  nextAction: string;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
}

export type TaskArea = 'tráfego' | 'site' | 'financeiro' | 'geral';
export type TaskType = 'otimizacao' | 'novo_projeto' | 'novo_cliente' | 'outro';

export interface Task {
  id: string;
  title: string;
  dueDate: string;
  area: TaskArea;
  taskType: TaskType;
  clientId?: string;
  hasFinance?: boolean;
  financeAmount?: number;
  done: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
}

export type ActivityAction =
  | 'client_created'
  | 'client_updated'
  | 'client_status_changed'
  | 'campaign_created'
  | 'campaign_status_changed'
  | 'task_created'
  | 'task_completed'
  | 'task_reopened'
  | 'receivable_created'
  | 'receivable_status_changed'
  | 'project_created'
  | 'project_status_changed'
  | 'project_updated';

export interface ActivityLog {
  id: string;
  action: ActivityAction;
  title: string;
  description: string;
  projectId: string;
  clientId: string;
  campaignId: string;
  receivableId: string;
  taskId: string;
  actor: string;
  createdAt: string;
}

// ===================== AGENT TYPES =====================

export type EntityType = 'client' | 'campaign' | 'project' | 'task';
export type SeverityLevel = 'critical' | 'warning' | 'info' | 'good';

export interface AgentRule {
  id: string;
  name: string;
  description: string;
  entityType: EntityType;
  conditionType: 'deadline_today' | 'overdue' | 'idle_days' | 'attention_required' | 'many_pending';
  thresholdValue?: number;
  thresholdUnit?: 'days' | 'hours' | 'count';
  severity: SeverityLevel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentAlert {
  id: string;
  relatedEntityId: string;
  relatedEntityType: EntityType;
  clientId?: string;
  title: string;
  message: string;
  severity: SeverityLevel;
  status: 'active' | 'dismissed' | 'resolved';
  suggestedAction?: string;
  triggeredAt: string;
  readAt?: string;
}

export interface AgentActivityLog {
  id: string;
  relatedEntityId: string;
  relatedEntityType: EntityType;
  analysisType: string;
  classification: string;
  reason: string;
  createdAt: string;
}

// ===================== CAMPLY DATA =====================

export interface CamplyData {
  clients: Client[];
  campaigns: Campaign[];
  receivables: Receivable[];
  projects: Project[];
  tasks: Task[];
  activityLogs: ActivityLog[];
  agentRules: AgentRule[];
  agentAlerts: AgentAlert[];
  agentLogs: AgentActivityLog[];
}

// ===================== COST ALERTS & THRESHOLDS =====================

export type CostAlertSeverity = 'critical' | 'warning' | 'info';

export type CostAlertType =
  | 'budget_exhausted'      // Budget diário esgotado (>90%)
  | 'budget_high'           // Budget >70% consumido antes das 18h
  | 'high_cpm'              // CPM muito acima do benchmark
  | 'low_ctr'               // CTR caiu >30% vs. período anterior
  | 'high_frequency'        // Frequência >3 (fadiga de criativo)
  | 'high_cpl'              // CPL subiu >25% vs. média histórica
  | 'low_roas'              // ROAS abaixo do breakeven
  | 'campaign_no_delivery'  // Campanha sem entrega há X horas
  | 'monthly_budget_alert'  // Limite mensal próximo
  | 'custom';               // Threshold personalizado

export interface CostAlert {
  id: string;
  userId?: string;
  clientId: string;
  campaignId?: string;
  alertType: CostAlertType;
  severity: CostAlertSeverity;
  metricName: string;
  currentValue?: number;
  thresholdValue?: number;
  message: string;
  isResolved: boolean;
  triggeredAt: string;
  resolvedAt?: string;
}

export interface CostThreshold {
  id: string;
  userId?: string;
  clientId: string;
  campaignId?: string;  // null = aplica para todos do cliente
  metric: 'cpm' | 'cpc' | 'cpl' | 'cpa' | 'roas' | 'budget_pct' | 'frequency';
  warningLevel: number;
  criticalLevel: number;
  period: 'daily' | 'weekly' | 'monthly';
  isActive: boolean;
}

// ===================== METRIC SNAPSHOTS =====================

export interface MetricSnapshot {
  id?: string;
  clientId: string;
  campaignId: string;
  snapshotDate: string;        // YYYY-MM-DD
  period: '1d' | '7d' | '14d' | '30d';
  spent: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  results: number;
  cpr: number;                 // custo por resultado
  leads?: number;
  cpl?: number;
  purchases?: number;
  cpa?: number;
  roas?: number;
  syncedAt?: string;
}

export interface Insight {
  id: string;
  level: 'critical' | 'warning' | 'good' | 'info';
  title: string;
  description: string;
  recommendation: string;
}

// ===================== CREATIVE CRITIC =====================

export interface CreativeCriticResponse {
  summary: string;
  selected_scope: string;
  top_creatives: Array<{ name: string; reason: string; metrics: string }>;
  underperformers: Array<{ name: string; reason: string; metrics: string }>;
  winner_patterns: string[];
  losing_patterns: string[];
  variant_briefs: Array<{ source_ad: string; headline: string; primary_text: string; format: string; insight: string }>;
  data_gaps: string[];
  next_actions: string[];
}
