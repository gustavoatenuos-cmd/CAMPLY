import { CalendarClock, Check, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { createActivityLog, formatDate, makeId, money, paymentStatusLabels } from '../data/camplyStore';
import { Modal } from './ui/Modal';
import { CamplyData, PaymentStatus, Receivable } from '../types';
import { clientDisplayName, clientOptionLabel } from './ClientsView';

interface PersonalFinanceViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function PersonalFinanceView({ data, updateData }: PersonalFinanceViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const forecast = buildFinancialForecast(data);
  const pending = data.receivables.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amount, 0);
  const overdue = data.receivables.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + item.amount, 0);
  const paid = data.receivables.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.amount, 0);
  const projectsToReceive = forecast.items.filter((item) => item.source === 'project' && item.status !== 'paid').reduce((sum, item) => sum + item.amount, 0);

  const addReceivable = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientId = String(form.get('clientId') ?? '');
    const amount = Number(form.get('amount') ?? 0);
    const client = data.clients.find((item) => item.id === clientId);
    if (!client || !amount) return;
    const receivable: Receivable = {
      id: makeId('recv'),
      clientId,
      description: String(form.get('description') ?? ''),
      amount,
      dueDate: String(form.get('dueDate') ?? new Date().toISOString().slice(0, 10)),
      status: String(form.get('status') ?? 'pending') as PaymentStatus,
    };
    updateData((current) => ({
      ...current,
      receivables: [receivable, ...current.receivables],
      activityLogs: [
        createActivityLog({
          action: 'receivable_created',
          title: `Recebimento criado: ${clientDisplayName(client)}`,
          description: `${receivable.description || 'Cobrança'} no valor de ${money(receivable.amount)} com vencimento em ${formatDate(receivable.dueDate)}.`,
          projectId: client.projectId,
          clientId: client.id,
          campaignId: '',
          receivableId: receivable.id,
          taskId: '',
        }),
        ...current.activityLogs,
      ],
    }));
    setModalOpen(false);
    event.currentTarget.reset();
  };

  const setStatus = (id: string, status: PaymentStatus) => {
    const receivable = data.receivables.find((item) => item.id === id);
    const client = data.clients.find((item) => item.id === receivable?.clientId);
    updateData((current) => ({
      ...current,
      receivables: current.receivables.map((item) => (item.id === id ? { ...item, status } : item)),
      activityLogs: receivable
        ? [
            createActivityLog({
              action: 'receivable_status_changed',
              title: status === 'paid' ? `Pagamento recebido: ${clientDisplayName(client)}` : `Status financeiro alterado: ${clientDisplayName(client)}`,
              description: `${receivable.description || 'Recebível'} de ${money(receivable.amount)} foi marcado como ${paymentStatusLabels[status]}.`,
              projectId: client?.projectId ?? '',
              clientId: receivable.clientId,
              campaignId: '',
              receivableId: receivable.id,
              taskId: '',
            }),
            ...current.activityLogs,
          ]
        : current.activityLogs,
    }));
  };

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Meu financeiro</p>
          <h1 className="mt-1 text-2xl font-black text-white">Recebimentos da operação</h1>
        </div>
        <button onClick={() => setModalOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-brand-ink">
          <Plus size={18} />
          Novo recebimento
        </button>
      </div>

      <Modal title="Novo recebimento" description="Cadastre mensalidades, parcelas ou cobranças próprias da operação." open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={addReceivable} className="space-y-5 p-5">
          {data.clients.length === 0 && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              Cadastre um cliente antes de lançar recebimentos.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Cliente</span>
              <select name="clientId" required className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="">Selecione</option>
                {data.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {clientOptionLabel(client)}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Descrição" name="description" placeholder="Ex: mensalidade, setup, parcela do projeto" required />
            <MoneyField label="Valor" name="amount" required />
            <Field label="Vencimento" name="dueDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Status</span>
              <select name="status" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="pending">{paymentStatusLabels.pending}</option>
                <option value="overdue">{paymentStatusLabels.overdue}</option>
                <option value="paid">{paymentStatusLabels.paid}</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-3 border-t border-brand-line pt-5">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft">Cancelar</button>
            <button disabled={data.clients.length === 0} className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink disabled:opacity-50">Salvar recebimento</button>
          </div>
        </form>
      </Modal>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Total label="Previsto este mês" value={money(forecast.currentMonthTotal)} />
        <Total label="Atrasado" value={money(overdue + forecast.overdueTotal)} tone="danger" />
        <Total label="Projetos a receber" value={money(projectsToReceive)} />
        <Total label="Recebido" value={money(paid)} tone="good" />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Total label="Mensalidades pendentes" value={money(pending + forecast.currentMonthPending)} />
        <Total label="Próximos 30 dias" value={money(forecast.next30DaysTotal)} />
        <Total label="Próximo mês" value={money(forecast.nextMonthTotal)} />
        <Total label="Próximos 3 meses" value={money(forecast.nextThreeMonthsTotal)} />
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
        <div className="flex items-center gap-2 border-b border-brand-line p-4">
          <CalendarClock size={17} className="text-brand-green" />
          <h2 className="font-bold text-white">Previsão automática de recebimentos</h2>
        </div>
        {forecast.items.length === 0 ? (
          <div className="p-5 text-sm text-brand-muted">
            Cadastre mensalidades recorrentes nos clientes ou projetos pontuais para o sistema montar a previsão.
          </div>
        ) : (
          forecast.items.slice(0, 12).map((item) => (
            <div key={item.id} className="grid gap-3 border-b border-brand-line p-4 text-sm last:border-b-0 xl:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr] xl:items-center">
              <div>
                <p className="font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-xs text-brand-muted">{item.description}</p>
              </div>
              <p className="text-brand-muted">{item.projectName || 'Cliente direto'}</p>
              <p className="text-brand-muted">{formatDate(item.dueDate)}</p>
              <p className="font-bold text-brand-green">{money(item.amount)}</p>
              <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${forecastStatusClass(item.status)}`}>
                {forecastStatusLabel(item.status)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
        <div className="border-b border-brand-line p-4">
          <h2 className="font-bold text-white">Mensalidades e recebíveis</h2>
        </div>
        {data.receivables.map((item) => {
          const client = data.clients.find((clientItem) => clientItem.id === item.clientId);
          return (
            <div key={item.id} className="grid gap-3 border-b border-brand-line p-4 text-sm last:border-b-0 xl:grid-cols-[1fr_1fr_0.7fr_0.7fr_0.8fr] xl:items-center">
              <p className="font-semibold text-white">{clientDisplayName(client)}</p>
              <p className="text-brand-muted">{item.description}</p>
              <p className="text-brand-muted">{formatDate(item.dueDate)}</p>
              <p className="font-bold text-brand-green">{money(item.amount)}</p>
              <div className="flex items-center gap-2">
                <select value={item.status} onChange={(event) => setStatus(item.id, event.target.value as PaymentStatus)} className="rounded-md border border-brand-line bg-brand-surface px-2 py-1 text-xs text-white">
                  <option value="pending">{paymentStatusLabels.pending}</option>
                  <option value="overdue">{paymentStatusLabels.overdue}</option>
                  <option value="paid">{paymentStatusLabels.paid}</option>
                </select>
                {item.status !== 'paid' && (
                  <button onClick={() => setStatus(item.id, 'paid')} className="rounded-md bg-brand-green/10 p-1.5 text-brand-green">
                    <Check size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
        <div className="border-b border-brand-line p-4">
          <h2 className="font-bold text-white">Projetos vinculados ao financeiro</h2>
        </div>
        {data.projects.map((project) => {
          const client = data.clients.find((clientItem) => clientItem.id === project.clientId);
          const remaining = project.paymentStatus === 'paid' ? 0 : Math.max(0, project.amountCharged - project.amountReceived);
          return (
            <div key={project.id} className="grid gap-3 border-b border-brand-line p-4 text-sm last:border-b-0 xl:grid-cols-[1fr_1fr_0.8fr_0.8fr_0.8fr] xl:items-center">
              <p className="font-semibold text-white">{project.name}</p>
              <p className="text-brand-muted">{clientDisplayName(client)}</p>
              <p className="text-brand-muted">{money(project.amountCharged)}</p>
              <p className="text-brand-muted">{money(project.amountReceived)}</p>
              <p className="font-bold text-brand-green">{money(remaining)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Field({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-brand-soft">{label}</span>
      <input name={name} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" {...props} />
    </label>
  );
}

function MoneyField({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-brand-soft">{label}</span>
      <div className="flex rounded-lg border border-brand-line bg-brand-surface focus-within:border-brand-green">
        <span className="grid place-items-center border-r border-brand-line px-3 text-sm font-bold text-brand-green">R$</span>
        <input name={name} type="number" min="0" step="0.01" className="w-full bg-transparent px-3 py-2 text-white outline-none" {...props} />
      </div>
    </label>
  );
}

function Total({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' | 'good' }) {
  const color = tone === 'danger' ? 'text-rose-400' : tone === 'good' ? 'text-brand-green' : 'text-white';
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
      <p className="text-sm text-brand-muted">{label}</p>
      <p className={`mt-3 text-2xl font-black ${color}`}>{value}</p>
    </div>
  );
}

type ForecastStatus = PaymentStatus | 'upcoming';

type ForecastItem = {
  id: string;
  source: 'client' | 'project';
  title: string;
  description: string;
  projectName: string;
  amount: number;
  dueDate: string;
  status: ForecastStatus;
};

function buildFinancialForecast(data: CamplyData) {
  const today = normalizeDate(new Date());
  const currentMonthKey = monthKey(toLocalISODate(today));
  const nextMonthKeyValue = monthKey(addMonths(today, 1));
  const clientItems = data.clients.flatMap((client): ForecastItem[] => {
    if (client.status !== 'active' || client.monthlyFee <= 0) return [];

    const project = data.projects.find((item) => item.id === client.projectId);
    const dueDay = client.dueDay || today.getDate();
    const monthsToProject = client.managementFeeType === 'recurring' ? [0, 1, 2] : [0];

    return monthsToProject.map((monthOffset) => {
      const dueDate = dueDateForMonth(addMonths(today, monthOffset), dueDay);
      const paidReceivable = data.receivables.some(
        (receivable) =>
          receivable.clientId === client.id &&
          receivable.status === 'paid' &&
          monthKey(receivable.dueDate) === monthKey(dueDate),
      );

      return {
        id: `client-${client.id}-${monthKey(dueDate)}`,
        source: 'client',
        title: clientDisplayName(client),
        description: client.managementFeeType === 'recurring'
          ? `Mensalidade recorrente - vence dia ${dueDay}`
          : 'Serviço pontual cadastrado no cliente',
        projectName: project?.name || '',
        amount: client.monthlyFee,
        dueDate,
        status: paidReceivable ? 'paid' : inferForecastStatus(dueDate, today, currentMonthKey),
      };
    });
  });

  const projectItems = data.projects
    .filter((project) => project.billingType === 'one_time' && project.paymentStatus !== 'paid')
    .map((project): ForecastItem => {
      const amount = Math.max(0, project.amountCharged - project.amountReceived);
      const dueDate = project.dueDate || toLocalISODate(today);
      return {
        id: `project-${project.id}`,
        source: 'project',
        title: project.company || project.name,
        description: `Projeto pontual - ${project.name}`,
        projectName: project.ownerName || 'Projeto direto',
        amount,
        dueDate,
        status: inferForecastStatus(dueDate, today, currentMonthKey),
      };
    })
    .filter((item) => item.amount > 0);

  const items = [...clientItems, ...projectItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const openItems = items.filter((item) => item.status !== 'paid');

  return {
    items,
    currentMonthTotal: sumForecast(openItems.filter((item) => monthKey(item.dueDate) === currentMonthKey)),
    currentMonthPending: sumForecast(openItems.filter((item) => item.source === 'client' && item.status === 'pending' && monthKey(item.dueDate) === currentMonthKey)),
    overdueTotal: sumForecast(openItems.filter((item) => item.status === 'overdue')),
    next30DaysTotal: sumForecast(
      openItems.filter((item) => {
        const days = daysBetween(today, parseLocalDate(item.dueDate));
        return days >= 0 && days <= 30;
      }),
    ),
    nextMonthTotal: sumForecast(openItems.filter((item) => monthKey(item.dueDate) === nextMonthKeyValue)),
    nextThreeMonthsTotal: sumForecast(openItems),
  };
}

function forecastStatusLabel(status: ForecastStatus) {
  if (status === 'paid') return 'Pago';
  if (status === 'overdue') return 'Atrasado';
  if (status === 'upcoming') return 'Próximo mês';
  return 'Pendente';
}

function forecastStatusClass(status: ForecastStatus) {
  if (status === 'paid') return 'bg-brand-green/10 text-brand-green';
  if (status === 'overdue') return 'bg-rose-500/10 text-rose-300';
  if (status === 'upcoming') return 'bg-sky-400/10 text-sky-200';
  return 'bg-amber-400/10 text-amber-200';
}

function inferForecastStatus(dueDate: string, today: Date, currentMonthKey: string): ForecastStatus {
  const parsedDueDate = parseLocalDate(dueDate);
  if (parsedDueDate.getTime() < today.getTime()) return 'overdue';
  return monthKey(dueDate) === currentMonthKey ? 'pending' : 'upcoming';
}

function sumForecast(items: ForecastItem[]) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function dueDateForMonth(date: Date, preferredDay: number) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(Math.max(preferredDay, 1), lastDay);
  return toLocalISODate(new Date(year, month, safeDay));
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function monthKey(value: string | Date) {
  return typeof value === 'string' ? value.slice(0, 7) : toLocalISODate(value).slice(0, 7);
}

function daysBetween(start: Date, end: Date) {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((normalizeDate(end).getTime() - normalizeDate(start).getTime()) / day);
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return normalizeDate(new Date(year, (month || 1) - 1, day || 1));
}

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toLocalISODate(date: Date) {
  const normalized = normalizeDate(date);
  normalized.setMinutes(normalized.getMinutes() - normalized.getTimezoneOffset());
  return normalized.toISOString().slice(0, 10);
}
