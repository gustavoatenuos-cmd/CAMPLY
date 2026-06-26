import { FormEvent } from 'react';
import { CamplyData, Client, BillingType, InvestmentPeriod, ClientStatus } from '../types';
import { createActivityLog, makeId } from '../data/camplyStore';
import React from 'react';
import { Modal } from './ui/Modal';

interface ClientFormModalProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  editingClient: Client | null | undefined;
  open: boolean;
  onClose: () => void;
}

const billingTypes = [
  { value: 'recurring', label: 'Mensalidade recorrente' },
  { value: 'one_time', label: 'Pagamento pontual' },
];

const investmentPeriods = [
  { value: 'daily', label: 'Por dia' },
  { value: 'weekly', label: 'Por semana' },
  { value: 'monthly', label: 'Por mês' },
];

export function ClientFormModal({ data, updateData, editingClient, open, onClose }: ClientFormModalProps) {
  const saveClient = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    
    const nextClient: Client = {
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
    
    onClose();
  };

  return (
    <Modal
      title={editingClient ? 'Editar cliente' : 'Novo cliente'}
      description="Cadastre a empresa, estrutura trabalhada, investimento de mídia e dados operacionais."
      open={open}
      onClose={onClose}
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
            onClick={onClose}
            className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft"
          >
            Cancelar
          </button>
          <button className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink">{editingClient ? 'Salvar alterações' : 'Salvar cliente'}</button>
        </div>
      </form>
    </Modal>
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
