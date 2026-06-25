import { Edit3, Mail, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { createActivityLog, makeId, money, normalizeMonthlyInvestment } from '../data/camplyStore';
import { billingTypes, investmentPeriods } from '../data/options';
import { Modal } from './ui/Modal';
import { BillingType, CamplyData, ClientStatus, InvestmentPeriod } from '../types';

interface ClientsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function ClientsView({ data, updateData }: ClientsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const editingClient = data.clients.find((client) => client.id === editingClientId);

  const saveClient = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    const nextClient = {
      id: editingClient?.id ?? makeId('client'),
      projectId: String(form.get('projectId') ?? ''),
      name,
      company: String(form.get('company') ?? ''),
      segment: String(form.get('segment') ?? ''),
      structure: String(form.get('structure') ?? ''),
      hasProject: form.get('hasProject') === 'on',
      contact: String(form.get('contact') ?? ''),
      monthlyFee: Number(form.get('monthlyFee') ?? 0),
      managementFeeType: String(form.get('managementFeeType') ?? 'recurring') as BillingType,
      dueDay: Number(form.get('dueDay') ?? 10),
      adInvestmentPeriod: String(form.get('adInvestmentPeriod') ?? 'monthly') as InvestmentPeriod,
      adInvestmentMeta: Number(form.get('adInvestmentMeta') ?? 0),
      adInvestmentGoogle: Number(form.get('adInvestmentGoogle') ?? 0),
      adInvestmentYoutube: Number(form.get('adInvestmentYoutube') ?? 0),
      adInvestmentTikTok: Number(form.get('adInvestmentTikTok') ?? 0),
      status: String(form.get('status') ?? 'lead') as ClientStatus,
      notes: String(form.get('notes') ?? ''),
    };

    updateData((current) => ({
      ...current,
      clients: editingClient
        ? current.clients.map((client) => (client.id === editingClient.id ? nextClient : client))
        : [nextClient, ...current.clients],
      activityLogs: [
        createActivityLog({
          action: editingClient ? 'client_updated' : 'client_created',
          title: editingClient ? `Cliente editado: ${nextClient.name}` : `Cliente criado: ${nextClient.name}`,
          description: editingClient
            ? 'Dados comerciais, financeiros ou operacionais do cliente foram atualizados.'
            : `${nextClient.company || nextClient.segment || 'Cliente sem empresa informada'} entrou na base operacional.`,
          projectId: nextClient.projectId,
          clientId: nextClient.id,
          campaignId: '',
          receivableId: '',
          taskId: '',
        }),
        ...current.activityLogs,
      ],
    }));
    setModalOpen(false);
    setEditingClientId(null);
    event.currentTarget.reset();
  };

  const setStatus = (id: string, status: ClientStatus) => {
    const client = data.clients.find((item) => item.id === id);
    updateData((current) => ({
      ...current,
      clients: current.clients.map((client) => (client.id === id ? { ...client, status } : client)),
      activityLogs: client
        ? [
            createActivityLog({
              action: 'client_status_changed',
              title: `Status alterado: ${client.name}`,
              description: `Cliente movido para ${status}.`,
              projectId: client.projectId,
              clientId: client.id,
              campaignId: '',
              receivableId: '',
              taskId: '',
            }),
            ...current.activityLogs,
          ]
        : current.activityLogs,
    }));
  };

  return (
    <section className="h-full overflow-y-auto p-6 lg:p-8">
      <Header
        eyebrow="Clientes"
        title="Base comercial"
        action="Novo cliente"
        onAction={() => {
          setEditingClientId(null);
          setModalOpen(true);
        }}
      />
      <Modal
        title={editingClient ? 'Editar cliente' : 'Novo cliente'}
        description="Cadastre a empresa, estrutura trabalhada, investimento de mídia e dados operacionais."
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingClientId(null);
        }}
      >
        <form key={editingClient?.id ?? 'new-client'} onSubmit={saveClient} className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do responsável" name="name" defaultValue={editingClient?.name} required />
            <Field label="Empresa / marca" name="company" defaultValue={editingClient?.company} />
            <Field label="Segmento" name="segment" defaultValue={editingClient?.segment} placeholder="Ex: clínica, infoproduto, ecommerce" />
            <Field label="Contato principal" name="contact" defaultValue={editingClient?.contact} placeholder="E-mail, telefone ou WhatsApp" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Projeto guarda-chuva</span>
              <select name="projectId" defaultValue={editingClient?.projectId ?? ''} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="">Sem projeto</option>
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Tipo de serviço</span>
              <select name="managementFeeType" defaultValue={editingClient?.managementFeeType ?? 'recurring'} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                {billingTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Estrutura trabalhada</span>
            <textarea name="structure" defaultValue={editingClient?.structure} rows={3} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" placeholder="Ex: landing page, WhatsApp, criativos, CRM, checkout, pixel, Google Tag Manager..." />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <MoneyField label="Valor da gestão" name="monthlyFee" defaultValue={editingClient?.monthlyFee} />
            <Field label="Dia de vencimento" name="dueDay" type="number" min="1" max="31" defaultValue={editingClient?.dueDay ?? 10} />
          </div>

          <div>
            <div className="mb-3 grid gap-4 md:grid-cols-[1fr_220px] md:items-end">
              <p className="text-sm font-semibold text-brand-soft">Investimento em anúncios</p>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-brand-soft">Período do investimento</span>
                <select name="adInvestmentPeriod" defaultValue={editingClient?.adInvestmentPeriod ?? 'monthly'} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                  {investmentPeriods.map((period) => (
                    <option key={period.value} value={period.value}>
                      {period.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <MoneyField label="Facebook/Meta" name="adInvestmentMeta" defaultValue={editingClient?.adInvestmentMeta} />
              <MoneyField label="Google" name="adInvestmentGoogle" defaultValue={editingClient?.adInvestmentGoogle} />
              <MoneyField label="YouTube" name="adInvestmentYoutube" defaultValue={editingClient?.adInvestmentYoutube} />
              <MoneyField label="TikTok" name="adInvestmentTikTok" defaultValue={editingClient?.adInvestmentTikTok} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Status</span>
              <select name="status" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" defaultValue={editingClient?.status ?? 'lead'}>
                <option value="lead">Lead</option>
                <option value="active">Ativo</option>
                <option value="paused">Pausado</option>
              </select>
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-sm font-semibold text-brand-soft">
              <input name="hasProject" type="checkbox" defaultChecked={editingClient?.hasProject || !!editingClient?.projectId} className="h-4 w-4 accent-brand-green" />
              Cliente vinculado a uma estrutura de projeto
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Observações</span>
            <textarea name="notes" defaultValue={editingClient?.notes} rows={3} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" />
          </label>

          <div className="flex justify-end gap-3 border-t border-brand-line pt-5">
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setEditingClientId(null);
              }}
              className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft"
            >
              Cancelar
            </button>
            <button className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink">{editingClient ? 'Salvar alterações' : 'Salvar cliente'}</button>
          </div>
        </form>
      </Modal>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {data.clients.map((client) => {
          const campaigns = data.campaigns.filter((campaign) => campaign.clientId === client.id);
          const pending = data.receivables.filter((item) => item.clientId === client.id && item.status !== 'paid');
          const totalAds =
            client.adInvestmentMeta + client.adInvestmentGoogle + client.adInvestmentYoutube + client.adInvestmentTikTok;
          const monthlyAds = normalizeMonthlyInvestment(totalAds, client.adInvestmentPeriod);
          const project = data.projects.find((item) => item.id === client.projectId);
          return (
            <article key={client.id} className="rounded-xl border border-brand-line bg-brand-ink p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">{client.name}</h2>
                  <p className="mt-1 text-sm text-brand-muted">{client.company || client.segment || 'Sem empresa informada'}</p>
                  {project && <p className="mt-1 text-xs font-semibold text-brand-green">Projeto: {project.name}</p>}
                </div>
                <select value={client.status} onChange={(event) => setStatus(client.id, event.target.value as ClientStatus)} className="rounded-md border border-brand-line bg-brand-surface px-2 py-1 text-xs text-white">
                  <option value="active">Ativo</option>
                  <option value="lead">Lead</option>
                  <option value="paused">Pausado</option>
                </select>
              </div>
              <button
                onClick={() => {
                  setEditingClientId(client.id);
                  setModalOpen(true);
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-brand-line px-3 py-2 text-sm font-semibold text-brand-soft transition hover:border-brand-green hover:text-white"
              >
                <Edit3 size={15} />
                Editar dados
              </button>
              <p className="mt-5 flex items-center gap-2 text-sm text-brand-muted"><Mail size={15} /> {client.contact || 'Contato não informado'}</p>
              {client.structure && <p className="mt-3 text-sm leading-relaxed text-brand-muted">{client.structure}</p>}
              <div className="mt-5 grid grid-cols-3 gap-2">
                <Mini label={client.managementFeeType === 'recurring' ? 'Mensalidade' : 'Pontual'} value={money(client.monthlyFee)} />
                <Mini label="Vence dia" value={client.dueDay.toString()} />
                <Mini label="Campanhas" value={campaigns.length.toString()} />
              </div>
              <div className="mt-4 rounded-lg bg-brand-surface p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Investimento em tráfego</p>
                <p className="mt-1 text-lg font-black text-brand-green">{money(totalAds)} <span className="text-xs text-brand-muted">/{periodLabel(client.adInvestmentPeriod)}</span></p>
                <p className="text-xs text-brand-muted">Equivalente mensal estimado: {money(monthlyAds)}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Mini label="Facebook/Meta" value={money(client.adInvestmentMeta)} />
                  <Mini label="Google" value={money(client.adInvestmentGoogle)} />
                  <Mini label="YouTube" value={money(client.adInvestmentYoutube)} />
                  <Mini label="TikTok" value={money(client.adInvestmentTikTok)} />
                </div>
              </div>
              <div className="mt-4 rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">A receber</p>
                <p className="mt-1 text-lg font-black text-brand-green">{money(pending.reduce((sum, item) => sum + item.amount, 0))}</p>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-brand-muted">{client.notes}</p>
            </article>
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

function periodLabel(period: InvestmentPeriod) {
  if (period === 'daily') return 'dia';
  if (period === 'weekly') return 'semana';
  return 'mês';
}

function Header({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action: string; onAction: () => void }) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-black text-white">{title}</h1>
      </div>
      <button onClick={onAction} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-brand-ink">
        <Plus size={18} />
        {action}
      </button>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-brand-surface p-3">
      <p className="text-[11px] text-brand-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}
