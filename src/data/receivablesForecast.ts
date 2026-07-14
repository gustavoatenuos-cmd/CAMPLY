import { CamplyData, Client, PaymentStatus, Project } from '../types';
import { clientDisplayName } from './clientDisplay';

export type ForecastStatus = PaymentStatus | 'upcoming';

export type ReceivablesFilter = 'current' | 'next' | 'current_next' | 'overdue' | 'all';

export interface OperationalEntry {
  id: string;
  source: 'client' | 'project';
  receivableId?: string;
  clientId?: string;
  projectId?: string;
  title: string;
  description: string;
  projectName: string;
  amount: number;
  dueDate: string;
  monthKey: string;
  status: ForecastStatus;
  paidAt?: string;
  active: boolean;
}

export interface OperationalCards {
  currentMonthForecast: number;
  currentMonthReceived: number;
  currentMonthOverdue: number;
  nextMonthForecast: number;
}

export interface OperationalView {
  cards: OperationalCards;
  currentMonthEntries: OperationalEntry[];
  nextMonthEntries: OperationalEntry[];
  overdueCurrentMonthEntries: OperationalEntry[];
  overdueAllEntries: OperationalEntry[];
  historyEntries: OperationalEntry[];
}

export const isProjectActive = (project?: Project) => !project || project.status !== 'done';
export const isClientActive = (client?: Client) => client?.status === 'active';

export function toLocalISODate(date: Date) {
  const normalized = normalizeDate(date);
  normalized.setMinutes(normalized.getMinutes() - normalized.getTimezoneOffset());
  return normalized.toISOString().slice(0, 10);
}

export function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return normalizeDate(new Date(year, (month || 1) - 1, day || 1));
}

export function monthKeyOf(value: string | Date) {
  return typeof value === 'string' ? value.slice(0, 7) : toLocalISODate(value).slice(0, 7);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function dueDateForMonth(date: Date, preferredDay: number) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(Math.max(preferredDay, 1), lastDay);
  return toLocalISODate(new Date(year, month, safeDay));
}

function inferForecastStatus(dueDate: string, today: Date, currentMonthKey: string): ForecastStatus {
  const parsedDueDate = parseLocalDate(dueDate);
  if (parsedDueDate.getTime() < today.getTime()) return 'overdue';
  return monthKeyOf(dueDate) === currentMonthKey ? 'pending' : 'upcoming';
}

/**
 * Um cliente pode ter mais de um recebível real na mesma competência (a
 * mensalidade recorrente + uma cobrança avulsa). Para não vincular a
 * previsão à cobrança errada, prioriza-se: (1) mesma data exata de
 * vencimento; (2) mesmo mês, escolhendo o valor mais próximo de
 * `monthlyFee`. Quando `dueDate` é omitido, busca em qualquer competência -
 * usado para detectar se uma cobrança pontual já foi lançada alguma vez.
 */
function findMatchingReceivable(receivables: CamplyData['receivables'], client: Client, dueDate?: string) {
  const forClient = receivables.filter((receivable) => receivable.clientId === client.id);
  if (!dueDate) {
    return forClient
      .slice()
      .sort((a, b) => Math.abs(a.amount - client.monthlyFee) - Math.abs(b.amount - client.monthlyFee))[0];
  }

  const exactDateMatch = forClient.find((receivable) => receivable.dueDate === dueDate);
  if (exactDateMatch) return exactDateMatch;

  return forClient
    .filter((receivable) => monthKeyOf(receivable.dueDate) === monthKeyOf(dueDate))
    .sort((a, b) => Math.abs(a.amount - client.monthlyFee) - Math.abs(b.amount - client.monthlyFee))[0];
}

/**
 * Recorrência mensal de clientes ativos: gera no máximo 1 linha para o mês
 * atual e 1 para o próximo (nunca mais). Clientes com cobrança pontual
 * (one_time) geram só a linha do mês atual.
 */
function buildClientEntries(data: CamplyData, today: Date, currentMonthKey: string): OperationalEntry[] {
  return data.clients.flatMap((client): OperationalEntry[] => {
    if (client.monthlyFee <= 0) return [];
    // Cobrança pontual: uma vez que exista um recebível compatível com a taxa
    // (em qualquer mês), o valor já foi lançado - não gerar nova previsão
    // fantasma a cada mês seguinte.
    if (client.managementFeeType === 'one_time' && findMatchingReceivable(data.receivables, client)) return [];

    const project = data.projects.find((item) => item.id === client.projectId);
    const active = isClientActive(client) && isProjectActive(project);
    const dueDay = client.dueDay || today.getDate();
    const monthOffsets = client.managementFeeType === 'recurring' ? [0, 1] : [0];

    return monthOffsets.map((monthOffset) => {
      const dueDate = dueDateForMonth(addMonths(today, monthOffset), dueDay);
      const existingReceivable = findMatchingReceivable(data.receivables, client, dueDate);

      return {
        id: `client-${client.id}-${monthKeyOf(dueDate)}`,
        source: 'client',
        receivableId: existingReceivable?.id,
        clientId: client.id,
        projectId: project?.id,
        title: clientDisplayName(client),
        description: client.managementFeeType === 'recurring'
          ? `Mensalidade recorrente - vence dia ${dueDay}`
          : 'Serviço pontual cadastrado no cliente',
        projectName: project?.name || '',
        amount: existingReceivable ? existingReceivable.amount : client.monthlyFee,
        dueDate: existingReceivable ? existingReceivable.dueDate : dueDate,
        monthKey: monthKeyOf(existingReceivable ? existingReceivable.dueDate : dueDate),
        paidAt: existingReceivable?.paidAt,
        status: existingReceivable ? existingReceivable.status : inferForecastStatus(dueDate, today, currentMonthKey),
        active,
      };
    });
  });
}

/** Cobranças pontuais de projetos ativos com saldo em aberto. */
function buildProjectEntries(data: CamplyData, today: Date, currentMonthKey: string): OperationalEntry[] {
  return data.projects
    .filter((project) => project.billingType === 'one_time')
    .map((project): OperationalEntry => {
      const client = data.clients.find((item) => item.id === project.clientId);
      const active = isProjectActive(project) && isClientActive(client);
      const amount = Math.max(0, project.amountCharged - project.amountReceived);
      const dueDate = project.dueDate || toLocalISODate(today);
      return {
        id: `project-${project.id}`,
        source: 'project',
        projectId: project.id,
        clientId: project.clientId,
        title: project.company || project.name,
        description: `Projeto pontual - ${project.name}`,
        projectName: project.ownerName || 'Projeto direto',
        amount,
        dueDate,
        monthKey: monthKeyOf(dueDate),
        paidAt: project.paidAt,
        status: project.paymentStatus === 'paid' ? 'paid' : inferForecastStatus(dueDate, today, currentMonthKey),
        active,
      };
    })
    .filter((item) => item.amount > 0 || item.status === 'paid');
}

function mapReceivableEntry(data: CamplyData, receivable: CamplyData['receivables'][number]): OperationalEntry {
  const client = data.clients.find((item) => item.id === receivable.clientId);
  const project = data.projects.find((item) => item.id === client?.projectId);
  return {
    id: `receivable-${receivable.id}`,
    source: 'client',
    receivableId: receivable.id,
    clientId: receivable.clientId,
    projectId: project?.id,
    title: clientDisplayName(client),
    description: receivable.description,
    projectName: project?.name || '',
    amount: receivable.amount,
    dueDate: receivable.dueDate,
    monthKey: monthKeyOf(receivable.dueDate),
    paidAt: receivable.paidAt,
    status: receivable.status,
    active: isClientActive(client) && isProjectActive(project),
  };
}

function sum(entries: OperationalEntry[]) {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}

/**
 * Monta a visão operacional: recebíveis reais + previsão de recorrência dos
 * próximos 2 meses, restrita a clientes/projetos ativos, sem duplicar
 * previsão quando já existe um recebível real lançado para a competência.
 */
export function buildOperationalView(data: CamplyData, referenceDate: Date = new Date()): OperationalView {
  const today = normalizeDate(referenceDate);
  const currentMonthKey = monthKeyOf(toLocalISODate(today));
  const nextMonthKey = monthKeyOf(addMonths(today, 1));

  const clientEntries = buildClientEntries(data, today, currentMonthKey);
  const projectEntries = buildProjectEntries(data, today, currentMonthKey);

  const receivableIdsCoveredByForecast = new Set(
    clientEntries.filter((entry) => entry.receivableId).map((entry) => entry.receivableId),
  );
  const looseReceivableEntries = data.receivables
    .filter((receivable) => !receivableIdsCoveredByForecast.has(receivable.id))
    .map((receivable) => mapReceivableEntry(data, receivable));

  const allActiveEntries = [...clientEntries, ...projectEntries, ...looseReceivableEntries].filter((entry) => entry.active);

  const currentMonthEntries = allActiveEntries
    .filter((entry) => entry.monthKey === currentMonthKey && entry.status !== 'overdue')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const nextMonthEntries = allActiveEntries
    .filter((entry) => entry.monthKey === nextMonthKey)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueCurrentMonthEntries = allActiveEntries
    .filter((entry) => entry.monthKey === currentMonthKey && entry.status === 'overdue')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueAllEntries = allActiveEntries
    .filter((entry) => entry.status === 'overdue')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const historyEntries = data.receivables
    .map((receivable) => mapReceivableEntry(data, receivable))
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  const cards: OperationalCards = {
    currentMonthForecast: sum(
      allActiveEntries.filter((entry) => entry.monthKey === currentMonthKey && entry.status !== 'paid'),
    ),
    currentMonthReceived: sum(
      allActiveEntries.filter((entry) => entry.monthKey === currentMonthKey && entry.status === 'paid'),
    ),
    currentMonthOverdue: sum(overdueCurrentMonthEntries),
    nextMonthForecast: sum(
      allActiveEntries.filter((entry) => entry.monthKey === nextMonthKey && entry.status !== 'paid'),
    ),
  };

  return {
    cards,
    currentMonthEntries,
    nextMonthEntries,
    overdueCurrentMonthEntries,
    overdueAllEntries,
    historyEntries,
  };
}
