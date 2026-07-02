import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CamplyData, Client, BillingType, InvestmentPeriod, ClientStatus } from '../types';
import { createActivityLog, makeId } from '../data/camplyStore';
import React from 'react';
import { Modal } from './ui/Modal';
import {
  analysisTemplates,
  analysisVerticals,
  businessModels,
  defaultAnalysisProfile,
  loadClientAnalysisProfile,
  metricLabels,
  primaryChannels,
  primaryConversionMetrics,
  profileMetricOptions,
  subsegmentsByVertical,
  upsertClientAnalysisProfile,
  type BudgetPeriod,
  type ClientAnalysisProfile,
} from '../lib/analysis/clientAnalysisProfile';

interface ClientFormModalProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  editingClient: Client | null | undefined;
  open: boolean;
  onClose: () => void;
  persistClientData?: (nextData: CamplyData, clientId: string) => Promise<void>;
  onClientPersisted?: (clientId: string) => void;
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

export function ClientFormModal({
  data,
  updateData,
  editingClient,
  open,
  onClose,
  persistClientData,
  onClientPersisted,
}: ClientFormModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [profileDraft, setProfileDraft] = useState<ClientAnalysisProfile>(() => defaultAnalysisProfile(editingClient?.id ?? 'new'));
  const [templateId, setTemplateId] = useState('custom');

  useEffect(() => {
    if (!open) return;
    const fallback = defaultAnalysisProfile(editingClient?.id ?? 'new', {
      vertical: editingClient?.segment || undefined,
      budgetPeriod: editingClient?.adInvestmentPeriod as BudgetPeriod | undefined,
      plannedBudget: editingClient?.adInvestmentMeta || null,
    });
    setProfileDraft(fallback);
    setTemplateId('custom');
    if (!editingClient?.id) return;
    let alive = true;
    void loadClientAnalysisProfile(editingClient.id)
      .then((profile) => {
        if (alive && profile) setProfileDraft(profile);
      })
      .catch(() => {
        // Mantém o modal utilizável em ambientes onde a migration ainda não foi aplicada.
      });
    return () => {
      alive = false;
    };
  }, [editingClient, open]);

  const subsegmentOptions = useMemo(() => (
    subsegmentsByVertical[profileDraft.vertical] || ['Outros']
  ), [profileDraft.vertical]);

  const updateProfile = (patch: Partial<ClientAnalysisProfile>) => {
    setProfileDraft((current) => ({ ...current, ...patch }));
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = analysisTemplates.find((item) => item.id === id);
    if (!template) return;
    updateProfile({
      vertical: template.vertical,
      subsegment: template.subsegment,
      businessModel: template.businessModel,
      primaryConversionMetric: template.primaryConversionMetric,
      secondaryMetrics: template.secondaryMetrics,
      primaryChannel: template.primaryChannel,
      budgetPeriod: template.budgetPeriod,
    });
  };

  const closeIfIdle = () => {
    if (saving) return;
    setError('');
    onClose();
  };

  const saveClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    const commercialMetaBudget = Number(form.get('adInvestmentMeta') ?? 0);
    const profileBudget = profileDraft.plannedBudget == null
      ? (Number.isFinite(commercialMetaBudget) && commercialMetaBudget > 0 ? commercialMetaBudget : null)
      : Number(profileDraft.plannedBudget);
    
    const nextClient: Client = {
      id: editingClient?.id ?? makeId('client'),
      projectId: String(form.get('projectId') ?? ''),
      name,
      company: String(form.get('company') ?? ''),
      segment: String(profileDraft.vertical || form.get('segment') || ''),
      structure: String(form.get('structure') ?? ''),
      hasProject: form.get('hasProject') === 'on',
      contact: String(form.get('contact') ?? ''),
      monthlyFee: Number(form.get('monthlyFee') ?? 0),
      managementFeeType: String(form.get('managementFeeType') ?? 'recurring') as BillingType,
      dueDay: Number(form.get('dueDay') ?? 10),
      adInvestmentPeriod: profileDraft.budgetPeriod as InvestmentPeriod,
      adInvestmentMeta: Number.isFinite(profileBudget ?? commercialMetaBudget) ? (profileBudget ?? commercialMetaBudget) : 0,
      adInvestmentGoogle: Number(form.get('adInvestmentGoogle') ?? 0),
      adInvestmentYoutube: Number(form.get('adInvestmentYoutube') ?? 0),
      adInvestmentTikTok: Number(form.get('adInvestmentTikTok') ?? 0),
      status: String(form.get('status') ?? 'lead') as ClientStatus,
      notes: String(form.get('notes') ?? ''),
    };
    const analysisProfile: ClientAnalysisProfile = {
      ...profileDraft,
      clientId: nextClient.id,
      plannedBudget: Number.isFinite(profileBudget) ? profileBudget : null,
      secondaryMetrics: Array.from(new Set(profileDraft.secondaryMetrics.filter(Boolean))),
    };

    const nextData: CamplyData = {
      ...data,
      clients: editingClient
        ? data.clients.map((client) => (client.id === editingClient.id ? nextClient : client))
        : [nextClient, ...data.clients],
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
        ...data.activityLogs,
      ],
    };

    setSaving(true);
    setError('');
    try {
      if (persistClientData) {
        await persistClientData(nextData, nextClient.id);
      } else {
        updateData(() => nextData);
      }
      const persistedProfile = await upsertClientAnalysisProfile(analysisProfile);
      const confirmedProfile = await loadClientAnalysisProfile(nextClient.id) ?? persistedProfile;
      setProfileDraft(confirmedProfile);
      onClientPersisted?.(nextClient.id);
      setError('');
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o cliente no banco.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editingClient ? 'Editar cliente' : 'Novo cliente'}
      description="Cadastre a empresa, estrutura trabalhada, investimento de mídia e dados operacionais."
      open={open}
      onClose={closeIfIdle}
    >
      <form key={editingClient?.id ?? 'new-client'} onSubmit={saveClient} className="space-y-5 p-5">
        {error && (
          <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome do responsável" name="name" defaultValue={editingClient?.name} required />
          <Field label="Empresa / marca" name="company" defaultValue={editingClient?.company} />
          <Field label="Contato principal" name="contact" defaultValue={editingClient?.contact} placeholder="E-mail, telefone ou WhatsApp" />
        </div>

        <section className="rounded-2xl border border-brand-line bg-brand-surface/70 p-4">
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green">Perfil de análise</p>
            <p className="mt-1 text-sm text-brand-muted">O template sugere uma leitura inicial, mas todos os campos podem ser editados antes de salvar.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Modelo sugerido</span>
              <select value={templateId} onChange={(event) => applyTemplate(event.target.value)} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="custom">Personalizado / manter edição</option>
                {analysisTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Segmento principal</span>
              <select value={profileDraft.vertical} onChange={(event) => updateProfile({ vertical: event.target.value, subsegment: subsegmentsByVertical[event.target.value]?.[0] || 'Outros', customVertical: null, customSubsegment: null })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green">
                {analysisVerticals.map((vertical) => <option key={vertical} value={vertical}>{vertical}</option>)}
              </select>
            </label>
            {profileDraft.vertical === 'Outros' && (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-brand-soft">Segmento personalizado</span>
                <input value={profileDraft.customVertical ?? ''} onChange={(event) => updateProfile({ customVertical: event.target.value || null })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green" placeholder="Ex.: Turismo" />
              </label>
            )}
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Subsegmento</span>
              <input list="client-subsegments" value={profileDraft.subsegment} onChange={(event) => updateProfile({ subsegment: event.target.value })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green" />
              <datalist id="client-subsegments">
                {subsegmentOptions.map((subsegment) => <option key={subsegment} value={subsegment} />)}
              </datalist>
            </label>
            {profileDraft.subsegment === 'Outros' && (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-brand-soft">Subsegmento personalizado</span>
                <input value={profileDraft.customSubsegment ?? ''} onChange={(event) => updateProfile({ customSubsegment: event.target.value || null })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green" placeholder="Ex.: Agência de viagens" />
              </label>
            )}
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Modelo de negócio</span>
              <select value={profileDraft.businessModel} onChange={(event) => updateProfile({ businessModel: event.target.value })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green">
                {businessModels.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Canal principal</span>
              <select value={profileDraft.primaryChannel} onChange={(event) => updateProfile({ primaryChannel: event.target.value })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green">
                {primaryChannels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Conversão principal</span>
              <select value={profileDraft.primaryConversionMetric} onChange={(event) => updateProfile({ primaryConversionMetric: event.target.value })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green">
                {primaryConversionMetrics.map((metricId) => <option key={metricId} value={metricId}>{metricLabels[metricId] || metricId}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Periodicidade do orçamento</span>
              <select value={profileDraft.budgetPeriod} onChange={(event) => updateProfile({ budgetPeriod: event.target.value as BudgetPeriod })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="daily">Diário</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Orçamento planejado Meta</span>
              <input value={profileDraft.plannedBudget ?? ''} onChange={(event) => updateProfile({ plannedBudget: event.target.value === '' ? null : Number(event.target.value) })} type="number" min="0" step="0.01" className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Investimento mínimo para análise</span>
              <input value={profileDraft.minimumEvaluationSpend} onChange={(event) => updateProfile({ minimumEvaluationSpend: Number(event.target.value) })} type="number" min="0" step="0.01" className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Impressões mínimas</span>
              <input value={profileDraft.minimumImpressions} onChange={(event) => updateProfile({ minimumImpressions: Number(event.target.value) })} type="number" min="0" step="1" className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Resultados mínimos</span>
              <input value={profileDraft.minimumResults} onChange={(event) => updateProfile({ minimumResults: Number(event.target.value) })} type="number" min="0" step="1" className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Atraso de atribuição tolerado (horas)</span>
              <input value={profileDraft.attributionDelayHours} onChange={(event) => updateProfile({ attributionDelayHours: Number(event.target.value) })} type="number" min="0" step="1" className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green" />
            </label>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-brand-soft">Métricas que devem ser acompanhadas</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {profileMetricOptions.map((metricId) => {
                const checked = profileDraft.secondaryMetrics.includes(metricId);
                return (
                  <label key={metricId} className="flex items-center gap-2 rounded-lg border border-brand-line bg-brand-ink/70 px-3 py-2 text-xs font-semibold text-brand-soft">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => updateProfile({
                        secondaryMetrics: event.target.checked
                          ? [...profileDraft.secondaryMetrics, metricId]
                          : profileDraft.secondaryMetrics.filter((item) => item !== metricId),
                      })}
                      className="h-4 w-4 accent-brand-green"
                    />
                    {metricLabels[metricId] || metricId}
                  </label>
                );
              })}
            </div>
          </div>
          <label className="mt-4 flex items-center gap-3 rounded-lg border border-brand-line bg-brand-ink/70 px-3 py-2 text-sm font-semibold text-brand-soft">
            <input type="checkbox" checked={profileDraft.analysisEnabled} onChange={(event) => updateProfile({ analysisEnabled: event.target.checked })} className="h-4 w-4 accent-brand-green" />
            Usar este cliente na análise por segmento
          </label>
        </section>

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
              <select name="adInvestmentPeriod" value={profileDraft.budgetPeriod} onChange={(event) => updateProfile({ budgetPeriod: event.target.value as BudgetPeriod })} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
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
            onClick={closeIfIdle}
            disabled={saving}
            className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft disabled:cursor-wait disabled:opacity-60"
          >
            Cancelar
          </button>
          <button disabled={saving} className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink disabled:cursor-wait disabled:opacity-60">
            {saving ? 'Salvando no banco...' : editingClient ? 'Salvar alterações' : 'Salvar cliente'}
          </button>
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
