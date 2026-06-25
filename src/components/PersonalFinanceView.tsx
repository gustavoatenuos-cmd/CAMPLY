import { Check, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { formatDate, makeId, money, paymentStatusLabels } from '../data/camplyStore';
import { Modal } from './ui/Modal';
import { CamplyData, PaymentStatus } from '../types';

interface PersonalFinanceViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function PersonalFinanceView({ data, updateData }: PersonalFinanceViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const pending = data.receivables.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amount, 0);
  const overdue = data.receivables.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + item.amount, 0);
  const paid = data.receivables.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.amount, 0);
  const projectsToReceive = data.projects.reduce((sum, project) => sum + Math.max(0, project.amountCharged - project.amountReceived), 0);

  const addReceivable = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientId = String(form.get('clientId') ?? '');
    const amount = Number(form.get('amount') ?? 0);
    if (!clientId || !amount) return;
    updateData((current) => ({
      ...current,
      receivables: [
        {
          id: makeId('recv'),
          clientId,
          description: String(form.get('description') ?? ''),
          amount,
          dueDate: String(form.get('dueDate') ?? new Date().toISOString().slice(0, 10)),
          status: String(form.get('status') ?? 'pending') as PaymentStatus,
        },
        ...current.receivables,
      ],
    }));
    setModalOpen(false);
    event.currentTarget.reset();
  };

  const setStatus = (id: string, status: PaymentStatus) => {
    updateData((current) => ({
      ...current,
      receivables: current.receivables.map((item) => (item.id === id ? { ...item, status } : item)),
    }));
  };

  return (
    <section className="h-full overflow-y-auto p-6 lg:p-8">
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
                {data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
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

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Total label="Mensalidades pendentes" value={money(pending)} />
        <Total label="Atrasado" value={money(overdue)} tone="danger" />
        <Total label="Projetos a receber" value={money(projectsToReceive)} />
        <Total label="Recebido" value={money(paid)} tone="good" />
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
        <div className="border-b border-brand-line p-4">
          <h2 className="font-bold text-white">Mensalidades e recebíveis</h2>
        </div>
        {data.receivables.map((item) => {
          const client = data.clients.find((clientItem) => clientItem.id === item.clientId);
          return (
            <div key={item.id} className="grid gap-3 border-b border-brand-line p-4 text-sm last:border-b-0 md:grid-cols-[1fr_1fr_0.7fr_0.7fr_0.8fr] md:items-center">
              <p className="font-semibold text-white">{client?.name}</p>
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
          const remaining = Math.max(0, project.amountCharged - project.amountReceived);
          return (
            <div key={project.id} className="grid gap-3 border-b border-brand-line p-4 text-sm last:border-b-0 md:grid-cols-[1fr_1fr_0.8fr_0.8fr_0.8fr] md:items-center">
              <p className="font-semibold text-white">{project.name}</p>
              <p className="text-brand-muted">{client?.name}</p>
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
