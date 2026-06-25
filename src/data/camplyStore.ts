import { ActivityLog, CamplyData, CampaignStatus, Insight, PaymentStatus, ProjectStatus } from '../types';

const STORAGE_KEY = 'camply-data-v2';

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
};

export const normalizeData = (data: Partial<CamplyData>): CamplyData => {
  const parsed = { ...initialData, ...data } as CamplyData;

  return {
    ...parsed,
    clients: parsed.clients.map((client) => ({
      ...client,
      projectId: client.projectId ?? '',
      managementFeeType: client.managementFeeType ?? 'recurring',
      adInvestmentPeriod: client.adInvestmentPeriod ?? 'monthly',
      adInvestmentMeta: client.adInvestmentMeta ?? 0,
      adInvestmentGoogle: client.adInvestmentGoogle ?? 0,
      adInvestmentYoutube: client.adInvestmentYoutube ?? 0,
      adInvestmentTikTok: client.adInvestmentTikTok ?? 0,
    })),
    projects: parsed.projects.map((project) => ({
      ...project,
      projectType: project.projectType ?? (project.billingType === 'recurring' ? 'traffic' : 'site'),
      clientId: project.clientId ?? parsed.clients[0]?.id ?? '',
      ownerName: project.ownerName ?? '',
      company: project.company ?? '',
      billingType: project.billingType ?? 'one_time',
      amountCharged: project.amountCharged ?? 0,
      amountReceived: project.amountReceived ?? 0,
      deliveredUrl: project.deliveredUrl ?? '',
      visibility: project.visibility ?? 'private',
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
  };
};

export const loadData = (): CamplyData => {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return initialData;

  try {
    return normalizeData(JSON.parse(stored));
  } catch {
    return initialData;
  }
};

export const saveData = (data: CamplyData) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

export const createActivityLog = (input: Omit<ActivityLog, 'id' | 'actor' | 'createdAt'>): ActivityLog => ({
  id: makeId('log'),
  actor: 'Gustavo',
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
    const daysWithoutOptimization = Math.abs(daysUntil(campaign.lastOptimizedAt));
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
