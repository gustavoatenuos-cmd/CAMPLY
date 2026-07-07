import { ActivityLog, CamplyData, Campaign, CampaignStatus, Insight, PaymentStatus, ProjectStatus } from '../types';

const STORAGE_KEY = 'camply-data-v3';
const LEGACY_STORAGE_KEY = 'camply-data-v2';

const storageKeyForUser = (userId: string) => `${STORAGE_KEY}:${userId}`;

export const campaignStatusLabels: Record<CampaignStatus, string> = {
  setup: 'Setup',
  launching: 'Subindo',
  live: 'No ar',
  optimize: 'Otimizar',
  waiting: 'Aguardando cliente',
  paused: 'Pausado',
};

export const campaignColumns: CampaignStatus[] = ['setup', 'launching', 'live', 'optimize', 'waiting', 'paused'];

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  overdue: 'Atrasado',
};

export const projectStatusLabels: Record<ProjectStatus, string> = {
  planning: 'Planejamento',
  active: 'Em andamento',
  waiting: 'Aguardando',
  done: 'Concluído',
};

export const initialData: CamplyData = {
  clients: [],
  campaigns: [],
  receivables: [],
  projects: [],
  tasks: [],
  activityLogs: [],
  agentRules: [],
  agentAlerts: [],
  agentLogs: [],
};

const stripMetaAnalyticsFromCampaign = ({
  metricsByPeriod: _metricsByPeriod,
  normalizedMetricsByPeriod: _normalizedMetricsByPeriod,
  globalMetricsByPeriod: _globalMetricsByPeriod,
  attributionGroupsByPeriod: _attributionGroupsByPeriod,
  completenessByPeriod: _completenessByPeriod,
  trendAvailabilityByPeriod: _trendAvailabilityByPeriod,
  activeAdSets: _activeAdSets,
  syncRunId: _syncRunId,
  partialSyncRunId: _partialSyncRunId,
  ...campaign
}: Campaign): Campaign => campaign;

// Tetos de histórico: o workspace inteiro vive num único JSONB no Supabase.
// Sem limite, activityLogs/agentAlerts/agentLogs crescem para sempre, o blob
// chega a megabytes e o carregamento passa a estourar o gateway (504).
// As listas são newest-first, então o corte preserva os registros recentes.
export const MAX_ACTIVITY_LOGS = 500;
export const MAX_AGENT_ALERTS = 300;
export const MAX_AGENT_LOGS = 500;

const capHistory = (data: CamplyData): CamplyData => ({
  ...data,
  activityLogs: (data.activityLogs ?? []).slice(0, MAX_ACTIVITY_LOGS),
  agentAlerts: (data.agentAlerts ?? []).slice(0, MAX_AGENT_ALERTS),
  agentLogs: (data.agentLogs ?? []).slice(0, MAX_AGENT_LOGS),
});

export const normalizeData = (data: Partial<CamplyData>): CamplyData => {
  const parsed = capHistory({ ...initialData, ...data } as CamplyData);

  return {
    ...parsed,
    clients: parsed.clients.map(({ metaAdAccountId: _legacyId, metaAdAccountName: _legacyName, ...client }) => ({
      ...client,
      projectId: client.projectId ?? '',
      managementFeeType: client.managementFeeType ?? 'recurring',
      adInvestmentPeriod: client.adInvestmentPeriod ?? 'monthly',
      adInvestmentMeta: client.adInvestmentMeta ?? 0,
      adInvestmentGoogle: client.adInvestmentGoogle ?? 0,
      adInvestmentYoutube: client.adInvestmentYoutube ?? 0,
      adInvestmentTikTok: client.adInvestmentTikTok ?? 0,
    })),
    campaigns: parsed.campaigns
      .filter((campaign) => !campaign.metaCampaignId)
      .map(stripMetaAnalyticsFromCampaign),
    projects: parsed.projects.map((project) => ({
      ...project,
      projectType: project.projectType ?? (project.billingType === 'recurring' ? 'traffic' : 'site'),
      clientId: project.clientId ?? parsed.clients[0]?.id ?? '',
      ownerName: project.ownerName ?? '',
      company: project.company ?? '',
      billingType: project.billingType ?? 'one_time',
      amountCharged: project.amountCharged ?? 0,
      amountReceived: project.amountReceived ?? 0,
      paymentStatus: project.paymentStatus ?? inferProjectPaymentStatus(project.amountCharged ?? 0, project.amountReceived ?? 0),
      deliveredUrl: project.deliveredUrl ?? '',
      visibility: project.visibility ?? 'private',
    })),
    tasks: parsed.tasks.map((task) => ({
      ...task,
      hasFinance: task.hasFinance ?? false,
      financeAmount: task.financeAmount,
    })),
    activityLogs: (parsed.activityLogs ?? []).map((log) => ({
      ...log,
      projectId: log.projectId ?? '',
      clientId: log.clientId ?? '',
      campaignId: log.campaignId ?? '',
      receivableId: log.receivableId ?? '',
      taskId: log.taskId ?? '',
      actor: log.actor ?? 'Gustavo',
    })),
    agentRules: parsed.agentRules || [],
    agentAlerts: parsed.agentAlerts || [],
    agentLogs: parsed.agentLogs || [],
  };
};

export const inferProjectPaymentStatus = (amountCharged: number, amountReceived: number): PaymentStatus => {
  if (amountCharged > 0 && amountReceived >= amountCharged) return 'paid';
  return 'pending';
};

export const sanitizeWorkspaceData = (data: CamplyData): CamplyData => capHistory({
  ...data,
  clients: data.clients.map(({ metaAdAccountId: _legacyId, metaAdAccountName: _legacyName, ...client }) => client),
  campaigns: data.campaigns
    .filter((campaign) => !campaign.metaCampaignId)
    .map(stripMetaAnalyticsFromCampaign),
});

export const loadData = (userId?: string | null): CamplyData => {
  if (!userId) return initialData;
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  const stored = window.localStorage.getItem(storageKeyForUser(userId));
  if (!stored) return initialData;

  try {
    return normalizeData(JSON.parse(stored));
  } catch {
    return initialData;
  }
};

export const saveData = (data: CamplyData, userId?: string | null) => {
  if (!userId) return;
  window.localStorage.setItem(storageKeyForUser(userId), JSON.stringify(sanitizeWorkspaceData(data)));
};

export const clearUserData = (userId?: string | null) => {
  if (!userId) return;
  window.localStorage.removeItem(storageKeyForUser(userId));
};

let fallbackIdCounter = 0;

export const makeId = (prefix: string) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;

  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const entropy = Array.from(bytes).some(Boolean)
    ? Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    : `${Date.now()}-${fallbackIdCounter++}`;
  return `${prefix}-${entropy}`;
};

let currentActivityActor = 'Usuário autenticado';

export const setActivityActor = (actor?: string | null) => {
  currentActivityActor = actor?.trim() || 'Usuário autenticado';
};

export const createActivityLog = (input: Omit<ActivityLog, 'id' | 'actor' | 'createdAt'>): ActivityLog => ({
  id: makeId('log'),
  actor: currentActivityActor,
  createdAt: new Date().toISOString(),
  ...input,
});

export const normalizeMonthlyInvestment = (value: number, period: 'daily' | 'weekly' | 'monthly') => {
  if (period === 'daily') return value * 30;
  if (period === 'weekly') return value * 4.33;
  return value;
};

export const money = (value: number) =>
  value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`));

export const daysUntil = (value: string) => {
  const target = new Date(`${value}T12:00:00`);
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  return Math.ceil((target.getTime() - base.getTime()) / 86400000);
};

export const buildInsights = (data: CamplyData): Insight[] => {
  const insights: Insight[] = [];

  data.campaigns.forEach((campaign) => {
    const client = data.clients.find((item) => item.id === campaign.clientId);
    const daysWithoutOptimization = campaign.lastOptimizedAt
      ? Math.abs(daysUntil(campaign.lastOptimizedAt))
      : 0;
    const spentRate = campaign.budget ? campaign.spent / campaign.budget : 0;

    if (['live', 'optimize'].includes(campaign.status) && daysWithoutOptimization >= 4) {
      insights.push({
        id: `campaign-${campaign.id}`,
        level: 'warning',
        title: `${campaign.name} precisa de revisão`,
        description: `${client?.name ?? 'Cliente'} está há ${daysWithoutOptimization} dias sem otimização registrada.`,
        recommendation: campaign.nextAction,
      });
    }

    if (spentRate >= 0.8) {
      insights.push({
        id: `budget-${campaign.id}`,
        level: 'critical',
        title: `${campaign.name} está perto do limite de verba`,
        description: `${client?.name ?? 'Cliente'} já consumiu ${Math.round(spentRate * 100)}% da verba cadastrada.`,
        recommendation: 'Conferir performance antes de manter ou aumentar orçamento.',
      });
    }
  });

  data.receivables.forEach((item) => {
    const client = data.clients.find((clientItem) => clientItem.id === item.clientId);
    const distance = daysUntil(item.dueDate);

    if (item.status === 'overdue' || (item.status === 'pending' && distance <= 3)) {
      insights.push({
        id: `recv-${item.id}`,
        level: item.status === 'overdue' ? 'critical' : 'warning',
        title: item.status === 'overdue' ? `Pagamento atrasado: ${client?.name}` : `Pagamento próximo: ${client?.name}`,
        description: `${item.description} de ${money(item.amount)} vence${distance < 0 ? 'u' : ''} em ${formatDate(item.dueDate)}.`,
        recommendation: item.status === 'overdue' ? 'Enviar cobrança e registrar retorno.' : 'Preparar lembrete de mensalidade.',
      });
    }
  });

  data.projects.forEach((project) => {
    if (project.status !== 'done' && daysUntil(project.dueDate) <= 7) {
      insights.push({
        id: `project-${project.id}`,
        level: 'info',
        title: `Projeto em foco: ${project.name}`,
        description: `Prazo em ${formatDate(project.dueDate)} com ${project.progress}% de progresso.`,
        recommendation: project.nextAction,
      });
    }
  });

  if (!insights.length) {
    insights.push({
      id: 'all-clear',
      level: 'good',
      title: 'Operação sem alertas críticos',
      description: 'Nenhum pagamento, campanha ou projeto exige atenção imediata agora.',
      recommendation: 'Aproveite para revisar criativos, métricas e próximos testes.',
    });
  }

  return insights;
};
