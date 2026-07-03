import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CamplyData, Client, BillingType, InvestmentPeriod, ClientStatus } from '../types';
import { createActivityLog, makeId } from '../data/camplyStore';
import React from 'react';
import { Modal } from './ui/Modal';
import {
  analysisTemplates,
  analysisVerticals,
  applyAnalysisTemplate,
  defaultAnalysisProfile,
  loadSavedAnalysisTemplates,
  loadClientAnalysisProfile,
  metricLabels,
  primaryChannels,
  primaryObjectiveConfig,
  primaryObjectives,
  profileMetricOptions,
  saveAnalysisTemplate,
  suggestedGoalsForObjective,
  subsegmentsByVertical,
  upsertClientAnalysisProfile,
  type BudgetPeriod,
  type ClientAnalysisProfile,
  type GoalExpectationType,
  type PerformanceGoal,
  type PrimaryObjective,
  type SavedAnalysisTemplate,
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
  const [savedTemplates, setSavedTemplates] = useState<SavedAnalysisTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const performanceGoals = profileDraft.performanceGoals || [];

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const fallback = defaultAnalysisProfile(editingClient?.id ?? 'new', {
      vertical: editingClient?.segment || undefined,
      budgetPeriod: editingClient?.adInvestmentPeriod as BudgetPeriod | undefined,
      plannedBudget: editingClient?.adInvestmentMeta || null,
    });
    setProfileDraft(fallback);
    setTemplateId('custom');
    void loadSavedAnalysisTemplates().then((templates) => { if (alive) setSavedTemplates(templates); });
    if (editingClient?.id) {
      void loadClientAnalysisProfile(editingClient.id)
        .then((profile) => {
          if (alive && profile) setProfileDraft(profile);
        })
        .catch(() => {
          // Mantém o modal utilizável em ambientes onde a migration ainda não foi aplicada.
        });
    }
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
    const template = [...analysisTemplates, ...savedTemplates].find((item) => item.id === id);
    if (!template) return;
    if (performanceGoals.length > 0 && !window.confirm('Aplicar este modelo substituirá as metas em edição. Deseja continuar?')) return;
    setTemplateId(id);
    setProfileDraft((current) => applyAnalysisTemplate(current, template));
  };

  const selectObjective = (objective: PrimaryObjective | null) => {
    if (!objective) {
      updateProfile({ primaryObjective: null });
      return;
    }
    const config = primaryObjectiveConfig(objective);
    const suggestions = performanceGoals.length === 0 ? suggestedGoalsForObjective(objective) : performanceGoals;
    updateProfile({
      primaryObjective: objective,
      primaryConversionMetric: config.primaryMetric,
      primaryChannel: config.channel,
      performanceGoals: suggestions,
      secondaryMetrics: Array.from(new Set(suggestions.map((item) => item.metricId))),
    });
  };

  const replaceWithSuggestions = () => {
    if (!profileDraft.primaryObjective) return;
    if (performanceGoals.length > 0 && !window.confirm('Substituir as metas atuais pelas sugestões deste objetivo?')) return;
    const goals = suggestedGoalsForObjective(profileDraft.primaryObjective);
    updateProfile({ performanceGoals: goals, secondaryMetrics: goals.map((item) => item.metricId) });
  };

  const updateGoal = (id: string, patch: Partial<PerformanceGoal>) => updateProfile({
    performanceGoals: performanceGoals.map((item) => item.id === id ? { ...item, ...patch } : item),
    secondaryMetrics: Array.from(new Set(performanceGoals.map((item) => item.id === id ? String(patch.metricId || item.metricId) : item.metricId))),
  });

  const addGoal = () => {
    const next: PerformanceGoal = {
      id: `goal-${crypto.randomUUID()}`,
      metricId: 'cpm', expectationType: 'maximum', value: null,
      minValue: null, maxValue: null, warningTolerancePercent: 10,
      criticalTolerancePercent: 25, weight: 1,
    };
    updateProfile({ performanceGoals: [...performanceGoals, next] });
  };

  const removeGoal = (id: string) => {
    const remaining = performanceGoals.filter((item) => item.id !== id);
    updateProfile({ performanceGoals: remaining, secondaryMetrics: Array.from(new Set(remaining.map((item) => item.metricId))) });
  };

  const saveCurrentAsTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setError('Informe um nome para o modelo personalizado.');
      return;
    }
    try {
      const saved = await saveAnalysisTemplate(name, profileDraft);
      setSavedTemplates((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setTemplateId(saved.id);
      setTemplateName('');
      setError('');
    } catch (templateError) {
      setError(templateError instanceof Error ? templateError.message : 'Não foi possível salvar o modelo.');
    }
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
    const commercialMetaBudget = editingClient?.adInvestmentMeta ?? 0;
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
                <option value="custom">Criar sem modelo</option>
                {analysisTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.label}</option>
                ))}
                {savedTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.label} · personalizado</option>
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
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Objetivo principal da operação</span>
              <select value={profileDraft.primaryObjective || ''} onChange={(event) => selectObjective((event.target.value || null) as PrimaryObjective | null)} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="">Configuração pendente</option>
                {primaryObjectives.map((objective) => <option key={objective.id} value={objective.id}>{objective.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Canal principal</span>
              <select value={profileDraft.primaryChannel} onChange={(event) => updateProfile({ primaryChannel: event.target.value })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green">
                {primaryChannels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Resultado acompanhado</span>
              <div className="rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-sm text-brand-soft">{profileDraft.primaryObjective ? metricLabels[profileDraft.primaryConversionMetric] : 'Defina o objetivo principal'}</div>
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
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Plataforma do orçamento</span>
              <select value={profileDraft.budgetPlatform || 'meta'} onChange={(event) => updateProfile({ budgetPlatform: event.target.value as ClientAnalysisProfile['budgetPlatform'] })} className="w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="meta">Meta Ads</option><option value="google">Google Ads</option><option value="youtube">YouTube Ads</option><option value="tiktok">TikTok Ads</option>
              </select>
            </label>
          </div>
          <div className="mt-5 rounded-xl border border-brand-line bg-brand-ink/40 p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-black text-white">Metas de performance</p><p className="text-xs text-brand-muted">Configure somente as métricas que entram na análise e no score.</p></div>
              <div className="flex flex-wrap gap-2"><button type="button" onClick={replaceWithSuggestions} disabled={!profileDraft.primaryObjective} className="rounded-lg border border-brand-line px-3 py-2 text-xs font-bold text-brand-soft disabled:opacity-50">Usar sugestões</button><button type="button" onClick={addGoal} className="rounded-lg bg-brand-green px-3 py-2 text-xs font-black text-brand-ink">+ Adicionar métrica</button></div>
            </div>
            <div className="mt-3 space-y-3">
              {performanceGoals.length === 0 && <p className="rounded-lg border border-dashed border-brand-line p-4 text-sm text-brand-muted">Nenhuma meta configurada. O score ficará inconclusivo até você adicionar uma métrica.</p>}
              {performanceGoals.map((goal) => <GoalEditor key={goal.id} goal={goal} onChange={(patch) => updateGoal(goal.id, patch)} onRemove={() => removeGoal(goal.id)} />)}
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} className="rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white outline-none focus:border-brand-green" placeholder="Nome do novo modelo personalizado" />
            <button type="button" onClick={() => void saveCurrentAsTemplate()} className="rounded-lg border border-brand-green/50 px-3 py-2 text-sm font-bold text-brand-green">Salvar como modelo</button>
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
          <p className="mb-3 rounded-lg border border-brand-green/20 bg-brand-green/5 p-3 text-xs text-brand-soft">O orçamento Meta é definido no Perfil de análise e sincronizado com o cadastro comercial.</p>
          <div className="grid gap-4 md:grid-cols-3">
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

const expectationLabels: Record<GoalExpectationType, string> = {
  maximum: 'Máximo desejado', minimum: 'Mínimo desejado', range: 'Faixa desejada', quantity_minimum: 'Quantidade mínima',
};

function GoalEditor({ goal, onChange, onRemove }: { goal: PerformanceGoal; onChange: (patch: Partial<PerformanceGoal>) => void; onRemove: () => void }) {
  const numberValue = (value: string) => value === '' ? null : Number(value);
  return (
    <div className="rounded-xl border border-brand-line bg-brand-surface/70 p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-bold text-brand-soft">Métrica<select value={goal.metricId} onChange={(event) => onChange({ metricId: event.target.value })} className="mt-1 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white">{profileMetricOptions.map((id) => <option key={id} value={id}>{metricLabels[id] || id}</option>)}</select></label>
        <label className="text-xs font-bold text-brand-soft">Tipo de expectativa<select value={goal.expectationType} onChange={(event) => onChange({ expectationType: event.target.value as GoalExpectationType })} className="mt-1 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white">{Object.entries(expectationLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {goal.expectationType === 'range' ? <><GoalNumber label="Mínimo" value={goal.minValue} onChange={(value) => onChange({ minValue: value })} /><GoalNumber label="Máximo" value={goal.maxValue} onChange={(value) => onChange({ maxValue: value })} /></> : <GoalNumber label="Valor desejado" value={goal.value} onChange={(value) => onChange({ value })} />}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <GoalNumber label="Tolerância de atenção (%)" value={goal.warningTolerancePercent} onChange={(value) => onChange({ warningTolerancePercent: value ?? 0 })} />
        <GoalNumber label="Tolerância crítica (%)" value={goal.criticalTolerancePercent} onChange={(value) => onChange({ criticalTolerancePercent: value ?? 0 })} />
        <GoalNumber label="Peso no score" value={goal.weight} onChange={(value) => onChange({ weight: value ?? 1 })} />
      </div>
      <button type="button" onClick={onRemove} className="mt-3 text-xs font-bold text-rose-200">Remover métrica</button>
    </div>
  );

  function GoalNumber({ label, value, onChange: change }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
    return <label className="text-xs font-bold text-brand-soft">{label}<input type="number" min="0" step="0.01" value={value ?? ''} onChange={(event) => change(numberValue(event.target.value))} className="mt-1 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white" /></label>;
  }
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
