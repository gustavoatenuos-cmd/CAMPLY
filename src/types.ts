export type ViewId = 'today' | 'campaigns' | 'clients' | 'mediaFinance' | 'projects' | 'personalFinance' | 'activity' | 'intelligence' | 'agentSettings' | 'agentChat' | 'metaIntegration' | 'creativeCritic';

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
  conversations?: number; // @deprecated
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
  lastOptimizedAt: string;
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
    ads: Array<{
      id: string;
      name: string;
      status: string;
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
  normalizedMetricsByPeriod?: Record<string, Record<string, number>>;
  lastSyncedAt?: string;
  metaStatus?: string;
  metaEffectiveStatus?: string;
  syncRunId?: string;
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
  | 'Vendas';

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
