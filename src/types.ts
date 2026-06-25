export type ViewId = 'today' | 'campaigns' | 'clients' | 'mediaFinance' | 'projects' | 'personalFinance' | 'intelligence';

export type CampaignStatus = 'setup' | 'launching' | 'live' | 'optimize' | 'waiting' | 'paused';
export type ClientStatus = 'active' | 'lead' | 'paused';
export type PaymentStatus = 'pending' | 'paid' | 'overdue';
export type ProjectStatus = 'planning' | 'active' | 'waiting' | 'done';
export type Priority = 'low' | 'medium' | 'high';

export interface Client {
  id: string;
  name: string;
  company: string;
  segment: string;
  structure: string;
  hasProject: boolean;
  contact: string;
  monthlyFee: number;
  dueDay: number;
  adInvestmentMeta: number;
  adInvestmentGoogle: number;
  adInvestmentYoutube: number;
  adInvestmentTikTok: number;
  status: ClientStatus;
  notes: string;
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
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  role: string;
  status: ProjectStatus;
  progress: number;
  dueDate: string;
  amountCharged: number;
  amountReceived: number;
  deliveredUrl: string;
  visibility: 'private' | 'portfolio' | 'public';
  nextAction: string;
}

export interface Task {
  id: string;
  title: string;
  dueDate: string;
  area: 'campanhas' | 'clientes' | 'financeiro' | 'projetos';
  done: boolean;
}

export interface CamplyData {
  clients: Client[];
  campaigns: Campaign[];
  receivables: Receivable[];
  projects: Project[];
  tasks: Task[];
}

export interface Insight {
  id: string;
  level: 'critical' | 'warning' | 'good' | 'info';
  title: string;
  description: string;
  recommendation: string;
}
