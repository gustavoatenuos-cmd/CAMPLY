import { FormEvent, useMemo, useState, type InputHTMLAttributes } from 'react';
import { Columns3, Edit3, Filter, Megaphone, Plus, Search, Layers } from 'lucide-react';
import { campaignColumns, campaignStatusLabels, createActivityLog, makeId, money } from '../data/camplyStore';
import { campaignPlatforms, metaCampaignObjectives } from '../data/options';
import type { Campaign, CampaignStatus, CamplyData, Priority } from '../types';
import { clientDisplayName, clientOptionLabel } from './ClientsView';
import { Modal } from './ui/Modal';
import { MetaCampaignsBoard } from './campaigns/MetaCampaignsBoard';
import { isClientOperationallyActive } from '../data/receivablesForecast';

interface CampaignsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  onOpenMetaIntegration?: () => void;
}

type CampaignsTab = 'meta' | 'kanban';

export function CampaignsView({ data, updateData, onOpenMetaIntegration }: CampaignsViewProps) {
  const [tab, setTab] = useState<CampaignsTab>('meta');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Use the same operational rule as Meta sync and the analytical board.
  const activeClients = useMemo(
    () => data.clients.filter((client) => isClientOperationallyActive(
      client,
      data.projects.find((project) => project.id === client.projectId),
    )),
    [data.clients, data.projects]
  );

  const activeClientIds = useMemo(
    () => new Set(activeClients.map((client) => client.id)),
    [activeClients]
  );

  // Filter campaigns related to active clients in the base
  const activeCampaigns = useMemo(() => {
    return data.campaigns.filter((campaign) => {
      const isClientActive = activeClientIds.has(campaign.clientId);
      const matchesClient = selectedClientId === 'all' || campaign.clientId === selectedClientId;
      const matchesPlatform = selectedPlatform === 'all' || campaign.platform === selectedPlatform;
      const matchesSearch = !searchQuery.trim() || campaign.name.toLowerCase().includes(searchQuery.toLowerCase());
      return isClientActive && matchesClient && matchesPlatform && matchesSearch;
    });
  }, [data.campaigns, activeClientIds, selectedClientId, selectedPlatform, searchQuery]);

  const editing = data.campaigns.find((campaign) => campaign.id === editingId);

  const saveCampaign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientId = String(form.get('clientId') || '');
    const name = String(form.get('name') || '').trim();
    const client = data.clients.find((item) => item.id === clientId);
    if (!client || !name) return;

    const campaign: Campaign = {
      id: editing?.id || makeId('campaign'),
      clientId,
      name,
      platform: String(form.get('platform') || 'Meta Ads') as Campaign['platform'],
      status: String(form.get('status') || 'setup') as CampaignStatus,
      objective: String(form.get('objective') || 'Tráfego'),
      budget: Number(form.get('budget') || 0),
      spent: editing?.spent || 0,
      lastOptimizedAt: editing?.lastOptimizedAt || new Date().toISOString(),
      nextAction: String(form.get('nextAction') || ''),
      priority: String(form.get('priority') || 'medium') as Priority,
      isMatrix: true,
      subCampaignIds: editing?.subCampaignIds || [],
    };

    updateData((current) => ({
      ...current,
      campaigns: editing
        ? current.campaigns.map((item) => item.id === editing.id ? campaign : item)
        : [campaign, ...current.campaigns],
      activityLogs: [createActivityLog({
        action: 'campaign_created',
        title: editing ? `Campanha editada: ${name}` : `Campanha criada: ${name}`,
        description: `${campaign.platform} para ${clientDisplayName(client)}.`,
        projectId: client.projectId,
        clientId,
        campaignId: campaign.id,
        receivableId: '', taskId: '',
      }), ...current.activityLogs],
    }));

    setModalOpen(false);
    setEditingId(null);
  };

  const setStatus = (campaign: Campaign, status: CampaignStatus) => {
    updateData((current) => ({
      ...current,
      campaigns: current.campaigns.map((item) => item.id === campaign.id ? { ...item, status, lastOptimizedAt: new Date().toISOString() } : item),
      activityLogs: [createActivityLog({
        action: 'campaign_status_changed',
        title: `Campanha movida: ${campaign.name}`,
        description: `Etapa operacional alterada para ${campaignStatusLabels[status]}.`,
        projectId: '', clientId: campaign.clientId, campaignId: campaign.id, receivableId: '', taskId: '',
      }), ...current.activityLogs],
    }));
  };

  return (
    <section className="h-full overflow-y-auto bg-brand-ink p-4 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-[1700px] space-y-6">

        {/* Header */}
        <header className="flex flex-col gap-4 rounded-2xl border border-brand-line bg-brand-surface p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-green">
              <Megaphone size={17} />
              <p className="text-xs font-bold uppercase tracking-[0.2em]">Gestão Operacional</p>
            </div>
            <h1 className="mt-2 text-3xl font-black text-white">Campanhas</h1>
            <p className="mt-1 text-sm text-brand-muted">
              {tab === 'meta'
                ? `Campanhas reais da Meta dos ${activeClients.length} clientes ativos, organizadas pelo objetivo definido no Gerenciador de Anúncios.`
                : `Acompanhamento de execução e otimização das contas ativas na sua base de clientes (${activeClients.length} clientes ativos).`}
            </p>
            <div role="tablist" aria-label="Visão de campanhas" className="mt-4 inline-flex rounded-xl border border-brand-line bg-brand-ink p-1">
              {([['meta', 'Campanhas Meta'], ['kanban', 'Kanban operacional']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${tab === id ? 'bg-brand-green text-brand-ink' : 'text-brand-muted hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {tab === 'kanban' && (
            <button
              type="button"
              onClick={() => { setEditingId(null); setModalOpen(true); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-4 py-3 text-sm font-black text-brand-ink transition hover:bg-brand-green/90"
            >
              <Plus size={17} /> Nova Campanha
            </button>
          )}
        </header>

        {tab === 'meta' && <MetaCampaignsBoard data={data} onOpenMetaIntegration={onOpenMetaIntegration} />}

        {tab === 'kanban' && (<>
        {/* Filtros da operação */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-brand-line bg-brand-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-muted">
              <Filter size={14} className="text-brand-green" />
              Filtros:
            </div>

            {/* Filtro por Cliente */}
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="rounded-lg border border-brand-line bg-brand-ink px-3 py-1.5 text-xs font-medium text-white focus:border-brand-green focus:outline-none"
            >
              <option value="all">Todos os Clientes Ativos ({activeClients.length})</option>
              {activeClients.map((client) => (
                <option key={client.id} value={client.id}>{clientDisplayName(client)}</option>
              ))}
            </select>

            {/* Filtro por Plataforma */}
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="rounded-lg border border-brand-line bg-brand-ink px-3 py-1.5 text-xs font-medium text-white focus:border-brand-green focus:outline-none"
            >
              <option value="all">Todas as Plataformas</option>
              {campaignPlatforms.map((platform) => (
                <option key={platform} value={platform}>{platform}</option>
              ))}
            </select>
          </div>

          {/* Busca por Nome */}
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-2.5 text-brand-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar campanha..."
              className="w-full rounded-lg border border-brand-line bg-brand-ink pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-brand-muted focus:border-brand-green focus:outline-none"
            />
          </div>
        </div>

        {/* Quadro Kanban Por Colunas */}
        <div className="grid gap-4 overflow-x-auto pb-4 md:grid-cols-2 xl:grid-cols-6">
          {campaignColumns.map((colStatus) => {
            const colCampaigns = activeCampaigns.filter((c) => c.status === colStatus);
            return (
              <div key={colStatus} className="flex flex-col rounded-2xl border border-brand-line bg-brand-surface p-4">
                <div className="flex items-center justify-between border-b border-brand-line/50 pb-3 mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-brand-green">
                    {campaignStatusLabels[colStatus]}
                  </span>
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-ink px-2 text-[10px] font-bold text-brand-muted">
                    {colCampaigns.length}
                  </span>
                </div>

                <div className="space-y-3 flex-1">
                  {colCampaigns.map((campaign) => {
                    const client = data.clients.find((item) => item.id === campaign.clientId);
                    return (
                      <article key={campaign.id} className="rounded-xl border border-brand-line bg-brand-ink/80 p-3.5 transition hover:border-brand-green/30">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <span className="inline-block rounded bg-brand-surface px-2 py-0.5 text-[9px] font-bold uppercase text-brand-green">
                              {campaign.platform}
                            </span>
                            <h3 className="mt-1 text-sm font-bold text-white truncate" title={campaign.name}>
                              {campaign.name}
                            </h3>
                            <p className="text-xs text-brand-muted truncate mt-0.5">
                              {clientDisplayName(client)}
                            </p>
                          </div>
                          <button
                            type="button"
                            aria-label={`Editar ${campaign.name}`}
                            onClick={() => { setEditingId(campaign.id); setModalOpen(true); }}
                            className="rounded-lg border border-brand-line p-1.5 text-brand-muted hover:text-white transition"
                          >
                            <Edit3 size={13} />
                          </button>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded bg-brand-surface/60 p-2">
                            <p className="text-[9px] uppercase text-brand-muted">Verba</p>
                            <p className="font-bold text-white">{money(campaign.budget)}</p>
                          </div>
                          <div className="rounded bg-brand-surface/60 p-2">
                            <p className="text-[9px] uppercase text-brand-muted">Prioridade</p>
                            <p className={`font-bold uppercase ${
                              campaign.priority === 'high' ? 'text-red-400' : campaign.priority === 'medium' ? 'text-amber-400' : 'text-brand-soft'
                            }`}>
                              {campaign.priority}
                            </p>
                          </div>
                        </div>

                        <select
                          value={campaign.status}
                          onChange={(event) => setStatus(campaign, event.target.value as CampaignStatus)}
                          className="mt-3 w-full rounded-lg border border-brand-line bg-brand-surface px-2 py-1 text-[11px] text-white focus:border-brand-green focus:outline-none"
                        >
                          {campaignColumns.map((status) => (
                            <option key={status} value={status}>{campaignStatusLabels[status]}</option>
                          ))}
                        </select>

                        {campaign.nextAction && (
                          <p className="mt-2 text-[10px] text-brand-muted truncate" title={campaign.nextAction}>
                            Próxima ação: <span className="text-brand-soft">{campaign.nextAction}</span>
                          </p>
                        )}
                      </article>
                    );
                  })}

                  {colCampaigns.length === 0 && (
                    <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-brand-line/40 text-center text-xs text-brand-muted">
                      Vazio
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </>)}

        {/* Modal de Criação / Edição */}
        <Modal
          title={editing ? 'Editar Campanha Operacional' : 'Nova Campanha Operacional'}
          description="Acompanhamento e planejamento operacional vinculado à sua base de clientes."
          open={modalOpen}
          onClose={() => { setModalOpen(false); setEditingId(null); }}
        >
          <form key={editing?.id || 'new'} onSubmit={saveCampaign} className="space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nome da Campanha" name="name" defaultValue={editing?.name} required />
              <label className="text-sm font-bold text-brand-soft">
                Cliente Ativo
                <select name="clientId" defaultValue={editing?.clientId || ''} required className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white">
                  <option value="">Selecione o Cliente</option>
                  {activeClients.map((client) => (
                    <option key={client.id} value={client.id}>{clientOptionLabel(client, data.projects)}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-bold text-brand-soft">
                Plataforma
                <select name="platform" defaultValue={editing?.platform || 'Meta Ads'} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white">
                  {campaignPlatforms.map((platform) => <option key={platform}>{platform}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-brand-soft">
                Objetivo
                <select name="objective" defaultValue={String(editing?.objective || 'Tráfego')} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white">
                  {metaCampaignObjectives.map((objective) => <option key={objective}>{objective}</option>)}
                </select>
              </label>
              <Field label="Verba Planejada (R$)" name="budget" type="number" min="0" step="0.01" defaultValue={editing?.budget || 0} />
              <label className="text-sm font-bold text-brand-soft">
                Prioridade
                <select name="priority" defaultValue={editing?.priority || 'medium'} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white">
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                </select>
              </label>
              <label className="text-sm font-bold text-brand-soft">
                Etapa Kanban
                <select name="status" defaultValue={editing?.status || 'setup'} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white">
                  {campaignColumns.map((status) => <option key={status} value={status}>{campaignStatusLabels[status]}</option>)}
                </select>
              </label>
              <Field label="Próxima Ação" name="nextAction" defaultValue={editing?.nextAction} />
            </div>
            <div className="flex justify-end gap-2 border-t border-brand-line pt-4">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-brand-line px-4 py-2 font-bold text-brand-soft">
                Cancelar
              </button>
              <button className="rounded-lg bg-brand-green px-4 py-2 font-black text-brand-ink">
                Salvar
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </section>
  );
}

function Field({ label, name, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="text-sm font-bold text-brand-soft">
      {label}
      <input name={name} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white" {...props} />
    </label>
  );
}
