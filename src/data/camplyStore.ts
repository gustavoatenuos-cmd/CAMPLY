import { CamplyData, CampaignStatus, Insight, PaymentStatus, ProjectStatus } from '../types';

const STORAGE_KEY = 'camply-data-v1';

const today = new Date();

const dateFromNow = (days: number) => {
  const date = new Date(today);
  date.setDate(today.getDate() + days);
  return date.toISOString().slice(0, 10);
};

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
  clients: [
    {
      id: 'client-andreza',
      name: 'Andreza',
      segment: 'Mentoria e infoproduto',
      contact: 'andreza@cliente.com',
      monthlyFee: 1800,
      dueDay: 5,
      status: 'active',
      notes: 'Foco em leads via WhatsApp. Precisa de atenção semanal nos criativos.',
    },
    {
      id: 'client-sorriso',
      name: 'Clínica Sorriso',
      segment: 'Odontologia',
      contact: 'contato@sorriso.com',
      monthlyFee: 2200,
      dueDay: 10,
      status: 'active',
      notes: 'Campanhas de agendamento com meta de reduzir custo por conversa.',
    },
    {
      id: 'client-moda',
      name: 'E-commerce Moda',
      segment: 'Loja online',
      contact: 'contato@moda.com',
      monthlyFee: 2500,
      dueDay: 20,
      status: 'lead',
      notes: 'Aguardando aprovação de verba e contrato.',
    },
  ],
  campaigns: [
    {
      id: 'campaign-andreza-leads',
      clientId: 'client-andreza',
      name: 'Captação Leads - Junho',
      platform: 'Meta Ads',
      status: 'optimize',
      objective: 'Gerar conversas qualificadas no WhatsApp',
      budget: 5000,
      spent: 1840,
      lastOptimizedAt: dateFromNow(-5),
      nextAction: 'Revisar CPA, pausar criativo fraco e duplicar melhor conjunto.',
      priority: 'high',
    },
    {
      id: 'campaign-sorriso-agenda',
      clientId: 'client-sorriso',
      name: 'Agendamentos WhatsApp',
      platform: 'Meta Ads',
      status: 'live',
      objective: 'Aumentar agendamentos de avaliação',
      budget: 8000,
      spent: 3420,
      lastOptimizedAt: dateFromNow(-2),
      nextAction: 'Manter leitura até bater 72h da última otimização.',
      priority: 'medium',
    },
    {
      id: 'campaign-moda-remarketing',
      clientId: 'client-moda',
      name: 'Remarketing Carrinho',
      platform: 'Google Ads',
      status: 'setup',
      objective: 'Recuperar abandono de carrinho',
      budget: 3000,
      spent: 0,
      lastOptimizedAt: dateFromNow(-8),
      nextAction: 'Conferir tags, públicos e publicar campanha inicial.',
      priority: 'medium',
    },
  ],
  receivables: [
    {
      id: 'recv-andreza',
      clientId: 'client-andreza',
      description: 'Mensalidade gestão de tráfego',
      amount: 1800,
      dueDate: dateFromNow(-2),
      status: 'overdue',
    },
    {
      id: 'recv-sorriso',
      clientId: 'client-sorriso',
      description: 'Mensalidade gestão de tráfego',
      amount: 2200,
      dueDate: dateFromNow(4),
      status: 'pending',
    },
    {
      id: 'recv-moda',
      clientId: 'client-moda',
      description: 'Setup inicial',
      amount: 1200,
      dueDate: dateFromNow(10),
      status: 'pending',
    },
  ],
  projects: [
    {
      id: 'project-camply',
      name: 'Camply Assistente Operacional',
      role: 'Produto próprio',
      status: 'active',
      progress: 45,
      dueDate: dateFromNow(14),
      nextAction: 'Validar rotina diária, dados necessários e próximos módulos.',
    },
    {
      id: 'project-parceria',
      name: 'Parceria Funil Perpétuo',
      role: 'Gestor de mídia e estratégia',
      status: 'planning',
      progress: 20,
      dueDate: dateFromNow(21),
      nextAction: 'Definir oferta, verba inicial e meta de CPL.',
    },
  ],
  tasks: [
    {
      id: 'task-opt-andreza',
      title: 'Otimizar campanha da Andreza',
      area: 'campanhas',
      dueDate: dateFromNow(0),
      done: false,
    },
    {
      id: 'task-cobrar-andreza',
      title: 'Cobrar mensalidade atrasada da Andreza',
      area: 'financeiro',
      dueDate: dateFromNow(0),
      done: false,
    },
    {
      id: 'task-camply-brief',
      title: 'Organizar briefing dos próximos módulos do Camply',
      area: 'projetos',
      dueDate: dateFromNow(1),
      done: false,
    },
  ],
};

export const loadData = (): CamplyData => {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return initialData;

  try {
    return { ...initialData, ...JSON.parse(stored) };
  } catch {
    return initialData;
  }
};

export const saveData = (data: CamplyData) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

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
