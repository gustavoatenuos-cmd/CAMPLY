import { CalendarClock, Check, Plus } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { createActivityLog, formatDate, makeId, money, paymentStatusLabels } from '../data/camplyStore';
import { buildOperationalView, OperationalEntry, ReceivablesFilter } from '../data/receivablesForecast';
import { Modal } from './ui/Modal';
import { CamplyData, PaymentStatus, Receivable } from '../types';
import { clientDisplayName, clientOptionLabel } from './ClientsView';
import { ClientFormModal } from './ClientFormModal';
import { ReceivablesFilterBar } from './receivables/ReceivablesFilterBar';
import { OperationalEntryRow } from './receivables/OperationalEntryRow';

interface PersonalFinanceViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function PersonalFinanceView({ data, updateData }: PersonalFinanceViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReceivablesFilter>('current_next');
  const view = useMemo(() => buildOperationalView(data), [data]);

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
      paidAt: String(form.get('status') ?? 'pending') === 'paid' ? new Date().toISOString().slice(0, 10) : undefined,
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

  const setReceivableStatus = (id: string, status: PaymentStatus) => {
    const receivable = data.receivables.find((item) => item.id === id);
    const client = data.clients.find((item) => item.id === receivable?.clientId);
    const paidAt = status === 'paid' ? new Date().toISOString().slice(0, 10) : undefined;
    updateData((current) => ({
      ...current,
      receivables: current.receivables.map((item) => (item.id === id ? { ...item, status, paidAt } : item)),
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

  const updateEntry = (entry: OperationalEntry, updates: { status?: PaymentStatus; amount?: number }) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const newStatus = updates.status !== undefined ? updates.status : (entry.status === 'upcoming' ? 'pending' : entry.status);
    const newAmount = updates.amount !== undefined ? updates.amount : entry.amount;
    const isPaid = newStatus === 'paid';

    if (entry.source === 'client' && entry.clientId) {
      if (entry.receivableId) {
        updateData((current) => ({
          ...current,
          receivables: current.receivables.map((r) => (r.id === entry.receivableId ? {
            ...r,
            status: newStatus,
            amount: newAmount,
            paidAt: isPaid && !r.paidAt ? todayStr : r.paidAt,
          } : r)),
        }));
      } else {
        const receivable: Receivable = {
          id: makeId('recv'),
          clientId: entry.clientId,
          description: entry.description,
          amount: newAmount,
          dueDate: entry.dueDate,
          status: newStatus,
          paidAt: isPaid ? todayStr : undefined,
        };
        updateData((current) => ({
          ...current,
          receivables: [receivable, ...current.receivables],
        }));
      }
    } else if (entry.source === 'project' && entry.projectId) {
      updateData((current) => ({
        ...current,
        projects: current.projects.map((p) => (p.id === entry.projectId ? {
          ...p,
          paymentStatus: newStatus,
          ...(updates.amount !== undefined ? { amountCharged: p.amountReceived + newAmount } : {}),
          paidAt: isPaid && !p.paidAt ? todayStr : p.paidAt,
        } : p)),
      }));
    }
  };

  const recorrenciasEntries = useMemo(() => {
    if (filter === 'current') return view.currentMonthEntries;
    if (filter === 'next') return view.nextMonthEntries;
    if (filter === 'current_next') {
      return [...view.currentMonthEntries, ...view.nextMonthEntries].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    }
    return [];
  }, [filter, view.currentMonthEntries, view.nextMonthEntries]);

  const showAtrasadosMesAtual = filter === 'current' || filter === 'current_next';
  const showAtrasadosTodos = filter === 'overdue';
  const showRecorrencias = filter === 'current' || filter === 'next' || filter === 'current_next';
  const showHistorico = filter === 'all';
  const visibleProjects = data.projects.filter((project) => filter === 'all' || project.status !== 'done');

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
                    {clientOptionLabel(client, data.projects)}
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
        <Total label="Previsto este mês" value={money(view.cards.currentMonthForecast)} />
        <Total label="Recebido este mês" value={money(view.cards.currentMonthReceived)} tone="good" />
        <Total label="Atrasado este mês" value={money(view.cards.currentMonthOverdue)} tone="danger" />
        <Total label="Previsto próximo mês" value={money(view.cards.nextMonthForecast)} />
      </div>

      <ReceivablesFilterBar value={filter} onChange={setFilter} />

      {(showAtrasadosMesAtual || showAtrasadosTodos) && (
        <EntryListBlock
          title={showAtrasadosTodos ? 'Atrasados' : 'Atrasados do mês atual'}
          emptyMessage="Nenhum recebimento em atraso por aqui."
          entries={showAtrasadosTodos ? view.overdueAllEntries : view.overdueCurrentMonthEntries}
          onStatusChange={(entry, status) => updateEntry(entry, { status })}
          onAmountEdit={(entry, amount) => updateEntry(entry, { amount })}
          onTitleClick={setEditingClientId}
        />
      )}

      {showRecorrencias && (
        <EntryListBlock
          title="Recorrências previstas"
          emptyMessage="Cadastre mensalidades recorrentes nos clientes ou projetos pontuais para o sistema montar a previsão."
          entries={recorrenciasEntries}
          onStatusChange={(entry, status) => updateEntry(entry, { status })}
          onAmountEdit={(entry, amount) => updateEntry(entry, { amount })}
          onTitleClick={setEditingClientId}
          icon={<CalendarClock size={17} className="text-brand-green" />}
        />
      )}

      {showHistorico && (
        <div className="mb-6 overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
          <div className="border-b border-brand-line p-4">
            <h2 className="font-bold text-white">Histórico completo de recebíveis</h2>
          </div>
          {view.historyEntries.map((entry) => (
            <div key={entry.id} className="grid gap-3 border-b border-brand-line p-4 text-sm last:border-b-0 xl:grid-cols-[1fr_1fr_0.7fr_0.7fr_0.8fr] xl:items-center">
              <p className="font-semibold text-white">{entry.title}</p>
              <p className="text-brand-muted">{entry.description}</p>
              <div>
                <p className="text-brand-muted">{formatDate(entry.dueDate)}</p>
                {entry.paidAt && <p className="mt-1 text-xs font-semibold text-brand-green">Pago: {formatDate(entry.paidAt)}</p>}
              </div>
              <p className="font-bold text-brand-green">{money(entry.amount)}</p>
              <div className="flex items-center gap-2">
                <select
                  value={entry.status}
                  onChange={(event) => entry.receivableId && setReceivableStatus(entry.receivableId, event.target.value as PaymentStatus)}
                  className="rounded-md border border-brand-line bg-brand-surface px-2 py-1 text-xs text-white"
                >
                  <option value="pending">{paymentStatusLabels.pending}</option>
                  <option value="overdue">{paymentStatusLabels.overdue}</option>
                  <option value="paid">{paymentStatusLabels.paid}</option>
                </select>
                {entry.status !== 'paid' && entry.receivableId && (
                  <button onClick={() => setReceivableStatus(entry.receivableId!, 'paid')} className="rounded-md bg-brand-green/10 p-1.5 text-brand-green">
                    <Check size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
        <div className="border-b border-brand-line p-4">
          <h2 className="font-bold text-white">Projetos vinculados ao financeiro</h2>
        </div>
        <div className="hidden grid-cols-[1fr_1fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-brand-line bg-brand-surface/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-brand-soft xl:grid">
          <p>Projeto</p>
          <p>Cliente Principal</p>
          <p>Soma Total</p>
          <p>Taxa Recebida</p>
          <p>A Receber / Recorrência</p>
        </div>
        {visibleProjects.map((project) => {
          const primaryClient = data.clients.find((clientItem) => clientItem.id === project.clientId);
          const projectClients = data.clients.filter((client) => client.projectId === project.id);

          const recurringTotal = projectClients
            .filter((client) => client.managementFeeType === 'recurring')
            .reduce((sum, client) => sum + client.monthlyFee, 0);
          const oneTimeTotal = projectClients
            .filter((client) => client.managementFeeType === 'one_time')
            .reduce((sum, client) => sum + client.monthlyFee, 0);

          const projectAmount = project.billingType === 'recurring' ? recurringTotal + oneTimeTotal + project.amountCharged : project.amountCharged;
          const remainingProjectFee = project.paymentStatus === 'paid' ? 0 : Math.max(0, project.amountCharged - project.amountReceived);

          const remainingTotal = project.billingType === 'recurring'
            ? recurringTotal + remainingProjectFee
            : remainingProjectFee;

          return (
            <div key={project.id} className="border-b border-brand-line last:border-b-0">
              <div className="grid gap-3 p-4 text-sm xl:grid-cols-[1fr_1fr_0.8fr_0.8fr_0.8fr] xl:items-center">
                <div>
                  <p className="font-semibold text-white">{project.name}</p>
                  <p className="text-xs text-brand-muted">{project.billingType === 'recurring' ? 'Trabalho recorrente' : 'Entrega pontual'}</p>
                </div>
                <p className="text-brand-muted">{clientDisplayName(primaryClient)}</p>
                <p className="text-brand-muted">{money(projectAmount)}</p>
                <p className="text-brand-muted">{money(project.amountReceived)}</p>
                <p className="font-bold text-brand-green">{money(remainingTotal)}</p>
              </div>

              {project.billingType === 'recurring' && (projectClients.length > 0 || project.amountCharged > 0) && (
                <div className="bg-brand-ink p-4 pt-0">
                  <div className="mt-1 rounded-lg border border-brand-line bg-brand-surface p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-soft">Composição do projeto recorrente</p>
                    {projectClients.map((client) => (
                      <div key={client.id} className="flex justify-between py-1.5 text-sm border-b border-brand-line/50 last:border-0">
                        <span className="text-brand-muted">{clientDisplayName(client)}</span>
                        <span className="font-semibold text-white">{money(client.monthlyFee)} {client.managementFeeType === 'recurring' ? '/mês' : '(pontual)'}</span>
                      </div>
                    ))}
                    {project.amountCharged > 0 && (
                      <div className="flex justify-between py-1.5 text-sm border-b border-brand-line/50 last:border-0">
                        <span className="text-brand-muted">Taxa fixa do projeto ({project.name})</span>
                        <span className="font-semibold text-white">{money(project.amountCharged)} {project.paymentStatus === 'paid' ? `(Paga${project.paidAt ? ` em ${formatDate(project.paidAt)}` : ''})` : '(Pendente)'}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ClientFormModal
        data={data}
        updateData={updateData}
        editingClient={data.clients.find((c) => c.id === editingClientId)}
        open={!!editingClientId}
        onClose={() => setEditingClientId(null)}
      />
    </section>
  );
}

interface EntryListBlockProps {
  title: string;
  emptyMessage: string;
  entries: OperationalEntry[];
  onStatusChange: (entry: OperationalEntry, status: PaymentStatus) => void;
  onAmountEdit: (entry: OperationalEntry, amount: number) => void;
  onTitleClick: (clientId: string) => void;
  icon?: React.ReactNode;
}

function EntryListBlock({ title, emptyMessage, entries, onStatusChange, onAmountEdit, onTitleClick, icon }: EntryListBlockProps) {
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
      <div className="flex items-center gap-2 border-b border-brand-line p-4">
        {icon}
        <h2 className="font-bold text-white">{title}</h2>
      </div>
      {entries.length === 0 ? (
        <div className="p-5 text-sm text-brand-muted">{emptyMessage}</div>
      ) : (
        entries.map((entry) => (
          <OperationalEntryRow
            key={entry.id}
            entry={entry}
            onStatusChange={onStatusChange}
            onAmountEdit={onAmountEdit}
            onTitleClick={onTitleClick}
          />
        ))
      )}
    </div>
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
